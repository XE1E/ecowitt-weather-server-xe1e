"""
Publicación de observaciones a redes meteorológicas públicas
(idea tomada de los RESTful uploaders de WeeWX).

Cada red se activa/desactiva y se configura con sus credenciales desde el
panel de administración. Se ejecuta de forma asíncrona y tolerante a fallos:
si una red falla, no afecta la ingestión ni a las demás.

Redes soportadas:
- Weather Underground (unidades imperiales)
- PWSWeather (unidades imperiales, mismo protocolo que WU)
- WOW-BE (Instituto Real Meteorológico de Bélgica, sucesor de Met Office WOW
  tras su retiro en 2026 -- mismo protocolo que WU, acepta estaciones de
  cualquier país)
- Weathercloud (protocolo propio, valores enteros escalados x10)
- Windy.com (unidades métricas / SI)
- OpenWeatherMap (Stations API, JSON)
- AWEKAS (unidades métricas, formato semicolon-delimited)
- openSenseMap / senseBox (unidades métricas, JSON con sensorId fijo)

Los datos entran en MÉTRICO (°C, km/h, hPa, mm) y aquí se convierten según
lo que cada protocolo espera.
"""
from typing import Any, Dict, Optional
import asyncio
import hashlib
import logging
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0
_CWOP_HOST = "cwop.aprs.net"
_CWOP_PORT = 14580
_AWEKAS_URL = "http://data.awekas.at/eingabe_pruefung.php"

# Último instante en que se intentó publicar en cada red, para respetar el
# intervalo por sistema (la estación ingresa datos ~cada minuto, pero cada red
# puede tener su propio ritmo; CWOP recomienda 10-15 min, por ejemplo).
_last_publish: Dict[str, datetime] = {}


def _due(name: str, interval_min: Any, now: datetime) -> bool:
    """
    ¿Toca publicar en `name` según su intervalo (minutos)?
    interval <= 0 => sin límite (cada ingesta). Marca el intento al aprobarlo,
    de modo que el espaciado se mantiene aunque el envío falle.
    """
    try:
        iv = float(interval_min)
    except (TypeError, ValueError):
        iv = 0.0
    if iv <= 0:
        return True
    last = _last_publish.get(name)
    if last is None or (now - last).total_seconds() >= iv * 60:
        _last_publish[name] = now
        return True
    return False


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


async def _wu_like(client, url, station_id, password, data, name,
                    id_key="ID", pw_key="PASSWORD") -> bool:
    """
    Protocolo "estilo Weather Underground" (WU/PWSWeather/WOW-BE comparten el
    mismo formato de query string). `id_key`/`pw_key` permiten reusarlo para
    WOW-BE, que manda los mismos campos pero con otros nombres para el ID de
    estación y la clave ("siteid"/"siteAuthenticationKey" en vez de
    "ID"/"PASSWORD") -- ver services/publish_all.
    """
    params = _q({
        id_key: station_id,
        pw_key: password,
        "dateutc": "now",
        "action": "updateraw",
        "tempf": _c_to_f(data.get("temperature_outdoor")),
        "humidity": data.get("humidity_outdoor"),
        "dewptf": _c_to_f(data.get("dew_point")),
        "windspeedmph": _kmh_to_mph(data.get("wind_speed")),
        "windgustmph": _kmh_to_mph(data.get("wind_gust")),
        "winddir": data.get("wind_direction"),
        "baromin": _hpa_to_inhg(data.get("pressure_relative")),
        # Presión absoluta (sin corregir a nivel del mar) -- WOW-BE la pide
        # aparte de la relativa; WU/PWSWeather la aceptan como campo opcional.
        "absbaromin": _hpa_to_inhg(data.get("pressure_absolute")),
        "rainin": _mm_to_in(data.get("rain_hourly")),
        "dailyrainin": _mm_to_in(data.get("rain_daily")),
        "solarradiation": data.get("solar_radiation"),
        # "uv_index", no "uv": con la clave corta nunca se publicaba el UV.
        "UV": data.get("uv_index"),
        "indoortempf": _c_to_f(data.get("temperature_indoor")),
        "indoorhumidity": data.get("humidity_indoor"),
    })
    return await _get(client, url, params, name)


async def _weathercloud(client, data, wid, key) -> bool:
    """
    Weathercloud (api.weathercloud.net/v01/set): protocolo propio, NO es
    estilo WU. Valores ENTEROS escalados x10 para un decimal sin usar coma
    (p. ej. "205" = 20.5°C) -- ver docs.weathercloud.net. wspd/wspdhi van en
    m/s (no km/h ni mph), y date/time van en UTC.
    """
    now = datetime.utcnow()

    def _x10(v):
        return None if v is None else round(v * 10)

    def _ms(kmh):
        return None if kmh is None else kmh / 3.6

    params = _q({
        "wid": wid,
        "key": key,
        "date": now.strftime("%Y%m%d"),
        "time": now.strftime("%H%M"),
        "temp": _x10(data.get("temperature_outdoor")),
        "tempin": _x10(data.get("temperature_indoor")),
        "chill": _x10(data.get("wind_chill")),
        "dew": _x10(data.get("dew_point")),
        "heat": _x10(data.get("heat_index")),
        "hum": data.get("humidity_outdoor"),
        "humin": data.get("humidity_indoor"),
        "bar": _x10(data.get("pressure_relative")),
        "wspd": _x10(_ms(data.get("wind_speed"))),
        "wspdhi": _x10(_ms(data.get("wind_gust"))),
        "wdir": data.get("wind_direction"),
        "rain": _x10(data.get("rain_daily")),
        "rainrate": _x10(data.get("rain_rate")),
        "solarrad": _x10(data.get("solar_radiation")),
        "uvi": _x10(data.get("uv_index")),
        "software": "ecowitt-xe1e_1.0",
    })
    return await _get(client, "http://api.weathercloud.net/v01/set", params, "Weathercloud")


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
        "uv": data.get("uv_index"),
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


# ---------- AWEKAS ----------
async def _awekas(client, data, username, password, lat, lon, condition=None) -> bool:
    """
    Publica a AWEKAS usando su formato de 25 campos semicolon-delimited.
    Unidades: °C, km/h, hPa y lluvia en **mm directos**.

    Ojo: la documentación de AWEKAS dice "décimas de mm" para el campo 8, pero es
    incorrecta — se verificó contra el dato ya publicado y lo que espera son mm.
    No "corrijas" esto multiplicando por 10: se publicaría 10x la lluvia real.

    `condition`: código entero de la posición 11 (0=clear warning, 1=clear,
    2=sunny sky, 3=partly cloudy, 4=cloudy, ... 25=heavy snow showers -- ver
    main.py::_awekas_condition_code, que lo deriva de la misma lógica que usa
    el e-paper). None si no se pudo derivar -- se manda vacío como antes.
    """
    now = datetime.utcnow()
    password_hash = hashlib.md5(password.encode()).hexdigest()

    def _fmt(v):
        if v is None:
            return ""
        return str(round(v, 1) if isinstance(v, float) else v)

    values = [
        username,                                    # 1: usuario
        password_hash,                               # 2: MD5 password
        now.strftime("%d.%m.%Y"),                    # 3: fecha DD.MM.YYYY
        now.strftime("%H:%M"),                       # 4: hora HH:MM
        _fmt(data.get("temperature_outdoor")),       # 5: temp °C
        _fmt(data.get("humidity_outdoor")),          # 6: humedad %
        _fmt(data.get("pressure_relative")),         # 7: presión hPa
        _fmt(data.get("rain_daily") or 0),              # 8: lluvia diaria (mm)
        _fmt(data.get("wind_speed")),                # 9: viento km/h
        _fmt(data.get("wind_direction")),            # 10: dirección
        str(condition) if condition is not None else "",  # 11: condición clima
        "",                                          # 12: texto aviso
        "",                                          # 13: altura nieve
        "en",                                        # 14: idioma
        "",                                          # 15: tendencia
        _fmt(data.get("wind_gust")),                 # 16: ráfaga km/h
        _fmt(data.get("solar_radiation")),           # 17: radiación solar
        _fmt(data.get("uv_index")),                  # 18: UV index
        "",                                          # 19: brillo
        "",                                          # 20: horas sol
        "",                                          # 21: temp suelo
        _fmt(data.get("rain_rate") or 0),              # 22: tasa lluvia (mm/h)
        "ecowitt-xe1e_1.0",                          # 23: software
        str(lon) if lon else "",                     # 24: longitud
        str(lat) if lat else "",                     # 25: latitud
    ]

    valstr = ";".join(values)
    url = f"{_AWEKAS_URL}?val={valstr}"

    try:
        r = await client.get(url, timeout=_TIMEOUT)
        if r.status_code == 200 and "OK" in r.text.upper():
            logger.info("Publicado en AWEKAS")
            return True
        logger.warning("AWEKAS respondió %s: %s", r.status_code, r.text[:120])
        return False
    except Exception as e:
        logger.error("Error publicando en AWEKAS: %s", e)
        return False


# ---------- openSenseMap (senseBox) ----------
async def _opensensemap(client, data, box_id, access_token, sensor_ids) -> bool:
    """
    Publica en openSenseMap (senseBox, red ciudadana de datos ambientales de
    la Universidad de Münster). A diferencia de las demás redes NO hay upsert
    por nombre de variable: cada sensor de la caja tiene un `_id` fijo que
    openSenseMap asignó al crearlo (registro manual en su web, no
    scripteable -- ver docs/internal/PLAN-OPTIMIZACION-SERVIDOR.md, sección
    B). `sensor_ids` mapea NUESTRO nombre de campo (p. ej.
    "temperature_outdoor") a ESE sensorId; un campo sin entrada en el mapeo,
    o sin valor en `data`, simplemente no se manda -- config parcial es
    válida (p. ej. solo temp+humedad si no se registraron los demás sensores).
    """
    if not sensor_ids:
        logger.warning("openSenseMap sin sensores configurados; omitido")
        return False
    payload = [
        {"sensor": sensor_id, "value": str(round(v, 2) if isinstance(v, float) else v)}
        for field, sensor_id in sensor_ids.items()
        if sensor_id and (v := data.get(field)) is not None
    ]
    if not payload:
        return False
    url = f"https://api.opensensemap.org/boxes/{box_id}/data"
    try:
        r = await client.post(url, json=payload, headers={"Authorization": access_token}, timeout=_TIMEOUT)
        if r.status_code in (200, 201):
            logger.info("Publicado en openSenseMap (%d sensores)", len(payload))
            return True
        logger.warning("openSenseMap respondió %s: %s", r.status_code, r.text[:120])
        return False
    except Exception as e:
        logger.error("Error publicando en openSenseMap: %s", e)
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


_CWOP_RETRIES = 2   # intentos totales (1 reintento) -- ver nota abajo
_CWOP_RETRY_DELAY = 3.0  # segundos entre intentos


async def _cwop(data, callsign, passcode, lat, lon) -> bool:
    """
    El servidor APRS-IS de CWOP es viejo y da timeouts/conexiones rechazadas de
    forma intermitente incluso con credenciales y formato correctos (~1 de cada
    5 intentos en la práctica) -- un solo reintento tras una pausa corta
    recupera la mayoría de esos casos sin sumar demora relevante (esto corre en
    background, después de responder al datalogger).
    """
    packet = build_cwop_packet(callsign, lat, lon, data, datetime.utcnow())
    last_err: Exception | None = None
    for attempt in range(1, _CWOP_RETRIES + 1):
        try:
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
            last_err = e
            if attempt < _CWOP_RETRIES:
                logger.warning("CWOP intento %d/%d falló (%s), reintentando en %gs",
                               attempt, _CWOP_RETRIES, e, _CWOP_RETRY_DELAY)
                await asyncio.sleep(_CWOP_RETRY_DELAY)
    logger.error("Error publicando en CWOP: %s", last_err)
    return False


async def publish_all(data: Dict[str, Any], settings, awekas_condition: Optional[int] = None) -> Dict[str, bool]:
    """
    Publica a todas las redes activas EN PARALELO (antes iban en secuencia:
    5 redes de 15s de timeout cada una podían sumar hasta ~75-90s en el peor
    caso si varias fallaban a la vez -- ver PLAN-OPTIMIZACION-SERVIDOR.md, A1).
    Devuelve {red: ok} para las intentadas. Nunca lanza excepción (cada red se
    protege por separado, tanto antes como ahora).

    `awekas_condition`: código de condición del cielo para AWEKAS (posición 11
    de su protocolo), derivado por el llamador (main.py::_awekas_condition_code)
    -- requiere astronomía/pronóstico que este módulo no maneja, así que se
    calcula afuera y se pasa ya resuelto.
    """
    now = datetime.utcnow()
    tareas: Dict[str, Any] = {}  # nombre de red -> coroutine sin arrancar

    async with httpx.AsyncClient() as client:
        if (getattr(settings, "wu_enabled", False) and settings.wu_station_id and settings.wu_station_key
                and _due("wunderground", getattr(settings, "wu_interval", 1), now)):
            tareas["wunderground"] = _wu_like(
                client, "https://rtupdate.wunderground.com/weatherstation/updateweatherstation.php",
                settings.wu_station_id, settings.wu_station_key, data, "Weather Underground")
        if (getattr(settings, "pws_enabled", False) and settings.pws_station_id and settings.pws_password
                and _due("pwsweather", getattr(settings, "pws_interval", 5), now)):
            tareas["pwsweather"] = _wu_like(
                client, "https://pwsupdate.pwsweather.com/api/v1/submitwx",
                settings.pws_station_id, settings.pws_password, data, "PWSWeather")
        if (getattr(settings, "wow_be_enabled", False) and settings.wow_be_site_id and settings.wow_be_auth_key
                and _due("wow_be", getattr(settings, "wow_be_interval", 5), now)):
            tareas["wow_be"] = _wu_like(
                client, "http://wow.meteo.be/api/v2/send",
                settings.wow_be_site_id, settings.wow_be_auth_key, data, "WOW-BE",
                id_key="siteid", pw_key="siteAuthenticationKey")
        if (getattr(settings, "weathercloud_enabled", False) and settings.weathercloud_id and settings.weathercloud_key
                and _due("weathercloud", getattr(settings, "weathercloud_interval", 10), now)):
            tareas["weathercloud"] = _weathercloud(
                client, data, settings.weathercloud_id, settings.weathercloud_key)
        if (getattr(settings, "windy_enabled", False) and settings.windy_api_key
                and _due("windy", getattr(settings, "windy_interval", 5), now)):
            tareas["windy"] = _windy(client, data, settings.windy_api_key)
        if (getattr(settings, "owm_enabled", False) and settings.owm_api_key
                and _due("openweathermap", getattr(settings, "owm_interval", 5), now)):
            tareas["openweathermap"] = _owm(client, data, settings.owm_api_key, settings.owm_station_id)
        if (getattr(settings, "awekas_enabled", False) and settings.awekas_username and settings.awekas_password
                and _due("awekas", getattr(settings, "awekas_interval", 5), now)):
            tareas["awekas"] = _awekas(
                client, data, settings.awekas_username, settings.awekas_password,
                getattr(settings, "awekas_latitude", None), getattr(settings, "awekas_longitude", None),
                condition=awekas_condition)
        if (getattr(settings, "opensensemap_enabled", False) and settings.opensensemap_box_id
                and settings.opensensemap_access_token
                and _due("opensensemap", getattr(settings, "opensensemap_interval", 1), now)):
            tareas["opensensemap"] = _opensensemap(
                client, data, settings.opensensemap_box_id, settings.opensensemap_access_token,
                getattr(settings, "opensensemap_sensor_ids", None) or {})

        results: Dict[str, bool] = {}
        if tareas:
            resueltas = await asyncio.gather(*tareas.values())
            results = dict(zip(tareas.keys(), resueltas))

    # CWOP usa un socket TCP propio (APRS-IS), no el cliente httpx de arriba;
    # se queda fuera del gather pero ya no se suma en secuencia a las demás.
    if (getattr(settings, "cwop_enabled", False) and settings.cwop_callsign
            and _due("cwop", getattr(settings, "cwop_interval", 10), now)):
        results["cwop"] = await _cwop(
            data, settings.cwop_callsign, getattr(settings, "cwop_passcode", "-1"),
            getattr(settings, "cwop_latitude", 19.380359),
            getattr(settings, "cwop_longitude", -99.174564))
    return results
