"""
Air quality via WAQI (aqicn.org).

Fetches server-side (avoids CORS, keeps the token secret) and caches briefly.
WAQI aggregates official monitoring stations (incl. CDMX/SEDEMA) and reports the
US EPA AQI plus per-pollutant sub-indices.
"""
import time
import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {}
_TTL = 600  # 10 minutes


async def get_air_quality(lat: float, lon: float, token: Optional[str]) -> Dict[str, Any]:
    if not token:
        return {"error": "no_token"}

    key = f"{lat:.3f},{lon:.3f}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return cached["data"]

    url = f"https://api.waqi.info/feed/geo:{lat};{lon}/?token={token}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            j = resp.json()
    except Exception as e:
        logger.error(f"WAQI fetch failed: {e}")
        return cached["data"] if cached else {"error": "fetch_failed"}

    if j.get("status") != "ok":
        return {"error": j.get("data", "unknown")}

    d = j["data"]
    iaqi = d.get("iaqi", {})

    def pol(k: str) -> Optional[float]:
        v = iaqi.get(k, {})
        return v.get("v") if isinstance(v, dict) else None

    aqi = d.get("aqi")
    data = {
        "aqi": aqi if isinstance(aqi, (int, float)) else None,
        "dominant": d.get("dominentpol"),
        "station": d.get("city", {}).get("name"),
        "time": d.get("time", {}).get("s"),
        "pollutants": {
            "pm25": pol("pm25"),
            "pm10": pol("pm10"),
            "o3": pol("o3"),
            "no2": pol("no2"),
            "so2": pol("so2"),
            "co": pol("co"),
        },
    }
    _CACHE[key] = {"ts": now, "data": data}
    return data
