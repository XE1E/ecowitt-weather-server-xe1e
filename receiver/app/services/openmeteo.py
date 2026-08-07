"""
Pronóstico de Open-Meteo, servido desde el backend.

Antes lo pedía el navegador directamente a api.open-meteo.com. Eso tenía tres
inconvenientes: si el origen fallaba la página se quedaba sin pronóstico, cada
visitante gastaba su propia cuota, y no había caché compartida entre visitas.

Aquí se aplica el mismo patrón que `smn.py`, que es el que mejor aguanta las
caídas: TTL corto, pero si el origen no responde y hay copia guardada —aunque
haya expirado— se sirve esa marcada como `stale`. Un pronóstico de hace un rato
sigue siendo útil; una página en blanco no.

Se devuelve el JSON de Open-Meteo TAL CUAL (más los campos de frescura), para que
el cliente conserve su parseo sin cambios.
"""
import time
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_URL = "https://api.open-meteo.com/v1/forecast"
_TTL = 900          # 15 min (Open-Meteo publica ~cada hora)
_MAX_ENTRIES = 8    # cota del caché: la clave es lat/lon
_CACHE: Dict[str, Dict[str, Any]] = {}

_DAILY = ("weather_code,temperature_2m_max,temperature_2m_min,"
          "precipitation_probability_max,precipitation_sum,"
          "wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset")
_HOURLY = "weather_code,temperature_2m,precipitation_probability"

# Conjunto ampliado para el display e-paper, que necesita rellenar un `hour[]` con forma
# WeatherAPI (sensación, humedad, presión, viento, nubosidad, visibilidad, día/noche).
#
# Va aparte y NO se añade al conjunto normal a propósito: son ocho campos más por cada
# una de las 168 horas, y el dashboard del navegador no los usa. Con esto cada consumidor
# descarga lo suyo y las dos respuestas se cachean por separado (el conjunto forma parte
# de la clave, ver get_forecast).
_HOURLY_EPAPER = (
    "weather_code,temperature_2m,precipitation_probability,apparent_temperature,"
    "relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,"
    "precipitation,cloud_cover,visibility,is_day"
)


def _age_min(ts: float) -> Optional[float]:
    return None if not ts else (time.time() - ts) / 60.0


def _with_freshness(payload: Dict[str, Any], ts: float) -> Dict[str, Any]:
    """Añade cuándo se descargó el dato y si viene de una copia expirada."""
    age = _age_min(ts)
    out = dict(payload)
    out["fetched_at"] = datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None).isoformat()
    out["age_minutes"] = round(age, 1) if age is not None else None
    out["stale"] = bool(age is not None and age > _TTL / 60.0)
    return out


async def get_forecast(lat: float, lon: float, days: int = 7,
                       epaper: bool = False) -> Dict[str, Any]:
    """
    `epaper=True` pide el conjunto horario ampliado que necesita el display e-paper.
    Se cachea como una entrada distinta: la clave incluye el conjunto, porque si no una
    consulta del navegador serviría su respuesta corta al display (o al revés) y el
    `hour[]` saldría sin la mitad de los campos.
    """
    hourly = _HOURLY_EPAPER if epaper else _HOURLY
    key = f"{lat:.3f},{lon:.3f},{days},{'e' if epaper else 'n'}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return _with_freshness(cached["data"], cached["ts"])

    params = {
        "latitude": lat, "longitude": lon,
        "daily": _DAILY, "hourly": hourly,
        "timezone": "auto", "forecast_days": days,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(_URL, params=params,
                                 headers={"User-Agent": "ecowitt-weather-server"})
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        if cached:
            logger.warning("Open-Meteo no responde (%s); se sirve la copia de hace %.0f min",
                           e, _age_min(cached["ts"]) or 0)
            return _with_freshness(cached["data"], cached["ts"])
        logger.error(f"Open-Meteo fetch failed sin copia previa: {e}")
        raise

    if len(_CACHE) >= _MAX_ENTRIES and key not in _CACHE:
        _CACHE.pop(min(_CACHE, key=lambda k: _CACHE[k]["ts"]), None)
    _CACHE[key] = {"ts": now, "data": data}
    return _with_freshness(data, now)
