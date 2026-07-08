"""
Calibración de lecturas (idea tomada de StdCalibrate de WeeWX).

Aplica correcciones a los valores ya en métrico, antes del control de calidad
y del cálculo de valores derivados. Sirve para corregir sesgos conocidos de un
sensor (p. ej. "mi termómetro lee 0.4 °C de más") sin tocar el hardware.

- Offsets (se suman):  temperatura (°C), humedad (%), presión (hPa)
- Multiplicadores (se escalan): viento, lluvia  (1.0 = sin cambio)

Todos los parámetros son editables en caliente desde el panel de administración.
"""
from typing import Any, Dict
import logging

logger = logging.getLogger(__name__)

# Campos afectados por cada offset/multiplicador
_TEMP_FIELDS = [
    "temperature_outdoor", "temperature_indoor",
    "temperature_ch1", "temperature_ch2", "temperature_ch3", "temperature_ch4",
    "temperature_ch5", "temperature_ch6", "temperature_ch7", "temperature_ch8",
]
_HUMIDITY_FIELDS = ["humidity_outdoor", "humidity_indoor"]
_PRESSURE_FIELDS = ["pressure_relative", "pressure_absolute"]
_WIND_FIELDS = ["wind_speed", "wind_gust", "wind_gust_max_daily"]
_RAIN_FIELDS = [
    "rain_rate", "rain_event", "rain_hourly", "rain_daily",
    "rain_weekly", "rain_monthly", "rain_yearly", "rain_total",
]


def _add_offset(data: Dict[str, Any], fields, offset: float) -> None:
    if not offset:
        return
    for f in fields:
        if data.get(f) is not None:
            data[f] = round(data[f] + offset, 1)


def _mult(data: Dict[str, Any], fields, factor: float) -> None:
    if factor is None or factor == 1.0:
        return
    for f in fields:
        if data.get(f) is not None:
            data[f] = round(data[f] * factor, 1)


def apply_calibration(data: Dict[str, Any], settings) -> Dict[str, Any]:
    """Devuelve una copia calibrada de `data` según los ajustes."""
    if not getattr(settings, "cal_enabled", False):
        return data
    result = data.copy()
    _add_offset(result, _TEMP_FIELDS, getattr(settings, "cal_temp_offset", 0.0) or 0.0)
    _add_offset(result, _HUMIDITY_FIELDS, getattr(settings, "cal_humidity_offset", 0.0) or 0.0)
    _add_offset(result, _PRESSURE_FIELDS, getattr(settings, "cal_pressure_offset", 0.0) or 0.0)
    _mult(result, _WIND_FIELDS, getattr(settings, "cal_wind_mult", 1.0) or 1.0)
    _mult(result, _RAIN_FIELDS, getattr(settings, "cal_rain_mult", 1.0) or 1.0)
    # Clamp de humedad a 0..100 tras el offset
    for f in _HUMIDITY_FIELDS:
        if result.get(f) is not None:
            result[f] = max(0.0, min(100.0, result[f]))
    return result
