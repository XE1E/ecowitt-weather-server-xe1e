"""
Ecowitt Weather Station Receiver

Receives weather data from Ecowitt gateways via HTTP POST
and stores it in InfluxDB.
"""

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import asyncio
import logging
import os

from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo

from .config import settings
from .services.parser import parse_ecowitt_data, describe_device, resolve_station
from .services.converter import convert_to_metric, calculate_derived_values, sea_level_pressure
from .services.calibration import apply_calibration
from .services.quality import quality_check, spike_check, stats_check
from .services import stats_cache
from .services.air_quality import get_air_quality
from .services import imeca
from .services.publishers import publish_all
from .services import aggregator
from .services.almanac import sun_altitude
from .services import svitrix
from .services import admin as adminsvc
from .services import settings_store
from .services import security as secsvc
from .services.timelapse import TimelapseService, TimelapseError
from .services import backup_status
from .services.log_redact import install_redaction as _install_redaction

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


_install_redaction()


# Búfer de logs en memoria para el panel (vive en logs.py: lo lee el router de admin).
from .logs import memory_log_handler  # noqa: E402
memory_log_handler.setLevel(logging.INFO)
logging.getLogger().addHandler(memory_log_handler)

# Log persistente en el volumen /data (sobrevive a deploys/reinicios) con rotación.
try:
    from logging.handlers import RotatingFileHandler
    _log_dir = os.environ.get("LOG_DIR", "/data/logs")
    os.makedirs(_log_dir, exist_ok=True)
    _file_handler = RotatingFileHandler(
        os.path.join(_log_dir, "receiver.log"),
        maxBytes=2_000_000, backupCount=5, encoding="utf-8",
    )
    _file_handler.setLevel(logging.INFO)
    _file_handler.setFormatter(
        logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
    logging.getLogger().addHandler(_file_handler)
    logger.info("Log a archivo activo en %s/receiver.log", _log_dir)
except Exception as _e:
    logger.warning("No se pudo iniciar el log a archivo: %s", _e)

# Los handlers de memoria y de archivo se añadieron después de la primera
# llamada, así que hay que volver a barrer para que también filtren.
_install_redaction()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Arranque y apagado del receiver (reemplaza `@app.on_event`, deprecado por
    Starlette). Referencia objetos de módulo (storage, alert_service,
    mqtt_publisher, _camera) y las tareas de fondo (station_watchdog, etc.)
    definidos MÁS ABAJO en este archivo -- válido en Python porque el cuerpo
    de esta función solo se ejecuta cuando arranca la app, momento en el que
    el módulo ya se terminó de importar por completo.
    """
    logger.info("Starting Ecowitt Weather Station Receiver")
    logger.info(f"InfluxDB URL: {settings.influxdb_url}")
    logger.info(f"Output unit system: {settings.output_unit_system}")
    logger.info(
        f"Alerts: {'enabled' if settings.alerts_enabled else 'disabled'}"
        f"{' (Telegram)' if settings.telegram_enabled else ''}"
    )
    logger.info(
        f"MQTT: {'enabled' if settings.mqtt_enabled else 'disabled'}"
        f"{' (HA discovery)' if settings.hass_discovery else ''}"
    )
    mqtt_publisher.connect()

    # Repopulate the in-memory latest reading from InfluxDB so /api/current
    # survives restarts (shows the last stored value instead of "no data").
    # Se restaura la principal (None) y cada estación secundaria configurada.
    try:
        last = await storage.get_latest()
        if last:
            latest_by_station[None] = last
            logger.info("Loaded last primary reading from InfluxDB into memory")
        for name in set(settings.secondary_station_map.values()):
            last_s = await storage.get_latest(station=name)
            if last_s:
                latest_by_station[name] = last_s
                logger.info(f"Loaded last reading for station '{name}' from InfluxDB")
    except Exception as e:
        logger.warning(f"Could not preload last reading: {e}")

    # Cargar ajustes editables persistidos (panel admin) y aplicarlos
    try:
        overrides = settings_store.load_overrides(settings.settings_file)
        if overrides:
            adminsvc.apply_overrides(settings, alert_service, overrides)
            logger.info(f"Applied {len(overrides)} saved setting(s) from {settings.settings_file}")
    except Exception as e:
        logger.warning(f"Could not load saved settings: {e}")

    # Tareas de fondo (loops infinitos): se guardan para poder cancelarlas
    # ordenadamente en el shutdown, algo que el `on_event` anterior no hacía
    # -- morían de golpe junto con el proceso, sin graceful shutdown real.
    background_tasks = []
    # Vigilante de estación caída. Se crea SIEMPRE y mira `alerts_enabled` en cada
    # vuelta: antes sólo se creaba si las alertas estaban activas al arrancar, así que
    # prenderlas desde el panel no traía avisos de estación/cámara/respaldo hasta
    # reiniciar.
    background_tasks.append(asyncio.create_task(station_watchdog()))
    # Vigilante de calidad del aire (se auto-guarda con los flags; permite
    # activarlo desde el panel sin reiniciar)
    background_tasks.append(asyncio.create_task(air_quality_watchdog()))
    # Acumuladores: resumen diario (Dayfile) para récords/climatología
    background_tasks.append(asyncio.create_task(daily_rollup_task()))
    # Caché de medias/desviaciones para el QC estadístico (no-op si qc_stats_enabled
    # está apagado, ver stats_refresh_task)
    background_tasks.append(asyncio.create_task(stats_refresh_task()))
    # Timelapse diario de la cámara (hoy y ayer, más la purga)
    background_tasks.append(asyncio.create_task(timelapse_task()))
    # Bitácora de pronósticos cada 30 min, para calificar a 3 h contra el
    # pluviómetro (ver services/forecast_verification.py)
    background_tasks.append(asyncio.create_task(_r_forecast.forecast_snapshot_task()))
    # Resumen semanal por correo (opt-in, ver email_digest_enabled)
    background_tasks.append(asyncio.create_task(_r_admin.email_digest_task()))
    # Historial del radar SACMEX: sólo expone ~10 cuadros, aquí se guardan todos
    background_tasks.append(asyncio.create_task(_r_radar.radar_archive_task()))
    # Alertas de sismos (antes sólo si alguien abría /api/earthquakes)
    background_tasks.append(asyncio.create_task(_r_external.earthquake_watch_task()))
    # Ciclones tropicales cerca de México (NHC): avisos de cambios + bitácora
    background_tasks.append(asyncio.create_task(_r_external.cyclone_watch_task()))

    # El histórico de análisis del cielo se guardaba DENTRO de la carpeta del día, así
    # que la poda de fotos se lo llevaba a los 7 días. Ahora vive aparte; esto sube lo
    # que quedara en el sitio viejo. Va en el arranque y no bajo demanda porque corre
    # contrarreloj contra esa poda, y es idempotente: no encuentra nada la segunda vez.
    try:
        movidos = _camera.migrate_daily_analysis()
        if movidos:
            logger.info(f"Análisis del cielo: {movidos} día(s) migrados fuera de la carpeta del día")
    except Exception as e:
        logger.warning(f"No se pudo migrar el histórico de análisis: {e}")

    yield

    # Shutdown: cancela los loops infinitos ANTES de cerrar las conexiones que
    # usan, para que un `docker stop`/reinicio del VPS no los deje a medias.
    logger.info("Shutting down Ecowitt Weather Station Receiver")
    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)
    storage.close()
    mqtt_publisher.close()


# Initialize FastAPI app
app = FastAPI(
    title="Ecowitt Weather Station Receiver",
    description="Receives and stores weather data from Ecowitt gateways",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware. La API se sirve mismo-origen (el dashboard hace de proxy de
# /api), así que restringir orígenes no afecta al sitio ni al widget /embed
# (que corre dentro de su iframe, mismo-origen). Sin credenciales: la auth admin
# usa header Bearer, no cookies.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://clima.xe1e.net",
        "http://localhost:5173",  # dev (Vite)
        "http://localhost:8080",  # dev/local
    ],
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

# Objetos compartidos con los routers (app/routers/*): viven en state.py para que
# ningún router tenga que importar main.py.
from . import state  # noqa: E402
from .state import storage, latest_by_station, alert_service, mqtt_publisher  # noqa: E402
from .state import station_pressure_hpa as _station_pressure_hpa  # noqa: E402

_report_limiter = secsvc.RateLimiter()


async def station_watchdog():
    """
    Avisa (Telegram/log) si alguna estación deja de enviar datos, y cuando vuelve.
    Verifica la principal y todas las secundarias con watchdog habilitado.
    """
    await asyncio.sleep(90)  # gracia inicial tras el arranque
    while True:
        try:
            if not settings.alerts_enabled:
                await asyncio.sleep(60)
                continue

            now = datetime.utcnow()
            stations_config = settings_store.get_stations_config(settings.settings_file)

            # Estación principal
            principal_config = stations_config.get("_principal", {})
            principal_timeout = settings.alert_station_offline_minutes * 60
            principal_label = principal_config.get("label", "Principal")
            await alert_service.check_station(
                latest_by_station.get(None, {}).get("received_at"),
                now, principal_timeout,
                station=None, label=principal_label
            )

            # Estaciones secundarias
            for name in settings.secondary_station_map.values():
                station_config = settings_store.get_station_config(
                    settings.settings_file, name
                )
                if not station_config.get("watchdog_enabled", True):
                    continue
                timeout = station_config.get("watchdog_minutes", 15) * 60
                label = station_config.get("label") or name
                await alert_service.check_station(
                    latest_by_station.get(name, {}).get("received_at"),
                    now, timeout,
                    station=name, label=label
                )

            # Cámara del exterior: sin señal si deja de mandar fotos.
            await alert_service.check_camera_offline(_camera.status())

            # Respaldo a R2: alguna categoría lleva demasiado sin una corrida exitosa.
            await alert_service.check_backup_stale(
                backup_status.read_all(settings.backup_status_dir)
            )

        except Exception as e:
            logger.error(f"Watchdog error: {e}")
        await asyncio.sleep(60)


async def air_quality_watchdog():
    """Revisa AQI (WAQI) e IMECA (Open-Meteo) cada 30 min y dispara alertas."""
    await asyncio.sleep(150)  # gracia inicial
    while True:
        try:
            if settings.alerts_enabled and getattr(settings, "alert_air_enabled", False):
                lat = settings.cwop_latitude
                lon = settings.cwop_longitude
                aqi = None
                try:
                    aq = await get_air_quality(lat, lon, settings.waqi_token)
                    if aq and isinstance(aq.get("aqi"), (int, float)):
                        aqi = aq["aqi"]
                except Exception:
                    pass
                imeca_val = None
                try:
                    # Sin `pressure_hpa` esto caía a 1 atm (ver `imeca.molar_volume`):
                    # a los ~780 hPa de la CDMX eso subestima el IMECA lo bastante
                    # como para no disparar "Mala"/"Muy mala" cuando sí tocaba --el
                    # mismo bug que ya se había corregido en los otros dos
                    # call-sites (`/api/airquality/imeca` y svitrix), pero no aquí.
                    im = await imeca.get_imeca(lat, lon, pressure_hpa=_station_pressure_hpa())
                    if im and im.get("available"):
                        imeca_val = im.get("imeca")
                except Exception:
                    pass
                await alert_service.check_air(aqi, imeca_val)
        except Exception as e:
            logger.error(f"Air quality watchdog error: {e}")
        await asyncio.sleep(1800)  # 30 min


async def daily_rollup_task():
    """
    Mantiene el resumen diario (weather_daily) para todas las estaciones.
    Al arrancar rellena los últimos ~90 días que falten; luego refresca
    hoy/ayer cada hora.
    """
    await asyncio.sleep(120)  # gracia inicial
    try:
        await aggregator.backfill_all_stations(
            storage, settings.secondary_station_map, days=90
        )
    except Exception as e:
        logger.error(f"Backfill inicial de resumen diario falló: {e}")
    while True:
        await asyncio.sleep(3600)
        try:
            await aggregator.backfill_all_stations(
                storage, settings.secondary_station_map, days=2
            )
        except Exception as e:
            logger.error(f"Refresco de resumen diario falló: {e}")


async def stats_refresh_task():
    """
    Refresca la caché de medias/desviaciones para el QC estadístico
    (services/stats_cache.py) cada `qc_stats_refresh_min` minutos, para la
    principal y cada estación secundaria. No hace nada si `qc_stats_enabled`
    está apagado (default) -- evita consultas de Influx innecesarias.

    Corre SIEMPRE en segundo plano, nunca en el camino de /data/report (ver
    A1 en el plan de optimización): el z-score en caliente solo lee esta
    caché, ya poblada.
    """
    # El interruptor se mira en cada vuelta (no sólo al arrancar): se puede prender o
    # apagar desde el panel sin reiniciar.
    await asyncio.sleep(60)  # gracia inicial
    while True:
        if not getattr(settings, "qc_stats_enabled", False):
            await asyncio.sleep(300)
            continue
        try:
            window = getattr(settings, "qc_stats_window", "-30d")
            await stats_cache.refresh(
                storage, list(settings.secondary_station_map.values()), window=window
            )
        except Exception as e:
            logger.error(f"Refresco de stats QC falló: {e}")
        await asyncio.sleep(max(5, int(getattr(settings, "qc_stats_refresh_min", 60))) * 60)


async def timelapse_task():
    """
    Mantiene el timelapse: refresca el vídeo de HOY según entran capturas, cierra el de
    AYER y purga los que pasan de la retención.

    La frescura vive aquí y no en el endpoint a propósito: así el encode ocurre a un
    ritmo conocido --una vez cada media hora-- en vez de depender de cuánta gente entre
    a la página. Ayer se rehace también en cada vuelta porque la primera pasada tras la
    medianoche puede pillar capturas aún en camino (el script de casa reintenta), y
    porque si el servidor estuvo apagado nadie lo generó.
    """
    if not TimelapseService.ffmpeg_available():
        logger.warning("ffmpeg no está en la imagen: no habrá timelapse")
        return
    await asyncio.sleep(300)  # gracia inicial: que no compita con el arranque
    while True:
        # Se mira en cada vuelta: prenderlo o apagarlo desde el panel ya no pide reiniciar.
        if not settings.camera_timelapse_enabled:
            await asyncio.sleep(300)
            continue
        try:
            hoy = datetime.now().astimezone().date()
            ayer = hoy - timedelta(days=1)
            for dia in (hoy, ayer):
                try:
                    await _timelapse.ensure(dia.isoformat())
                except TimelapseError as e:
                    # Lo normal a primera hora: aún no hay fotogramas suficientes.
                    logger.debug("timelapse %s: %s", dia, e)
            # Los días viejos también necesitan cartel: aquí arriba sólo se han tocado
            # hoy y ayer, y la retención guarda hasta 90 días de vídeo.
            await _timelapse.fill_missing_posters()
            _timelapse.prune()
        except Exception as e:
            logger.error(f"Tarea de timelapse falló: {e}")
        await asyncio.sleep(1800)  # 30 min


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }


# Both paths are registered so the device works whether its "Path" field is
# configured as "/data/report/" or "/data/report" (a common Ecowitt gotcha:
# without both, a missing trailing slash triggers a 307 redirect that some
# station firmwares — including WS2910 consoles — do not follow on POST).
async def _bg_alertas_principal(parsed_data: dict, qc_rejected: set, stats_flagged: list) -> None:
    """Nunca debe tumbar la ingestión: corre en BackgroundTasks, después de
    responder al datalogger (ver receive_ecowitt_data)."""
    try:
        await alert_service.process(parsed_data, qc_rejected=qc_rejected)
    except Exception as e:
        logger.error(f"Alert processing failed: {e}")
    try:
        await alert_service.check_stats_outlier(stats_flagged)
    except Exception as e:
        logger.error(f"Stats QC alert failed: {e}")


async def _bg_publish_principal(parsed_data: dict) -> None:
    try:
        # Sólo si AWEKAS está activo: calcula astronomía y puede consultar Open-Meteo,
        # y antes corría en CADA envío de la estación aunque AWEKAS estuviera apagado.
        awekas_condition = (await _awekas_condition_code(parsed_data)
                            if getattr(settings, "awekas_enabled", False) else None)
        results = await publish_all(parsed_data, settings, awekas_condition=awekas_condition)
        await alert_service.check_publish_networks(results)
    except Exception as e:
        logger.error(f"Public publish failed: {e}")


async def _bg_alertas_secundaria(parsed_data: dict, station: str, qc_rejected: set,
                                  stats_flagged: list) -> None:
    try:
        scfg = settings_store.get_station_config(settings.settings_file, station)
        if scfg.get("alerts_enabled"):
            await alert_service.process(
                parsed_data, station=station, label=scfg.get("label") or station,
                thresholds=scfg.get("alert_thresholds") or None,
                disabled=scfg.get("disabled_rules") or [],
                qc_rejected=qc_rejected)
            await alert_service.check_stats_outlier(stats_flagged, station=station)
    except Exception as e:
        logger.error(f"Alert processing (secundaria {station}) failed: {e}")


@app.post("/data/report/")
@app.post("/data/report")
async def receive_ecowitt_data(request: Request, background_tasks: BackgroundTasks):
    """
    Receive weather data from an Ecowitt station (WS2910 console or gateway).

    The station sends data as a form-encoded POST request using the
    Ecowitt protocol (Weather Services -> Customized -> Protocol: Ecowitt).

    Alertas y publicación a redes públicas corren en BackgroundTasks: el
    datalogger recibe la respuesta en cuanto el dato queda guardado (memoria +
    InfluxDB), sin esperar a Telegram/correo ni a las 5 redes externas
    (WU/PWSWeather/Windy/OWM/AWEKAS pueden sumar hasta ~90s de timeouts en el
    peor caso -- ver docs/internal/PLAN-OPTIMIZACION-SERVIDOR.md, punto A1).
    """
    # Seguridad opcional del endpoint (token en query param + allowlist de IP).
    # La IP real del datalogger llega en X-Real-IP (nginx la fija en /data/report).
    client_ip = (request.headers.get("x-real-ip")
                 or (request.client.host if request.client else "")).strip()
    allow = (getattr(settings, "ecowitt_ip_allowlist", None) or "").replace(";", ",")
    allowed = [x.strip() for x in allow.split(",") if x.strip()]
    if allowed and client_ip not in allowed:
        logger.warning("Push rechazado: IP %s no está en la allowlist", client_ip or "?")
        raise HTTPException(status_code=403, detail="IP no permitida")
    if getattr(settings, "ecowitt_secure_enabled", False) and getattr(settings, "ecowitt_secure_token", None):
        if request.query_params.get("token") != settings.ecowitt_secure_token:
            logger.warning("Push rechazado: token inválido desde %s", client_ip or "?")
            raise HTTPException(status_code=403, detail="Token inválido")

    # Rate-limit por IP: defensa ante flood/DoS. Muy holgado (60/min) para no
    # afectar al datalogger legítimo, que envía ~1-4 lecturas por minuto.
    if not _report_limiter.allow(client_ip or "?", limit=60, window_s=60):
        logger.warning("Push rechazado: rate-limit excedido desde %s", client_ip or "?")
        raise HTTPException(status_code=429, detail="Demasiadas peticiones")

    try:
        # Parse form data
        form_data = await request.form()
        raw_data = dict(form_data)

        logger.debug(f"Received raw data: {raw_data}")

        # Parse Ecowitt protocol
        parsed_data = parse_ecowitt_data(raw_data)

        # ¿Estación principal (None) o secundaria (nombre)? Determina el tag,
        # el aislamiento de alertas/publicación y la lectura previa para el
        # filtro de picos.
        station = resolve_station(parsed_data, settings.secondary_station_map)

        # Whitelist de passkey: si station is None, no es una secundaria conocida
        # — puede ser la principal registrada o un passkey DESCONOCIDO.
        if station is None:
            passkey = (parsed_data.get("passkey") or "").strip()
            primary_pk = (getattr(settings, "primary_passkey", "") or "").strip()
            if primary_pk:
                if passkey != primary_pk:
                    # Whitelist activa: passkey ajeno/mal configurado -> rechazar
                    # (antes se trataba como principal y contaminaba el dato real).
                    logger.warning("Push RECHAZADO: passkey no registrado (%s...) IP %s",
                                   (passkey[:6] or "?"), client_ip or "?")
                    raise HTTPException(status_code=403, detail="Estacion no registrada")
            elif passkey:
                # Whitelist NO configurada: se conserva el comportamiento previo
                # (no listado = principal) y se registra el passkey para capturarlo.
                logger.info("Passkey de la principal (whitelist no configurada): %s", passkey)

        # El passkey ya cumplió su función (resolver la estación). Se elimina para
        # que NUNCA quede en la copia en memoria ni se filtre por /api/current,
        # /api/stations, etc. (no se usa en el resto del pipeline).
        parsed_data.pop("passkey", None)

        # Convert units if needed (sin derivados: se calculan tras calibración/QC)
        if settings.output_unit_system == "metric":
            parsed_data = convert_to_metric(parsed_data, compute_derived=False)

        # Config de la estación secundaria (se lee una vez y se reutiliza).
        station_cfg = (settings_store.get_station_config(settings.settings_file, station)
                       if station is not None else {})

        # Pipeline estilo WeeWX: calibrar -> QC rangos -> QC picos -> derivar.
        # El filtro de picos compara contra la lectura PREVIA de ESA estación
        # (no una global) para no generar falsos picos al mezclar estaciones.
        prev = latest_by_station.get(station)
        # Calibración: la principal usa la global; las secundarias usan la SUYA
        # (independiente, no hereda la de la principal).
        station_cal = (station_cfg.get("calibration") or {}) if station is not None else None
        parsed_data = apply_calibration(parsed_data, settings, station_cal)

        # Presión relativa (nivel del mar) calculada en el servidor desde la
        # absoluta + altitud (fórmula ISA), independiente de la relativa que
        # manda la consola. Útil cuando la consola no permite ajustar altitud
        # (p. ej. WS2910). Altitud 0 = conservar la relativa de la estación.
        altitude = (station_cfg.get("altitude_m") if station is not None
                    else settings.station_altitude_m) or 0.0
        if altitude and parsed_data.get("pressure_absolute") is not None:
            parsed_data["pressure_relative"] = sea_level_pressure(
                parsed_data["pressure_absolute"], altitude)

        parsed_data, qc_bad = quality_check(parsed_data, settings)
        parsed_data, spike_bad = spike_check(parsed_data, prev, settings)
        # Campos que el QC acabó de anular en ESTA lectura. Se pasan a las alertas
        # para que no confundan "el sensor no reportó" con "reportó una lectura
        # imposible y la filtramos": sin esto, cada pico rechazado disparaba un
        # falso "Sensor sin contacto".
        qc_rejected = {f for f, *_ in qc_bad} | {f for f, *_ in spike_bad}
        # QC estadístico (z-score contra la caché de media/desviación de ESTA
        # estación, ver services/stats_cache.py): NO modifica parsed_data, solo
        # marca campos dudosos para que las alertas avisen si se sostiene.
        _, stats_flagged = stats_check(parsed_data, stats_cache.get(station), settings)
        if settings.output_unit_system == "metric":
            parsed_data = calculate_derived_values(parsed_data)

        # Add metadata
        parsed_data["received_at"] = datetime.utcnow().isoformat()

        # Tag de estación secundaria (la principal queda SIN tag). Debe fijarse
        # antes de escribir para que get_tags() lo incluya.
        if station is not None:
            parsed_data["station"] = station

        # Store latest data in memory (por estación)
        latest_by_station[station] = parsed_data.copy()

        # Write to InfluxDB
        try:
            await storage.write(parsed_data)
        except Exception as e:
            # Directo, NO por background_tasks: esta rama re-lanza y termina en
            # el 500 del except general de abajo -- FastAPI solo adjunta las
            # tareas en curso a una respuesta que SÍ se retorna normal, nunca a
            # la que arma un handler de excepción, así que una tarea agregada
            # aquí jamás llegaría a correr.
            await alert_service.check_influx_write(str(e))
            raise
        background_tasks.add_task(alert_service.check_influx_write, None)

        logger.info(
            f"Stored data from {describe_device(parsed_data)} - "
            f"Temp: {parsed_data.get('temperature_outdoor')}°C, "
            f"Humidity: {parsed_data.get('humidity_outdoor')}%, "
            f"Wind: {parsed_data.get('wind_speed')} km/h"
        )

        # MQTT y publicación a redes son SOLO de la principal. Las alertas corren
        # para la principal y, si tienen su flag activo, también para secundarias
        # (estado aislado por estación, umbrales globales por ahora).
        if station is None:
            # Publish to MQTT (never let this break ingestion; ya no bloqueante)
            try:
                mqtt_publisher.publish(parsed_data)
            except Exception as e:
                logger.error(f"MQTT publish failed: {e}")

            # Alertas (Telegram/correo) y publicación a redes públicas: a
            # BackgroundTasks, corren DESPUÉS de responder al datalogger.
            background_tasks.add_task(_bg_alertas_principal, parsed_data, qc_rejected, stats_flagged)
            background_tasks.add_task(_bg_publish_principal, parsed_data)
        else:
            # Estación secundaria: alertas propias solo si están habilitadas en su
            # configuración (Admin → Estaciones → config). Estado por estación.
            background_tasks.add_task(_bg_alertas_secundaria, parsed_data, station, qc_rejected,
                                       stats_flagged)

        return {"status": "success", "message": "Data received"}

    except HTTPException:
        raise
    except Exception as e:
        # No filtrar detalles internos al cliente (el detalle va solo al log).
        logger.error(f"Error processing data: {e}")
        raise HTTPException(status_code=500, detail="Error interno")




# ── Sensor local del display kiosco (BME280 del ESP32) ──
# Se guarda APARTE de los datos meteorológicos (no toca InfluxDB ni la Principal):
# último valor + min/max del DÍA LOCAL, que se reinician al cambiar de día.
#
# Se persiste en el volumen /data porque solo vivía en memoria: cualquier reinicio
# del contenedor (y todo `docker compose up --build`) borraba los min/max a media
# tarde y la página 2 del kiosco volvía a arrancar con min = max = lectura actual.
_MX_TZ = ZoneInfo("America/Mexico_City")


# --- Registro de estaciones por MAC (whitelist de passkey) -----------------


# ---------------------------------------------------------------------------
# Wizard de configuración inicial
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# API de Estaciones (Etapa 2)
# ---------------------------------------------------------------------------


# ── Cámara del exterior ──────────────────────────────────────────────────────
# La cámara está detrás del NAT de casa y el servidor en el VPS, así que la foto se
# EMPUJA hacia aquí. Ver docs/archivo/PLAN-CAMARA-EXTERIOR.md y services/camera.py.
# Viven en state.py (los usan también los routers).
_timelapse = state.timelapse
_camera = state.camera


# Código entero que espera AWEKAS en la posición 11 de su protocolo (ver el
# uploader de referencia weewx-awekas, que documenta la tabla completa: 0-25,
# fog/nieve/tormenta/granizo/etc incluidos). Solo mapeamos lo que `svitrix.
# _condition` puede distinguir con nuestras señales (radiación solar + % de
# nubes del pronóstico): despejado/parcial/nublado y lluvia por intensidad --
# el resto (niebla, nieve, tormenta, granizo...) no lo detectamos, así que se
# deja sin mandar antes que adivinar mal.
_AWEKAS_CONDITION_FROM_WEATHERAPI_CODE = {
    1000: 2,   # Sunny -> sunny sky
    1003: 3,   # Partly cloudy -> partly cloudy
    1006: 6,   # Cloudy -> overcast sky
    1183: 10,  # Light rain -> light rain
    1189: 11,  # Moderate rain -> rain
    1195: 12,  # Heavy rain -> heavy rain
}


async def _awekas_condition_code(data: Dict[str, Any]) -> Optional[int]:
    """Traduce la condición actual (mismo criterio que el e-paper, ver
    svitrix._condition) al código entero que espera AWEKAS. None si no se
    pudo derivar (p. ej. Open-Meteo caído) -- AWEKAS simplemente no recibe
    ese campo ese ciclo, no rompe el resto de la publicación."""
    try:
        sun_elev = sun_altitude(settings.cwop_latitude, settings.cwop_longitude)
        fc = await _current_forecast_wmo_cloudcover()
        cloud_cover = fc.get("cloud_cover") if fc else None
        cond = svitrix._condition(data, sun_elev=sun_elev, cloud_cover=cloud_cover)
        return _AWEKAS_CONDITION_FROM_WEATHERAPI_CODE.get(cond.get("code"))
    except Exception as e:
        logger.warning("No se pudo derivar condición para AWEKAS: %s", e)
        return None


# --- Netatmo: login OAuth2 (fase 3 de estaciones vecinas) -------------------
# Ver docs/internal/PLAN-ESTACIONES-VECINAS.md. Netatmo, a diferencia de
# Xweather, no usa una llave fija -- hay que mandar al dueño de la cuenta a
# autorizar la app y recibir el `code` en un callback propio, del lado del
# servidor, apenas Netatmo redirige (el code expira en ~30-60 s).


# --- Endpoints por área (fase 3 de docs/internal/PLAN-REVISION-CODIGO.md) ------
from .routers import camera as _r_camera, data as _r_data, external as _r_external  # noqa: E402
from .routers import devices as _r_devices, forecast as _r_forecast, kiosk as _r_kiosk  # noqa: E402
from .routers import admin as _r_admin, radar as _r_radar, stations as _r_stations  # noqa: E402
from .routers.camera import _current_forecast_wmo_cloudcover  # noqa: E402  (condición de AWEKAS)

app.include_router(_r_admin.router)
app.include_router(_r_camera.router)
app.include_router(_r_devices.router)
app.include_router(_r_kiosk.router)
app.include_router(_r_stations.router)
app.include_router(_r_data.router)
app.include_router(_r_forecast.router)
app.include_router(_r_radar.router)
app.include_router(_r_external.router)
