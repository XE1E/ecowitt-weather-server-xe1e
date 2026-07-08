"""
Publicación de observaciones a redes meteorológicas públicas
(idea tomada de los RESTful uploaders de WeeWX).

Cada red se activa/desactiva y se configura con sus credenciales desde el
panel de administración. Se ejecuta de forma asíncrona y tolerante a fallos:
si una red falla, no afecta la ingestión ni a las demás.

Redes soportadas:
- Weather Underground (unidades imperiales)
- PWSWeather (unidades imperiales, mismo protocolo que WU)
- Windy.com (unidades métricas / SI)
- OpenWeatherMap (Stations API, JSON)

Los datos entran en MÉTRICO (°C, km/h, hPa, mm) y aquí se convierten según
lo que cada protocolo espera.
"""
from typing import Any, Dict, Optional
import asyncio
import logging
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0
_CWOP_HOST = "cwop.aprs.net"
_CWOP_PORT = 14580


# --- helpers de unidades (desde métrico) ---
def _c_to_f(c):
    return None if c is None else c * 9 / 5 + 32


def _kmh_to_mph(k):
    return None if k is None else k * 0.621371


def _kmh_to_ms(k):
    return None if k is None else k / 3.6


def _hpa_to_inhg(h):
    return None if h is None else h * 0.0295300


def _mm_to_in(m):
    return None if m is None else m / 25.4


def _q(params: Dict[str, Any]) -> Dict[str, Any]:
    """Quita valores None y redondea floats a 2 decimales."""
    out = {}
    for k, v in params.items():
        if v is None:
            continue
        out[k] = round(v, 2) if isinstance(v, float) else v
    return out


async def _get(client: httpx.AsyncClient, url: str, params: Dict[str, Any], name: str) -> bool:
    try:
        r = await client.get(url, params=params, timeout=_TIMEOUT)
        # WU/PWSWeather responden 200 con cuerpo "success"; tratamos 200 como éxito
        if r.status_code == 200:
            logger.info("Publicado en %s", name)
            return True
        logger.warning("%s respondió %s: %s", name, r.status_code, r.text[:120])
        return False
    except Exception as e:
        logger.error("Error publicando en %s: %s", name, e)
        return False


async def _wu_like(client, url, station_id, password, data, name) -> bool:
    params = _q({
        "ID": station_id,
        "PASSWORD": password,
        "dateutc": "now",
        "action": "updateraw",
        "tempf": _c_to_f(data.get("temperature_outdoor")),
        "humidity": data.get("humidity_outdoor"),
        "dewptf": _c_to_f(data.get("dew_point")),
        "windspeedmph": _kmh_to_mph(data.get("wind_speed")),
        "windgustmph": _kmh_to_mph(data.get("wind_gust")),
        "winddir": data.get("wind_direction"),
        "baromin": _hpa_to_inhg(data.get("pressure_relative")),
        "rainin": _mm_to_in(data.get("rain_hourly")),
        "dailyrainin": _mm_to_in(data.get("rain_daily")),
        "solarradiation": data.get("solar_radiation"),
        "UV": data.get("uv"),
        "indoortempf": _c_to_f(data.get("temperature_indoor")),
        "indoorhumidity": data.get("humidity_indoor"),
    })
    return await _get(client, url, params, name)


async def _windy(client, data, api_key) -> bool:
    # Windy PWS API acepta métrico: temp °C, wind m/s, pressure Pa, precip mm
    params = _q({
        "temp": data.get("temperature_outdoor"),
        "tempf": None,
        "wind": _kmh_to_ms(data.get("wind_speed")),
        "gust": _kmh_to_ms(data.get("wind_gust")),
        "winddir": data.get("wind_direction"),
        "rh": data.get("humidity_outdoor"),
        "dewpoint": data.get("dew_point"),
        "pressure": (data["pressure_relative"] * 100) if data.get("pressure_relative") else None,
        "precip": data.get("rain_hourly"),
        "uv": data.get("uv"),
    })
    url = f"https://stations.windy.com/pws/update/{api_key}"
    return await _get(client, url, params, "Windy")


async def _owm(client, data, api_key, station_id) -> bool:
    # OpenWeatherMap Stations API: POST JSON de mediciones
    if not station_id:
        logger.warning("OWM sin station_id; omitido")
        return False
    payload = [{
        "station_id": station_id,
        "dt": None,  # el servidor usa 'now' si se omite dt en la práctica; se envía sin dt
        "temperature": data.get("temperature_outdoor"),
        "wind_speed": _kmh_to_ms(data.get("wind_speed")),
        "wind_gust": _kmh_to_ms(data.get("wind_gust")),
        "wind_deg": data.get("wind_direction"),
        "pressure": data.get("pressure_relative"),
        "humidity": data.get("humidity_outdoor"),
        "dew_point": data.get("dew_point"),
        "rain_1h": data.get("rain_hourly"),
    }]
    # quitar None de cada medición y dt vacío
    payload = [{k: v for k, v in m.items() if v is not None} for m in payload]
    url = f"https://api.openweathermap.org/data/3.0/measurements?appid={api_key}"
    try:
        r = await client.post(url, json=payload, timeout=_TIMEOUT)
        if r.status_code in (200, 204):
            logger.info("Publicado en OpenWeatherMap")
            return True
        logger.warning("OpenWeatherMap respondió %s: %s", r.status_code, r.text[:120])
        return False
    except Exception as e:
        logger.error("Error publicando en OpenWeatherMap: %s", e)
        return False


# ---------- CWOP / APRS-IS ----------
def _aprs_lat(lat: float) -> str:
    ns = "N" if lat >= 0 else "S"
    lat = abs(lat)
    deg = int(lat)
    minutes = (lat - deg) * 60
    return f"{deg:02d}{minutes:05.2f}{ns}"


def _aprs_lon(lon: float) -> str:
    ew = "E" if lon >= 0 else "W"
    lon = abs(lon)
    deg = int(lon)
    minutes = (lon - deg) * 60
    return f"{deg:03d}{minutes:05.2f}{ew}"


def build_cwop_packet(callsign: str, lat: float, lon: float, data: Dict[str, Any], now: datetime) -> str:
    """
    Construye un paquete meteorológico APRS para CWOP.
    Unidades APRS: viento mph, temp °F, lluvia en centésimas de pulgada,
    presión en décimas de hPa.
    """
    ts = now.strftime("%d%H%M")  # día/hora/min Zulu
    pos = f"{_aprs_lat(lat)}/{_aprs_lon(lon)}"

    def _f3(v, cast=int):
        return f"{cast(round(v)):03d}" if v is not None else "..."

    wdir = _f3(data.get("wind_direction"))
    wspd = _f3(_kmh_to_mph(data.get("wind_speed")))
    gust = _f3(_kmh_to_mph(data.get("wind_gust")))

    wx = f"{wdir}/{wspd}g{gust}"

    tempf = _c_to_f(data.get("temperature_outdoor"))
    wx += f"t{int(round(tempf)):03d}" if tempf is not None else "t..."

    r1 = _mm_to_in(data.get("rain_hourly"))
    if r1 is not None:
        wx += f"r{int(round(r1 * 100)):03d}"
    rd = _mm_to_in(data.get("rain_daily"))
    if rd is not None:
        wx += f"P{int(round(rd * 100)):03d}"

    hum = data.get("humidity_outdoor")
    if hum is not None:
        h = int(round(hum))
        wx += f"h{0 if h >= 100 else h:02d}"

    baro = data.get("pressure_relative")
    if baro is not None:
        wx += f"b{int(round(baro * 10)):05d}"

    return f"{callsign}>APRS,TCPIP*:@{ts}z{pos}_{wx}"


async def _cwop(data, callsign, passcode, lat, lon) -> bool:
    try:
        packet = build_cwop_packet(callsign, lat, lon, data, datetime.utcnow())
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(_CWOP_HOST, _CWOP_PORT), timeout=_TIMEOUT)
        try:
            await reader.readline()  # banner del servidor
            login = f"user {callsign} pass {passcode} vers ecowitt-xe1e 1.0\r\n"
            writer.write(login.encode())
            await writer.drain()
            await asyncio.wait_for(reader.readline(), timeout=_TIMEOUT)  # respuesta login
            writer.write((packet + "\r\n").encode())
            await writer.drain()
            logger.info("Publicado en CWOP como %s", callsign)
            return True
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
    except Exception as e:
        logger.error("Error publicando en CWOP: %s", e)
        return False


async def publish_all(data: Dict[str, Any], settings) -> Dict[str, bool]:
    """
    Publica a todas las redes activas. Devuelve {red: ok} para las intentadas.
    Nunca lanza excepción (cada red se protege por separado).
    """
    results: Dict[str, bool] = {}
    async with httpx.AsyncClient() as client:
        if getattr(settings, "wu_enabled", False) and settings.wu_station_id and settings.wu_station_key:
            results["wunderground"] = await _wu_like(
                client, "https://rtupdate.wunderground.com/weatherstation/updateweatherstation.php",
                settings.wu_station_id, settings.wu_station_key, data, "Weather Underground")
        if getattr(settings, "pws_enabled", False) and settings.pws_station_id and settings.pws_password:
            results["pwsweather"] = await _wu_like(
                client, "https://pwsupdate.pwsweather.com/api/v1/submitwx",
                settings.pws_station_id, settings.pws_password, data, "PWSWeather")
        if getattr(settings, "windy_enabled", False) and settings.windy_api_key:
            results["windy"] = await _windy(client, data, settings.windy_api_key)
        if getattr(settings, "owm_enabled", False) and settings.owm_api_key:
            results["openweathermap"] = await _owm(client, data, settings.owm_api_key, settings.owm_station_id)
    if getattr(settings, "cwop_enabled", False) and settings.cwop_callsign:
        results["cwop"] = await _cwop(
            data, settings.cwop_callsign, getattr(settings, "cwop_passcode", "-1"),
            getattr(settings, "cwop_latitude", 19.380359),
            getattr(settings, "cwop_longitude", -99.174564))
    return results
