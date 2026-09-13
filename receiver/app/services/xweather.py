"""
Estaciones vecinas (PWS/METAR/mesonet) vía Xweather (ex-AerisWeather), para
comparar contra la lectura propia -- ver docs/internal/PLAN-ESTACIONES-VECINAS.md
para la investigación completa (por qué Xweather y no MADIS/Synoptic/WU/Ecowitt.net).

Mismo patrón que openmeteo.py: caché TTL en memoria, y si el origen no
responde se sirve la última copia buena marcada `stale` en vez de romper la
tarjeta del sitio.

Presión: se usa `altimeterMB` (QNH, fórmula de aviación) y NO `pressureMB`
(reducida a nivel del mar con fórmula meteorológica) -- divergen bastante a
la altitud de CDMX, y `altimeterMB` es la que corresponde a nuestra propia
`pressure_relative` (fórmula ISA). Ver `_normalize` para el detalle y los
números reales que lo confirmaron.

Filtro de calidad: se descarta la presión resultante si cae fuera de un rango
plausible a nivel del mar (una PWS con la altitud mal configurada manda
presión absoluta cruda -- se vio en producción, mismo bug que tuvo nuestro
propio GW1100, ver `project_gw1100_pressure_fix` en memoria) y estaciones con
`trustFactor` bajo.

Fase 2: además del dato puntual, se guarda un historial corto de presión POR
ESTACIÓN VECINA (mismo patrón que `_pressure_hist`/`_push_and_delta` en
alerts.py, pero uno por vecina en vez de por estación propia) para calcular
su tendencia en la misma ventana de 3 h que usa `/api/forecast/local` para la
estación propia -- así ambas tendencias son directamente comparables. Se
agrega una tendencia agregada "de la zona" (`zone_trend*`), preferiendo el
METAR si tiene suficiente historia (misma razón que en NearbyStationsCard:
calibración profesional, sin el ruido de las PWS baratas) y cayendo a la
mediana de las vecinas si no.
"""
import time
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .forecaster import zone_trend as _zone_trend_helper

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

# Ventana de tendencia: 3 h, igual que /api/forecast/local (estación propia),
# para que la tendencia de la zona y la propia se puedan comparar directo.
_TREND_WINDOW_MIN = 180
# Historial de presión por estación vecina: id -> deque de (ts unix, mb).
# maxlen generoso: a TTL de 10 min caben ~36 lecturas en 2x la ventana (6 h).
_TREND_HIST: Dict[str, deque] = {}


def _age_min(ts: float) -> Optional[float]:
    return None if not ts else (time.time() - ts) / 60.0


def _clean_pressure(mb: Optional[float]) -> Optional[float]:
    if mb is None:
        return None
    lo, hi = _PLAUSIBLE_PRESSURE_MB
    return mb if lo <= mb <= hi else None


def _station_trend(station_id: Optional[str], now: float, pressure_mb: Optional[float]) -> Optional[float]:
    """Guarda esta lectura en el historial de la estación y devuelve su
    tendencia de presión (actual - línea base de hace ~_TREND_WINDOW_MIN),
    o None si aún no hay suficiente historia (tras un reinicio, o si esta
    lectura no trae presión utilizable). Mismo cálculo que
    `_delta_over_window` en alerts.py, aplicado por estación vecina.
    """
    if not station_id or pressure_mb is None:
        return None
    hist = _TREND_HIST.setdefault(station_id, deque(maxlen=40))
    hist.append((now, pressure_mb))
    cutoff = now - _TREND_WINDOW_MIN * 2 * 60
    while hist and hist[0][0] < cutoff:
        hist.popleft()
    if len(hist) < 2:
        return None
    target = now - _TREND_WINDOW_MIN * 60
    baseline = min(hist, key=lambda e: abs(e[0] - target))
    if (now - baseline[0]) < _TREND_WINDOW_MIN * 60 * 0.5:
        return None
    return round(hist[-1][1] - baseline[1], 1)


def _normalize(raw: Dict[str, Any], now: Optional[float] = None) -> Optional[Dict[str, Any]]:
    ob = raw.get("ob") or {}
    rel = raw.get("relativeTo") or {}
    trust = ob.get("trustFactor")
    if trust is not None and trust < _MIN_TRUST_FACTOR:
        return None
    # Xweather trae TRES presiones por estación: `spressureMB` (absoluta, sin
    # corregir), `pressureMB` (reducida a nivel del mar con fórmula
    # meteorológica -- usa temperatura) y `altimeterMB` (QNH, fórmula estándar
    # de aviación). Nuestra `pressure_relative` se calcula con la fórmula ISA
    # (misma familia que QNH, ver project_gw1100_pressure_fix en memoria), así
    # que hay que comparar contra `altimeterMB`, NO `pressureMB` -- las dos
    # fórmulas divergen bastante a la altitud de CDMX (~2250 m): se verificó
    # en vivo que MMMX daba pressureMB=1013 pero altimeterMB=1027, y la
    # estación propia marcaba 1027.3 -- casi idéntica al QNH, nada parecida a
    # la "reducida a nivel del mar". Cae a `pressureMB` solo si la fuente no
    # trae `altimeterMB` (algunas PWS no lo reportan).
    pressure_mb = ob.get("altimeterMB")
    if pressure_mb is None:
        pressure_mb = ob.get("pressureMB")
    pressure_clean = _clean_pressure(pressure_mb)
    station_id = raw.get("id")
    return {
        "id": station_id,
        "source": raw.get("dataSource"),
        "distance_km": rel.get("distanceKM"),
        "bearing": rel.get("bearingENG"),
        "observed_at": ob.get("dateTimeISO"),
        "temp_c": ob.get("tempC"),
        "humidity": ob.get("humidity"),
        "pressure_mb": pressure_clean,
        "pressure_trend_mb": _station_trend(station_id, now if now is not None else time.time(), pressure_clean),
        "wind_speed_kph": ob.get("windSpeedKPH"),
        "wind_dir_deg": ob.get("windDirDEG"),
        "trust_factor": trust,
    }


def _with_freshness(payload: List[Dict[str, Any]], ts: float) -> Dict[str, Any]:
    age = _age_min(ts)
    zone = _zone_trend_helper(payload)
    return {
        "stations": payload,
        "fetched_at": datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None).isoformat(),
        "age_minutes": round(age, 1) if age is not None else None,
        "stale": bool(age is not None and age > _TTL / 60.0),
        "zone_trend_mb": zone["delta_mb"],
        "zone_trend": zone["trend"],
        "zone_trend_reference": zone["reference"],
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
            data = [s for raw in (body.get("response") or []) if (s := _normalize(raw, now))]
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
