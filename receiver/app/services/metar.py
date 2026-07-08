"""
METAR fetcher (proxy to aviationweather.gov).

Runs server-side to avoid browser CORS issues and caches the result briefly.
Default station MMMX (Aeropuerto Internacional de la Ciudad de México).
"""
import time
import logging
from typing import Any, Dict

import httpx

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {"ts": 0.0, "station": None, "data": {}}
_TTL = 600  # 10 minutes


async def get_metar(station: str = "MMMX") -> Dict[str, Any]:
    now = time.time()
    if _CACHE["data"] and _CACHE["station"] == station and (now - _CACHE["ts"]) < _TTL:
        return _CACHE["data"]

    url = f"https://aviationweather.gov/api/data/metar?ids={station}&format=json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers={"User-Agent": "ecowitt-weather-server"})
            resp.raise_for_status()
            arr = resp.json()
    except Exception as e:
        logger.error(f"METAR fetch failed: {e}")
        return _CACHE["data"] or {}

    if not arr:
        return {}

    m = arr[0]
    clouds = [
        f"{c.get('cover')} {c.get('base')} ft"
        for c in (m.get("clouds") or [])
        if c.get("cover")
    ]
    data = {
        "station": m.get("icaoId", station),
        "raw": m.get("rawOb"),
        "observed": m.get("reportTime"),
        "temp_c": m.get("temp"),
        "dewpoint_c": m.get("dewp"),
        "wind_dir": m.get("wdir"),
        "wind_speed_kt": m.get("wspd"),
        "visibility": m.get("visib"),
        "altimeter_hpa": round(m["altim"], 1) if m.get("altim") else None,
        "flight_category": m.get("fltCat"),
        "clouds": clouds,
    }
    _CACHE.update(ts=now, station=station, data=data)
    return data
