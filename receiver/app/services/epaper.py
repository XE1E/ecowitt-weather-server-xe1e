"""
Adaptador para el firmware del display LilyGo T5 4.7" e-paper.

Sirve el dato REAL de la estación con la forma de WeatherAPI `forecast.json`, que es
justo lo que `DecodeWeatherAPI()` del firmware ya sabe parsear. Así el display cambia
de fuente **sin tocar una sola línea de su dibujado** —las 11+ pantallas, el touch y el
deep sleep se quedan igual— y puede volver a WeatherAPI.com como respaldo cambiando
nada más la URL.

Es el mismo patrón de `svitrix.py` (que cubre `current.json` para el reloj Ulanzi) y
reusa su `build_weatherapi()` como base del bloque `current`. Lo que se añade aquí:

- `forecast.forecastday[]` de tres días con las 24 horas de cada uno, que el e-paper
  necesita para sus gráficas.
- `astro` calculado con pyephem para las coordenadas exactas del sitio.
- un bloque `xe1e{}` con lo que WeatherAPI no puede dar (radiación, lluvia del evento,
  IMECA, máximos MEDIDOS, tendencia real de presión).

Plan y decisiones: `PLAN-FUENTE-DATOS-XE1E.md` en el repo del firmware.
"""
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import svitrix

# --------------------------------------------------------------------------------------
# WMO (Open-Meteo) -> código de condición de WeatherAPI + texto en español.
#
# Son dos saltos (WMO -> WeatherAPI -> icono OWM) porque el firmware ya tiene el segundo
# resuelto en `mapWeatherAPIIcon()`. Aprovecharlo sale más barato que inventar un tercer
# vocabulario, y TODOS los códigos de esta tabla están cubiertos por su `switch` --lo que
# importa, porque su caso por omisión dibuja "nublado" y un código no contemplado pasaría
# desapercibido--.
#
# El texto va en español porque el display se configura con `Language = "es"`, igual que
# lo que devolvería WeatherAPI con `lang=es`.
# --------------------------------------------------------------------------------------
_WMO: Dict[int, tuple] = {
    0:  (1000, "Despejado"),
    1:  (1000, "Mayormente despejado"),
    2:  (1003, "Parcialmente nublado"),
    3:  (1009, "Nublado"),
    45: (1135, "Niebla"),
    48: (1147, "Niebla con escarcha"),
    51: (1150, "Llovizna ligera"),
    53: (1153, "Llovizna moderada"),
    55: (1153, "Llovizna intensa"),
    56: (1168, "Llovizna helada ligera"),
    57: (1171, "Llovizna helada intensa"),
    61: (1183, "Lluvia ligera"),
    63: (1189, "Lluvia moderada"),
    65: (1195, "Lluvia intensa"),
    66: (1198, "Lluvia helada ligera"),
    67: (1201, "Lluvia helada intensa"),
    71: (1213, "Nevada ligera"),
    73: (1219, "Nevada moderada"),
    75: (1225, "Nevada intensa"),
    77: (1237, "Granos de nieve"),
    80: (1240, "Chubascos ligeros"),
    81: (1243, "Chubascos moderados"),
    82: (1246, "Chubascos torrenciales"),
    85: (1255, "Chubascos de nieve ligeros"),
    86: (1258, "Chubascos de nieve intensos"),
    95: (1087, "Tormenta"),
    96: (1273, "Tormenta con granizo ligero"),
    99: (1276, "Tormenta con granizo intenso"),
}

# Códigos WMO de nieve: deciden si la probabilidad va a `chance_of_snow` en vez de
# `chance_of_rain` (Open-Meteo publica una sola probabilidad de precipitación).
_WMO_NIEVE = {71, 73, 75, 77, 85, 86}

# Código de WeatherAPI -> texto en español, derivado de la tabla de arriba para no
# repetirlo. Sirve para traducir la condición ACTUAL, que `svitrix._condition()` devuelve
# en inglés ("Cloudy", "Light rain") porque el reloj Ulanzi la quiere así. Sin esto la
# pantalla mezclaba idiomas: "Cloudy" arriba y "Chubascos ligeros" en el pronóstico.
_TEXTO_ES: Dict[int, str] = {}
for _wmo in sorted(_WMO):                      # en orden: WMO 0 gana sobre 1 para 1000
    _c, _t = _WMO[_wmo]
    _TEXTO_ES.setdefault(_c, _t)
_TEXTO_ES.setdefault(1006, "Nublado")          # el que usa nuestro caso por omisión

_TZ_ID = os.environ.get("TZ", "America/Mexico_City")


def _num(v: Any) -> Optional[float]:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _condicion(wmo: Any) -> Dict[str, Any]:
    code, text = _WMO.get(int(wmo) if isinstance(wmo, (int, float)) else -1,
                          (1006, "Nublado"))
    return {"code": code, "text": text}


def _defra_index(pm25: Optional[float]) -> int:
    """
    PM2.5 (µg/m³) -> índice DAQI del DEFRA británico (1-10), que es el
    `gb-defra-index` de WeatherAPI y lo que lee la pantalla de calidad del aire.

    Se calcula de verdad con las bandas oficiales en vez de emitir 0: un cero se
    dibujaría como un valor legítimo y sería mentira.
    """
    if pm25 is None:
        return 0
    for lim, idx in ((11, 1), (23, 2), (35, 3), (41, 4), (47, 5),
                     (53, 6), (58, 7), (64, 8), (70, 9)):
        if pm25 <= lim:
            return idx
    return 10


def _fase_luna_en(illum: Optional[float], waxing: Optional[bool]) -> str:
    """
    Nombre de fase lunar en INGLÉS canónico de WeatherAPI.

    El almanaque lo devuelve en español, pero `TranslateMoonPhase()` del firmware busca
    palabras clave inglesas ("waxing"+"crescent", "full", "last"...) y traduce él mismo
    al idioma configurado. Mandarlo en español haría que cayera al `return phase` final y
    se vería el texto sin traducir, incoherente con el resto de la pantalla.
    """
    if illum is None:
        return "New Moon"
    if illum < 1:
        return "New Moon"
    if illum > 99:
        return "Full Moon"
    if 45 <= illum <= 55:
        return "First Quarter" if waxing else "Last Quarter"
    if illum < 45:
        return "Waxing Crescent" if waxing else "Waning Crescent"
    return "Waxing Gibbous" if waxing else "Waning Gibbous"


def _hhmm(iso: Any) -> str:
    """"2026-08-07T06:14" -> "06:14". Lo que dibuja la pantalla, sin AM/PM."""
    if not isinstance(iso, str) or "T" not in iso:
        return ""
    return iso.split("T", 1)[1][:5]


def _horas_por_dia(om: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Convierte los arrays paralelos de Open-Meteo en horas agrupadas por fecha local.

    Se emiten las 24 horas de cada día empezando a las 00:00 locales, no una selección:
    el firmware muestrea él mismo cada 3 h (`h += 3`) sobre lo que reciba, así que
    mandarle menos horas le desalinearía las gráficas.
    """
    h = om.get("hourly") or {}
    tiempos = h.get("time") or []
    offset = int(om.get("utc_offset_seconds") or 0)

    def col(nombre: str) -> List[Any]:
        return h.get(nombre) or []

    def val(arr: List[Any], i: int) -> Any:
        return arr[i] if i < len(arr) else None

    c_code = col("weather_code")
    c_temp = col("temperature_2m")
    c_app = col("apparent_temperature")
    c_hum = col("relative_humidity_2m")
    c_pres = col("pressure_msl")
    c_wind = col("wind_speed_10m")
    c_wdir = col("wind_direction_10m")
    c_prec = col("precipitation")
    c_pop = col("precipitation_probability")
    c_nube = col("cloud_cover")
    c_vis = col("visibility")
    c_dia = col("is_day")

    out: Dict[str, List[Dict[str, Any]]] = {}
    for i, t in enumerate(tiempos):
        if not isinstance(t, str) or len(t) < 16:
            continue
        wmo = val(c_code, i)
        pop = _num(val(c_pop, i)) or 0
        nieva = isinstance(wmo, (int, float)) and int(wmo) in _WMO_NIEVE
        # `time_epoch` en unix real: la hora de Open-Meteo viene en local sin sufijo
        # (timezone=auto), así que se lee como UTC y se le descuenta el offset del sitio.
        epoch = int(datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp()) - offset
        vis = _num(val(c_vis, i))
        out.setdefault(t[:10], []).append({
            "time_epoch": epoch,
            "time": t.replace("T", " "),
            "temp_c": _num(val(c_temp, i)),
            "feelslike_c": _num(val(c_app, i)),
            "humidity": _num(val(c_hum, i)),
            "pressure_mb": _num(val(c_pres, i)),
            "wind_kph": _num(val(c_wind, i)),
            "wind_degree": _num(val(c_wdir, i)),
            "precip_mm": _num(val(c_prec, i)),
            "chance_of_rain": 0 if nieva else round(pop),
            "chance_of_snow": round(pop) if nieva else 0,
            "cloud": _num(val(c_nube, i)),
            "vis_km": round(vis / 1000.0, 1) if vis is not None else None,
            "is_day": val(c_dia, i),
            "condition": _condicion(wmo),
        })
    return out


def _hora_actual(horas: List[Dict[str, Any]], ahora: datetime) -> Optional[Dict[str, Any]]:
    """La entrada horaria que cubre este momento (para nubosidad y visibilidad)."""
    clave = ahora.strftime("%Y-%m-%d %H:00")
    for e in horas:
        if e.get("time") == clave:
            return e
    return horas[0] if horas else None


def _max_min_hoy(stats: Optional[Dict[str, Any]],
                 horas_hoy: List[Dict[str, Any]],
                 ahora: datetime,
                 fc_max: Optional[float],
                 fc_min: Optional[float]) -> tuple:
    """
    Máxima y mínima de HOY combinando lo MEDIDO con el pronóstico de lo que resta.

    WeatherAPI manda aquí su propio pronóstico del día. Nosotros tenemos el dato real
    de la estación, que es mejor: a media tarde la máxima ya ocurrió y medirla le gana a
    estimarla. Pero quedarse solo con lo medido subestimaría el día por la mañana, así
    que se toma el extremo entre lo medido y las horas que faltan.
    """
    med_max = med_min = None
    if stats:
        t = (stats.get("stats") or {}).get("temperature_outdoor") or {}
        med_max, med_min = _num(t.get("max")), _num(t.get("min"))

    restantes = [_num(e.get("temp_c")) for e in horas_hoy
                 if isinstance(e.get("time"), str) and e["time"] >= ahora.strftime("%Y-%m-%d %H:00")]
    restantes = [v for v in restantes if v is not None]

    cand_max = [v for v in (med_max, max(restantes) if restantes else None, fc_max) if v is not None]
    cand_min = [v for v in (med_min, min(restantes) if restantes else None, fc_min) if v is not None]
    return (max(cand_max) if cand_max else None,
            min(cand_min) if cand_min else None)


def build_forecast_json(data: Optional[Dict[str, Any]],
                        aq: Optional[Dict[str, Any]] = None,
                        im: Optional[Dict[str, Any]] = None,
                        *,
                        lat: float = 19.380359, lon: float = -99.174564,
                        sun_elev: Optional[float] = None,
                        almanac: Optional[Dict[str, Any]] = None,
                        om: Optional[Dict[str, Any]] = None,
                        stats: Optional[Dict[str, Any]] = None,
                        p_3h: Optional[float] = None,
                        ahora: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Arma el `forecast.json` completo. Función pura: quien llama reúne los datos.

    NUNCA lanza por falta de dato de estación. El e-paper despierta, pide una vez y se
    vuelve a dormir, así que un error lo deja con la pantalla vieja hasta el siguiente
    ciclo --que puede ser media hora--. Si la estación no ha reportado, se cae al
    pronóstico de la hora en curso y se marca la procedencia en `xe1e.source`.
    """
    d = data or {}
    om = om or {}
    ahora = ahora or datetime.now()
    por_dia = _horas_por_dia(om)
    fechas = sorted(por_dia.keys())[:3]
    horas_hoy = por_dia.get(fechas[0], []) if fechas else []
    actual = _hora_actual(horas_hoy, ahora)

    # ---- current: base de svitrix (dato real) + lo que el e-paper lee y aquél no emite
    base = svitrix.build_weatherapi(d, aq, im, lat=lat, lon=lon, sun_elev=sun_elev)
    current = base["current"]

    hay_estacion = _num(d.get("temperature_outdoor")) is not None
    if not hay_estacion and actual:
        # Respaldo: sin lectura de la estación, el pronóstico de esta hora antes que "--".
        current["temp_c"] = actual.get("temp_c")
        current["humidity"] = actual.get("humidity")
        current["pressure_mb"] = actual.get("pressure_mb")
        current["wind_kph"] = actual.get("wind_kph")
        current["wind_degree"] = actual.get("wind_degree")
        current["condition"] = actual.get("condition")
        current["is_day"] = actual.get("is_day")

    # La condición se traduce al español para no mezclar idiomas con el pronóstico. Se
    # hace por código, no por texto, así que sigue valiendo si svitrix añade condiciones.
    cond = current.get("condition")
    if isinstance(cond, dict) and _TEXTO_ES.get(cond.get("code")):
        cond["text"] = _TEXTO_ES[cond["code"]]

    feels = _num(d.get("feels_like"))
    dew = _num(d.get("dew_point"))
    current["feelslike_c"] = feels if feels is not None else (actual or {}).get("feelslike_c")
    current["dewpoint_c"] = dew
    # Nubosidad y visibilidad no se miden en la estación: salen del pronóstico.
    current["cloud"] = (actual or {}).get("cloud")
    current["vis_km"] = (actual or {}).get("vis_km")
    if isinstance(current.get("air_quality"), dict):
        current["air_quality"]["gb-defra-index"] = _defra_index(
            _num(current["air_quality"].get("pm2_5")))

    # ---- location: el firmware compara `localtime` con su propio reloj para detectar
    # desfases de zona horaria, así que tiene que ser la hora local de verdad.
    location = dict(base["location"])
    location.update({
        "tz_id": _TZ_ID,
        "localtime": ahora.strftime("%Y-%m-%d %H:%M"),
        "localtime_epoch": int(ahora.timestamp()),
    })

    # ---- forecast: tres días
    daily = om.get("daily") or {}
    d_fechas = daily.get("time") or []

    def dcol(nombre: str, fecha: str) -> Any:
        arr = daily.get(nombre) or []
        try:
            return arr[d_fechas.index(fecha)]
        except (ValueError, IndexError):
            return None

    alm = almanac or {}
    luna = alm.get("moon") or {}
    sol = alm.get("sun") or {}

    forecastday: List[Dict[str, Any]] = []
    for n, fecha in enumerate(fechas):
        horas = por_dia.get(fecha, [])
        fc_max, fc_min = _num(dcol("temperature_2m_max", fecha)), _num(dcol("temperature_2m_min", fecha))
        if n == 0:
            tmax, tmin = _max_min_hoy(stats, horas, ahora, fc_max, fc_min)
            # Día 0 con pyephem: coordenadas y elevación exactas del sitio, y sin el
            # problema de horario de verano que traía la fuente anterior.
            astro = {
                "sunrise": sol.get("rise") or _hhmm(dcol("sunrise", fecha)),
                "sunset": sol.get("set") or _hhmm(dcol("sunset", fecha)),
                "moonrise": luna.get("rise") or "",
                "moonset": luna.get("set") or "",
                "moon_phase": _fase_luna_en(_num(luna.get("illumination")), luna.get("waxing")),
                "moon_illumination": int(_num(luna.get("illumination")) or 0),
            }
        else:
            tmax, tmin = fc_max, fc_min
            # El firmware solo lee `astro` del día 0; en los siguientes se manda el sol
            # de Open-Meteo por completitud y la luna vacía.
            astro = {
                "sunrise": _hhmm(dcol("sunrise", fecha)),
                "sunset": _hhmm(dcol("sunset", fecha)),
                "moonrise": "", "moonset": "",
                "moon_phase": "", "moon_illumination": 0,
            }

        forecastday.append({
            "date": fecha,
            "day": {
                "maxtemp_c": tmax,
                "mintemp_c": tmin,
                "totalprecip_mm": _num(dcol("precipitation_sum", fecha)),
                "daily_chance_of_rain": _num(dcol("precipitation_probability_max", fecha)) or 0,
                "condition": _condicion(dcol("weather_code", fecha)),
            },
            "astro": astro,
            "hour": horas,
        })

    # ---- xe1e: lo que WeatherAPI no puede dar. El firmware todavía no lo lee (Fase 3),
    # pero viaja ya para no tener que tocar el servidor otra vez.
    p_now = _num(d.get("pressure_relative"))
    tendencia = round(p_now - p_3h, 1) if (p_now is not None and _num(p_3h) is not None) else None
    est = (stats or {}).get("stats") or {}

    xe1e = {
        "source": "estacion" if hay_estacion else "openmeteo",
        "station_time": d.get("received_at"),
        "solar_radiation": _num(d.get("solar_radiation")),
        "rain_event_mm": _num(d.get("rain_event")),
        "rain_rate_mm": _num(d.get("rain_rate")),
        "pressure_trend_3h": tendencia,
        "temp_indoor": _num(d.get("temperature_indoor")),
        "humidity_indoor": _num(d.get("humidity_indoor")),
        "temp_ch1": _num(d.get("temperature_ch1")),
        "humidity_ch1": _num(d.get("humidity_ch1")),
        "wind_gust_max_daily": _num(d.get("wind_gust_max_daily")),
        "temp_max_measured": _num((est.get("temperature_outdoor") or {}).get("max")),
        "temp_min_measured": _num((est.get("temperature_outdoor") or {}).get("min")),
        "imeca": (im or {}).get("imeca") if isinstance(im, dict) else None,
        "imeca_categoria": (im or {}).get("category") if isinstance(im, dict) else None,
        "imeca_dominante": (im or {}).get("dominant") if isinstance(im, dict) else None,
        "forecast_stale": bool(om.get("stale")),
    }

    return {
        "location": location,
        "current": current,
        "forecast": {"forecastday": forecastday},
        "xe1e": xe1e,
        "source": "Estación XE1E (clima.xe1e.net)",
    }
