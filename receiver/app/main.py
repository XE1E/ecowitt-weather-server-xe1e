"""
Ecowitt Weather Station Receiver

Receives weather data from Ecowitt gateways via HTTP POST
and stores it in InfluxDB.
"""

from fastapi import FastAPI, Request, HTTPException, Header, Response, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List, Any
from collections import deque
import asyncio
import json
import logging
import os
import platform
import re
import secrets
import shutil
import time
from zoneinfo import ZoneInfo

from .config import settings
from .services.parser import parse_ecowitt_data, describe_device, resolve_station
from .services.converter import convert_to_metric, calculate_derived_values, sea_level_pressure
from .services.calibration import apply_calibration
from .services.quality import quality_check, spike_check
from .services.storage import InfluxDBStorage
from .services.alerts import AlertService
from .services.mqtt_publisher import MqttPublisher
from .services.metar import get_metar, get_taf
from .services.air_quality import get_air_quality
from .services import imeca
from .services.earthquakes import get_earthquakes
from .services.publishers import publish_all
from .services import forecaster
from .services import aggregator
from .services import openmeteo
from .services import forecast_consensus
from .services.almanac import get_almanac, sun_altitude
from .services import satellite
from .services.windrose import compute_wind_rose
from .services import sky_validation
from .services import smn
from .services import svitrix
from .services import epaper
from .services import bim32
from .services import admin as adminsvc
from .services import settings_store
from .services import security as secsvc
from .services.camera import CameraStore
from .services.timelapse import TimelapseService, TimelapseError
from .services import sky_analyzer
from .services import backup_status
from .services import r2_quota

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# Redacción de credenciales en el log. httpx registra la URL completa de cada
# petición saliente, así que el token de WAQI o el hash de AWEKAS acababan en
# claro en el panel de Sistema --y de ahí a una captura o a un pegado de logs.
_REDACT_PARAMS = (
    "token", "key", "api_key", "apikey", "password", "passwd", "pwd",
    "secret", "access_token", "auth", "passcode", "passkey", "id",
)
_REDACT_QUERY_RE = re.compile(
    r"(?i)\b(" + "|".join(_REDACT_PARAMS) + r")=([^&\s;\"']+)"
)
# AWEKAS no usa un parámetro con nombre: manda "val=usuario;hash;fecha;..." y el
# segundo campo ES la credencial.
_REDACT_AWEKAS_RE = re.compile(r"(?i)(val=[^;&\s]*;)([^;&\s]+)")


def _redact(text: str) -> str:
    text = _REDACT_AWEKAS_RE.sub(r"\1<redacted>", text)
    return _REDACT_QUERY_RE.sub(r"\1=<redacted>", text)


class RedactingFilter(logging.Filter):
    """Reescribe el mensaje ya formateado para que ningún handler vea el secreto.

    Va en los handlers y no en el logger raíz: los registros que suben por
    propagación desde un logger hijo (httpx, por ejemplo) no vuelven a pasar
    por los filtros de los loggers ancestros, pero sí por los de cada handler.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        redacted = _redact(message)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def _install_redaction() -> None:
    """Aplica el filtro a todos los handlers del raíz que aún no lo tengan."""
    for handler in logging.getLogger().handlers:
        if not any(isinstance(f, RedactingFilter) for f in handler.filters):
            handler.addFilter(RedactingFilter())


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

# Initialize FastAPI app
app = FastAPI(
    title="Ecowitt Weather Station Receiver",
    description="Receives and stores weather data from Ecowitt gateways",
    version="1.0.0"
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
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

# Initialize storage
storage = InfluxDBStorage(
    url=settings.influxdb_url,
    token=settings.influxdb_token,
    org=settings.influxdb_org,
    bucket=settings.influxdb_bucket
)

# Última lectura en memoria, por estación. Clave None = estación principal;
# clave "nombre" = estación secundaria (p. ej. un GW1100). Acceso rápido para
# /api/current y para pasar la lectura previa al filtro de picos por estación.
latest_by_station: Dict[Optional[str], dict] = {}

# Weather alerts (Telegram / log)
alert_service = AlertService(settings)

# MQTT publisher (with Home Assistant discovery)
mqtt_publisher = MqttPublisher(settings)

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
            principal_timeout = principal_config.get(
                "watchdog_minutes", settings.alert_station_offline_minutes
            ) * 60
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
    if not settings.camera_timelapse_enabled:
        return
    if not TimelapseService.ffmpeg_available():
        logger.warning("Timelapse habilitado pero ffmpeg no está en la imagen; se omite")
        return
    await asyncio.sleep(300)  # gracia inicial: que no compita con el arranque
    while True:
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


@app.on_event("startup")
async def startup_event():
    """Initialize connections on startup."""
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

    # Vigilante de estación caída (solo si las alertas están activas)
    if settings.alerts_enabled:
        asyncio.create_task(station_watchdog())

    # Vigilante de calidad del aire (se auto-guarda con los flags; permite
    # activarlo desde el panel sin reiniciar)
    asyncio.create_task(air_quality_watchdog())

    # Acumuladores: resumen diario (Dayfile) para récords/climatología
    asyncio.create_task(daily_rollup_task())

    # Timelapse diario de la cámara (hoy y ayer, más la purga)
    asyncio.create_task(timelapse_task())

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


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down Ecowitt Weather Station Receiver")
    storage.close()
    mqtt_publisher.close()


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
@app.post("/data/report/")
@app.post("/data/report")
async def receive_ecowitt_data(request: Request):
    """
    Receive weather data from an Ecowitt station (WS2910 console or gateway).

    The station sends data as a form-encoded POST request using the
    Ecowitt protocol (Weather Services -> Customized -> Protocol: Ecowitt).
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

        # Secundaria "a la intemperie" (p. ej. un GW1100 con su sensor integrado
        # puesto afuera): reporta como INTERIOR, pero físicamente es EXTERIOR. Se
        # promueve interior→exterior para que TODO (calibración exterior, derivados,
        # almacenamiento, publicación a redes y la web) lo trate como exterior.
        if station is not None and station_cfg.get("treat_indoor_as_outdoor"):
            for src, dst in (("temperature_indoor", "temperature_outdoor"),
                             ("humidity_indoor", "humidity_outdoor")):
                if parsed_data.get(src) is not None:
                    parsed_data[dst] = parsed_data.pop(src)

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
        await storage.write(parsed_data)

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
            # Publish to MQTT (never let this break ingestion)
            try:
                mqtt_publisher.publish(parsed_data)
            except Exception as e:
                logger.error(f"MQTT publish failed: {e}")

            # Evaluate weather alerts (never let this break ingestion)
            try:
                await alert_service.process(parsed_data, qc_rejected=qc_rejected)
            except Exception as e:
                logger.error(f"Alert processing failed: {e}")

            # Publicar a redes públicas (WU/PWSWeather/Windy/OWM) sin romper ingestión
            try:
                await publish_all(parsed_data, settings)
            except Exception as e:
                logger.error(f"Public publish failed: {e}")
        else:
            # Estación secundaria: alertas propias solo si están habilitadas en su
            # configuración (Admin → Estaciones → config). Estado por estación.
            try:
                scfg = settings_store.get_station_config(settings.settings_file, station)
                if scfg.get("alerts_enabled"):
                    await alert_service.process(
                        parsed_data, station=station, label=scfg.get("label") or station,
                        thresholds=scfg.get("alert_thresholds") or None,
                        disabled=scfg.get("disabled_rules") or [],
                        qc_rejected=qc_rejected)
            except Exception as e:
                logger.error(f"Alert processing (secundaria {station}) failed: {e}")

        return {"status": "success", "message": "Data received"}

    except HTTPException:
        raise
    except Exception as e:
        # No filtrar detalles internos al cliente (el detalle va solo al log).
        logger.error(f"Error processing data: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@app.get("/api/current")
async def get_current_data(station: Optional[str] = None):
    """
    Get the most recent weather data.

    station: None/omitido = estación principal; nombre = estación secundaria.
    """
    data = latest_by_station.get(station)
    if not data:
        raise HTTPException(status_code=404, detail="No data available yet")

    # Calculate rain accumulations if device doesn't provide them
    result = dict(data)
    try:
        rain_accum = await storage.get_rain_accumulations(station=station)
        if result.get("rain_weekly") is None and rain_accum.get("rain_weekly") is not None:
            result["rain_weekly"] = rain_accum["rain_weekly"]
        if result.get("rain_monthly") is None and rain_accum.get("rain_monthly") is not None:
            result["rain_monthly"] = rain_accum["rain_monthly"]
        if result.get("rain_yearly") is None and rain_accum.get("rain_yearly") is not None:
            result["rain_yearly"] = rain_accum["rain_yearly"]
    except Exception as e:
        logger.error(f"Rain accumulation error: {e}")

    # Lluvia acumulada en ventana móvil, integrando rain_rate. Son dos ventanas
    # porque las consumen sitios distintos: la tarjeta del tablero usa 2 h y la
    # consola usa 24 h. Ojo, 24 h móviles NO es `rain_daily`, que se reinicia a
    # medianoche: a las 00:30 el diario dice casi cero aunque haya llovido toda
    # la tarde, y era justo lo que hacía inútil el dato en la consola.
    try:
        rain_2h = await storage.get_rain_hours(hours=2, station=station)
        if rain_2h is not None:
            result["rain_2h"] = rain_2h
    except Exception as e:
        logger.error(f"Rain 2h calculation error: {e}")

    try:
        rain_24h = await storage.get_rain_hours(hours=24, station=station)
        if rain_24h is not None:
            result["rain_24h"] = rain_24h
    except Exception as e:
        logger.error(f"Rain 24h calculation error: {e}")

    # Promedio de viento de 10 min, calculado desde las muestras guardadas: la
    # estación no manda ninguno (ver get_wind_avg10m). Si algún día un dispositivo
    # SÍ reporta `windspdmph_avg10m`, ese valor ya viene en `data` y manda sobre el
    # calculado, que es lo que comprueba el `is None`.
    try:
        if result.get("wind_speed_avg10m") is None:
            wind_avg = await storage.get_wind_avg10m(station=station)
            if wind_avg is not None:
                result["wind_speed_avg10m"] = wind_avg
    except Exception as e:
        logger.error(f"Wind 10-min average error: {e}")

    return result


@app.get("/api/history")
async def get_history(
    start: str = "-24h",
    stop: str = "now()",
    measurement: str = "weather",
    station: Optional[str] = None
):
    """
    Get historical weather data.

    Args:
        start: Start time (e.g., "-24h", "-7d", "2024-01-01T00:00:00Z")
        stop: End time (e.g., "now()", "2024-01-02T00:00:00Z")
        measurement: Measurement name
        station: None/omitido = principal; nombre = estación secundaria
    """
    try:
        secsvc.validate_flux_time(start, "start")
        secsvc.validate_flux_time(stop, "stop")
        secsvc.validate_measurement(measurement)
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        data = await storage.query(
            start=start, stop=stop, measurement=measurement, station=station
        )
        return {"data": data}
    except Exception as e:
        logger.error(f"Error querying history: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@app.get("/api/stats/daily")
async def get_daily_stats(station: Optional[str] = None, start: Optional[str] = None):
    """
    Get statistics (min, max, avg) for today (local calendar day).

    station: None/omitido = principal; nombre = estación secundaria.
    start: si se omite, usa inicio del día local (medianoche); si se pasa,
           puede ser ventana Flux ("-24h") o timestamp ISO.
    """
    if start is None:
        start_iso, _, _ = aggregator.local_day_bounds_utc()
        start = start_iso
    try:
        secsvc.validate_flux_time(start, "start")
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        stats = await storage.get_daily_stats(start=start, station=station)
        return stats
    except Exception as e:
        logger.error(f"Error getting daily stats: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@app.get("/api/stats/records")
async def get_records(start: str = "-30d"):
    """Statistics (min/max/avg) over a range (e.g. -7d, -30d, -365d, -3650d)."""
    try:
        secsvc.validate_flux_time(start, "start")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await storage.get_daily_stats(start=start)
    except Exception as e:
        logger.error(f"Error getting records: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


class LoginBody(BaseModel):
    user: str
    password: str


def _require_admin(authorization: Optional[str]) -> None:
    if not adminsvc.valid_session(adminsvc.bearer_token(authorization)):
        raise HTTPException(status_code=401, detail="No autorizado")


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
_KIOSK_LOCAL_FILE = os.environ.get("KIOSK_LOCAL_FILE", "/data/kiosk_local.json")
_kiosk_local: Dict[str, Any] = {"latest": None, "day": None, "min": {}, "max": {}}


def _kiosk_local_load() -> None:
    """Restaura el estado persistido, si hay. El `day` se carga tal cual: si es de
    un día anterior, el primer POST que llegue detecta el cambio y reinicia los
    min/max, igual que si el proceso no se hubiera reiniciado."""
    try:
        with open(_KIOSK_LOCAL_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return                      # no existe, o quedó corrupto: se empieza limpio
    if not isinstance(data, dict):
        return
    _kiosk_local.update(
        latest=data.get("latest"),
        day=data.get("day"),
        min=data.get("min") or {},
        max=data.get("max") or {},
    )
    print(f"[kiosk] estado local restaurado (día {_kiosk_local['day']})", flush=True)


def _kiosk_local_save() -> None:
    """Guarda con escritura atómica (archivo temporal + replace) para no dejar un
    JSON truncado si el contenedor muere justo durante el guardado."""
    tmp = f"{_KIOSK_LOCAL_FILE}.tmp"
    try:
        os.makedirs(os.path.dirname(_KIOSK_LOCAL_FILE) or ".", exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_kiosk_local, fh)
        os.replace(tmp, _KIOSK_LOCAL_FILE)
    except OSError as e:
        print(f"[kiosk] no se pudo guardar {_KIOSK_LOCAL_FILE}: {e}", flush=True)


_kiosk_local_load()


@app.post("/api/kiosk/local")
async def kiosk_local_post(body: dict = Body(...)):
    """Recibe la lectura del BME280 del display (temperature °C, humidity %, pressure hPa)."""
    today = datetime.now(_MX_TZ).strftime("%Y-%m-%d")
    if _kiosk_local["day"] != today:
        _kiosk_local.update(day=today, min={}, max={})
    vals: Dict[str, float] = {}
    for k in ("temperature", "humidity", "pressure"):
        v = body.get(k)
        if isinstance(v, (int, float)):
            fv = round(float(v), 1)
            vals[k] = fv
            _kiosk_local["min"][k] = round(min(_kiosk_local["min"].get(k, fv), fv), 1)
            _kiosk_local["max"][k] = round(max(_kiosk_local["max"].get(k, fv), fv), 1)
    _kiosk_local["latest"] = {**vals, "received_at": datetime.utcnow().isoformat()}
    _kiosk_local_save()
    return {"ok": True}


@app.get("/api/kiosk/local")
async def kiosk_local_get():
    """Último BME280 local + min/max del día, para la página kiosco (página 2)."""
    return {
        "latest": _kiosk_local["latest"],
        "min": _kiosk_local["min"],
        "max": _kiosk_local["max"],
        "day": _kiosk_local["day"],
    }


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
    import httpx
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


@app.get("/api/admin/stations/{name}/calibration")
async def admin_get_station_calibration(name: str, authorization: Optional[str] = Header(default=None)):
    """Calibración propia de una estación secundaria (dict de claves cal_*)."""
    _require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    cfg = settings_store.get_station_config(settings.settings_file, name)
    return cfg.get("calibration") or {}


@app.post("/api/admin/stations/{name}/calibration")
async def admin_save_station_calibration(
    name: str, body: dict, authorization: Optional[str] = Header(default=None)
):
    """Guarda la calibración propia de una estación secundaria."""
    _require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    clean = {k: v for k, v in body.items() if k.startswith("cal_")}
    cfg = settings_store.get_station_config(settings.settings_file, name)
    cfg["calibration"] = clean
    settings_store.save_station_config(settings.settings_file, name, cfg)
    return {"status": "ok", "calibration": clean}


@app.get("/api/admin/stations/{name}/alerts")
async def admin_get_station_alerts(name: str, authorization: Optional[str] = Header(default=None)):
    """Umbrales de alerta propios de una estación secundaria (claves alert_*)."""
    _require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    cfg = settings_store.get_station_config(settings.settings_file, name)
    return cfg.get("alert_thresholds") or {}


@app.post("/api/admin/stations/{name}/alerts")
async def admin_save_station_alerts(
    name: str, body: dict, authorization: Optional[str] = Header(default=None)
):
    """Guarda los umbrales y las reglas apagadas propios de una secundaria."""
    _require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    clean = {k: v for k, v in body.items() if k.startswith("alert_")}
    cfg = settings_store.get_station_config(settings.settings_file, name)
    cfg["alert_thresholds"] = clean
    if isinstance(body.get("disabled_rules"), list):
        cfg["disabled_rules"] = [r for r in body["disabled_rules"] if isinstance(r, str)]
    settings_store.save_station_config(settings.settings_file, name, cfg)
    return {"status": "ok", "alert_thresholds": clean, "disabled_rules": cfg.get("disabled_rules", [])}


# --- Registro de estaciones por MAC (whitelist de passkey) -----------------

def _persist_registry(secondary_str=None, primary_pk=None):
    """Persiste (settings.json) y aplica EN VIVO cambios al registro de passkeys."""
    current = {}
    if secondary_str is not None:
        current["secondary_stations"] = secondary_str
    if primary_pk is not None:
        current["primary_passkey"] = primary_pk
    settings_store.save_overrides(settings.settings_file, current)
    adminsvc.apply_overrides(settings, alert_service, current)


def _mask_pk(pk):
    return (pk[:6] + "..." + pk[-4:]) if pk and len(pk) > 12 else (pk or "")


def _valid_station_name(name):
    return bool(name) and len(name) <= 32 and all(c.isalnum() or c in "_-" for c in name)


@app.get("/api/admin/registry")
async def admin_get_registry(authorization: Optional[str] = Header(default=None)):
    """Registro de estaciones (whitelist de passkey): principal + secundarias."""
    _require_admin(authorization)
    primary_pk = getattr(settings, "primary_passkey", "") or ""
    smap = settings.secondary_station_map  # {passkey: nombre}
    return {
        "whitelist_active": bool(primary_pk),
        "primary": {"has_passkey": bool(primary_pk), "passkey_masked": _mask_pk(primary_pk)},
        "secondaries": [{"name": n, "passkey_masked": _mask_pk(p)} for p, n in smap.items()],
    }


@app.put("/api/admin/registry/primary")
async def admin_set_primary_passkey(body: dict, authorization: Optional[str] = Header(default=None)):
    """Define/limpia el passkey de la PRINCIPAL desde su MAC (activa la whitelist)."""
    _require_admin(authorization)
    mac = (body.get("mac") or "").strip()
    if not mac:
        _persist_registry(primary_pk="")  # limpia -> whitelist desactivada
        return {"has_passkey": False}
    try:
        pk = settings_store.passkey_from_mac(mac)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _persist_registry(primary_pk=pk)
    return {"has_passkey": True, "passkey_masked": _mask_pk(pk)}


@app.post("/api/admin/registry/secondary")
async def admin_add_secondary(body: dict, authorization: Optional[str] = Header(default=None)):
    """Agrega una estación secundaria desde su MAC (deriva el passkey)."""
    _require_admin(authorization)
    name = (body.get("name") or "").strip()
    mac = (body.get("mac") or "").strip()
    if not _valid_station_name(name):
        raise HTTPException(status_code=400, detail="Nombre inválido (letras, números, - o _)")
    if name.lower() in ("principal", "primary"):
        raise HTTPException(status_code=400, detail="Nombre reservado")
    try:
        pk = settings_store.passkey_from_mac(mac)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    smap = {p: n for p, n in settings.secondary_station_map.items() if n != name}
    smap[pk] = name
    _persist_registry(secondary_str=",".join(f"{p}:{n}" for p, n in smap.items()))
    return {"name": name, "passkey_masked": _mask_pk(pk)}


@app.delete("/api/admin/registry/secondary/{name}")
async def admin_del_secondary(name: str, authorization: Optional[str] = Header(default=None)):
    """Quita una estación secundaria del registro (deja de aceptar sus pushes)."""
    _require_admin(authorization)
    smap = {p: n for p, n in settings.secondary_station_map.items() if n != name}
    _persist_registry(secondary_str=",".join(f"{p}:{n}" for p, n in smap.items()))
    return {"ok": True}


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
    authorization: Optional[str] = Header(default=None)
):
    """Retorna los últimos logs del sistema."""
    _require_admin(authorization)
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

def _detect_sensors(data: dict) -> list:
    """Detecta qué sensores están presentes en los datos de una estación."""
    sensors = []
    if data.get("temperature_outdoor") is not None:
        sensors.append("exterior")
    if data.get("temperature_indoor") is not None:
        sensors.append("interior")
    if data.get("wind_speed") is not None:
        sensors.append("viento")
    if data.get("rain_daily") is not None:
        sensors.append("lluvia")
    if data.get("uv_index") is not None:
        sensors.append("UV")
    if data.get("solar_radiation") is not None:
        sensors.append("solar")
    for i in range(1, 9):
        if data.get(f"temperature_ch{i}") is not None:
            sensors.append(f"WN31-ch{i}")
    return sensors


def _detect_sensors_detail(data: dict, sensor_labels: dict) -> list:
    """
    Detecta sensores con información detallada: lecturas actuales, batería, labels.

    Returns:
        Lista de dicts con info de cada sensor detectado.
    """
    sensors = []

    # Sensor exterior (WS69 para WS2910, WN32 para GW1100)
    if data.get("temperature_outdoor") is not None:
        # Detectar tipo de sensor exterior por batería/modelo.
        #   WS69/WH65 -> battery_wh65 o battery_ws69
        #   WN32      -> battery_wh32 o battery_wh26 (el WN32 ES un WH26, y según
        #                el firmware reporta con una clave o la otra; mirar solo
        #                wh32 lo dejaba sin identificar, con su batería y señal
        #                sin leer, porque ese campo no siempre llega).
        has_ws69 = data.get("battery_wh65") is not None or data.get("battery_ws69") is not None
        has_wn32 = data.get("battery_wh32") is not None or data.get("battery_wh26") is not None
        sensor_type = "WS69" if has_ws69 else ("WN32" if has_wn32 else "Exterior")
        ext = {
            "id": "outdoor",
            "type": sensor_type,
            "category": "exterior",
            "label": sensor_labels.get("outdoor", "Exterior"),
            "temperature": data.get("temperature_outdoor"),
            "humidity": data.get("humidity_outdoor"),
            "battery_ok": next(
                (data[k] for k in ("battery_wh65", "battery_ws69", "battery_wh32", "battery_wh26")
                 if data.get(k) is not None), True),
            "signal": next(
                (data[k] for k in ("signal_wh65", "signal_ws69", "signal_wh32", "signal_wh26")
                 if data.get(k) is not None), None),
            "active": True,
        }
        # Si la estación mide presión pero NO tiene sensor interior separado
        # (p. ej. GW1100 con trampa: su barómetro integrado va como exterior),
        # se muestra la presión en la fila exterior; si hubiera interior, la
        # presión va allí (WS2910).
        if data.get("temperature_indoor") is None and data.get("pressure_relative") is not None:
            ext["pressure"] = data.get("pressure_relative")
        sensors.append(ext)

    # Sensor interior (consola o GW1100)
    if data.get("temperature_indoor") is not None:
        sensors.append({
            "id": "indoor",
            "type": "console",
            "category": "interior",
            "label": sensor_labels.get("indoor", "Interior"),
            "temperature": data.get("temperature_indoor"),
            "humidity": data.get("humidity_indoor"),
            "pressure": data.get("pressure_relative"),
            "battery_ok": True,  # Consola siempre con corriente
            "active": True,
        })

    # Sensores WN31 (canales 1-8)
    for i in range(1, 9):
        temp = data.get(f"temperature_ch{i}")
        if temp is not None:
            sensors.append({
                "id": f"ch{i}",
                "type": "WN31",
                "category": "canal",
                "channel": i,
                "label": sensor_labels.get(f"ch{i}", f"Canal {i}"),
                "temperature": temp,
                "humidity": data.get(f"humidity_ch{i}"),
                "battery_ok": data.get(f"battery_ch{i}", True),
                "signal": data.get(f"signal_ch{i}"),
                "active": True,
            })

    # Viento (parte del WS69)
    if data.get("wind_speed") is not None:
        sensors.append({
            "id": "wind",
            "type": "WS69",
            "category": "viento",
            "label": sensor_labels.get("wind", "Viento"),
            "wind_speed": data.get("wind_speed"),
            "wind_gust": data.get("wind_gust"),
            "wind_direction": data.get("wind_direction"),
            "battery_ok": data.get("battery_wh65", data.get("battery_ws69", True)),
            "signal": data.get("signal_wh65", data.get("signal_ws69")),
            "active": True,
        })

    # Lluvia (parte del WS69)
    if data.get("rain_daily") is not None:
        sensors.append({
            "id": "rain",
            "type": "WS69",
            "category": "lluvia",
            "label": sensor_labels.get("rain", "Lluvia"),
            "rain_rate": data.get("rain_rate"),
            "rain_daily": data.get("rain_daily"),
            "battery_ok": data.get("battery_wh65", data.get("battery_ws69", True)),
            "signal": data.get("signal_wh65", data.get("signal_ws69")),
            "active": True,
        })

    # UV/Solar (parte del WS69)
    if data.get("uv_index") is not None or data.get("solar_radiation") is not None:
        sensors.append({
            "id": "solar",
            "type": "WS69",
            "category": "solar",
            "label": sensor_labels.get("solar", "Solar/UV"),
            "uv_index": data.get("uv_index"),
            "solar_radiation": data.get("solar_radiation"),
            "battery_ok": data.get("battery_wh65", data.get("battery_ws69", True)),
            "signal": data.get("signal_wh65", data.get("signal_ws69")),
            "active": True,
        })

    return sensors


def _station_status(last_received: Optional[str], timeout_minutes: int = 15) -> str:
    """Determina si una estación está online u offline."""
    if not last_received:
        return "unknown"
    try:
        last_dt = datetime.fromisoformat(last_received.replace("Z", "+00:00"))
        now = datetime.now(last_dt.tzinfo)
        delta = (now - last_dt).total_seconds() / 60
        return "online" if delta < timeout_minutes else "offline"
    except Exception:
        return "unknown"


@app.get("/api/stations")
async def list_stations():
    """
    Lista todas las estaciones registradas con su estado actual.

    Incluye la estación principal (name=null) y todas las secundarias
    configuradas en SECONDARY_STATIONS o en settings.json.
    """
    stations_config = settings_store.get_stations_config(settings.settings_file)
    secondary_map = settings.secondary_station_map
    result = []

    # Estación principal (siempre presente)
    principal_data = latest_by_station.get(None, {})
    principal_config = stations_config.get("_principal", {})
    principal_timeout = principal_config.get("watchdog_minutes", settings.alert_station_offline_minutes)
    principal_sensor_labels = settings_store.get_sensor_labels(settings.settings_file, None)
    result.append({
        "name": None,
        "label": principal_config.get("label", "Principal"),
        "last_received": principal_data.get("received_at"),
        "status": _station_status(principal_data.get("received_at"), principal_timeout),
        "sensors": _detect_sensors(principal_data),
        "sensors_detail": _detect_sensors_detail(principal_data, principal_sensor_labels),
        "model": principal_data.get("model"),
        "config": {
            "alerts_enabled": settings.alerts_enabled,
            "publish_enabled": any([
                settings.wu_enabled, settings.pws_enabled,
                settings.windy_enabled, settings.owm_enabled, settings.cwop_enabled
            ]),
            "mqtt_enabled": settings.mqtt_enabled,
            "watchdog_enabled": True,
            "watchdog_minutes": principal_timeout,
        }
    })

    # Estaciones secundarias (desde .env y/o settings.json)
    all_secondary_names = set(secondary_map.values())
    for name in all_secondary_names:
        passkey = next((k for k, v in secondary_map.items() if v == name), None)
        station_data = latest_by_station.get(name, {})
        station_config = settings_store.get_station_config(settings.settings_file, name)
        timeout = station_config.get("watchdog_minutes", 15)
        station_sensor_labels = settings_store.get_sensor_labels(settings.settings_file, name)
        result.append({
            "name": name,
            "label": station_config.get("label") or name,
            "passkey_hint": settings_store.mask_passkey(passkey) if passkey else None,
            "last_received": station_data.get("received_at"),
            "status": _station_status(station_data.get("received_at"), timeout),
            "sensors": _detect_sensors(station_data),
            "sensors_detail": _detect_sensors_detail(station_data, station_sensor_labels),
            "model": station_data.get("model"),
            "config": station_config,
        })

    return {"stations": result, "count": len(result)}


@app.get("/api/stations/{name}")
async def get_station(name: str):
    """Obtiene el estado detallado de una estación específica."""
    if name == "_principal" or name == "principal":
        name_key = None
        config = settings_store.get_station_config(settings.settings_file, "_principal")
    else:
        name_key = name
        if name not in settings.secondary_station_map.values():
            raise HTTPException(status_code=404, detail=f"Estación '{name}' no encontrada")
        config = settings_store.get_station_config(settings.settings_file, name)

    station_data = latest_by_station.get(name_key, {})
    timeout = config.get("watchdog_minutes", 15)
    sensor_labels = settings_store.get_sensor_labels(
        settings.settings_file,
        None if name == "_principal" or name == "principal" else name
    )

    return {
        "name": name_key,
        "label": config.get("label") or name or "Principal",
        "last_received": station_data.get("received_at"),
        "status": _station_status(station_data.get("received_at"), timeout),
        "sensors": _detect_sensors(station_data),
        "sensors_detail": _detect_sensors_detail(station_data, sensor_labels),
        "model": station_data.get("model"),
        "config": config,
        "sensor_labels": sensor_labels,
        "current_data": station_data if station_data else None,
    }


@app.put("/api/stations/{name}")
async def update_station(name: str, body: dict = Body(...),
                        authorization: Optional[str] = Header(default=None)):
    """Actualiza la configuración de una estación (requiere sesión admin)."""
    _require_admin(authorization)
    if name == "_principal" or name == "principal":
        station_key = "_principal"
    else:
        if name not in settings.secondary_station_map.values():
            raise HTTPException(status_code=404, detail=f"Estación '{name}' no encontrada")
        station_key = name

    # Actualizar config general de la estación
    if "config" in body:
        new_config = body["config"]
        settings_store.save_station_config(settings.settings_file, station_key, new_config)

    # Actualizar labels de sensores
    if "sensor_labels" in body:
        station_for_labels = None if station_key == "_principal" else station_key
        for sensor_id, label in body["sensor_labels"].items():
            settings_store.save_sensor_label(
                settings.settings_file, sensor_id, label, station_for_labels
            )

    return {"ok": True, "message": "Configuración actualizada"}


@app.post("/api/admin/stations")
async def create_station(body: dict = Body(...), authorization: Optional[str] = Header(default=None)):
    """Crea una nueva estación secundaria."""
    _require_admin(authorization)
    name = body.get("name", "").strip().lower()
    passkey = body.get("passkey", "").strip() or None

    if not name:
        raise HTTPException(status_code=400, detail="El nombre es requerido")
    if not name.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="El nombre solo puede contener letras, números, guiones y guiones bajos")
    if name in ("principal", "_principal"):
        raise HTTPException(status_code=400, detail="Nombre reservado")
    if name in settings.secondary_station_map.values():
        raise HTTPException(status_code=400, detail=f"Ya existe una estación con nombre '{name}'")

    # Register passkey mapping if provided
    if passkey:
        if passkey in settings.secondary_station_map:
            raise HTTPException(status_code=400, detail="Este passkey ya está asignado a otra estación")
        settings.secondary_station_map[passkey] = name

    # Create default config
    settings_store.save_station_config(settings.settings_file, name, {
        "label": name.title(),
        "watchdog_enabled": True,
        "watchdog_minutes": 15,
        "alerts_enabled": False,
        "publish_enabled": False,
        "mqtt_enabled": False,
    })

    # Save passkey mapping to settings file
    all_settings = settings_store.load_all_settings(settings.settings_file)
    if "station_passkeys" not in all_settings:
        all_settings["station_passkeys"] = {}
    if passkey:
        all_settings["station_passkeys"][passkey] = name
    settings_store.save_all_settings(settings.settings_file, all_settings)

    return {"ok": True, "name": name, "message": f"Estación '{name}' creada"}


@app.delete("/api/admin/stations/{name}")
async def delete_station(name: str, authorization: Optional[str] = Header(default=None)):
    """Elimina una estación secundaria (no elimina datos históricos)."""
    _require_admin(authorization)

    if name in ("principal", "_principal"):
        raise HTTPException(status_code=400, detail="No se puede eliminar la estación principal")

    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail=f"Estación '{name}' no encontrada")

    # Remove from passkey map
    passkey_to_remove = None
    for pk, n in settings.secondary_station_map.items():
        if n == name:
            passkey_to_remove = pk
            break
    if passkey_to_remove:
        del settings.secondary_station_map[passkey_to_remove]

    # Remove from settings file
    all_settings = settings_store.load_all_settings(settings.settings_file)
    if "station_passkeys" in all_settings:
        all_settings["station_passkeys"] = {
            pk: n for pk, n in all_settings.get("station_passkeys", {}).items()
            if n != name
        }
    if "stations" in all_settings and name in all_settings["stations"]:
        del all_settings["stations"][name]
    settings_store.save_all_settings(settings.settings_file, all_settings)

    # Remove from latest cache
    latest_by_station.pop(name, None)

    return {"ok": True, "message": f"Estación '{name}' eliminada"}


@app.get("/api/compare")
async def get_compare():
    """Comparación 24h vs 24h previas (aprox. 'vs ayer')."""
    try:
        return await storage.get_comparison()
    except Exception as e:
        logger.error(f"Error getting comparison: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/climate/records")
async def get_climate_records(start: str = "-3650d"):
    """Récords ampliados: de siempre, por mes calendario, este mes/año y ayer."""
    try:
        rows = await storage.query_daily_summaries(start=start)
        return aggregator.build_records(rows, lat=getattr(settings, "cwop_latitude", 19.380359))
    except Exception as e:
        logger.error(f"Error getting climate records: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/climate/onthisday")
async def get_on_this_day():
    """Efeméride: qué pasó el mismo día calendario en años previos."""
    try:
        rows = await storage.query_daily_summaries(start="-3650d")
        return aggregator.on_this_day(rows)
    except Exception as e:
        logger.error(f"Error building on-this-day: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/climate/noaa")
async def get_climate_noaa(year: int, month: Optional[int] = None):
    """Reporte climatológico estilo NOAA: mensual (con month) o anual (sin month)."""
    try:
        rows = await storage.query_daily_summaries(start="-3650d")
        lat = getattr(settings, "cwop_latitude", 19.380359)
        if month:
            return aggregator.noaa_month(rows, year, month, lat)
        return aggregator.noaa_year(rows, year, lat)
    except Exception as e:
        logger.error(f"Error building NOAA report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/smn")
async def get_smn_forecast(ides: str = "9", idmun: str = "14", hourly: int = 1):
    """Pronóstico oficial del SMN (CONAGUA) por municipio (por defecto Benito Juárez,
    CDMX). `hourly=0` omite el horario (evita descargar el archivo grande)."""
    try:
        return await smn.get_forecast(ides=ides, idmun=idmun, hourly=bool(hourly))
    except Exception as e:
        logger.error(f"Error SMN: {e}")
        raise HTTPException(status_code=502, detail="No se pudo obtener el pronóstico del SMN")


@app.get("/api/svitrix")
async def get_svitrix():
    """Dato real de la estación con forma WeatherAPI `current.json` (+ solar_radiation)
    para el firmware SVITRIX del reloj Ulanzi. Apunta la URL del reloj aquí."""
    data = latest_by_station.get(None)
    # Sin NINGUNA lectura (arranque en frío sin histórico que repoblar) no se puede
    # servir un `current`: con temp_c/humidity/pressure_mb en null, el firmware los
    # lee como 0.0 y pinta "0 °C / 0 % / 0 mb" como si fueran medidas reales.
    #
    # Se responde 503 SOLO en ese caso, que es transitorio. Si hay una lectura
    # aunque sea vieja se manda tal cual: el reloj reinicia el ESP32 tras
    # ~15 min sin un fetch con HTTP 200 (DataFetcher.cpp, staleLimit), así que
    # devolver error mientras la estación está caída lo dejaría en ciclo de
    # reinicios — peor que mostrar el último valor conocido.
    if not data or data.get("temperature_outdoor") is None:
        raise HTTPException(status_code=503, detail="Sin lectura de la estación todavía")
    lat = getattr(settings, "cwop_latitude", 19.380359)
    lon = getattr(settings, "cwop_longitude", -99.174564)
    aq = im = None
    try:
        aq = await get_air_quality(lat, lon, settings.waqi_token)
    except Exception as e:
        logger.error(f"svitrix aq: {e}")
    try:
        im = await imeca.get_imeca(lat, lon, pressure_hpa=data.get("pressure_absolute"))
    except Exception as e:
        logger.error(f"svitrix imeca: {e}")
    # Elevación del sol (pyephem, ya cacheada): la usa la condición del tiempo
    # para juzgar nubosidad por índice de claridad, y el is_day del ícono.
    sun_elev = None
    try:
        alm = get_almanac(lat, lon)
        if alm.get("available"):
            sun_elev = (alm.get("sun") or {}).get("altitude")
    except Exception as e:
        logger.error(f"svitrix almanac: {e}")
    return svitrix.build_weatherapi(data, aq, im, lat=lat, lon=lon, sun_elev=sun_elev)


@app.get("/api/epaper/forecast.json")
async def get_epaper_forecast():
    """
    Dato de la estación con forma WeatherAPI `forecast.json` para el display LilyGo
    e-paper 4.7". Apunta ahí la URL del firmware en vez de a api.weatherapi.com.

    A diferencia de `/api/svitrix`, este endpoint **no devuelve 503 nunca**: el e-paper
    despierta, pide una vez y se vuelve a dormir, así que un error lo deja con la
    pantalla vieja hasta el siguiente ciclo. Si falta el dato de la estación se cae al
    pronóstico de la hora en curso y se marca en `xe1e.source`.

    Por lo mismo, cada fuente externa se pide con tolerancia a fallos: que se caiga WAQI
    o el IMECA no puede costar la pantalla entera.
    """
    lat = getattr(settings, "cwop_latitude", 19.380359)
    lon = getattr(settings, "cwop_longitude", -99.174564)
    data = latest_by_station.get(None)

    async def _ok(coro, etiqueta):
        try:
            return await coro
        except Exception as e:
            logger.error(f"epaper {etiqueta}: {e}")
            return None

    start_iso, _, _ = aggregator.local_day_bounds_utc()
    aq, im, om, stats, p_3h = await asyncio.gather(
        _ok(get_air_quality(lat, lon, settings.waqi_token), "calidad del aire"),
        _ok(imeca.get_imeca(lat, lon, pressure_hpa=_station_pressure_hpa()), "imeca"),
        _ok(openmeteo.get_forecast(lat, lon, days=3, epaper=True), "pronostico"),
        _ok(storage.get_daily_stats(start=start_iso), "estadisticas del dia"),
        _ok(storage.get_field_value_ago("pressure_relative", start="-3h"), "presion de hace 3h"),
    )

    alm = None
    try:
        alm = get_almanac(lat, lon)
        if not alm.get("available"):
            alm = None
    except Exception as e:
        logger.error(f"epaper almanaque: {e}")

    return epaper.build_forecast_json(
        data, aq, im, lat=lat, lon=lon,
        sun_elev=((alm or {}).get("sun") or {}).get("altitude"),
        almanac=alm, om=om, stats=stats, p_3h=p_3h,
        ahora=datetime.now(),
    )


@app.get("/api/bim32")
async def get_bim32():
    """
    JSON compacto para el firmware BIM32 (`weather.hpp`): combina el dato REAL de la
    estación (temperatura/humedad/presión/viento, igual que `/api/svitrix`) con el
    pronóstico diario y horario de Open-Meteo, ya recortado a 5 días / 40 puntos
    horarios y con los códigos de ícono que `Weather::_convertIcon()` ya sabe
    interpretar. Sustituye las 2-3 peticiones que el ESP32 hacía directo a
    Open-Meteo por esta única llamada.

    Sin lectura de la estación se cae al pronóstico de la hora en curso, igual que
    `/api/epaper/forecast.json` — no se devuelve 503, para no dejar al firmware sin
    dato con el que refrescar su pantalla.
    """
    lat = getattr(settings, "cwop_latitude", 19.380359)
    lon = getattr(settings, "cwop_longitude", -99.174564)
    data = latest_by_station.get(None)

    sun_elev = None
    try:
        alm = get_almanac(lat, lon)
        if alm.get("available"):
            sun_elev = (alm.get("sun") or {}).get("altitude")
    except Exception as e:
        logger.error(f"bim32 almanaque: {e}")

    try:
        om = await openmeteo.get_forecast(lat, lon, days=6, epaper=True)
        # Mismo ajuste que ya usa /api/forecast: corrige temperatura (con decay)
        # y presión (constante, calibración vs. el barómetro real) usando el
        # sesgo real de la estación -- antes BIM32 recibía ambas crudas de
        # Open-Meteo, cuya presión reducida a nivel del mar queda muy por
        # debajo de la relativa ya calibrada de la estación.
        om = _apply_temperature_bias(om, (data or {}).get("temperature_outdoor"), (data or {}).get("pressure_relative"))
    except Exception as e:
        logger.error(f"bim32 pronostico: {e}")
        om = {}

    # Análisis visual de la cámara (ver sky_analyzer.py): a diferencia del índice de
    # claridad solar, sí distingue nubes de noche. Se descarta si está viejo (cámara
    # caída, cuota de la API agotada) para no clavar una lectura obsoleta. Ojo: el
    # análisis corre en SU PROPIO intervalo (camera_analysis_interval_min), más lento
    # que las capturas de foto -- usar camera_stale_seconds (pensado para la foto)
    # lo descartaba casi siempre justo al borde del intervalo. Dos intervalos de
    # margen (mínimo 20 min) cubre esa cadencia más una reintento/latencia de la API.
    analysis_stale_seconds = max(settings.camera_analysis_interval_min * 60 * 2, 1200)
    sky_analysis = _camera.get_analysis()
    if sky_analysis:
        try:
            analyzed_at = datetime.fromisoformat(sky_analysis.get("analyzed_at", ""))
            if analyzed_at.tzinfo is None:
                analyzed_at = analyzed_at.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - analyzed_at).total_seconds() > analysis_stale_seconds:
                sky_analysis = None
        except (ValueError, TypeError):
            sky_analysis = None

    return bim32.build_bim32(data, om, sun_elev=sun_elev, sky_analysis=sky_analysis)


@app.get("/api/bim32/history")
async def get_bim32_history(period: int = 30):
    """
    Historial exterior (temperatura/humedad/presión) para el firmware BIM32,
    en baldes de `period` minutos (hasta 24 puntos). Reemplaza el mecanismo de
    ThingSpeak (Thingspeak::sendHistory/receiveHistory en el firmware): ya no
    hace falta que el ESP32 mande su propia lectura a un canal externo, este
    servidor ya tiene el histórico real de la estación.
    """
    period = max(1, min(period, 999))
    try:
        records = await storage.query(
            start=f"-{period * 24}m",
            fields=["temperature_outdoor", "humidity_outdoor", "pressure_relative"],
        )
        return {"period_minutes": period, "history": bim32.build_bim32_history(records, period)}
    except Exception as e:
        logger.error(f"Error building bim32 history: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@app.get("/api/smn/municipios")
async def get_smn_municipios():
    """Lista de municipios del SMN (para búsqueda/autocompletar)."""
    try:
        return {"municipios": await smn.municipios()}
    except Exception as e:
        logger.error(f"Error SMN municipios: {e}")
        raise HTTPException(status_code=502, detail="No se pudo obtener la lista de municipios")


@app.get("/api/wind/rose")
async def get_wind_rose(start: str = "-7d"):
    """Rosa de vientos: distribución por sectores en el periodo (desde histórico)."""
    try:
        records = await storage.query(start=start, fields=["wind_direction", "wind_speed"])
        return compute_wind_rose(records)
    except Exception as e:
        logger.error(f"Error building wind rose: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rain/last")
async def get_last_rain(station: Optional[str] = None):
    """Fecha/hora de la última lluvia registrada (rain_rate > 0)."""
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"date": await storage.get_last_rain(station=station)}


@app.get("/api/rain/hours")
async def get_rain_hours(hours: int = 2, station: Optional[str] = None):
    """Lluvia acumulada en las últimas N horas (máx 24)."""
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    hours = max(1, min(hours, 24))
    rain = await storage.get_rain_hours(hours=hours, station=station)
    return {"hours": hours, "rain_mm": rain}


@app.get("/api/rain/daily")
async def get_daily_rain(days: int = 7, station: Optional[str] = None):
    """
    Lluvia por día LOCAL de los últimos `days` días. Alimenta el histograma de la
    celda LLUVIA de la consola.

    Existe en vez de reutilizar /api/climate/noaa --el único que ya daba lluvia por
    día-- porque aquél devuelve un mes entero con veinte campos por jornada, y una
    ventana de 7 días a caballo entre dos meses obligaría a pedir dos.

    Un día sin resumen devuelve `rain: null`, no 0: "no se guardó el día" y "no
    llovió" son cosas distintas y el histograma las dibuja distinto.
    """
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    days = max(1, min(days, 31))
    # Se pide una ventana MAYOR que los días pedidos y luego se recorta por fecha
    # local: los resúmenes llevan la fecha local como tag, pero el rango de Flux va en
    # UTC, así que con "-7d" justos el día más antiguo entra a medias o se cae.
    rows = await storage.query_daily_summaries(start=f"-{days + 2}d", station=station)
    by_date = {str(r.get("date")): r.get("rain_total") for r in rows if r.get("date")}

    wanted = aggregator.local_recent_dates(days)
    # El día EN CURSO no tiene resumen cerrado --el rollup lo escribe al terminar el
    # día-- así que su barra saldría vacía justo cuando más interesa. Para hoy se toma
    # el acumulado vivo de la última lectura, y se queda el mayor de los dos por si el
    # rollup ya corrió.
    live = (latest_by_station.get(station) or {}).get("rain_daily")

    out = []
    for i, d in enumerate(wanted):
        mm = by_date.get(d)
        es_hoy = i == len(wanted) - 1
        if es_hoy and isinstance(live, (int, float)):
            if not isinstance(mm, (int, float)) or live > mm:
                mm = live
        out.append({"date": d,
                    "rain": round(float(mm), 1) if isinstance(mm, (int, float)) else None})
    return {"days": days, "data": out}


# ── Cámara del exterior ──────────────────────────────────────────────────────
# La cámara está detrás del NAT de casa y el servidor en el VPS, así que la foto se
# EMPUJA hacia aquí. Ver docs/archivo/PLAN-CAMARA-EXTERIOR.md y services/camera.py.
_timelapse = TimelapseService(
    base_dir=settings.camera_dir,
    fps=settings.camera_timelapse_fps,
    width=settings.camera_timelapse_width,
    min_frames=settings.camera_timelapse_min_frames,
    retention_days=settings.camera_timelapse_retention_days,
)

_camera = CameraStore(
    base_dir=settings.camera_dir,
    retention_days=settings.camera_retention_days,
    stale_seconds=settings.camera_stale_seconds,
    analysis_retention_days=settings.camera_analysis_retention_days,
)


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
        "r2_influx_keep": settings.r2_influx_keep,
    }


@app.post("/api/camera/upload")
async def camera_upload(request: Request):
    """
    Recibe una captura del exterior. Acepta multipart (campo `file`) o el JPEG en
    crudo como cuerpo, que es lo que sale de un `curl --data-binary` desde un script.

    El cuerpo se lee A MANO en vez de declarar `file: UploadFile` en la firma: con el
    parámetro declarado, FastAPI intenta parsear como formulario CUALQUIER envío, así
    que un `--data-binary` sin `Content-Type` --lo más natural desde un script-- se
    caía con un 500 antes de llegar a la validación. Comprobado contra producción.

    Autenticación por token propio en `X-Camera-Token` (o `?token=`), NO el del panel
    de administración: esto lo va a llamar un script desatendido en una máquina de
    casa y, si ese token se filtra, lo único que permite es subir fotos.

    Sin `CAMERA_UPLOAD_TOKEN` configurado responde 503 y no guarda nada: es una ruta
    de ESCRITURA, y dejarla abierta "hasta que la configure" es como se acaban
    teniendo carpetas llenas de lo que suba cualquiera.
    """
    esperado = settings.camera_upload_token
    if not esperado:
        raise HTTPException(status_code=503, detail="Subida de cámara no configurada")

    recibido = request.headers.get("X-Camera-Token") or request.query_params.get("token") or ""
    # Comparación en tiempo constante: el token viaja por HTTP en la LAN, pero no
    # cuesta nada no filtrar su longitud ni su prefijo por el tiempo de respuesta.
    if not secrets.compare_digest(recibido, esperado):
        raise HTTPException(status_code=401, detail="Token inválido")

    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        subida = form.get("file")
        data = await subida.read() if hasattr(subida, "read") else b""
    else:
        data = await request.body()

    try:
        meta = _camera.save(data)
    except ValueError as e:
        # 400 y no 500: el envío es el que está mal, y así el script de casa puede
        # distinguir "mi captura salió mal" de "el servidor está caído".
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        logger.error("Error guardando la captura de cámara: %s", e)
        raise HTTPException(status_code=500, detail="Error interno")
    logger.info("Cámara: captura de %d bytes recibida", meta["bytes"])

    # Análisis del cielo con visión (asíncrono, no bloquea la respuesta).
    # NO en cada captura: ver _debe_analizar (throttle por intervalo).
    has_any_key = settings.anthropic_api_key or settings.gemini_api_key
    if has_any_key and settings.camera_analysis_enabled and _debe_analizar():
        asyncio.create_task(_analyze_sky_background(data))

    return {"ok": True, **meta}


# Momento (monotónico) del último análisis DISPARADO. Empieza en 0 para que la primera
# captura tras arrancar sí analice. Se pone ANTES de lanzar el análisis, aunque falle:
# si Gemini devuelve 429 no tiene sentido reintentar a los 5 min y volver a chocar; se
# espera el intervalo completo, que es lo que respeta la cuota del tier gratuito.
_ultimo_analisis_ts = 0.0

# Resultado del último intento de análisis, para el panel de diagnóstico. `ok` None
# hasta el primer intento tras arrancar.
_ultimo_analisis_resultado: Dict[str, Any] = {"ok": None, "at": None, "provider": None, "error": None}


def _registrar_analisis(provider: Optional[str], error: Optional[str]) -> None:
    """Guarda el desenlace del último análisis (lo lee /api/camera/diag)."""
    _ultimo_analisis_resultado.update({
        "ok": error is None,
        "at": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "error": error,
    })


def _debe_analizar() -> bool:
    """Throttle del análisis por `camera_analysis_interval_min`.

    El análisis NO corre en cada captura: a 5 min son ~288/día y agotan la cuota diaria
    gratuita de Gemini (429), dejando el análisis congelado media tarde. Con 15 min caen
    ~72-96/día. Con el intervalo en 0 se analiza en cada captura (comportamiento previo).
    """
    global _ultimo_analisis_ts
    interval = max(0, settings.camera_analysis_interval_min) * 60
    ahora = time.monotonic()
    if interval and (ahora - _ultimo_analisis_ts) < interval:
        return False
    _ultimo_analisis_ts = ahora
    return True


async def _current_forecast_wmo_cloudcover() -> Optional[Dict[str, Any]]:
    """Código WMO y % de nubes que predice Open-Meteo para la hora de AHORA.

    Compartido entre el endpoint `/api/camera/analysis/validation` (validación bajo
    demanda) y `_analyze_sky_background` (una validación por captura, para el
    histórico) -- ambos necesitan lo mismo: qué predijo el modelo para este momento.
    `get_forecast` ya cachea 15 min, así que llamarlo por cada captura (~5 min) no
    agrega peticiones nuevas a Open-Meteo la mayoría de las veces.
    """
    try:
        # epaper=True: el conjunto horario NORMAL (`_HOURLY` en openmeteo.py) no
        # trae `cloud_cover`, sólo el ampliado para el e-paper. Sin esto,
        # `hourly.get("cloud_cover", [0])[idx]` indexaba ese `[0]` de relleno con
        # cualquier hora que no fuera la 00:00 -> IndexError, atrapado por el
        # except de abajo, y el endpoint devolvía "sin pronóstico" TODO el día.
        forecast = await openmeteo.get_forecast(
            settings.cwop_latitude,
            settings.cwop_longitude,
            days=1,
            epaper=True,
        )
        hourly = forecast.get("hourly", {})
        times = hourly.get("time", [])
        now = _openmeteo_now_str(forecast)
        try:
            idx = times.index(now)
        except ValueError:
            idx = 0 if times else -1
        if idx < 0:
            return None
        codes = hourly.get("weather_code", [])
        clouds = hourly.get("cloud_cover", [])
        return {
            "weather_code": codes[idx] if idx < len(codes) else None,
            "cloud_cover": clouds[idx] if idx < len(clouds) else 0,
        }
    except Exception:
        return None


async def _analyze_sky_background(image_data: bytes) -> None:
    """Analiza la imagen del cielo en background y guarda el resultado."""
    try:
        station_data = dict(latest_by_station.get(None) or {})
        # Sol directo sin obstrucción de nubes: con el lente gran angular de esta
        # cámara, sobreexpone buena parte del encuadre durante horas (verificado con
        # fotos reales) sin que sea nubosidad -- ver sky_analyzer.sun_glare_likely()
        # y docs/archivo/PLAN-HDR-CAMARA.md (por qué no se resuelve tocando la cámara).
        try:
            lat = getattr(settings, "cwop_latitude", 19.380359)
            lon = getattr(settings, "cwop_longitude", -99.174564)
            altitude = sun_altitude(lat, lon)
            station_data["sun_glare_likely"] = sky_analyzer.sun_glare_likely(
                altitude, station_data.get("solar_radiation")
            )
        except Exception as e:
            logger.warning(f"No se pudo calcular sol_glare_likely: {e}")
        analysis = await sky_analyzer.analyze_sky(
            image_data,
            anthropic_api_key=settings.anthropic_api_key,
            gemini_api_key=settings.gemini_api_key,
            provider=settings.camera_analysis_provider,
            anthropic_model=settings.camera_analysis_model_anthropic,
            gemini_model=settings.camera_analysis_model_gemini,
            # Lecturas en vivo de la PRINCIPAL, para que el modelo no contradiga con el
            # texto lo que la propia estación ya midió (típicamente lluvia cayendo que
            # la imagen no deja ver clara). Es la misma fuente que /api/current.
            station_data=station_data,
        )
        analysis_dict = analysis.to_dict()
        # Se registra SIEMPRE el resultado del intento (éxito o error) para que el
        # panel muestre "por qué no analiza" sin escarbar en logs: el 429 de cuota
        # agotada, un timeout, etc.
        _registrar_analisis(analysis.provider, analysis.error)
        try:
            await alert_service.check_camera_analysis(analysis.error)
        except Exception as e:
            logger.error("Error evaluando alerta de análisis de cámara: %s", e)
        if analysis.error:
            # NO se guarda: un fallo pasajero de la API (timeout, 503 del tier
            # gratuito de Gemini) NO debe borrar el último análisis bueno. Si lo
            # guardáramos, la tarjeta del dashboard se ocultaría hasta la próxima
            # captura con éxito. Mejor dejar el anterior, que ya envejece solo con
            # su marca de tiempo.
            logger.warning("Análisis del cielo con error (%s): %s -- se conserva el anterior",
                           analysis.provider or "?", analysis.error)
        else:
            forecast_current = await _current_forecast_wmo_cloudcover()
            validation = sky_validation.validate_analysis(analysis_dict, forecast_current)
            _camera.save_analysis(analysis_dict, validation=validation)
            logger.info("Análisis del cielo (%s): %s, %d%% nubes",
                        analysis.provider, analysis.sky_condition, analysis.cloud_coverage_pct)
            # Evaluar alertas visuales (tormenta, precipitación visible, visibilidad)
            try:
                await alert_service.check_sky(analysis_dict)
            except Exception as e:
                logger.error("Error evaluando alertas visuales: %s", e)
    except Exception as e:
        logger.error("Error en análisis del cielo: %s", e)
        error_msg = str(e)[:200]
        _registrar_analisis(None, error_msg)
        try:
            await alert_service.check_camera_analysis(error_msg)
        except Exception as e2:
            logger.error("Error evaluando alerta de análisis de cámara: %s", e2)


@app.get("/api/camera/status")
async def camera_status():
    """¿Hay foto, de cuándo es y está vieja? Lo consulta la página del kiosco."""
    return _camera.status_with_analysis()


@app.get("/api/camera/capture-config")
async def camera_capture_config():
    """Config que la Pi lee en cada corrida para decidir si captura ahora. Pública: no
    trae secretos, y así el script no necesita el token para un simple GET."""
    return {
        "enabled": settings.camera_capture_enabled,
        "interval_min": settings.camera_capture_interval_min,
        "hour_start": settings.camera_capture_hour_start,
        "hour_end": settings.camera_capture_hour_end,
    }


@app.get("/api/kiosk/config")
async def kiosk_config():
    """Config pública que leen las páginas del kiosco (consola, menú) para decidir qué
    mostrar. De momento sólo si la cámara aparece; se puede ampliar sin romper nada."""
    return {"camera_enabled": settings.kiosk_camera_enabled}


@app.get("/api/camera/diag")
async def camera_diag(authorization: Optional[str] = Header(default=None)):
    """Estado consolidado para el panel: última foto, último análisis (con su error si
    lo hubo), proveedor activo y la config vigente. Así se ve 'por qué no analiza'."""
    _require_admin(authorization)
    resolved = sky_analyzer.resolve_provider(
        settings.camera_analysis_provider, settings.anthropic_api_key, settings.gemini_api_key)
    return {
        "capture": {
            "enabled": settings.camera_capture_enabled,
            "interval_min": settings.camera_capture_interval_min,
            "hour_start": settings.camera_capture_hour_start,
            "hour_end": settings.camera_capture_hour_end,
            "status": _camera.status(),
        },
        "analysis": {
            "enabled": settings.camera_analysis_enabled,
            "interval_min": settings.camera_analysis_interval_min,
            "provider_setting": settings.camera_analysis_provider,
            "active_provider": resolved,
            "has_gemini_key": bool(settings.gemini_api_key),
            "has_anthropic_key": bool(settings.anthropic_api_key),
            "model_gemini": settings.camera_analysis_model_gemini,
            "model_anthropic": settings.camera_analysis_model_anthropic,
            "last_attempt": _ultimo_analisis_resultado,
            "last_saved": _camera.get_analysis(),
        },
        # El timelapse entra en el diagnóstico porque su fallo típico no es de datos
        # sino de despliegue: si la imagen se reconstruye sin ffmpeg, las capturas
        # siguen llegando y lo único que pasa es que el vídeo no aparece nunca.
        "timelapse": {
            "enabled": settings.camera_timelapse_enabled,
            "ffmpeg": TimelapseService.ffmpeg_available(),
            "fps": settings.camera_timelapse_fps,
            "width": settings.camera_timelapse_width,
            "min_frames": settings.camera_timelapse_min_frames,
            "retention_days": settings.camera_timelapse_retention_days,
            "disk_bytes": _timelapse.disk_bytes(),
            "days": _timelapse.days(),
        },
        "retention_days": settings.camera_retention_days,
        "stale_seconds": settings.camera_stale_seconds,
        "kiosk_camera_enabled": settings.kiosk_camera_enabled,
    }


@app.post("/api/camera/analyze-now")
async def camera_analyze_now(authorization: Optional[str] = Header(default=None)):
    """Fuerza el análisis de la última foto AHORA, saltándose el intervalo. Para el
    botón del panel: probar tras cambiar ajustes o refrescar a voluntad."""
    _require_admin(authorization)
    if not (settings.anthropic_api_key or settings.gemini_api_key):
        raise HTTPException(status_code=400, detail="No hay API key configurada para el análisis")
    ultima = _camera.latest()
    if ultima is None:
        raise HTTPException(status_code=404, detail="No hay ninguna foto que analizar todavía")
    data, _ = ultima
    await _analyze_sky_background(data)
    return {"status": "ok", "result": _ultimo_analisis_resultado}


@app.get("/api/camera/analysis")
async def camera_analysis():
    """Último análisis del cielo (si está habilitado y hay uno)."""
    analysis = _camera.get_analysis()
    has_anthropic = bool(settings.anthropic_api_key)
    has_gemini = bool(settings.gemini_api_key)
    resolved = sky_analyzer.resolve_provider(
        settings.camera_analysis_provider,
        settings.anthropic_api_key,
        settings.gemini_api_key,
    )
    if analysis is None:
        return {
            "available": False,
            "enabled": settings.camera_analysis_enabled,
            "provider": settings.camera_analysis_provider,
            "active_provider": resolved,
            "has_anthropic_key": has_anthropic,
            "has_gemini_key": has_gemini,
        }
    trend = _camera.get_trend()
    return {
        "available": True,
        "enabled": settings.camera_analysis_enabled,
        "provider": settings.camera_analysis_provider,
        "active_provider": resolved,
        "has_anthropic_key": has_anthropic,
        "has_gemini_key": has_gemini,
        "trend": trend,
        **analysis,
    }


@app.get("/api/camera/analysis/providers")
async def camera_analysis_providers():
    """Info sobre proveedores de análisis disponibles (para el panel admin)."""
    has_anthropic = bool(settings.anthropic_api_key)
    has_gemini = bool(settings.gemini_api_key)
    resolved = sky_analyzer.resolve_provider(
        settings.camera_analysis_provider,
        settings.anthropic_api_key,
        settings.gemini_api_key,
    )
    return {
        "enabled": settings.camera_analysis_enabled,
        "provider_setting": settings.camera_analysis_provider,
        "active_provider": resolved,
        "providers": sky_analyzer.PROVIDER_INFO,
        "keys_configured": {
            "anthropic": has_anthropic,
            "gemini": has_gemini,
        },
        "models": {
            "anthropic": settings.camera_analysis_model_anthropic,
            "gemini": settings.camera_analysis_model_gemini,
        },
    }


@app.get("/api/camera/analysis/history")
async def camera_analysis_history(date: Optional[str] = None):
    """
    Histórico de análisis del cielo.

    - Sin parámetros: lista los días disponibles con análisis
    - Con ?date=YYYY-MM-DD: devuelve los análisis de ese día
    """
    if date is None:
        days = _camera.get_analysis_days()
        return {"days": days}

    # Validar formato de fecha
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (usar YYYY-MM-DD)")

    data = _camera.get_daily_analysis(date)
    if data is None:
        raise HTTPException(status_code=404, detail=f"No hay análisis para {date}")

    # Calcular estadísticas del día
    coverages = [e.get("coverage", 0) for e in data]
    conditions = {}
    for e in data:
        c = e.get("condition", "unknown")
        conditions[c] = conditions.get(c, 0) + 1

    return {
        "date": date,
        "count": len(data),
        "stats": {
            "coverage_avg": round(sum(coverages) / len(coverages), 1) if coverages else 0,
            "coverage_min": min(coverages) if coverages else 0,
            "coverage_max": max(coverages) if coverages else 0,
            "conditions": conditions,
        },
        "entries": data,
    }


@app.get("/api/camera/analysis/validation")
async def camera_analysis_validation():
    """
    Valida el análisis del cielo contra el pronóstico actual.

    Compara lo que VE la cámara con lo que PREDICEN los modelos para
    detectar discrepancias y dar una medida de confianza.
    """
    analysis = _camera.get_analysis()
    if not analysis or analysis.get("error"):
        return {"validated": False, "reason": "Sin análisis disponible"}

    forecast_current = await _current_forecast_wmo_cloudcover()
    result = sky_validation.validate_analysis(analysis, forecast_current)
    if not result.get("validated"):
        return result

    # Agregar info del análisis para contexto
    result["analysis"] = {
        "sky_condition": analysis.get("sky_condition"),
        "cloud_coverage_pct": analysis.get("cloud_coverage_pct"),
        "analyzed_at": analysis.get("analyzed_at"),
    }

    return result


@app.get("/api/camera/analysis/accuracy")
async def camera_analysis_accuracy(days: int = 30):
    """
    Qué tan seguido coincidió la cámara con el pronóstico en los últimos N días.

    Se arma sobre el `match` que ya se guarda por captura en el histórico diario
    (ver `CameraStore.save_analysis`) -- no recalcula nada, sólo tabula.
    """
    days = max(1, min(days, 365))
    return _camera.get_accuracy_stats(days)


@app.get("/api/camera/best/{date}.jpg")
async def camera_best_of_day_jpg(date: str):
    """
    La foto elegida como mejor del día. 404 si el fotograma ya se podó -- las FOTOS
    se retienen 7 días por defecto, mucho menos que el análisis que las eligió.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (usar YYYY-MM-DD)")
    entry = _camera.best_of_day(date)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No hay análisis para {date}")
    ruta = _camera.frame_path(date, entry.get("ts", ""))
    if not ruta or not os.path.exists(ruta):
        raise HTTPException(status_code=404, detail="La foto ya no está disponible (retención de fotos)")
    return FileResponse(
        ruta,
        media_type="image/jpeg",
        # Un día cerrado no cambia; el de hoy sí puede cambiar de "mejor" según entren
        # más capturas, así que sólo se cachea un rato corto.
        headers={"Cache-Control": "max-age=600"},
    )


@app.get("/api/camera/best/{date}")
async def camera_best_of_day(date: str):
    """
    Metadato de la mejor foto del día (mayor visibilidad reportada, ver
    `CameraStore.best_of_day`). Se conserva para siempre -- vive en el análisis
    diario -- aunque la foto en sí ya se haya podado (ver el endpoint `.jpg`).

    Va DESPUÉS de `/api/camera/best/{date}.jpg` a propósito: Starlette prueba las
    rutas en el orden en que se registran, y `{date}` sin restricción hace match
    con "2026-08-29.jpg" completo (el punto no rompe el patrón). Registrada antes,
    esta ruta se comía las peticiones de la foto y respondía 400 "fecha inválida"
    en vez de dejarlas llegar al endpoint de la imagen.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (usar YYYY-MM-DD)")
    entry = _camera.best_of_day(date)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No hay análisis para {date}")
    return entry


@app.get("/api/camera/latest.jpg")
async def camera_latest():
    """La última captura. 404 mientras no haya llegado ninguna."""
    ultima = _camera.latest()
    if ultima is None:
        raise HTTPException(status_code=404, detail="Sin capturas")
    data, cuando = ultima
    return Response(
        content=data,
        media_type="image/jpeg",
        # Media cadencia: lo bastante para que un refresco no vuelva a descargarla,
        # lo bastante poco para no servir una foto vieja tras la siguiente captura.
        headers={"Cache-Control": "max-age=150", "X-Captured-At": cuando},
    )


@app.get("/api/camera/days")
async def camera_days():
    """Días con histórico y cuántas capturas tiene cada uno (para el timelapse)."""
    return {"retention_days": settings.camera_retention_days, "days": _camera.days()}


@app.get("/api/camera/timelapse/days")
async def timelapse_days():
    """Qué días tienen vídeo (o fotogramas para hacerlo), del más nuevo al más viejo."""
    return {
        "enabled": settings.camera_timelapse_enabled,
        "ffmpeg": TimelapseService.ffmpeg_available(),
        "fps": settings.camera_timelapse_fps,
        "min_frames": settings.camera_timelapse_min_frames,
        "retention_days": settings.camera_timelapse_retention_days,
        "frames_retention_days": settings.camera_retention_days,
        "disk_bytes": _timelapse.disk_bytes(),
        "days": _timelapse.days(),
    }


@app.get("/api/camera/timelapse/{date}.mp4")
async def timelapse_video(date: str):
    """
    El vídeo del día. Si todavía no existe se pone a generarlo EN SEGUNDO PLANO y
    responde 202: el encode tarda segundos y dejar la petición colgada mientras corre
    ffmpeg daría un tiempo de espera raro en el navegador (y varias peticiones a la vez
    encolarían encodes). La web consulta `timelapse/days` y vuelve a pedirlo.
    """
    if not settings.camera_timelapse_enabled:
        raise HTTPException(status_code=404, detail="El timelapse está deshabilitado")
    try:
        st = _timelapse.status(date)
    except TimelapseError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if st["video"]:
        return FileResponse(
            _timelapse.video_path(date),
            media_type="video/mp4",
            filename=f"timelapse-{date}.mp4",
            # Un día cerrado no cambia nunca; el de hoy sí, según entran capturas.
            headers={"Cache-Control": "max-age=300" if st["stale"] else "max-age=86400"},
        )

    if st["generating"]:
        raise HTTPException(status_code=202, detail="El vídeo se está generando")
    if not st["enough_frames"]:
        raise HTTPException(
            status_code=404,
            detail=f"{date}: sólo hay {st['frames']} captura(s); "
                   f"hacen falta {settings.camera_timelapse_min_frames}",
        )
    if not TimelapseService.ffmpeg_available():
        raise HTTPException(status_code=503, detail="ffmpeg no está disponible en el servidor")

    asyncio.create_task(_timelapse_generar(date))
    raise HTTPException(status_code=202, detail="Generando el vídeo; vuelve a pedirlo en un momento")


@app.get("/api/camera/timelapse/{date}.jpg")
async def timelapse_poster(date: str):
    """
    Cartel del vídeo de ese día: lo usa el `poster` del `<video>` para no enseñar un
    rectángulo negro. 404 si aún no hay vídeo --el reproductor entonces se comporta
    como antes, que es el estado del que se viene--.
    """
    try:
        ruta = _timelapse.poster_path(date)
    except TimelapseError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not os.path.exists(ruta):
        raise HTTPException(status_code=404, detail="Sin cartel para ese día")
    return FileResponse(
        ruta,
        media_type="image/jpeg",
        # El cartel de un día cerrado no cambia; el de hoy se rehace con el vídeo.
        headers={"Cache-Control": "max-age=3600"},
    )


@app.post("/api/camera/timelapse/{date}")
async def timelapse_regenerate(date: str, authorization: Optional[str] = Header(default=None)):
    """Rehace el vídeo de un día aunque ya exista (botón del panel)."""
    _require_admin(authorization)
    if not TimelapseService.ffmpeg_available():
        raise HTTPException(status_code=503, detail="ffmpeg no está disponible en el servidor")
    try:
        return await _timelapse.ensure(date, force=True)
    except TimelapseError as e:
        raise HTTPException(status_code=400, detail=str(e))


async def _timelapse_generar(date: str) -> None:
    """Encode en segundo plano. Se traga los errores: ya quedan en el log y el estado
    del día los vuelve a contar solo (sigue sin vídeo)."""
    try:
        await _timelapse.ensure(date)
    except TimelapseError as e:
        logger.warning("timelapse %s: %s", date, e)
    except Exception as e:
        logger.error("timelapse %s falló: %s", date, e)


@app.get("/api/summaries/daily")
async def get_daily_summaries(days: int = 30, station: Optional[str] = None):
    """
    Resúmenes diarios crudos de los últimos `days` días LOCALES, una fila por día.

    Es la fuente de las páginas de detalle del kiosco en 7 y 30 días. Lo que ya había
    no servía: `/api/climate/noaa` da la serie diaria pero SÓLO por mes calendario, y
    "los últimos 30 días" casi siempre cae a caballo entre dos meses --habría que
    pedir dos y pegarlos en el cliente--; `/api/stats/records` sí acepta una ventana
    libre pero devuelve el agregado del periodo, no la serie. Y `/api/rain/daily`
    resuelve exactamente esto, pero sólo para la lluvia.

    Devuelve las filas TAL CUAL las guarda el rollup (temp_max/min/avg, rain_total,
    wind_avg, gust_max, hum_*, press_*, uv_max, solar_max…), sin recortar campos: cada
    página del kiosco usa los suyos y filtrarlos aquí obligaría a tocar el backend
    cada vez que una pantalla quiera un dato más.

    Un día sin resumen NO aparece en la lista. El día EN CURSO tampoco: su resumen lo
    escribe el rollup al cerrarlo, y media jornada mezclada con días completos
    falsearía cualquier mínima o promedio de la serie.
    """
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    days = max(1, min(days, 400))
    # Ventana MAYOR que la pedida y recorte por fecha local después, por lo mismo que
    # en /api/rain/daily: los resúmenes llevan la fecha local como tag pero el rango
    # de Flux va en UTC, así que con los días justos el más antiguo entra a medias.
    rows = await storage.query_daily_summaries(start=f"-{days + 2}d", station=station)
    wanted = set(aggregator.local_recent_dates(days))
    out = sorted((r for r in rows if str(r.get("date")) in wanted),
                 key=lambda r: str(r.get("date")))
    return {"days": days, "data": out}


@app.get("/api/almanac")
async def get_almanac_data():
    """Almanaque astronómico ampliado (sol, crepúsculos, luna y planetas)."""
    try:
        lat = getattr(settings, "cwop_latitude", 19.380359)
        lon = getattr(settings, "cwop_longitude", -99.174564)
        return get_almanac(lat, lon)
    except Exception as e:
        logger.error(f"Error getting almanac: {e}")
        return {"available": False, "reason": "error"}


def _openmeteo_now_str(forecast: dict) -> str:
    """
    "YYYY-MM-DDTHH:00" de AHORA en la zona que usó Open-Meteo para las horas de
    ESTE pronóstico. Con `timezone=auto` el `hourly.time` viene en hora LOCAL sin
    sufijo (p. ej. "2026-08-19T14:00", ni "Z" ni offset), y la respuesta trae
    `utc_offset_seconds` para ese sitio -- se usa ESE, no la zona del contenedor,
    para no depender de que `TZ` en el .env coincida con la lat/lon pedida (el
    default de docker-compose.yml es `TZ=UTC`; sólo coincide hoy porque el .env
    de este despliegue lo fija a America/Mexico_City).
    """
    offset_s = forecast.get("utc_offset_seconds") or 0
    local_now = datetime.now(timezone.utc) + timedelta(seconds=offset_s)
    return local_now.strftime("%Y-%m-%dT%H:00")


def _apply_temperature_bias(forecast: dict, current_temp: Optional[float],
                            current_pressure: Optional[float] = None) -> dict:
    """
    Corrige temperatura y presión del pronóstico de Open-Meteo con el bias real
    de la estación (nombre de la función sin cambiar para no tocar el otro
    llamador -- ver `/api/forecast` y `/api/bim32`, que la invocan igual).

    Temperatura: el pronóstico puede estar varios grados desfasado del
    microclima local. Se calcula la diferencia entre la temperatura medida y
    la del pronóstico para "ahora", y se aplica esa corrección con DECAY a
    las próximas horas (disminuye 10%/hora, se apaga a las 10h) porque el
    desfase actual puede no aplicar a horas lejanas -- cambia con la
    condición del momento.

    Presión: a diferencia de la temperatura, el desfase suele ser un problema
    de CALIBRACIÓN, no meteorológico -- Open-Meteo reduce a nivel del mar con
    una fórmula estándar (usa la elevación del punto pedido), mientras que la
    estación reporta su presión relativa ya calibrada contra el barómetro
    real del aeropuerto local (`pressure_relative`). Ese desfase no se
    "resuelve" con las horas, así que se aplica CONSTANTE a todo el
    horario (sin decay), incluidas horas pasadas.
    """
    hourly = forecast.get("hourly")
    if not hourly or "time" not in hourly:
        return forecast

    times = hourly["time"]
    if not times:
        return forecast

    # `hourly.time` viene en hora LOCAL sin sufijo (`timezone=auto`), así que
    # `.replace("Z", "+00:00")` no encuentra nada que reemplazar y
    # `datetime.fromisoformat(...).timestamp()` interpretaba ese naive datetime
    # con la zona del PROCESO -- correcto sólo porque el .env de este despliegue
    # fija `TZ=America/Mexico_City` igual que la lat/lon pedida; con el
    # `TZ=UTC` por defecto de docker-compose.yml la resta quedaría desfasada
    # exactamente el offset del sitio. Se ancla explícitamente al
    # `utc_offset_seconds` que la propia respuesta declara, sin depender de la
    # zona del contenedor.
    offset_s = forecast.get("utc_offset_seconds") or 0
    now_ts = datetime.now(timezone.utc).timestamp()

    closest_idx = 0
    closest_diff = float("inf")
    for i, t in enumerate(times):
        try:
            t_local_naive_ts = datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp()
            t_ts = t_local_naive_ts - offset_s
            diff = abs(t_ts - now_ts)
            if diff < closest_diff:
                closest_diff = diff
                closest_idx = i
        except (ValueError, AttributeError):
            continue

    if closest_diff > 7200:
        return forecast

    result = dict(forecast)
    result["hourly"] = dict(hourly)
    bias_info: Dict[str, Any] = {}

    temps = hourly.get("temperature_2m")
    if current_temp is not None and temps:
        forecast_now_temp = temps[closest_idx]
        if forecast_now_temp is not None:
            bias = current_temp - forecast_now_temp
            if abs(bias) >= 0.5:
                corrected_temps = list(temps)
                for i in range(len(corrected_temps)):
                    if corrected_temps[i] is None or i < closest_idx:
                        continue
                    decay = max(0.0, 1.0 - (i - closest_idx) * 0.10)
                    corrected_temps[i] = round(corrected_temps[i] + bias * decay, 1)
                result["hourly"]["temperature_2m"] = corrected_temps
                bias_info["temperature"] = {
                    "applied": True,
                    "measured": round(current_temp, 1),
                    "forecast": round(forecast_now_temp, 1),
                    "bias": round(bias, 1),
                }

    pres = hourly.get("pressure_msl")
    if current_pressure is not None and pres:
        forecast_now_pres = pres[closest_idx]
        if forecast_now_pres is not None:
            bias = current_pressure - forecast_now_pres
            if abs(bias) >= 1.0:
                result["hourly"]["pressure_msl"] = [
                    round(p + bias, 1) if p is not None else None for p in pres
                ]
                bias_info["pressure"] = {
                    "applied": True,
                    "measured": round(current_pressure, 1),
                    "forecast": round(forecast_now_pres, 1),
                    "bias": round(bias, 1),
                }

    if bias_info:
        result["bias_correction"] = bias_info
    return result


@app.get("/api/forecast")
async def get_forecast(lat: Optional[float] = None, lon: Optional[float] = None):
    """
    Pronóstico de Open-Meteo con caché en el servidor y corrección por bias.

    Lo pedía el navegador directamente al origen, así que una caída dejaba la
    página sin pronóstico y cada visitante gastaba cuota por su cuenta. Aquí se
    cachea y, si el origen no responde, se sirve la última copia buena marcada
    como `stale` (mismo criterio que /api/smn).

    Además, corrige las temperaturas horarias usando la diferencia entre la
    lectura actual de la estación y el pronóstico para "ahora". La corrección
    se aplica con decay (disminuye conforme se aleja en el tiempo). Este
    endpoint no pide `pressure_msl` a Open-Meteo (ver `openmeteo._HOURLY`), así
    que la corrección de presión no aplica aquí -- sí en `/api/bim32`, que
    usa el conjunto ampliado.
    """
    try:
        forecast = await openmeteo.get_forecast(
            lat if lat is not None else getattr(settings, "cwop_latitude", 19.380359),
            lon if lon is not None else getattr(settings, "cwop_longitude", -99.174564),
        )
        current = latest_by_station.get(None, {})
        return _apply_temperature_bias(forecast, current.get("temperature_outdoor"), current.get("pressure_relative"))
    except Exception as e:
        logger.error(f"Error obteniendo pronóstico Open-Meteo: {e}")
        raise HTTPException(status_code=502, detail="No se pudo obtener el pronóstico")


@app.get("/api/forecast/local")
async def get_local_forecast():
    """Pronóstico local por tendencia barométrica (datos de nuestra estación)."""
    try:
        p_now = latest_by_station.get(None, {}).get("pressure_relative")
        p_3h = await storage.get_field_value_ago("pressure_relative", start="-3h")
        return forecaster.local_forecast(p_now, p_3h)
    except Exception as e:
        logger.error(f"Error building local forecast: {e}")
        return {"available": False, "reason": "error"}


@app.get("/api/forecast/consensus")
async def get_consensus_forecast_endpoint():
    """
    Pronóstico combinado: estación local + presión + Open-Meteo + WeatherAPI.

    Combina múltiples fuentes para mayor precisión:
    - Prioriza datos reales de la estación si está lloviendo
    - Usa tendencia de presión para alertas de corto plazo (0-3h)
    - Compara Open-Meteo vs WeatherAPI y muestra el más conservador
    """
    try:
        lat = getattr(settings, "cwop_latitude", 19.380359)
        lon = getattr(settings, "cwop_longitude", -99.174564)

        # Datos actuales de la estación
        current_data = latest_by_station.get(None)

        # Histórico de presión (últimas 4 horas)
        pressure_history = []
        try:
            rows = await storage.query(start="-4h", fields=["pressure_relative"])
            for r in rows:
                ts = r.get("_time")
                p = r.get("pressure_relative")
                if ts and p:
                    if isinstance(ts, str):
                        ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    pressure_history.append((ts, p))
        except Exception as e:
            logger.warning(f"No se pudo obtener histórico de presión: {e}")

        return await forecast_consensus.get_consensus_forecast(
            lat, lon,
            current_data=current_data,
            pressure_history=pressure_history,
        )
    except Exception as e:
        logger.error(f"Error en pronóstico de consenso: {e}")
        raise HTTPException(status_code=500, detail="Error generando pronóstico combinado")


@app.get("/api/alerts")
async def get_alerts():
    """Current active weather alerts (from the alert service)."""
    return {
        "enabled": alert_service.enabled,
        "active": [{"key": k, "message": m} for k, m in alert_service.active.items()],
    }


@app.get("/api/metar")
async def get_metar_data(station: str = "MMMX"):
    """Latest METAR for an airport (default MMMX / Ciudad de México)."""
    try:
        return await get_metar(station)
    except Exception as e:
        logger.error(f"Error getting METAR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/taf")
async def get_taf_data(station: str = "MMMX"):
    """Latest TAF (forecast) for an airport (default MMMX)."""
    try:
        return await get_taf(station)
    except Exception as e:
        logger.error(f"Error getting TAF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/satellite")
async def get_satellite(layer: str = "VIIRS_SNPP_CorrectedReflectance_TrueColor",
                        date: str = "", lat: float = 19.380359, lon: float = -99.174564):
    """Imagen satelital NASA GIBS (proxy servido desde el backend, con caché)."""
    data = await satellite.get_snapshot(layer, date, lat, lon)
    if not data:
        raise HTTPException(status_code=502, detail="Imagen satelital no disponible")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=1800"})


@app.get("/api/airquality")
async def get_air_quality_data(lat: float = 19.4326, lon: float = -99.1332):
    """Air quality (WAQI) for a location; token from settings (WAQI_TOKEN)."""
    try:
        return await get_air_quality(lat, lon, settings.waqi_token)
    except Exception as e:
        logger.error(f"Error getting air quality: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _station_pressure_hpa() -> Optional[float]:
    """
    Presión ABSOLUTA de la principal (hPa), para convertir µg/m³ → ppm en el IMECA
    con el volumen molar del sitio. A 2240 m la diferencia contra 1 atm cambia el
    índice de categoría (ver imeca.molar_volume). None => se supone nivel del mar.
    """
    return (latest_by_station.get(None) or {}).get("pressure_absolute")


@app.get("/api/airquality/imeca")
async def get_imeca_data(lat: float = 19.380359, lon: float = -99.174564):
    """IMECA estimado (NADF-009-AIRE-2017) desde concentraciones de Open-Meteo."""
    try:
        return await imeca.get_imeca(lat, lon, pressure_hpa=_station_pressure_hpa())
    except Exception as e:
        logger.error(f"Error getting IMECA: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/earthquakes")
async def get_earthquakes_data():
    """Sismos recientes cerca de la estación (SSN/USGS). Evalúa alertas de sismos grandes."""
    try:
        lat = getattr(settings, "cwop_latitude", 19.380359)
        lon = getattr(settings, "cwop_longitude", -99.174564)
        result = await get_earthquakes(lat, lon)
        await alert_service.check_earthquake(result.get("quakes", []))
        return result
    except Exception as e:
        logger.error(f"Error getting earthquakes: {e}")
        return {"quakes": []}
