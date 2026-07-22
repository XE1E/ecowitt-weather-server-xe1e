"""
Calibración de lecturas (idea tomada de StdCalibrate de WeeWX).

Aplica correcciones a los valores ya en métrico, antes del control de calidad
y del cálculo de valores derivados. Sirve para corregir sesgos conocidos de un
sensor (p. ej. "mi termómetro exterior lee 0.4 °C de más") sin tocar el hardware.

La calibración es POR SENSOR:
- Temperatura/humedad: un offset independiente para exterior, interior y cada
  canal WN31 (ch1..ch8).
- Presión: offset (aplica a relativa y absoluta).
- Viento: multiplicador de velocidad + offset de dirección (alinear veleta).
- Lluvia: multiplicador.
- Solar: multiplicador (ganancia). UV: offset.

Todos los parámetros son editables en caliente desde el panel de administración.
"""
from typing import Any, Dict
import logging

logger = logging.getLogger(__name__)

# Campo de dato -> atributo de settings con su offset (°C)
_TEMP_OFFSETS = {
    "temperature_outdoor": "cal_temp_outdoor",
    "temperature_indoor": "cal_temp_indoor",
    "temperature_ch1": "cal_temp_ch1",
    "temperature_ch2": "cal_temp_ch2",
    "temperature_ch3": "cal_temp_ch3",
    "temperature_ch4": "cal_temp_ch4",
    "temperature_ch5": "cal_temp_ch5",
    "temperature_ch6": "cal_temp_ch6",
    "temperature_ch7": "cal_temp_ch7",
    "temperature_ch8": "cal_temp_ch8",
}
# Campo de dato -> atributo de settings con su offset (%)
_HUM_OFFSETS = {
    "humidity_outdoor": "cal_hum_outdoor",
    "humidity_indoor": "cal_hum_indoor",
    "humidity_ch1": "cal_hum_ch1",
    "humidity_ch2": "cal_hum_ch2",
    "humidity_ch3": "cal_hum_ch3",
    "humidity_ch4": "cal_hum_ch4",
    "humidity_ch5": "cal_hum_ch5",
    "humidity_ch6": "cal_hum_ch6",
    "humidity_ch7": "cal_hum_ch7",
    "humidity_ch8": "cal_hum_ch8",
}
_PRESSURE_FIELDS = ["pressure_relative", "pressure_absolute"]
_WIND_FIELDS = ["wind_speed", "wind_gust", "wind_gust_max_daily"]
_RAIN_FIELDS = [
    "rain_rate", "rain_event", "rain_hourly", "rain_daily",
    "rain_weekly", "rain_monthly", "rain_yearly", "rain_total",
]


def apply_calibration(data: Dict[str, Any], settings, overrides: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Devuelve una copia calibrada de `data` según los ajustes por sensor.

    - `overrides=None` (estación principal): usa la calibración GLOBAL de settings.
    - `overrides={...}` (estación secundaria): usa SU PROPIA calibración de forma
      independiente (no hereda los offsets de la principal). Un dict vacío ⇒ sin
      calibración (cal_enabled por defecto False), que es lo seguro.
    """
    per_station = overrides is not None
    src = overrides or {}

    def g(name: str, default):
        if per_station:
            v = src.get(name, default)
        else:
            v = getattr(settings, name, default)
        return default if v is None else v

    if not g("cal_enabled", False):
        return data
    result = data.copy()

    # Offsets globales legados (compat): solo aplican a la principal.
    g_temp = 0.0 if per_station else g("cal_temp_offset", 0.0)
    g_hum = 0.0 if per_station else g("cal_humidity_offset", 0.0)

    # Temperatura por sensor (+ global legado)
    for field, attr in _TEMP_OFFSETS.items():
        if result.get(field) is not None:
            off = g(attr, 0.0) + g_temp
            if off:
                result[field] = round(result[field] + off, 1)

    # Humedad por sensor (+ global legado), con clamp 0..100
    for field, attr in _HUM_OFFSETS.items():
        if result.get(field) is not None:
            off = g(attr, 0.0) + g_hum
            if off:
                result[field] = round(result[field] + off, 1)
            result[field] = max(0.0, min(100.0, result[field]))

    # Presión (offset a relativa y absoluta)
    p_off = g("cal_pressure_offset", 0.0)
    if p_off:
        for field in _PRESSURE_FIELDS:
            if result.get(field) is not None:
                result[field] = round(result[field] + p_off, 1)

    # Viento: multiplicador de velocidad
    w_mult = g("cal_wind_mult", 1.0)
    if w_mult != 1.0:
        for field in _WIND_FIELDS:
            if result.get(field) is not None:
                result[field] = round(result[field] * w_mult, 1)
    # Viento: offset de dirección (alinear veleta), normalizado 0..359
    d_off = g("cal_wind_dir_offset", 0.0)
    if d_off and result.get("wind_direction") is not None:
        result["wind_direction"] = round((result["wind_direction"] + d_off) % 360)

    # Lluvia: multiplicador
    r_mult = g("cal_rain_mult", 1.0)
    if r_mult != 1.0:
        for field in _RAIN_FIELDS:
            if result.get(field) is not None:
                result[field] = round(result[field] * r_mult, 1)

    # Solar: ganancia; UV: offset (no negativo)
    s_mult = g("cal_solar_mult", 1.0)
    if s_mult != 1.0 and result.get("solar_radiation") is not None:
        result["solar_radiation"] = round(result["solar_radiation"] * s_mult, 1)
    uv_off = g("cal_uv_offset", 0.0)
    if uv_off and result.get("uv_index") is not None:
        result["uv_index"] = max(0, round(result["uv_index"] + uv_off))

    return result
