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
from .services.parser import parse_ecowitt_data
from .services.converter import convert_to_metric
from .services.storage import InfluxDBStorage

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


@app.on_event("startup")
async def startup_event():
    """Initialize connections on startup."""
    logger.info("Starting Ecowitt Weather Station Receiver")
    logger.info(f"InfluxDB URL: {settings.influxdb_url}")
    logger.info(f"Output unit system: {settings.output_unit_system}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down Ecowitt Weather Station Receiver")
    storage.close()


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }


@app.post("/data/report/")
async def receive_ecowitt_data(request: Request):
    """
    Receive weather data from Ecowitt gateway.

    The gateway sends data as form-encoded POST request.
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
            f"Stored data - Temp: {parsed_data.get('temperature_outdoor')}°C, "
            f"Humidity: {parsed_data.get('humidity_outdoor')}%, "
            f"Wind: {parsed_data.get('wind_speed')} km/h"
        )

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
