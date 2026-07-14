"""
Ecowitt Weather Station Receiver

Receives weather data from Ecowitt gateways via HTTP POST
and stores it in InfluxDB.
"""

from fastapi import FastAPI, Request, HTTPException, Header, Response, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, List
from collections import deque
import asyncio
import logging

from .config import settings
from .services.parser import parse_ecowitt_data, describe_device, resolve_station
from .services.converter import convert_to_metric, calculate_derived_values
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
from .services.almanac import get_almanac
from .services import satellite
from .services.windrose import compute_wind_rose
from .services import admin as adminsvc
from .services import settings_store

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


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


memory_log_handler = MemoryLogHandler(maxlen=500)
memory_log_handler.setLevel(logging.INFO)
logging.getLogger().addHandler(memory_log_handler)

# Initialize FastAPI app
app = FastAPI(
    title="Ecowitt Weather Station Receiver",
    description="Receives and stores weather data from Ecowitt gateways",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
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
                    im = await imeca.get_imeca(lat, lon)
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

        # Convert units if needed (sin derivados: se calculan tras calibración/QC)
        if settings.output_unit_system == "metric":
            parsed_data = convert_to_metric(parsed_data, compute_derived=False)

        # Pipeline estilo WeeWX: calibrar -> QC rangos -> QC picos -> derivar.
        # El filtro de picos compara contra la lectura PREVIA de ESA estación
        # (no una global) para no generar falsos picos al mezclar estaciones.
        prev = latest_by_station.get(station)
        parsed_data = apply_calibration(parsed_data, settings)
        parsed_data, _ = quality_check(parsed_data, settings)
        parsed_data, _ = spike_check(parsed_data, prev, settings)
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

        # MQTT, alertas y publicación a redes públicas SOLO para la estación
        # principal. Las secundarias (GW1100, etc.) solo registran datos.
        if station is None:
            # Publish to MQTT (never let this break ingestion)
            try:
                mqtt_publisher.publish(parsed_data)
            except Exception as e:
                logger.error(f"MQTT publish failed: {e}")

            # Evaluate weather alerts (never let this break ingestion)
            try:
                await alert_service.process(parsed_data)
            except Exception as e:
                logger.error(f"Alert processing failed: {e}")

            # Publicar a redes públicas (WU/PWSWeather/Windy/OWM) sin romper ingestión
            try:
                await publish_all(parsed_data, settings)
            except Exception as e:
                logger.error(f"Public publish failed: {e}")

        return {"status": "success", "message": "Data received"}

    except Exception as e:
        logger.error(f"Error processing data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/current")
async def get_current_data(station: Optional[str] = None):
    """
    Get the most recent weather data.

    station: None/omitido = estación principal; nombre = estación secundaria.
    """
    data = latest_by_station.get(station)
    if not data:
        raise HTTPException(status_code=404, detail="No data available yet")
    return data


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
        data = await storage.query(
            start=start, stop=stop, measurement=measurement, station=station
        )
        return {"data": data}
    except Exception as e:
        logger.error(f"Error querying history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stats/daily")
async def get_daily_stats(station: Optional[str] = None, start: str = "-24h"):
    """
    Get statistics (min, max, avg) over a range.

    station: None/omitido = principal; nombre = estación secundaria.
    start: ventana Flux (p. ej. "-24h", "-7d", "-30d").
    """
    try:
        stats = await storage.get_daily_stats(start=start, station=station)
        return stats
    except Exception as e:
        logger.error(f"Error getting daily stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stats/records")
async def get_records(start: str = "-30d"):
    """Statistics (min/max/avg) over a range (e.g. -7d, -30d, -365d, -3650d)."""
    try:
        return await storage.get_daily_stats(start=start)
    except Exception as e:
        logger.error(f"Error getting records: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class LoginBody(BaseModel):
    user: str
    password: str


def _require_admin(authorization: Optional[str]) -> None:
    if not adminsvc.valid_session(adminsvc.bearer_token(authorization)):
        raise HTTPException(status_code=401, detail="No autorizado")


@app.post("/api/admin/login")
async def admin_login(body: LoginBody):
    token = adminsvc.login(settings, body.user, body.password)
    if not token:
        raise HTTPException(status_code=401, detail="Credenciales inválidas o panel deshabilitado")
    return {"token": token}


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
        "mqtt_enabled": settings.mqtt_enabled,
        "waqi_configured": bool(settings.waqi_token),
        "admin_enabled": adminsvc.admin_enabled(settings),
        "publication": {
            "wu": settings.wu_enabled,
            "windy": settings.windy_enabled,
            "pws": settings.pws_enabled,
            "owm": settings.owm_enabled,
            "cwop": settings.cwop_enabled,
        },
    }


@app.post("/api/admin/test-telegram")
async def admin_test_telegram(authorization: Optional[str] = Header(default=None)):
    """Envía un mensaje de prueba a Telegram."""
    _require_admin(authorization)
    if not settings.telegram_enabled or not settings.telegram_bot_token or not settings.telegram_chat_id:
        raise HTTPException(status_code=400, detail="Telegram no configurado")
    try:
        await alert_service._notifier.send("🧪 Mensaje de prueba desde Estacion Clima XE1E")
        return {"status": "ok", "message": "Mensaje enviado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    logs = memory_log_handler.get_logs(limit=min(limit, 500))
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

    # Sensor exterior (WS69)
    if data.get("temperature_outdoor") is not None:
        sensors.append({
            "id": "outdoor",
            "type": "WS69",
            "category": "exterior",
            "label": sensor_labels.get("outdoor", "Exterior"),
            "temperature": data.get("temperature_outdoor"),
            "humidity": data.get("humidity_outdoor"),
            "battery_ok": data.get("battery_wh65", data.get("battery_ws69", True)),
            "active": True,
        })

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
async def update_station(name: str, body: dict = Body(...)):
    """Actualiza la configuración de una estación."""
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


@app.get("/api/climate/daily")
async def get_climate_daily(start: str = "-365d", stop: str = "now()"):
    """Resúmenes diarios (weather_daily): un registro por día con extremos."""
    try:
        rows = await storage.query_daily_summaries(start=start, stop=stop)
        return {"days": rows, "count": len(rows)}
    except Exception as e:
        logger.error(f"Error getting daily summaries: {e}")
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


@app.get("/api/wind/rose")
async def get_wind_rose(start: str = "-7d"):
    """Rosa de vientos: distribución por sectores en el periodo (desde histórico)."""
    try:
        records = await storage.query(start=start, fields=["wind_direction", "wind_speed"])
        return compute_wind_rose(records)
    except Exception as e:
        logger.error(f"Error building wind rose: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


@app.get("/api/airquality/imeca")
async def get_imeca_data(lat: float = 19.380359, lon: float = -99.174564):
    """IMECA estimado (NADF-009-AIRE-2017) desde concentraciones de Open-Meteo."""
    try:
        return await imeca.get_imeca(lat, lon)
    except Exception as e:
        logger.error(f"Error getting IMECA: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/earthquakes")
async def get_earthquakes_data():
    """Sismos recientes cerca de la estación (USGS)."""
    try:
        lat = getattr(settings, "cwop_latitude", 19.380359)
        lon = getattr(settings, "cwop_longitude", -99.174564)
        return await get_earthquakes(lat, lon)
    except Exception as e:
        logger.error(f"Error getting earthquakes: {e}")
        return {"quakes": []}
