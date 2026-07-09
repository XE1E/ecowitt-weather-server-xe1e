"""
Sismos recientes (proxy a USGS earthquake.gov).

Consulta los sismos recientes alrededor de la estación (útil en el centro de
México, zona sísmica) y cachea el resultado unos minutos. Dato externo, no
medido por la estación.
"""
import time
import logging
from typing import Any, Dict

import httpx

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {"ts": 0.0, "data": {}}
_TTL = 600  # 10 min
_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"


async def get_earthquakes(
    lat: float = 19.380359, lon: float = -99.174564,
    radius_km: float = 800.0, min_mag: float = 4.0, limit: int = 6,
) -> Dict[str, Any]:
    now = time.time()
    if _CACHE["data"] and (now - _CACHE["ts"]) < _TTL:
        return _CACHE["data"]

    params = {
        "format": "geojson",
        "latitude": lat, "longitude": lon,
        "maxradiuskm": radius_km,
        "minmagnitude": min_mag,
        "orderby": "time",
        "limit": limit,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(_URL, params=params, headers={"user-agent": "clima-xe1e/1.0"})
            r.raise_for_status()
            js = r.json()
    except Exception as e:
        logger.error(f"Error fetching earthquakes: {e}")
        return _CACHE["data"] or {"quakes": []}

    quakes = []
    for f in js.get("features", []):
        p = f.get("properties", {})
        g = (f.get("geometry", {}) or {}).get("coordinates", [None, None, None])
        t_ms = p.get("time")
        quakes.append({
            "mag": p.get("mag"),
            "place": p.get("place"),
            "time": (t_ms / 1000.0) if t_ms is not None else None,  # epoch segundos UTC
            "depth_km": g[2] if len(g) > 2 else None,
            "url": p.get("url"),
        })

    data = {"quakes": quakes, "source": "USGS"}
    _CACHE.update(ts=now, data=data)
    return data
