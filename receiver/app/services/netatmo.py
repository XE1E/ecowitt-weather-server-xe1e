"""
Estaciones vecinas vía Netatmo -- segunda red además de Xweather (fase 3 de
docs/internal/PLAN-ESTACIONES-VECINAS.md). Netatmo tiene su propia base de
estaciones domésticas, independiente de la de Xweather/PWSWeather: en la
prueba de factibilidad (2026-09-13) se encontraron 6 estaciones Netatmo en un
radio donde Xweather solo tenía 1 -- mejora real de densidad.

Mismo patrón de caché TTL + stale-fallback que xweather.py/openmeteo.py, más
manejo de OAuth2 (Netatmo, a diferencia de Xweather, no usa una llave fija):

- El intercambio código->token inicial lo hace `exchange_code()`, llamado
  desde el endpoint callback de main.py justo cuando Netatmo redirige --
  el `code` de un solo uso expira en ~30-60 s, no puede pasar por el usuario.
- `_ensure_access_token()` usa el `refresh_token` guardado para pedir un
  `access_token` nuevo cuando expira (~3 h de vida). Netatmo ROTA el
  `refresh_token` en cada refresh -- el nuevo se persiste de inmediato vía
  el callback `on_refresh_token` (main.py lo conecta a settings_store), antes
  de que el proceso pueda caerse y perderlo.

Presión: `getpublicdata` no dice si su "pressure" ya es a nivel del mar o
absoluta de estación -- **sin verificar contra datos reales todavía** (ver
checklist en PLAN-ESTACIONES-VECINAS.md). Se aplica el mismo filtro de rango
plausible que Xweather (950-1050 hPa) como red de seguridad mientras tanto.
"""
import asyncio
import logging
import math
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import httpx

from .forecaster import zone_trend as _zone_trend_helper

logger = logging.getLogger(__name__)

_AUTHORIZE_URL = "https://api.netatmo.com/oauth2/authorize"
_TOKEN_URL = "https://api.netatmo.com/oauth2/token"
_PUBLICDATA_URL = "https://api.netatmo.com/api/getpublicdata"
_SCOPE = "read_station"

_TTL = 600           # 10 min, igual que xweather.py
_TIMEOUT = 15.0
_MAX_ENTRIES = 4
_CACHE: Dict[str, Dict[str, Any]] = {}

# Mismo rango y mismo motivo que xweather.py: descartar una estación con la
# altitud mal configurada mandando presión absoluta cruda.
_PLAUSIBLE_PRESSURE_MB = (950.0, 1050.0)

_TREND_WINDOW_MIN = 180
_TREND_HIST: Dict[str, deque] = {}

# Token de acceso en memoria (vive ~3h, ver expires_in de la respuesta de
# Netatmo). Un solo proceso receiver, no hace falta compartirlo entre workers.
_access_token: Optional[str] = None
_access_token_exp: float = 0.0
_token_lock = asyncio.Lock()


def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    """URL a la que se manda al dueño de la cuenta para autorizar la app."""
    from urllib.parse import urlencode
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": _SCOPE,
        "state": state,
    }
    return f"{_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> Dict[str, Any]:
    """Intercambia el `code` de un solo uso (recién recibido del callback) por
    un access_token + refresh_token. Debe llamarse de inmediato -- el code
    expira en segundos (ver nota en PLAN-ESTACIONES-VECINAS.md)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(_TOKEN_URL, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": _SCOPE,
        })
        r.raise_for_status()
        return r.json()


async def _ensure_access_token(client_id: str, client_secret: str, refresh_token: Optional[str],
                                on_refresh_token: Callable[[str], None]) -> str:
    global _access_token, _access_token_exp
    now = time.time()
    if _access_token and now < _access_token_exp - 60:
        return _access_token
    async with _token_lock:
        now = time.time()
        if _access_token and now < _access_token_exp - 60:
            return _access_token
        if not refresh_token:
            raise RuntimeError(
                "Netatmo sin refresh_token -- falta completar el login OAuth "
                "en Admin -> Integraciones -> Netatmo"
            )
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(_TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            })
            r.raise_for_status()
            body = r.json()
        _access_token = body["access_token"]
        _access_token_exp = now + float(body.get("expires_in", 10800))
        new_refresh = body.get("refresh_token")
        if new_refresh and new_refresh != refresh_token:
            on_refresh_token(new_refresh)
        return _access_token


def _age_min(ts: float) -> Optional[float]:
    return None if not ts else (time.time() - ts) / 60.0


def _clean_pressure(mb: Optional[float]) -> Optional[float]:
    if mb is None:
        return None
    lo, hi = _PLAUSIBLE_PRESSURE_MB
    return mb if lo <= mb <= hi else None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


_COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def _bearing_compass(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    """Rumbo (8 puntos) de (lat1,lon1) hacia (lat2,lon2)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dl)
    deg = (math.degrees(math.atan2(x, y)) + 360) % 360
    return _COMPASS[round(deg / 45) % 8]


def _station_trend(station_id: Optional[str], now: float, pressure_mb: Optional[float]) -> Optional[float]:
    """Igual que xweather._station_trend: tendencia propia de esta estación
    vecina en la ventana de 3h, con su propio historial en memoria."""
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


def _normalize(raw: Dict[str, Any], our_lat: float, our_lon: float, now: float) -> Optional[Dict[str, Any]]:
    place = raw.get("place") or {}
    loc = place.get("location")
    if not loc or len(loc) != 2:
        return None
    st_lon, st_lat = loc[0], loc[1]  # Netatmo da [lon, lat], al revés que casi todo lo demás

    # getpublicdata no trae un module_types explícito (a diferencia de
    # getstationsdata): cada módulo se identifica por lo que reporta en su
    # propio `type`, no por su id. Se aplanan todos los módulos de la
    # estación en un solo dict {medida: valor}, quedándose con la lectura
    # más reciente de cada módulo (normalmente solo hay una por `res`).
    latest: Dict[str, float] = {}
    latest_ts = 0
    for module in (raw.get("measures") or {}).values():
        types = module.get("type") or []
        res = module.get("res") or {}
        if not types or not res:
            continue
        try:
            ts_key = max(res, key=lambda t: int(t))
        except (ValueError, TypeError):
            continue
        values = res.get(ts_key) or []
        latest_ts = max(latest_ts, int(ts_key))
        for t, v in zip(types, values):
            latest[t] = v

    if not latest:
        return None

    pressure_mb = _clean_pressure(latest.get("pressure"))
    station_id = f"netatmo:{raw.get('_id')}"
    return {
        "id": station_id,
        "source": "NETATMO",
        "distance_km": round(_haversine_km(our_lat, our_lon, st_lat, st_lon), 1),
        "bearing": _bearing_compass(our_lat, our_lon, st_lat, st_lon),
        "observed_at": (datetime.fromtimestamp(latest_ts, timezone.utc).replace(tzinfo=None).isoformat()
                        if latest_ts else None),
        "temp_c": latest.get("temperature"),
        "humidity": latest.get("humidity"),
        "pressure_mb": pressure_mb,
        "pressure_trend_mb": _station_trend(station_id, now, pressure_mb),
        # Unidades tal como las devuelve la API pública (km/h, grados) --
        # sin confirmar en vivo todavía si depende de la unidad configurada
        # por el dueño de la estación (ver docstring del módulo).
        "wind_speed_kph": latest.get("wind_strength"),
        "wind_dir_deg": latest.get("wind_angle"),
        "trust_factor": None,  # getpublicdata no expone nada equivalente
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
                              refresh_token: Optional[str], on_refresh_token: Callable[[str], None],
                              radius_km: float = 15, limit: int = 10) -> Dict[str, Any]:
    key = f"{lat:.3f},{lon:.3f},{radius_km:.0f},{limit}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return _with_freshness(cached["data"], cached["ts"])

    try:
        token = await _ensure_access_token(client_id, client_secret, refresh_token, on_refresh_token)
        # getpublicdata pide un bbox, no un radio+límite como Xweather -- lo
        # aproximamos con grados (no hay `limit` del lado del servidor, así
        # que el radio se mantiene modesto por defecto para no traer de más
        # en zonas muy densas; el corte real lo hace `limit` abajo).
        dlat = radius_km / 111.0
        dlon = radius_km / (111.0 * max(0.1, math.cos(math.radians(lat))))
        params = {
            "lat_ne": lat + dlat, "lon_ne": lon + dlon,
            "lat_sw": lat - dlat, "lon_sw": lon - dlon,
            "filter": "true",
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(_PUBLICDATA_URL, params=params,
                                  headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            body = r.json()
        raw_list = body.get("body") or []
        data = [s for raw in raw_list if (s := _normalize(raw, lat, lon, now))]
        data.sort(key=lambda s: s["distance_km"])
        data = data[:limit]
    except Exception as e:
        if cached:
            logger.warning("Netatmo no responde (%s); se sirve la copia de hace %.0f min",
                           e, _age_min(cached["ts"]) or 0)
            return _with_freshness(cached["data"], cached["ts"])
        logger.error(f"Netatmo fetch failed sin copia previa: {e}")
        raise

    if len(_CACHE) >= _MAX_ENTRIES and key not in _CACHE:
        _CACHE.pop(min(_CACHE, key=lambda k: _CACHE[k]["ts"]), None)
    _CACHE[key] = {"ts": now, "data": data}
    return _with_freshness(data, now)
