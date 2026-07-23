"""
Adaptador para el firmware SVITRIX (reloj Ulanzi TC001).

Expone el dato REAL de la estación con la MISMA forma que WeatherAPI
`current.json`, de modo que el firmware pueda apuntar aquí en lugar de a
WeatherAPI.com cambiando solo la URL. Añade campos extra que WeatherAPI no
tiene: `current.solar_radiation` (W/m²). El viento ya forma parte del esquema
de WeatherAPI (`wind_kph`, `wind_degree`, `wind_dir`, `gust_kph`).
"""
from typing import Any, Dict, Optional

# WeatherAPI usa abreviaturas de rumbo en inglés.
_CARD16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
_POLL_KEY = {"PM2.5": "pm2_5", "PM10": "pm10", "O3": "o3",
             "NO2": "no2", "SO2": "so2", "CO": "co"}


def _num(v: Any) -> Optional[float]:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _cardinal(deg: Optional[float]) -> Optional[str]:
    if deg is None:
        return None
    return _CARD16[round(deg / 22.5) % 16]


def _epa_index(us_aqi: Optional[float]) -> int:
    """US AQI (0-500) → índice US EPA 1-6 (como WeatherAPI air_quality)."""
    if us_aqi is None:
        return 0
    for lim, idx in ((50, 1), (100, 2), (150, 3), (200, 4), (300, 5)):
        if us_aqi <= lim:
            return idx
    return 6


def _condition(data: Dict[str, Any]) -> Dict[str, Any]:
    """Deriva (text, code) estilo WeatherAPI a partir del dato real de la estación.
    Códigos válidos de WeatherAPI para que el ícono del reloj sea coherente."""
    rr = _num(data.get("rain_rate"))
    solar = _num(data.get("solar_radiation"))
    if rr and rr > 0:
        if rr >= 7.6:
            return {"text": "Heavy rain", "code": 1195}
        if rr >= 2.5:
            return {"text": "Moderate rain", "code": 1189}
        return {"text": "Light rain", "code": 1183}
    if solar is not None:
        if solar >= 400:
            return {"text": "Sunny", "code": 1000}
        if solar >= 120:
            return {"text": "Partly cloudy", "code": 1003}
        if solar > 5:
            return {"text": "Cloudy", "code": 1006}
    return {"text": "Clear", "code": 1000}   # noche despejada / sin radiación


def build_weatherapi(data: Optional[Dict[str, Any]],
                     aq: Optional[Dict[str, Any]] = None,
                     im: Optional[Dict[str, Any]] = None,
                     lat: float = 19.380359, lon: float = -99.174564) -> Dict[str, Any]:
    d = data or {}
    tc = _num(d.get("temperature_outdoor"))
    hum = _num(d.get("humidity_outdoor"))
    press = _num(d.get("pressure_relative"))
    wkph = _num(d.get("wind_speed"))
    wdeg = _num(d.get("wind_direction"))
    gust = _num(d.get("wind_gust"))
    uv = _num(d.get("uv_index"))
    solar = _num(d.get("solar_radiation"))
    rain_today = _num(d.get("rain_daily"))
    rain_rate = _num(d.get("rain_rate"))

    us_aqi = _num((aq or {}).get("aqi"))
    poll: Dict[str, float] = {}
    if im and im.get("available"):
        for p in im.get("pollutants", []):
            k = _POLL_KEY.get(p.get("pollutant"))
            if k is not None and isinstance(p.get("conc"), (int, float)):
                poll[k] = round(p["conc"], 1)

    current = {
        "last_updated": d.get("received_at"),
        "temp_c": round(tc, 1) if tc is not None else None,
        "temp_f": round(tc * 9 / 5 + 32, 1) if tc is not None else None,
        "humidity": round(hum) if hum is not None else None,
        "pressure_mb": round(press, 1) if press is not None else None,
        "wind_kph": round(wkph, 1) if wkph is not None else None,
        "wind_degree": round(wdeg) if wdeg is not None else None,
        "wind_dir": _cardinal(wdeg),
        "gust_kph": round(gust, 1) if gust is not None else None,
        "uv": round(uv, 1) if uv is not None else None,
        "solar_radiation": round(solar) if solar is not None else None,  # W/m² (extra)
        # Precipitación: precip_mm/in = acumulado de HOY (estándar WeatherAPI);
        # rain_rate_mm = intensidad actual (mm/h, extra).
        "precip_mm": round(rain_today, 1) if rain_today is not None else None,
        "precip_in": round(rain_today / 25.4, 2) if rain_today is not None else None,
        "rain_rate_mm": round(rain_rate, 1) if rain_rate is not None else None,
        "condition": _condition(d),
        "air_quality": {
            "us-epa-index": _epa_index(us_aqi),
            "pm2_5": poll.get("pm2_5", 0),
            "pm10": poll.get("pm10", 0),
            "o3": poll.get("o3", 0),
            "no2": poll.get("no2", 0),
            "so2": poll.get("so2", 0),
            "co": poll.get("co", 0),
        },
    }
    return {
        "location": {
            "name": "Benito Juárez", "region": "Ciudad de México", "country": "México",
            "lat": lat, "lon": lon,
        },
        "current": current,
        "source": "Estación XE1E (clima.xe1e.net)",
    }
