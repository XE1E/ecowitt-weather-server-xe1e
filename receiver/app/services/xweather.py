"""
Estaciones vecinas (PWS/METAR/mesonet) vía Xweather (ex-AerisWeather), para
comparar contra la lectura propia -- ver docs/internal/PLAN-ESTACIONES-VECINAS.md
para la investigación completa (por qué Xweather y no MADIS/Synoptic/WU/Ecowitt.net).

Mismo patrón que openmeteo.py: caché TTL en memoria, y si el origen no
responde se sirve la última copia buena marcada `stale` en vez de romper la
tarjeta del sitio.

Filtro de calidad: se descarta `pressureMB` fuera de un rango plausible a
nivel del mar (una PWS con la altitud mal configurada manda presión absoluta
cruda -- se vio en producción, mismo bug que tuvo nuestro propio GW1100, ver
`project_gw1100_pressure_fix` en memoria) y estaciones con `trustFactor` bajo.
"""
import time
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_URL = "https://data.api.xweather.com/observations/closest"
_TTL = 600           # 10 min -- ritmo típico de actualización de una PWS
_TIMEOUT = 15.0
_MAX_ENTRIES = 4      # la clave es lat/lon/radio/límite; normalmente solo hay 1 en uso
_CACHE: Dict[str, Dict[str, Any]] = {}

# Rango plausible de presión a nivel del mar. Fuera de esto es casi seguro una
# PWS con la altitud mal puesta mandando presión absoluta sin corregir (en
# CDMX, ~2250 msnm, eso cae típicamente entre 750-790 hPa -- muy por debajo).
_PLAUSIBLE_PRESSURE_MB = (950.0, 1050.0)
_MIN_TRUST_FACTOR = 50


def _age_min(ts: float) -> Optional[float]:
    return None if not ts else (time.time() - ts) / 60.0


def _clean_pressure(mb: Optional[float]) -> Optional[float]:
    if mb is None:
        return None
    lo, hi = _PLAUSIBLE_PRESSURE_MB
    return mb if lo <= mb <= hi else None


def _normalize(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    ob = raw.get("ob") or {}
    rel = raw.get("relativeTo") or {}
    trust = ob.get("trustFactor")
    if trust is not None and trust < _MIN_TRUST_FACTOR:
        return None
    return {
        "id": raw.get("id"),
        "source": raw.get("dataSource"),
        "distance_km": rel.get("distanceKM"),
        "bearing": rel.get("bearingENG"),
        "observed_at": ob.get("dateTimeISO"),
        "temp_c": ob.get("tempC"),
        "humidity": ob.get("humidity"),
        "pressure_mb": _clean_pressure(ob.get("pressureMB")),
        "wind_speed_kph": ob.get("windSpeedKPH"),
        "wind_dir_deg": ob.get("windDirDEG"),
        "trust_factor": trust,
    }


def _with_freshness(payload: List[Dict[str, Any]], ts: float) -> Dict[str, Any]:
    age = _age_min(ts)
    return {
        "stations": payload,
        "fetched_at": datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None).isoformat(),
        "age_minutes": round(age, 1) if age is not None else None,
        "stale": bool(age is not None and age > _TTL / 60.0),
    }


async def get_nearby_stations(lat: float, lon: float, client_id: str, client_secret: str,
                              radius_km: float = 40, limit: int = 10) -> Dict[str, Any]:
    key = f"{lat:.3f},{lon:.3f},{radius_km:.0f},{limit}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return _with_freshness(cached["data"], cached["ts"])

    params = {
        "p": f"{lat},{lon}",
        "radius": f"{radius_km / 1.60934:.0f}mi",  # la API pide millas en la query
        "limit": limit,
        "filter": "allstations",  # sin esto solo devuelve METAR -- ver PLAN-ESTACIONES-VECINAS.md
        "client_id": client_id,
        "client_secret": client_secret,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(_URL, params=params)
            r.raise_for_status()
            body = r.json()
            if not body.get("success"):
                raise RuntimeError(body.get("error") or "respuesta sin éxito")
            data = [s for raw in (body.get("response") or []) if (s := _normalize(raw))]
    except Exception as e:
        if cached:
            logger.warning("Xweather no responde (%s); se sirve la copia de hace %.0f min",
                           e, _age_min(cached["ts"]) or 0)
            return _with_freshness(cached["data"], cached["ts"])
        logger.error(f"Xweather fetch failed sin copia previa: {e}")
        raise

    if len(_CACHE) >= _MAX_ENTRIES and key not in _CACHE:
        _CACHE.pop(min(_CACHE, key=lambda k: _CACHE[k]["ts"]), None)
    _CACHE[key] = {"ts": now, "data": data}
    return _with_freshness(data, now)
