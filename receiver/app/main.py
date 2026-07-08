"""
Ecowitt Weather Station Receiver

Receives weather data from Ecowitt gateways via HTTP POST
and stores it in InfluxDB.
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import logging

from .config import settings
from .services.parser import parse_ecowitt_data, describe_device
from .services.converter import convert_to_metric
from .services.storage import InfluxDBStorage
from .services.alerts import AlertService
from .services.mqtt_publisher import MqttPublisher
from .services.metar import get_metar
from .services.air_quality import get_air_quality

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

        # Convert units if needed
        if settings.output_unit_system == "metric":
            parsed_data = convert_to_metric(parsed_data)

        # Add metadata
        parsed_data["received_at"] = datetime.utcnow().isoformat()

        # Store latest data in memory
        global latest_data
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
