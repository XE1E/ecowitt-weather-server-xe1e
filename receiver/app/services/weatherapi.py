"""
Pronóstico de WeatherAPI.com, como complemento a Open-Meteo.

WeatherAPI tiene mejor precisión para ciudades grandes y zonas urbanas. Se usa
junto con Open-Meteo para tener un "consenso" entre fuentes: cuando ambas
predicen lluvia, la confianza es mayor; cuando difieren, se muestra el más
conservador (el que predice peor tiempo).

Requiere API key gratuita (hasta 1M llamadas/mes): weatherapi.com/signup.aspx
"""
import time
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_URL = "https://api.weatherapi.com/v1/forecast.json"
_TTL = 900          # 15 min
_CACHE: Dict[str, Dict[str, Any]] = {}


def _age_min(ts: float) -> Optional[float]:
    return None if not ts else (time.time() - ts) / 60.0


def _with_freshness(payload: Dict[str, Any], ts: float) -> Dict[str, Any]:
    age = _age_min(ts)
    out = dict(payload)
    out["fetched_at"] = datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None).isoformat()
    out["age_minutes"] = round(age, 1) if age is not None else None
    out["stale"] = bool(age is not None and age > _TTL / 60.0)
    return out


# Mapeo de códigos WeatherAPI a códigos WMO (para unificar con Open-Meteo)
# https://www.weatherapi.com/docs/weather_conditions.json
_WEATHERAPI_TO_WMO = {
    1000: 0,    # Sunny/Clear -> Clear sky
    1003: 2,    # Partly cloudy
    1006: 3,    # Cloudy
    1009: 3,    # Overcast
    1030: 45,   # Mist
    1063: 80,   # Patchy rain possible -> Rain showers slight
    1066: 85,   # Patchy snow possible
    1069: 66,   # Patchy sleet possible
    1072: 56,   # Patchy freezing drizzle possible
    1087: 95,   # Thundery outbreaks possible
    1114: 71,   # Blowing snow
    1117: 75,   # Blizzard
    1135: 45,   # Fog
    1147: 48,   # Freezing fog
    1150: 51,   # Patchy light drizzle
    1153: 51,   # Light drizzle
    1168: 56,   # Freezing drizzle
    1171: 57,   # Heavy freezing drizzle
    1180: 61,   # Patchy light rain
    1183: 61,   # Light rain
    1186: 63,   # Moderate rain at times
    1189: 63,   # Moderate rain
    1192: 65,   # Heavy rain at times
    1195: 65,   # Heavy rain
    1198: 66,   # Light freezing rain
    1201: 67,   # Moderate or heavy freezing rain
    1204: 66,   # Light sleet
    1207: 67,   # Moderate or heavy sleet
    1210: 71,   # Patchy light snow
    1213: 71,   # Light snow
    1216: 73,   # Patchy moderate snow
    1219: 73,   # Moderate snow
    1222: 75,   # Patchy heavy snow
    1225: 75,   # Heavy snow
    1237: 77,   # Ice pellets
    1240: 80,   # Light rain shower
    1243: 81,   # Moderate or heavy rain shower
    1246: 82,   # Torrential rain shower
    1249: 66,   # Light sleet showers
    1252: 67,   # Moderate or heavy sleet showers
    1255: 85,   # Light snow showers
    1258: 86,   # Moderate or heavy snow showers
    1261: 77,   # Light showers of ice pellets
    1264: 77,   # Moderate or heavy showers of ice pellets
    1273: 95,   # Patchy light rain with thunder
    1276: 95,   # Moderate or heavy rain with thunder
    1279: 95,   # Patchy light snow with thunder
    1282: 95,   # Moderate or heavy snow with thunder
}


def _to_wmo(code: int) -> int:
    """Convierte código WeatherAPI a WMO."""
    return _WEATHERAPI_TO_WMO.get(code, 3)  # Default: nublado


async def get_forecast(lat: float, lon: float, days: int = 3) -> Optional[Dict[str, Any]]:
    """
    Obtiene pronóstico de WeatherAPI.com.

    Devuelve None si no hay API key configurada o si falla la petición sin caché.
    El formato de salida se normaliza para ser compatible con Open-Meteo.
    """
    api_key = settings.weatherapi_key
    if not api_key:
        return None

    key = f"{lat:.3f},{lon:.3f},{days}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return _with_freshness(cached["data"], cached["ts"])

    params = {
        "key": api_key,
        "q": f"{lat},{lon}",
        "days": min(days, 3),  # Plan gratuito: máx 3 días
        "aqi": "no",
        "alerts": "no",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(_URL, params=params,
                                 headers={"User-Agent": "ecowitt-weather-server"})
            r.raise_for_status()
            raw = r.json()
    except Exception as e:
        if cached:
            logger.warning("WeatherAPI no responde (%s); se sirve la copia de hace %.0f min",
                           e, _age_min(cached["ts"]) or 0)
            return _with_freshness(cached["data"], cached["ts"])
        logger.warning(f"WeatherAPI fetch failed sin copia previa: {e}")
        return None

    # Normalizar a formato similar a Open-Meteo
    data = _normalize(raw)

    _CACHE[key] = {"ts": now, "data": data}
    return _with_freshness(data, now)


def _normalize(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza la respuesta de WeatherAPI al formato de Open-Meteo.
    Así el frontend puede usar cualquiera de las dos fuentes sin cambios.
    """
    forecast_days = raw.get("forecast", {}).get("forecastday", [])

    # Datos diarios
    daily = {
        "time": [],
        "weather_code": [],
        "temperature_2m_max": [],
        "temperature_2m_min": [],
        "precipitation_probability_max": [],
        "precipitation_sum": [],
        "wind_speed_10m_max": [],
        "wind_direction_10m_dominant": [],
        "sunrise": [],
        "sunset": [],
    }

    # Datos horarios
    hourly = {
        "time": [],
        "weather_code": [],
        "temperature_2m": [],
        "precipitation_probability": [],
    }

    for fd in forecast_days:
        day = fd.get("day", {})
        astro = fd.get("astro", {})
        date = fd.get("date", "")

        daily["time"].append(date)
        daily["weather_code"].append(_to_wmo(day.get("condition", {}).get("code", 1000)))
        daily["temperature_2m_max"].append(day.get("maxtemp_c"))
        daily["temperature_2m_min"].append(day.get("mintemp_c"))
        daily["precipitation_probability_max"].append(day.get("daily_chance_of_rain", 0))
        daily["precipitation_sum"].append(day.get("totalprecip_mm", 0))
        daily["wind_speed_10m_max"].append(day.get("maxwind_kph"))
        daily["wind_direction_10m_dominant"].append(None)  # WeatherAPI no lo tiene

        # Convertir hora local a ISO
        def to_iso(date_str: str, time_str: str) -> str:
            try:
                # "06:23 AM" -> "2026-08-10T06:23"
                t = datetime.strptime(time_str, "%I:%M %p")
                return f"{date_str}T{t.strftime('%H:%M')}"
            except Exception:
                return f"{date_str}T06:00"

        daily["sunrise"].append(to_iso(date, astro.get("sunrise", "06:00 AM")))
        daily["sunset"].append(to_iso(date, astro.get("sunset", "06:00 PM")))

        # Horas del día
        for hour in fd.get("hour", []):
            hourly["time"].append(hour.get("time", "").replace(" ", "T"))
            hourly["weather_code"].append(_to_wmo(hour.get("condition", {}).get("code", 1000)))
            hourly["temperature_2m"].append(hour.get("temp_c"))
            hourly["precipitation_probability"].append(hour.get("chance_of_rain", 0))

    # Ubicación
    loc = raw.get("location", {})

    return {
        "latitude": loc.get("lat"),
        "longitude": loc.get("lon"),
        "timezone": loc.get("tz_id", "America/Mexico_City"),
        "daily": daily,
        "hourly": hourly,
        "source": "weatherapi",
    }


async def get_current(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Obtiene condiciones actuales de WeatherAPI.
    Útil para comparar con los datos de la estación local.
    """
    api_key = settings.weatherapi_key
    if not api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.weatherapi.com/v1/current.json",
                params={"key": api_key, "q": f"{lat},{lon}", "aqi": "no"},
                headers={"User-Agent": "ecowitt-weather-server"}
            )
            r.raise_for_status()
            raw = r.json()
    except Exception as e:
        logger.warning(f"WeatherAPI current failed: {e}")
        return None

    curr = raw.get("current", {})
    return {
        "temperature_c": curr.get("temp_c"),
        "feels_like_c": curr.get("feelslike_c"),
        "humidity": curr.get("humidity"),
        "pressure_mb": curr.get("pressure_mb"),
        "wind_kph": curr.get("wind_kph"),
        "wind_degree": curr.get("wind_degree"),
        "precip_mm": curr.get("precip_mm"),
        "cloud": curr.get("cloud"),
        "uv": curr.get("uv"),
        "condition_code": curr.get("condition", {}).get("code"),
        "condition_wmo": _to_wmo(curr.get("condition", {}).get("code", 1000)),
        "condition_text": curr.get("condition", {}).get("text"),
        "is_day": curr.get("is_day"),
        "source": "weatherapi",
    }
