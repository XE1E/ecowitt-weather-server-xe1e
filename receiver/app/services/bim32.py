"""
Adaptador para el firmware BIM32 (ESP32 + Arduino, weather.hpp).

BIM32 ya sabe leer openweathermap.org, weatherbit.io y open-meteo.com como
proveedores de clima, y convierte sus íconos con `Weather::_convertIcon()` a un
vocabulario propio de 8 códigos (1,2,3,4,9,10,11,13,50 — el mismo prefijo que
usan los íconos de OpenWeatherMap). Este endpoint reempaqueta:

- El dato REAL de la estación (temperatura/humedad/presión/viento) para
  `current`, igual que `svitrix.py` — pero sin calidad del aire ni IMECA, que
  BIM32 no usa (esa la trae del BME680 local, por su propia fuente de confort).
- El ícono/descripción de `current` prioriza el análisis visual de la cámara
  (`sky_analyzer.py`, vía `_camera.get_analysis()` en `main.py`) sobre el
  índice de claridad solar de `svitrix._condition()`: de noche no hay
  radiación que medir y ese índice siempre cae en "Despejado", mientras que la
  cámara sí distingue nubes con poca luz. La lluvia medida por la estación
  sigue mandando siempre sobre ambos.
- El pronóstico de Open-Meteo para `daily` (5 días) y `hourly` (muestreo cada
  3 h, hasta 40 puntos), ya recortado y con los mismos nombres de campo que el
  firmware espera.

Los códigos de ícono viajan ya traducidos a ese vocabulario de 8 valores, así
que el firmware no aprende nada nuevo: agrega un proveedor más que llena los
mismos campos que ya llenan OPEN_METEO/WEATHERBIT/OPENWEATHERMAP, en una sola
petición HTTP en vez de dos o tres.

El viento se manda en m/s (`wind_ms`), no en km/h: es la unidad que usa
internamente el firmware para los tres proveedores existentes (OpenWeatherMap
y Open-Meteo se pedían con esa unidad; Weatherbit la da así por defecto). La
estación y Open-Meteo entregan km/h en este servidor, así que aquí se convierte.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import svitrix

_KMH_A_MS = 1.0 / 3.6

# WMO (Open-Meteo) -> código de ícono de 8 valores que ya entiende
# Weather::_convertIcon() (igual que Weather::_openMeteoIcon() en el firmware).
_WMO_ICONO: Dict[int, int] = {
    0: 1, 1: 1,
    2: 2,
    3: 4,
    45: 50, 48: 50,
    51: 10, 53: 10, 55: 10, 56: 10, 57: 10,
    61: 9, 63: 9, 65: 9, 66: 9, 67: 9, 80: 9, 81: 9, 82: 9,
    71: 13, 73: 13, 75: 13, 77: 13, 85: 13, 86: 13,
    95: 11, 96: 11, 99: 11,
}

# Código WeatherAPI (los que devuelve svitrix._condition() a partir del dato
# REAL de la estación) -> el mismo vocabulario de 8 valores.
_WEATHERAPI_A_ICONO: Dict[int, int] = {
    1000: 1, 1003: 2, 1006: 4, 1183: 10, 1189: 10, 1195: 10,
}

_DESCRIPCION_ES: Dict[int, str] = {
    1: "Despejado", 2: "Parcialmente nublado", 4: "Nublado",
    9: "Chubascos", 10: "Lluvia", 11: "Tormenta", 13: "Nieve", 50: "Niebla",
}

# sky_condition del análisis visual de la cámara (ver sky_analyzer.py) -> el mismo
# vocabulario de 8 valores. "night"/"unknown" quedan fuera a propósito: significan
# que el modelo no pudo distinguir nada, así que se cae al criterio solar de abajo.
_SKY_CONDITION_A_ICONO: Dict[str, int] = {
    "clear": 1, "partly_cloudy": 2, "mostly_cloudy": 4, "overcast": 4,
    "foggy": 50, "rainy": 10, "stormy": 11,
}


def _num(v: Any) -> Optional[float]:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _ms(v: Any) -> Optional[float]:
    n = _num(v)
    return round(n * _KMH_A_MS, 1) if n is not None else None


def _icono_wmo(code: Any) -> int:
    try:
        return _WMO_ICONO.get(int(code), 1)
    except (TypeError, ValueError):
        return 1


def _en(arr: Optional[List[Any]], i: int) -> Any:
    return arr[i] if arr and i < len(arr) else None


def _current_de_estacion(d: Dict[str, Any], sun_elev: Optional[float],
                         sky_analysis: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    rr = _num(d.get("rain_rate"))
    icon = None
    if not (rr and rr > 0):
        # Sin lluvia medida (que manda siempre, ver svitrix._condition): preferir lo
        # que la cámara vio sobre el índice de claridad solar, que de noche no tiene
        # con qué juzgar nubosidad y siempre cae en "Despejado".
        icon = _SKY_CONDITION_A_ICONO.get((sky_analysis or {}).get("sky_condition"))
    if icon is None:
        cond = svitrix._condition(d, sun_elev)
        icon = _WEATHERAPI_A_ICONO.get(cond["code"], 1)
    return {
        "temp_c": round(_num(d.get("temperature_outdoor")), 1),
        "humidity": round(_num(d.get("humidity_outdoor")) or 0),
        "pressure_mb": round(_num(d.get("pressure_relative")) or 0, 1),
        "wind_ms": _ms(d.get("wind_speed")) or 0,
        "wind_deg": round(_num(d.get("wind_direction")) or 0),
        "is_day": (1 if sun_elev > 0 else 0) if sun_elev is not None else 1,
        "icon": icon,
        "description": _DESCRIPCION_ES.get(icon, "----"),
    }


def _current_de_pronostico(om: Dict[str, Any]) -> Dict[str, Any]:
    """Respaldo cuando la estación todavía no ha reportado nada: la hora en
    curso del pronóstico, igual que hace epaper.build_forecast_json."""
    h = om.get("hourly") or {}
    icon = _icono_wmo(_en(h.get("weather_code"), 0))
    return {
        "temp_c": _num(_en(h.get("temperature_2m"), 0)),
        "humidity": _num(_en(h.get("relative_humidity_2m"), 0)),
        "pressure_mb": _num(_en(h.get("pressure_msl"), 0)),
        "wind_ms": _ms(_en(h.get("wind_speed_10m"), 0)) or 0,
        "wind_deg": round(_num(_en(h.get("wind_direction_10m"), 0)) or 0),
        "is_day": int(_en(h.get("is_day"), 0) or 1),
        "icon": icon,
        "description": _DESCRIPCION_ES.get(icon, "----"),
    }


def _daily(om: Dict[str, Any], dias: int = 5) -> List[Dict[str, Any]]:
    daily = om.get("daily") or {}
    out = []
    for i in range(dias):
        out.append({
            "day_temp": _num(_en(daily.get("temperature_2m_max"), i)),
            "night_temp": _num(_en(daily.get("temperature_2m_min"), i)),
            "wind_ms": _ms(_en(daily.get("wind_speed_10m_max"), i)),
            "icon": _icono_wmo(_en(daily.get("weather_code"), i)),
        })
    return out


def _hourly(om: Dict[str, Any], maximo: int = 40) -> List[Dict[str, Any]]:
    """Muestrea el horario de Open-Meteo cada 3h desde ahora, igual que hacía
    `Weather::_updateOpenMeteoHourly()` en el firmware — resuelto aquí para que
    el ESP32 ya no tenga que filtrar 144 horas él mismo."""
    hourly = om.get("hourly") or {}
    tiempos = hourly.get("time") or []
    offset = int(om.get("utc_offset_seconds") or 0)
    ahora = int(datetime.now(timezone.utc).timestamp())

    out: List[Dict[str, Any]] = []
    for i, t in enumerate(tiempos):
        if not isinstance(t, str) or len(t) < 16:
            continue
        try:
            epoch = int(datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp()) - offset
        except ValueError:
            continue
        if epoch < ahora:
            continue
        hora_local = datetime.fromtimestamp(epoch + offset, timezone.utc).hour
        if hora_local % 3 != 0:
            continue
        out.append({
            "dt": epoch,
            "temp_c": _num(_en(hourly.get("temperature_2m"), i)),
            "pressure_mb": _num(_en(hourly.get("pressure_msl"), i)),
            "wind_ms": _ms(_en(hourly.get("wind_speed_10m"), i)),
            "wind_deg": round(_num(_en(hourly.get("wind_direction_10m"), i)) or 0),
            "pop": round(_num(_en(hourly.get("precipitation_probability"), i)) or 0),
            "icon": _icono_wmo(_en(hourly.get("weather_code"), i)),
        })
        if len(out) >= maximo:
            break
    return out


def build_bim32(data: Optional[Dict[str, Any]], om: Optional[Dict[str, Any]],
                sun_elev: Optional[float] = None,
                sky_analysis: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """JSON compacto para `Weather::update()`. Función pura: quien llama reúne
    los datos (mismo patrón que `epaper.build_forecast_json`).

    `sky_analysis` es el último resultado de `sky_analyzer.analyze_sky()` (ya
    filtrado por antigüedad por quien llama) -- ver `_current_de_estacion`.
    """
    d = data or {}
    om = om or {}
    hay_estacion = _num(d.get("temperature_outdoor")) is not None
    current = _current_de_estacion(d, sun_elev, sky_analysis) if hay_estacion else _current_de_pronostico(om)
    return {
        "current": current,
        "daily": _daily(om),
        "hourly": _hourly(om),
    }
