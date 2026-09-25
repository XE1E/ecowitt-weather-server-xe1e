"""
Ecowitt Weather Station Receiver

Receives weather data from Ecowitt gateways via HTTP POST
and stores it in InfluxDB.
"""

from fastapi import FastAPI, Request, HTTPException, Header, Body, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from collections import deque
import asyncio
import json
import logging
import os
import platform
import secrets
import shutil

import httpx
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
from .services import digest
from .services import backup_status
from .services import r2_quota
from .services.log_redact import install_redaction as _install_redaction

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


_install_redaction()


# In-memory log buffer for admin panel
class MemoryLogHandler(logging.Handler):
    def __init__(self, maxlen: int = 500):
        super().__init__()
        self.buffer: deque = deque(maxlen=maxlen)

    def emit(self, record: logging.LogRecord):
        self.buffer.append({
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        })

    def get_logs(self, limit: int = 100) -> List[Dict]:
        return list(self.buffer)[-limit:]

    def get_logs_since(self, minutes: int) -> List[Dict]:
        """
        Filtra por ventana de tiempo en vez de cantidad de líneas: con más
        redes publicando (reintentos incluidos) y más chequeos de alertas, un
        límite fijo de líneas cubre cada vez menos tiempo real según cuánto
        esté pasando en ese momento.
        """
        cutoff = datetime.now() - timedelta(minutes=minutes)
        return [e for e in self.buffer if datetime.fromisoformat(e["timestamp"]) >= cutoff]


memory_log_handler = MemoryLogHandler(maxlen=1500)
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
    background_tasks.append(asyncio.create_task(email_digest_task()))
    # Historial del radar SACMEX: sólo expone ~10 cuadros, aquí se guardan todos
    background_tasks.append(asyncio.create_task(_r_radar.radar_archive_task()))
    # Alertas de sismos (antes sólo si alguien abría /api/earthquakes)
    background_tasks.append(asyncio.create_task(_r_external.earthquake_watch_task()))

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

# Limitadores de tasa (en memoria, por IP): login y endpoint de ingesta.
_login_limiter = secsvc.RateLimiter()
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
                lat = getattr(settings, "cwop_latitude", 19.380359)
                lon = getattr(settings, "cwop_longitude", -99.174564)
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


class LoginBody(BaseModel):
    user: str
    password: str


from .deps import require_admin as _require_admin  # noqa: E402


@app.post("/api/admin/login")
async def admin_login(body: LoginBody, request: Request):
    ip = secsvc.client_ip(request)
    # Anti-fuerza-bruta: máx. 5 intentos por IP por minuto.
    if not _login_limiter.allow(ip or "?", limit=5, window_s=60):
        logger.warning("Login admin bloqueado por rate-limit desde %s", ip or "?")
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera un momento.")
    token = adminsvc.login(settings, body.user, body.password)
    if not token:
        logger.warning("Login admin FALLIDO (user=%r) desde %s", body.user, ip or "?")
        raise HTTPException(status_code=401, detail="Credenciales inválidas o panel deshabilitado")
    logger.info("Login admin OK desde %s", ip or "?")
    return {"token": token}


@app.post("/api/admin/logout")
async def admin_logout(authorization: Optional[str] = Header(default=None)):
    """Revoca el token de sesión en el servidor (no solo en el cliente)."""
    adminsvc.logout(adminsvc.bearer_token(authorization))
    return {"status": "ok"}


@app.get("/api/admin/settings")
async def admin_get_settings(authorization: Optional[str] = Header(default=None)):
    _require_admin(authorization)
    return adminsvc.public_settings(settings)


@app.post("/api/admin/settings")
async def admin_save_settings(body: dict, authorization: Optional[str] = Header(default=None)):
    _require_admin(authorization)
    incoming = {k: v for k, v in body.items() if k in settings_store.EDITABLE_KEYS}
    # No sobreescribir claves secretas si vienen vacías (en blanco = conservar)
    for tk in settings_store.SECRET_KEYS:
        if tk in incoming and (incoming[tk] is None or incoming[tk] == ""):
            incoming.pop(tk)
    # Validar/coaccionar tipos según el modelo Settings (evita corromper la
    # config con tipos inválidos, p. ej. un puerto o un umbral no numérico).
    for k in list(incoming.keys()):
        v = incoming[k]
        if v is None:
            continue
        cur = getattr(settings, k, None)
        try:
            if isinstance(cur, bool):
                incoming[k] = v if isinstance(v, bool) else str(v).strip().lower() in ("1", "true", "yes", "on")
            elif isinstance(cur, int) and not isinstance(cur, bool):
                incoming[k] = int(float(v))
            elif isinstance(cur, float):
                incoming[k] = float(v)
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail=f"Valor inválido para '{k}'")
    current = settings_store.load_overrides(settings.settings_file)
    current.update(incoming)
    settings_store.save_overrides(settings.settings_file, current)
    adminsvc.apply_overrides(settings, alert_service, current)
    # Reconectar MQTT si cambió alguna configuración relacionada
    mqtt_keys = {"mqtt_enabled", "mqtt_broker", "mqtt_port", "mqtt_username",
                 "mqtt_password", "mqtt_topic", "hass_discovery", "hass_discovery_prefix"}
    if mqtt_keys & set(incoming.keys()):
        mqtt_publisher.reconnect()
    return {"status": "ok", "applied": list(incoming.keys())}


@app.get("/api/admin/status")
async def admin_status(authorization: Optional[str] = Header(default=None)):
    _require_admin(authorization)
    return {
        "station_offline": alert_service.station_offline,
        "last_received": latest_by_station.get(None, {}).get("received_at"),
        "active_alerts": [{"key": k, "message": m} for k, m in alert_service.active.items()],
        "alert_history": alert_service.get_history(limit=20),
        "alerts_enabled": settings.alerts_enabled,
        "telegram_enabled": settings.telegram_enabled,
        "email_enabled": settings.email_enabled,
        "mqtt_enabled": settings.mqtt_enabled,
        "waqi_configured": bool(settings.waqi_token),
        "ecowitt_secure_enabled": settings.ecowitt_secure_enabled,
        "admin_enabled": adminsvc.admin_enabled(settings),
        "publication": {
            "wu": settings.wu_enabled,
            "windy": settings.windy_enabled,
            "pws": settings.pws_enabled,
            "owm": settings.owm_enabled,
            "cwop": settings.cwop_enabled,
            "awekas": settings.awekas_enabled,
            "wow_be": settings.wow_be_enabled,
            "weathercloud": settings.weathercloud_enabled,
        },
    }


def _read_meminfo() -> Dict[str, int]:
    """Lee /proc/meminfo (compartido con el host) -> {clave: kB}."""
    info: Dict[str, int] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                if rest:
                    info[key.strip()] = int(rest.strip().split()[0])  # kB
    except OSError:
        pass
    return info


def _os_pretty_name() -> str:
    """Nombre del SO. Prefiere /host/os-release (montado desde el host, p. ej.
    Ubuntu) sobre /etc/os-release (imagen base del contenedor, Debian)."""
    for path in ("/host/os-release", "/etc/os-release"):
        try:
            with open(path) as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        return line.split("=", 1)[1].strip().strip('"')
        except OSError:
            continue
    return platform.system()


def _host_hostname() -> str:
    """Hostname del host (montado en /host/hostname). Dentro del contenedor
    platform.node() devuelve el ID del contenedor, no el del servidor."""
    try:
        with open("/host/hostname") as f:
            name = f.read().strip()
            if name:
                return name
    except OSError:
        pass
    return platform.node()


def _human_duration(seconds: float) -> str:
    s = int(seconds)
    d, rem = divmod(s, 86400)
    h, rem = divmod(rem, 3600)
    m, _ = divmod(rem, 60)
    parts: List[str] = []
    if d:
        parts.append(f"{d}d")
    if h:
        parts.append(f"{h}h")
    if not d:
        parts.append(f"{m}m")
    return " ".join(parts)


@app.get("/api/admin/backup-status")
async def admin_backup_status(authorization: Optional[str] = Header(default=None)):
    """Estado de los respaldos a R2 para el panel (Sistema): última corrida
    exitosa por categoría y si las credenciales de R2 están configuradas."""
    _require_admin(authorization)
    r2_configured = bool(
        settings.r2_bucket and settings.r2_account_id
        and settings.r2_access_key_id and settings.r2_secret_access_key
    )
    return {
        "r2_configured": r2_configured,
        "r2_bucket": settings.r2_bucket if r2_configured else None,
        "backup_api_configured": bool(settings.backup_api_token),
        # Fotos no tiene retención propia en R2 (ver scripts/backup-camera-fotos.sh):
        # sigue esta, así que el panel la muestra para no obligar a ir a Cámara.
        "camera_retention_days": settings.camera_retention_days,
        "categories": backup_status.read_all(settings.backup_status_dir),
    }


@app.get("/api/admin/r2-usage")
async def admin_r2_usage(authorization: Optional[str] = Header(default=None)):
    """Uso de R2 del mes en curso vs. el tier gratis (ver services/r2_quota.py).

    Requiere `cloudflare_api_token` (DISTINTO a las claves S3 de R2) — sin él,
    responde `configured: false` en vez de un error, porque es una función
    opcional y no todos los que configuran R2 necesitan vigilar la cuota."""
    _require_admin(authorization)
    if not (settings.cloudflare_api_token and settings.r2_account_id and settings.r2_bucket):
        return {"configured": False}
    usage = await r2_quota.get_r2_usage(
        settings.r2_account_id, settings.cloudflare_api_token, settings.r2_bucket
    )
    return {"configured": True, **usage}


@app.get("/api/admin/system-info")
async def admin_system_info(authorization: Optional[str] = Header(default=None)):
    """Datos técnicos del servidor: SO, disco, memoria, CPU, uptime.

    Disco/memoria/CPU/uptime son del HOST: el contenedor comparte /proc y el
    volumen /data vive sobre el disco del host. El nombre del SO se lee de
    /host/os-release (montado desde el host) para reportar el SO real.
    """
    _require_admin(authorization)
    GB = 1024 ** 3

    mem = _read_meminfo()
    mem_total = mem.get("MemTotal", 0) * 1024
    mem_avail = mem.get("MemAvailable", 0) * 1024
    mem_used = max(0, mem_total - mem_avail)

    try:
        du = shutil.disk_usage("/data")
        disk_total, disk_used, disk_free = du.total, du.used, du.free
    except OSError:
        disk_total = disk_used = disk_free = 0

    try:
        with open("/proc/uptime") as f:
            up = float(f.read().split()[0])
    except OSError:
        up = 0.0

    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        load1 = load5 = load15 = 0.0

    retention_days = os.environ.get("DATA_RETENTION_DAYS", "90").strip()
    retention = "Infinita" if retention_days in ("0", "") else f"{retention_days} días"

    return {
        "os": {
            "name": _os_pretty_name(),
            "kernel": platform.release(),
            "arch": platform.machine(),
            "hostname": _host_hostname(),
        },
        "cpu": {
            "cores": os.cpu_count(),
            "load_1m": round(load1, 2),
            "load_5m": round(load5, 2),
            "load_15m": round(load15, 2),
        },
        "memory": {
            "total_gb": round(mem_total / GB, 2),
            "used_gb": round(mem_used / GB, 2),
            "available_gb": round(mem_avail / GB, 2),
            "used_pct": round(mem_used / mem_total * 100, 1) if mem_total else None,
        },
        "disk": {
            "total_gb": round(disk_total / GB, 2),
            "used_gb": round(disk_used / GB, 2),
            "free_gb": round(disk_free / GB, 2),
            "used_pct": round(disk_used / disk_total * 100, 1) if disk_total else None,
        },
        "uptime": {"seconds": int(up), "human": _human_duration(up)},
        "runtime": {
            "python": platform.python_version(),
            "app_version": app.version,
            "influxdb_url": settings.influxdb_url,
            "data_retention": retention,
        },
    }


# ── Sensor local del display kiosco (BME280 del ESP32) ──
# Se guarda APARTE de los datos meteorológicos (no toca InfluxDB ni la Principal):
# último valor + min/max del DÍA LOCAL, que se reinician al cambiar de día.
#
# Se persiste en el volumen /data porque solo vivía en memoria: cualquier reinicio
# del contenedor (y todo `docker compose up --build`) borraba los min/max a media
# tarde y la página 2 del kiosco volvía a arrancar con min = max = lectura actual.
_MX_TZ = ZoneInfo("America/Mexico_City")


@app.post("/api/admin/test-telegram")
async def admin_test_telegram(authorization: Optional[str] = Header(default=None)):
    """Envía un mensaje de prueba a Telegram."""
    _require_admin(authorization)
    if not settings.telegram_enabled or not settings.telegram_bot_token or not settings.telegram_chat_id:
        raise HTTPException(status_code=400, detail="Telegram no configurado")
    try:
        await alert_service.send_test_telegram()
        return {"status": "ok", "message": "Mensaje enviado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/test-email")
async def admin_test_email(authorization: Optional[str] = Header(default=None)):
    """Envía un correo de prueba con la configuración SMTP actual."""
    _require_admin(authorization)
    if not settings.email_enabled or not settings.smtp_host or not settings.email_to:
        raise HTTPException(status_code=400, detail="Correo no configurado (falta host o destinatario)")
    try:
        await alert_service.send_test_email()
        return {"status": "ok", "message": "Correo enviado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/test-digest")
async def admin_test_digest(authorization: Optional[str] = Header(default=None)):
    """Envía el resumen semanal AHORA MISMO (con los datos reales de los últimos
    7 días), sin esperar al día/hora programados y sin marcar la semana como
    ya enviada -- ver `_build_and_send_digest(force=True)`."""
    _require_admin(authorization)
    if not settings.email_enabled or not settings.smtp_host or not settings.email_to:
        raise HTTPException(status_code=400, detail="Correo no configurado (falta host o destinatario)")
    try:
        await _build_and_send_digest(force=True)
        return {"status": "ok", "message": "Resumen enviado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/test-all")
async def admin_test_all(authorization: Optional[str] = Header(default=None)):
    """Prueba los canales configurados (Telegram, correo, MQTT) y devuelve el
    resultado por servicio. ok=None significa 'no configurado' (se omite)."""
    _require_admin(authorization)
    results = []

    async def _try(name, cond, coro_factory):
        if not cond:
            results.append({"service": name, "ok": None, "message": "No configurado"})
            return
        try:
            await coro_factory()
            results.append({"service": name, "ok": True, "message": "Enviado"})
        except Exception as e:
            results.append({"service": name, "ok": False, "message": str(e)[:150]})

    await _try("Telegram",
               settings.telegram_enabled and settings.telegram_bot_token and settings.telegram_chat_id,
               alert_service.send_test_telegram)
    await _try("Correo",
               settings.email_enabled and settings.smtp_host and settings.email_to,
               alert_service.send_test_email)

    if settings.mqtt_enabled:
        try:
            r = mqtt_publisher.test_connection(
                settings.mqtt_broker, settings.mqtt_port,
                settings.mqtt_username, settings.mqtt_password)
            results.append({"service": "MQTT", "ok": bool(r.get("success")),
                            "message": r.get("message", "")})
        except Exception as e:
            results.append({"service": "MQTT", "ok": False, "message": str(e)[:150]})
    else:
        results.append({"service": "MQTT", "ok": None, "message": "No configurado"})

    return {"results": results}


_GITHUB_REPO = os.environ.get("GITHUB_REPO", "XE1E/ecowitt-weather-server-xe1e")


@app.get("/api/admin/updates")
async def admin_updates(authorization: Optional[str] = Header(default=None)):
    """Consulta los últimos commits de la rama main en GitHub (repo público).
    Si GIT_SHA está horneado en la imagen, calcula cuántos commits de atraso hay."""
    _require_admin(authorization)
    url = f"https://api.github.com/repos/{_GITHUB_REPO}/commits?sha=main&per_page=15"
    current = os.environ.get("GIT_SHA")  # se hornea en build (incremento 2); puede faltar
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"Accept": "application/vnd.github+json"})
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo consultar GitHub: {e}")
    commits = [{
        "sha": c["sha"][:7],
        "message": (c.get("commit", {}).get("message", "") or "").splitlines()[0][:120],
        "date": c.get("commit", {}).get("author", {}).get("date"),
        "url": c.get("html_url"),
    } for c in data]
    latest = commits[0] if commits else None
    behind = None
    if current and commits:
        shas = [c["sha"] for c in commits]
        if current[:7] in shas:
            behind = shas.index(current[:7])   # nº de commits más nuevos que el actual
    return {
        "repo": _GITHUB_REPO,
        "current_sha": current[:7] if current else None,
        "latest": latest,
        "behind": behind,
        "commits": commits,
    }


# --- Registro de estaciones por MAC (whitelist de passkey) -----------------


# ---------------------------------------------------------------------------
# Wizard de configuración inicial
# ---------------------------------------------------------------------------

@app.get("/api/admin/setup-status")
async def admin_setup_status(authorization: Optional[str] = Header(default=None)):
    """Retorna si el wizard de configuración inicial se ha completado."""
    _require_admin(authorization)
    return {"setup_completed": settings_store.get_setup_completed(settings.settings_file)}


@app.get("/api/admin/logs")
async def admin_logs(
    limit: int = 100,
    minutes: Optional[int] = None,
    authorization: Optional[str] = Header(default=None)
):
    """
    Retorna los últimos logs del sistema. Con `minutes` filtra por ventana de
    tiempo real (recomendado) en vez de `limit` por cantidad de líneas.
    """
    _require_admin(authorization)
    if minutes is not None:
        logs = memory_log_handler.get_logs_since(minutes=min(minutes, 240))
    else:
        logs = memory_log_handler.get_logs(limit=min(limit, 1500))
    return {"logs": logs}


@app.get("/api/admin/mqtt/status")
async def admin_mqtt_status(authorization: Optional[str] = Header(default=None)):
    """Retorna el estado de la conexión MQTT."""
    _require_admin(authorization)
    return mqtt_publisher.get_status()


@app.post("/api/admin/mqtt/test")
async def admin_mqtt_test(body: dict, authorization: Optional[str] = Header(default=None)):
    """Prueba la conexión MQTT con los parámetros dados."""
    _require_admin(authorization)
    broker = body.get("broker") or settings.mqtt_broker
    port = body.get("port") or settings.mqtt_port
    username = body.get("username") or settings.mqtt_username
    password = body.get("password") or settings.mqtt_password
    result = mqtt_publisher.test_connection(broker, port, username, password)
    return result


@app.post("/api/admin/mqtt/reconnect")
async def admin_mqtt_reconnect(authorization: Optional[str] = Header(default=None)):
    """Fuerza reconexión MQTT con la configuración actual."""
    _require_admin(authorization)
    success = mqtt_publisher.reconnect()
    return {"success": success, "status": mqtt_publisher.get_status()}


@app.post("/api/admin/setup-complete")
async def admin_setup_complete(authorization: Optional[str] = Header(default=None)):
    """Marca el wizard de configuración como completado."""
    _require_admin(authorization)
    settings_store.set_setup_completed(settings.settings_file, True)
    return {"status": "ok"}


@app.post("/api/admin/wizard/test-telegram")
async def admin_wizard_test_telegram(
    body: dict,
    authorization: Optional[str] = Header(default=None)
):
    """Prueba credenciales de Telegram durante el wizard (sin guardarlas aún)."""
    _require_admin(authorization)
    bot_token = body.get("bot_token")
    chat_id = body.get("chat_id")
    if not bot_token or not chat_id:
        raise HTTPException(status_code=400, detail="Faltan bot_token o chat_id")
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            r = await client.post(url, json={
                "chat_id": chat_id,
                "text": "🧪 Mensaje de prueba desde el wizard de Estacion Clima XE1E",
            })
            if r.status_code == 200:
                return {"status": "ok", "message": "Mensaje enviado correctamente"}
            else:
                data = r.json()
                return {"status": "error", "message": data.get("description", "Error desconocido")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/wizard/test-email")
async def admin_wizard_test_email(
    body: dict,
    authorization: Optional[str] = Header(default=None)
):
    """Prueba credenciales de correo durante el wizard (sin guardarlas aún)."""
    _require_admin(authorization)
    smtp_host = body.get("smtp_host")
    smtp_port = body.get("smtp_port", 587)
    smtp_user = body.get("smtp_user")
    smtp_password = body.get("smtp_password")
    from_address = body.get("from_address")
    to_addresses = body.get("to_addresses")
    starttls = body.get("starttls", True)

    if not smtp_host or not to_addresses:
        raise HTTPException(status_code=400, detail="Faltan smtp_host o to_addresses")

    try:
        import smtplib
        from email.mime.text import MIMEText

        msg = MIMEText("🧪 Mensaje de prueba desde el wizard de Estación Clima XE1E")
        msg["Subject"] = "Prueba de alertas - Estación Clima XE1E"
        msg["From"] = from_address or smtp_user or "alertas@estacion.local"
        msg["To"] = to_addresses

        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            if starttls:
                server.starttls()
            if smtp_user and smtp_password:
                server.login(smtp_user, smtp_password)
            server.sendmail(msg["From"], to_addresses.split(","), msg.as_string())

        return {"status": "ok", "message": "Correo enviado correctamente"}
    except smtplib.SMTPAuthenticationError:
        return {"status": "error", "message": "Error de autenticación SMTP"}
    except smtplib.SMTPConnectError:
        return {"status": "error", "message": "No se pudo conectar al servidor SMTP"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# API de Estaciones (Etapa 2)
# ---------------------------------------------------------------------------


# ── Cámara del exterior ──────────────────────────────────────────────────────
# La cámara está detrás del NAT de casa y el servidor en el VPS, así que la foto se
# EMPUJA hacia aquí. Ver docs/archivo/PLAN-CAMARA-EXTERIOR.md y services/camera.py.
# Viven en state.py (los usan también los routers).
_timelapse = state.timelapse
_camera = state.camera


@app.get("/api/backup/r2-credentials")
async def backup_r2_credentials(request: Request):
    """
    Credenciales de Cloudflare R2 para scripts/backup-*.sh.

    Esos scripts corren por cron en el VPS, FUERA del contenedor, y las
    credenciales ahora se configuran desde Admin (settings.json) y no en el
    .env: por eso las piden aquí en vez de leerlas de un archivo. Autenticación
    por token propio en `X-Backup-Token`, NO el del panel de administración —
    mismo motivo que camera_upload_token: si se filtra, sólo permite leer estas
    credenciales, no entrar al panel ni a nada más.

    Sin `BACKUP_API_TOKEN` configurado responde 503: es una ruta que devuelve
    secretos, y dejarla abierta "hasta que la configure" expondría R2 a quien
    sea que la encuentre.
    """
    esperado = settings.backup_api_token
    if not esperado:
        raise HTTPException(status_code=503, detail="Respaldo a R2 no configurado")

    recibido = request.headers.get("X-Backup-Token") or ""
    if not secrets.compare_digest(recibido, esperado):
        raise HTTPException(status_code=401, detail="Token inválido")

    return {
        "r2_account_id": settings.r2_account_id,
        "r2_access_key_id": settings.r2_access_key_id,
        "r2_secret_access_key": settings.r2_secret_access_key,
        "r2_bucket": settings.r2_bucket,
        "r2_timelapse_retention_days": settings.r2_timelapse_retention_days,
        "r2_analisis_retention_days": settings.r2_analisis_retention_days,
        "r2_archivo_retention_days": settings.r2_archivo_retention_days,
        "r2_influx_keep": settings.r2_influx_keep,
    }


@app.post("/api/admin/docker-health")
async def report_docker_health(request: Request, body: Dict[str, Any] = Body(...)):
    """
    Recibe qué contenedores del stack están "unhealthy" ahora mismo, desde
    `scripts/check-docker-health.sh` (cron en el HOST, fuera de los
    contenedores -- ninguno de ellos puede ver a los demás ni tiene acceso al
    socket de Docker para consultar `docker inspect` sobre sí mismo).

    Autenticación por token propio en `X-Docker-Health-Token`, NO el del panel
    de administración -- mismo motivo que `backup_api_token`: si se filtra,
    sólo permite reportar salud de contenedores, no entrar al panel ni a nada
    más. Sin `DOCKER_HEALTH_API_TOKEN` configurado responde 503.
    """
    esperado = settings.docker_health_api_token
    if not esperado:
        raise HTTPException(status_code=503, detail="Monitoreo de Docker no configurado")

    recibido = request.headers.get("X-Docker-Health-Token") or ""
    if not secrets.compare_digest(recibido, esperado):
        raise HTTPException(status_code=401, detail="Token inválido")

    unhealthy = body.get("unhealthy") or []
    if not isinstance(unhealthy, list):
        raise HTTPException(status_code=400, detail="'unhealthy' debe ser una lista")

    await alert_service.check_docker_health([str(x) for x in unhealthy])
    return {"status": "ok"}


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


def _read_digest_state() -> Optional[str]:
    """Última semana ISO ya enviada (o None si nunca), desde `digest_state_file`."""
    try:
        with open(settings.digest_state_file, encoding="utf-8") as f:
            return json.load(f).get("last_sent_week")
    except (OSError, ValueError):
        return None


def _write_digest_state(week: str) -> None:
    try:
        os.makedirs(os.path.dirname(settings.digest_state_file), exist_ok=True)
        tmp = settings.digest_state_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"last_sent_week": week}, f)
        os.replace(tmp, settings.digest_state_file)
    except OSError as e:
        logger.warning("no se pudo guardar el estado del resumen semanal: %s", e)


async def _build_and_send_digest(force: bool = False) -> None:
    """
    Arma y manda el resumen semanal. `force=True` (usado por el botón "Enviar
    prueba" del panel) ignora `email_digest_enabled`/el día-hora configurados y
    NO actualiza `digest_state_file` -- una prueba no debe "gastar" el envío
    de la semana real.
    """
    week_start, week_end, week_dates = digest.week_range(datetime.now().astimezone().date())
    _, _, prev_dates = digest.week_range(datetime.strptime(week_start, "%Y-%m-%d").date())

    all_rows = await storage.query_daily_summaries(start="-16d")
    week_set, prev_set = set(week_dates), set(prev_dates)
    week_rows = [r for r in all_rows if str(r.get("date")) in week_set]
    prev_rows = [r for r in all_rows if str(r.get("date")) in prev_set]

    best_photo_date = _camera.best_of_week(week_dates)

    msg = digest.build_weekly_digest(week_rows, prev_rows, week_start, week_end, best_photo_date=best_photo_date)
    if force:
        msg["subject"] = "🧪 Prueba — " + msg["subject"]
    await alert_service.send_digest(msg["subject"], msg["body"])
    if not force:
        _write_digest_state(digest.week_id(datetime.now().astimezone().date()))


async def email_digest_task():
    """Revisa cada hora (mismo idiom que timelapse_task/daily_rollup_task) si
    toca mandar el resumen semanal (email_digest_enabled + día/hora configurados,
    ver digest.is_due). El estado de "ya se mandó esta semana" vive en un
    archivito propio (digest_state_file) para no duplicar si el receiver se
    reinicia el mismo día programado."""
    await asyncio.sleep(180)  # gracia inicial
    while True:
        try:
            if getattr(settings, "email_digest_enabled", False):
                now = datetime.now().astimezone()
                if digest.is_due(now, settings.email_digest_weekday, settings.email_digest_hour, _read_digest_state()):
                    await _build_and_send_digest(force=False)
                    logger.info("Resumen semanal enviado")
        except Exception as e:
            logger.error(f"Resumen semanal falló: {e}")
        await asyncio.sleep(3600)


# --- Netatmo: login OAuth2 (fase 3 de estaciones vecinas) -------------------
# Ver docs/internal/PLAN-ESTACIONES-VECINAS.md. Netatmo, a diferencia de
# Xweather, no usa una llave fija -- hay que mandar al dueño de la cuenta a
# autorizar la app y recibir el `code` en un callback propio, del lado del
# servidor, apenas Netatmo redirige (el code expira en ~30-60 s).


# --- Endpoints por área (fase 3 de docs/internal/PLAN-REVISION-CODIGO.md) ------
from .routers import camera as _r_camera, data as _r_data, external as _r_external  # noqa: E402
from .routers import devices as _r_devices, forecast as _r_forecast, kiosk as _r_kiosk  # noqa: E402
from .routers import radar as _r_radar, stations as _r_stations  # noqa: E402
from .routers.camera import _current_forecast_wmo_cloudcover  # noqa: E402  (condición de AWEKAS)

app.include_router(_r_camera.router)
app.include_router(_r_devices.router)
app.include_router(_r_kiosk.router)
app.include_router(_r_stations.router)
app.include_router(_r_data.router)
app.include_router(_r_forecast.router)
app.include_router(_r_radar.router)
app.include_router(_r_external.router)
