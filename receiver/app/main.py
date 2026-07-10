"""
Ecowitt Weather Station Receiver

Receives weather data from Ecowitt gateways via HTTP POST
and stores it in InfluxDB.
"""

from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import asyncio
import logging

from .config import settings
from .services.parser import parse_ecowitt_data, describe_device
from .services.converter import convert_to_metric, calculate_derived_values
from .services.calibration import apply_calibration
from .services.quality import quality_check, spike_check
from .services.storage import InfluxDBStorage
from .services.alerts import AlertService
from .services.mqtt_publisher import MqttPublisher
from .services.metar import get_metar
from .services.air_quality import get_air_quality
from .services import imeca
from .services.earthquakes import get_earthquakes
from .services.publishers import publish_all
from .services import forecaster
from .services import aggregator
from .services.almanac import get_almanac
from .services.windrose import compute_wind_rose
from .services import admin as adminsvc
from .services import settings_store

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

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

# Store latest data in memory for quick access
latest_data: dict = {}

# Weather alerts (Telegram / log)
alert_service = AlertService(settings)

# MQTT publisher (with Home Assistant discovery)
mqtt_publisher = MqttPublisher(settings)


async def station_watchdog():
    """Avisa (Telegram/log) si la estación deja de enviar datos, y cuando vuelve."""
    if not settings.alerts_enabled:
        return
    threshold = settings.alert_station_offline_minutes * 60
    await asyncio.sleep(90)  # gracia inicial tras el arranque
    while True:
        try:
            await alert_service.check_station(
                latest_data.get("received_at"), datetime.utcnow(), threshold
            )
        except Exception as e:
            logger.error(f"Watchdog error: {e}")
        await asyncio.sleep(60)


async def daily_rollup_task():
    """
    Mantiene el resumen diario (weather_daily). Al arrancar rellena los últimos
    ~90 días que falten; luego refresca hoy/ayer cada hora.
    """
    await asyncio.sleep(120)  # gracia inicial
    try:
        await aggregator.backfill(storage, days=90)
    except Exception as e:
        logger.error(f"Backfill inicial de resumen diario falló: {e}")
    while True:
        await asyncio.sleep(3600)
        try:
            await aggregator.backfill(storage, days=2)  # hoy y ayer
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
    global latest_data
    try:
        last = await storage.get_latest()
        if last:
            latest_data = last
            logger.info("Loaded last reading from InfluxDB into memory")
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
    global latest_data
    try:
        # Parse form data
        form_data = await request.form()
        raw_data = dict(form_data)

        logger.debug(f"Received raw data: {raw_data}")

        # Parse Ecowitt protocol
        parsed_data = parse_ecowitt_data(raw_data)

        # Convert units if needed (sin derivados: se calculan tras calibración/QC)
        if settings.output_unit_system == "metric":
            parsed_data = convert_to_metric(parsed_data, compute_derived=False)

        # Pipeline estilo WeeWX: calibrar -> QC rangos -> QC picos -> derivar
        # (latest_data aún contiene la lectura PREVIA en este punto)
        parsed_data = apply_calibration(parsed_data, settings)
        parsed_data, _ = quality_check(parsed_data, settings)
        parsed_data, _ = spike_check(parsed_data, latest_data, settings)
        if settings.output_unit_system == "metric":
            parsed_data = calculate_derived_values(parsed_data)

        # Add metadata
        parsed_data["received_at"] = datetime.utcnow().isoformat()

        # Store latest data in memory
        latest_data = parsed_data.copy()

        # Write to InfluxDB
        await storage.write(parsed_data)

        logger.info(
            f"Stored data from {describe_device(parsed_data)} - "
            f"Temp: {parsed_data.get('temperature_outdoor')}°C, "
            f"Humidity: {parsed_data.get('humidity_outdoor')}%, "
            f"Wind: {parsed_data.get('wind_speed')} km/h"
        )

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
async def get_current_data():
    """Get the most recent weather data."""
    if not latest_data:
        raise HTTPException(status_code=404, detail="No data available yet")
    return latest_data


@app.get("/api/history")
async def get_history(
    start: str = "-24h",
    stop: str = "now()",
    measurement: str = "weather"
):
    """
    Get historical weather data.

    Args:
        start: Start time (e.g., "-24h", "-7d", "2024-01-01T00:00:00Z")
        stop: End time (e.g., "now()", "2024-01-02T00:00:00Z")
        measurement: Measurement name
    """
    try:
        data = await storage.query(start=start, stop=stop, measurement=measurement)
        return {"data": data}
    except Exception as e:
        logger.error(f"Error querying history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stats/daily")
async def get_daily_stats():
    """Get daily statistics (min, max, avg)."""
    try:
        stats = await storage.get_daily_stats()
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
    return {"status": "ok", "applied": list(incoming.keys())}


@app.get("/api/admin/status")
async def admin_status(authorization: Optional[str] = Header(default=None)):
    _require_admin(authorization)
    return {
        "station_offline": alert_service.station_offline,
        "last_received": latest_data.get("received_at"),
        "active_alerts": [{"key": k, "message": m} for k, m in alert_service.active.items()],
        "alerts_enabled": settings.alerts_enabled,
        "telegram_enabled": settings.telegram_enabled,
        "waqi_configured": bool(settings.waqi_token),
        "admin_enabled": adminsvc.admin_enabled(settings),
    }


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
        p_now = latest_data.get("pressure_relative")
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
