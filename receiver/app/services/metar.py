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
    data = {
        "station": m.get("icaoId", station),
        "name": m.get("name"),
        "raw": m.get("rawOb"),
        "observed": m.get("reportTime"),
        "temp_c": m.get("temp"),
        "dewpoint_c": m.get("dewp"),
        "wind_dir": m.get("wdir"),
        "wind_speed_kt": m.get("wspd"),
        "wind_gust_kt": m.get("wgst"),
        "visibility": m.get("visib"),
        "altimeter_hpa": round(m["altim"], 1) if m.get("altim") else None,
        "slp_hpa": m.get("slp"),
        "flight_category": m.get("fltCat"),
        "clouds": [{"cover": c.get("cover"), "base": c.get("base")}
                   for c in (m.get("clouds") or []) if c.get("cover")],
        "wx": m.get("wxString"),
    }
    _CACHE.update(ts=now, station=station, data=data)
    return data


_TAF_CACHE: Dict[str, Any] = {}


async def get_taf(station: str = "MMMX") -> Dict[str, Any]:
    now = time.time()
    cached = _TAF_CACHE.get(station)
    if cached and (now - cached["ts"]) < _TTL:
        return cached["data"]

    url = f"https://aviationweather.gov/api/data/taf?ids={station}&format=json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers={"User-Agent": "ecowitt-weather-server"})
            resp.raise_for_status()
            arr = resp.json()
    except Exception as e:
        logger.error(f"TAF fetch failed: {e}")
        return cached["data"] if cached else {}

    if not arr:
        return {}

    t = arr[0]
    periods = []
    for f in (t.get("fcsts") or []):
        periods.append({
            "from": f.get("timeFrom"), "to": f.get("timeTo"),
            "change": f.get("fcstChange"), "probability": f.get("probability"),
            "wind_dir": f.get("wdir"), "wind_speed_kt": f.get("wspd"), "wind_gust_kt": f.get("wgst"),
            "visibility": f.get("visib"), "wx": f.get("wxString"),
            "clouds": [{"cover": c.get("cover"), "base": c.get("base")}
                       for c in (f.get("clouds") or []) if c.get("cover")],
        })
    data = {
        "station": t.get("icaoId", station),
        "name": t.get("name"),
        "raw": t.get("rawTAF"),
        "issued": t.get("issueTime"),
        "valid_from": t.get("validTimeFrom"), "valid_to": t.get("validTimeTo"),
        "periods": periods,
    }
    _TAF_CACHE[station] = {"ts": now, "data": data}
    return data
