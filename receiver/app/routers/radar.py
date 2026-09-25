"""Radar meteorológico del SACMEX: cuadros, historial propio y ecos decodificados
(ver services/sacmex_radar.py y services/radar_decode.py)."""
import asyncio
import io
import logging
from datetime import datetime
from typing import Dict, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Response

from ..config import settings
from ..services import radar_decode, sacmex_radar

logger = logging.getLogger(__name__)
router = APIRouter()
_MX_TZ = ZoneInfo("America/Mexico_City")

# El orden importa: /archive y /decoded/{id} van ANTES que /{frame_id}.

@router.get("/api/radar/sacmex")
async def get_sacmex_radar():
    """Últimos cuadros del radar del SACMEX (CDMX), ver services/sacmex_radar.py.
    Cada cuadro se pide aparte a /api/radar/sacmex/<id>, servido desde caché."""
    return await sacmex_radar.get_frames()


@router.get("/api/radar/sacmex/archive")
async def get_sacmex_radar_archive():
    """Cuántos cuadros del radar lleva guardados el historial, por día."""
    return {"enabled": settings.radar_archive_enabled,
            "keep_days": settings.radar_archive_days,
            **sacmex_radar.archive_summary(settings.radar_archive_dir)}


_decoded_png: Dict[str, bytes] = {}


def _render_decoded(data: bytes) -> Optional[bytes]:
    bg = radar_decode.cached_background(settings.radar_archive_dir)
    if bg is None:
        return None
    buf = io.BytesIO()
    radar_decode.render(radar_decode.decode(radar_decode.to_array(data), bg)).save(buf, "PNG", optimize=True)
    return buf.getvalue()


@router.get("/api/radar/sacmex/decoded/{frame_id}")
async def get_sacmex_radar_decoded(frame_id: str):
    """Los ecos que el decodificador (services/radar_decode.py) lee en un cuadro,
    en PNG transparente del mismo tamaño, para revisarlo encima del original.
    503 mientras el historial no tenga cuadros suficientes para sacar el fondo."""
    data = sacmex_radar.get_image(frame_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Cuadro de radar no disponible")
    png = _decoded_png.get(frame_id)
    if png is None:
        png = await asyncio.to_thread(_render_decoded, data)
        if png is None:
            raise HTTPException(status_code=503, detail="Aún no hay historial suficiente para el fondo")
        if len(_decoded_png) >= 24:
            _decoded_png.pop(next(iter(_decoded_png)))
        _decoded_png[frame_id] = png
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=3600"})


async def radar_archive_task():
    """Cada 5 min (el ritmo del radar) baja los cuadros nuevos y los guarda en el
    historial. Aquí, y no en el endpoint, porque de noche o en días sin visitas
    nadie pide /api/radar/sacmex y se perderían cuadros: SACMEX sólo guarda ~50 min."""
    if not settings.radar_archive_enabled:
        return
    await asyncio.sleep(120)  # gracia inicial
    while True:
        try:
            await sacmex_radar.refresh()
            n = sacmex_radar.archive_new(settings.radar_archive_dir)
            if n:
                logger.info(f"Radar SACMEX: {n} cuadro(s) nuevo(s) al historial")
            sacmex_radar.prune_archive(settings.radar_archive_dir, settings.radar_archive_days,
                                       datetime.now(_MX_TZ).date().isoformat())
        except Exception as e:
            logger.error(f"Historial del radar SACMEX falló: {e}")
        await asyncio.sleep(300)


@router.get("/api/radar/sacmex/{frame_id}")
async def get_sacmex_radar_frame(frame_id: str):
    """Un cuadro del radar SACMEX. El nombre es único por cuadro (lleva su hora),
    así que se puede cachear mucho tiempo en el navegador."""
    data = sacmex_radar.get_image(frame_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Cuadro de radar no disponible")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=86400, immutable"})
