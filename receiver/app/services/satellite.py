"""
Proxy de imagen satelital NASA GIBS (Global Imagery Browse Services).

Se sirve desde el backend (mismo origen que la web) para evitar problemas de
carga en el navegador del cliente: límites por IP, latencia o bloqueos de la
API pública de "snapshots" de NASA. Sin API key. Cachea el JPEG unos minutos.
"""
import re
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Dict] = {}
_TTL = 1800  # 30 min

LAYERS = {
    "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    "MODIS_Terra_CorrectedReflectance_TrueColor",
    "MODIS_Aqua_CorrectedReflectance_TrueColor",
}


def _valid_date(date: str) -> str:
    if date and re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return date
    # Ayer en UTC (la imagen de hoy puede no estar publicada)
    return (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")


async def get_snapshot(layer: str, date: str, lat: float, lon: float) -> Optional[bytes]:
    if layer not in LAYERS:
        layer = "VIIRS_SNPP_CorrectedReflectance_TrueColor"
    date = _valid_date(date)
    key = f"{layer}:{date}:{lat:.2f}:{lon:.2f}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return cached["data"]

    dlat, dlon = 6.0, 9.0
    bbox = f"{lat - dlat:.2f},{lon - dlon:.2f},{lat + dlat:.2f},{lon + dlon:.2f}"
    layers = f"{layer},Coastlines_15m,Reference_Features_15m"
    url = (
        "https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot"
        f"&LAYERS={layers}&CRS=EPSG:4326&BBOX={bbox}"
        f"&WIDTH=1050&HEIGHT=700&FORMAT=image/jpeg&TIME={date}"
    )
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.get(url, headers={"User-Agent": "ecowitt-weather-server"})
            resp.raise_for_status()
            data = resp.content
    except Exception as e:
        logger.error(f"NASA GIBS snapshot fetch failed: {e}")
        return cached["data"] if cached else None

    _CACHE[key] = {"ts": now, "data": data}
    return data
