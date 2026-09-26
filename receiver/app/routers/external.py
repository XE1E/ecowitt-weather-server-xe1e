"""Datos de fuentes externas servidos por el backend (con caché propia en cada
servicio): METAR/TAF, satélite, calidad del aire, IMECA, sismos y ciclones."""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response

from .. import state
from ..config import settings
from ..services import imeca, nhc, satellite
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
                        date: str = "", lat: Optional[float] = None, lon: Optional[float] = None):
    """Imagen satelital NASA GIBS (proxy servido desde el backend, con caché)."""
    data = await satellite.get_snapshot(layer, date, settings.cwop_latitude if lat is None else lat,
                                        settings.cwop_longitude if lon is None else lon)
    if not data:
        raise HTTPException(status_code=502, detail="Imagen satelital no disponible")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=1800"})


@router.get("/api/airquality")
async def get_air_quality_data(lat: Optional[float] = None, lon: Optional[float] = None):
    """Calidad del aire (WAQI). Sin lat/lon, la ubicación de la estación (antes el
    valor por omisión era el Zócalo, distinto del de todo lo demás)."""
    try:
        return await get_air_quality(settings.cwop_latitude if lat is None else lat,
                                     settings.cwop_longitude if lon is None else lon, settings.waqi_token)
    except Exception as e:
        logger.error(f"Error getting air quality: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log



@router.get("/api/airquality/imeca")
async def get_imeca_data(lat: Optional[float] = None, lon: Optional[float] = None):
    """IMECA estimado (NADF-009-AIRE-2017) desde concentraciones de Open-Meteo."""
    try:
        return await imeca.get_imeca(settings.cwop_latitude if lat is None else lat,
                                     settings.cwop_longitude if lon is None else lon,
                                     pressure_hpa=state.station_pressure_hpa())
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
        lat = settings.cwop_latitude
        lon = settings.cwop_longitude
        # Las alertas ya NO se evalúan aquí (dependían de que alguien abriera la
        # página): las revisa earthquake_watch_task cada 10 min.
        return await get_earthquakes(lat, lon)
    except Exception as e:
        logger.error(f"Error getting earthquakes: {e}")
        return {"quakes": []}


async def cyclone_watch_task():
    """Ciclones cerca de México cada 10 min (el ritmo de la caché de nhc.py): manda
    los cambios por Telegram/correo (ver services/cyclone_alerts.py) y anota cada
    tormenta en la bitácora de la temporada. También genera el resumen IA de las
    discusiones nuevas (services/cyclone_summary.py)."""
    import os
    from ..services import cyclone_alerts, cyclone_summary
    await asyncio.sleep(150)  # gracia inicial
    path = os.path.join(settings.cyclone_dir, "alertas.json")
    while True:
        try:
            data = await nhc.get_ciclones(settings.cwop_latitude, settings.cwop_longitude)
            if not data.get("stale"):
                tormentas = data.get("tormentas", [])
                nhc.registrar_temporada(settings.cyclone_dir, tormentas)
                msgs, estado = cyclone_alerts.eventos(cyclone_alerts.cargar(path), tormentas)
                svc = state.alert_service
                if msgs and settings.alerts_enabled and settings.alert_cyclone_enabled and svc.enabled:
                    for m in msgs:
                        svc._add_to_history("cyclone_nhc", m, resolved=False)
                        await svc._safe_notify(m, category="cyclone")
                    await svc._safe_notify("📍 Detalle: https://clima.xe1e.net/ciclones", category="cyclone")
                # El estado se guarda aunque las alertas estén apagadas: al
                # encenderlas no debe llegar de golpe todo lo ya pasado.
                cyclone_alerts.guardar(path, estado)
                if settings.cyclone_summary_enabled and settings.gemini_api_key:
                    await cyclone_summary.actualizar(
                        settings.cyclone_dir, tormentas, nhc._texto,
                        settings.gemini_api_key, settings.camera_analysis_model_gemini)
        except Exception as e:
            logger.error(f"Revisión de ciclones falló: {e}")
        await asyncio.sleep(600)


@router.get("/api/ciclones")
async def get_ciclones():
    """Ciclones tropicales activos (Atlántico y Pacífico, NHC) con su cercanía a México."""
    from ..services import cyclone_summary
    try:
        data = await nhc.get_ciclones(settings.cwop_latitude, settings.cwop_longitude)
    except Exception as e:
        logger.error(f"Error getting ciclones: {e}")
        raise HTTPException(status_code=502, detail="El NHC no está disponible")
    # Copia: `data` es la caché de nhc.py y no debe llevar el resumen pegado.
    return {**data, "tormentas": [
        {**t, "resumen_ia": cyclone_summary.leer(settings.cyclone_dir, t["id"])}
        for t in data.get("tormentas", [])
    ]}


@router.get("/api/ciclones/mapa")
async def get_ciclones_mapa():
    """Cono y líneas de avisos costeros por tormenta, para el mapa de la página."""
    return await nhc.get_mapa()


@router.get("/api/ciclones/sat/{atcf}")
async def get_ciclon_satelite(atcf: str):
    """Cuadros GOES recientes de la tormenta (URLs directas a NOAA STAR)."""
    return await nhc.get_satelite(atcf)


@router.get("/api/ciclones/temporada")
async def get_ciclones_temporada(anio: Optional[int] = None):
    """Resumen de la temporada (bitácora propia: desde 2026-09-25)."""
    from datetime import datetime
    return nhc.resumen_temporada(settings.cyclone_dir, anio or datetime.now().year)


@router.get("/api/ciclones/img/{atcf}/{tipo}")
async def get_ciclon_img(atcf: str, tipo: str, request: Request):
    """Imagen del NHC (cono o key messages en español, o perspectiva a 7 días con
    atcf=outlook y tipo=pacifico|atlantico). Sólo URLs de una lista blanca.

    La página le agrega ?v=<hora de los datos>, así que cada vez que se renuevan
    los datos el navegador vuelve a preguntar; con Last-Modified, si la imagen no
    cambió la respuesta es un 304 sin cuerpo."""
    url = nhc.img_url(atcf, tipo)
    if not url:
        raise HTTPException(status_code=404, detail="Imagen no reconocida")
    img = await nhc.get_img(url)
    if not img:
        raise HTTPException(status_code=404, detail="Imagen no disponible")
    headers = {"Cache-Control": "public, max-age=60"}
    if img.get("last_modified"):
        headers["Last-Modified"] = img["last_modified"]
        if request.headers.get("if-modified-since") == img["last_modified"]:
            return Response(status_code=304, headers=headers)
    return Response(content=img["data"], media_type=img["ctype"], headers=headers)
