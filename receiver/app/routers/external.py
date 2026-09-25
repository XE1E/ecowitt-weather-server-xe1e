"""Datos de fuentes externas servidos por el backend (con caché propia en cada
servicio): METAR/TAF, satélite, calidad del aire, IMECA y sismos."""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, Response

from .. import state
from ..config import settings
from ..services import imeca, satellite
from ..services.air_quality import get_air_quality
from ..services.earthquakes import get_earthquakes
from ..services.metar import get_metar, get_taf

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/metar")
async def get_metar_data(station: str = "MMMX"):
    """Latest METAR for an airport (default MMMX / Ciudad de México)."""
    try:
        return await get_metar(station)
    except Exception as e:
        logger.error(f"Error getting METAR: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


@router.get("/api/taf")
async def get_taf_data(station: str = "MMMX"):
    """Latest TAF (forecast) for an airport (default MMMX)."""
    try:
        return await get_taf(station)
    except Exception as e:
        logger.error(f"Error getting TAF: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


@router.get("/api/satellite")
async def get_satellite(layer: str = "VIIRS_SNPP_CorrectedReflectance_TrueColor",
                        date: str = "", lat: float = 19.380359, lon: float = -99.174564):
    """Imagen satelital NASA GIBS (proxy servido desde el backend, con caché)."""
    data = await satellite.get_snapshot(layer, date, lat, lon)
    if not data:
        raise HTTPException(status_code=502, detail="Imagen satelital no disponible")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=1800"})


@router.get("/api/airquality")
async def get_air_quality_data(lat: float = 19.4326, lon: float = -99.1332):
    """Air quality (WAQI) for a location; token from settings (WAQI_TOKEN)."""
    try:
        return await get_air_quality(lat, lon, settings.waqi_token)
    except Exception as e:
        logger.error(f"Error getting air quality: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log



@router.get("/api/airquality/imeca")
async def get_imeca_data(lat: float = 19.380359, lon: float = -99.174564):
    """IMECA estimado (NADF-009-AIRE-2017) desde concentraciones de Open-Meteo."""
    try:
        return await imeca.get_imeca(lat, lon, pressure_hpa=state.station_pressure_hpa())
    except Exception as e:
        logger.error(f"Error getting IMECA: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


async def earthquake_watch_task():
    """Revisa los sismos cada 10 min (el ritmo de la caché de earthquakes.py) y
    avisa de los que pasen el umbral. Antes sólo se evaluaban cuando alguien abría
    /api/earthquakes, así que de noche un sismo grande podía no avisarse."""
    await asyncio.sleep(120)  # gracia inicial
    while True:
        try:
            if settings.alerts_enabled and getattr(settings, "alert_earthquake_enabled", True):
                result = await get_earthquakes(settings.cwop_latitude, settings.cwop_longitude)
                await state.alert_service.check_earthquake(result.get("quakes", []))
            else:
                # Igual se llama, para que expiren los sismos viejos en `active`.
                await state.alert_service.check_earthquake([])
        except Exception as e:
            logger.error(f"Revisión de sismos falló: {e}")
        await asyncio.sleep(600)


@router.get("/api/earthquakes")
async def get_earthquakes_data():
    """Sismos recientes cerca de la estación (SSN/USGS)."""
    try:
        lat = getattr(settings, "cwop_latitude", 19.380359)
        lon = getattr(settings, "cwop_longitude", -99.174564)
        # Las alertas ya NO se evalúan aquí (dependían de que alguien abriera la
        # página): las revisa earthquake_watch_task cada 10 min.
        return await get_earthquakes(lat, lon)
    except Exception as e:
        logger.error(f"Error getting earthquakes: {e}")
        return {"quakes": []}
