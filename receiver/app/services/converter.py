"""
Unit Converter

Converts Ecowitt data from imperial to metric units.
"""

from typing import Dict, Any
import math

# Conversion factors
FAHRENHEIT_TO_CELSIUS = lambda f: (f - 32) * 5 / 9
INHG_TO_HPA = lambda inhg: inhg * 33.8639
INCHES_TO_MM = lambda inches: inches * 25.4
MPH_TO_KMH = lambda mph: mph * 1.60934
MPH_TO_MS = lambda mph: mph * 0.44704


def convert_to_metric(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert all imperial units to metric.

    Conversions:
    - Temperature: °F → °C
    - Pressure: inHg → hPa
    - Rain: inches → mm
    - Wind: mph → km/h

    Args:
        data: Dictionary with imperial units

    Returns:
        Dictionary with metric units
    """
    result = data.copy()

    # Temperature conversions (°F → °C)
    temp_fields = [
        ("temperature_outdoor_f", "temperature_outdoor"),
        ("temperature_indoor_f", "temperature_indoor"),
        ("temperature_1_f", "temperature_1"),
        ("temperature_2_f", "temperature_2"),
        ("temperature_3_f", "temperature_3"),
        ("temperature_4_f", "temperature_4"),
    ]

    for imperial_key, metric_key in temp_fields:
        if imperial_key in result and result[imperial_key] is not None:
            result[metric_key] = round(FAHRENHEIT_TO_CELSIUS(result[imperial_key]), 1)
            del result[imperial_key]

    # Pressure conversions (inHg → hPa)
    pressure_fields = [
        ("pressure_relative_inhg", "pressure_relative"),
        ("pressure_absolute_inhg", "pressure_absolute"),
    ]

    for imperial_key, metric_key in pressure_fields:
        if imperial_key in result and result[imperial_key] is not None:
            result[metric_key] = round(INHG_TO_HPA(result[imperial_key]), 1)
            del result[imperial_key]

    # Rain conversions (inches → mm)
    rain_fields = [
        ("rain_rate_in", "rain_rate"),
        ("rain_event_in", "rain_event"),
        ("rain_hourly_in", "rain_hourly"),
        ("rain_daily_in", "rain_daily"),
        ("rain_weekly_in", "rain_weekly"),
        ("rain_monthly_in", "rain_monthly"),
        ("rain_yearly_in", "rain_yearly"),
        ("rain_total_in", "rain_total"),
    ]

    for imperial_key, metric_key in rain_fields:
        if imperial_key in result and result[imperial_key] is not None:
            result[metric_key] = round(INCHES_TO_MM(result[imperial_key]), 1)
            del result[imperial_key]

    # Wind conversions (mph → km/h)
    wind_fields = [
        ("wind_speed_mph", "wind_speed"),
        ("wind_gust_mph", "wind_gust"),
        ("wind_gust_max_daily_mph", "wind_gust_max_daily"),
    ]

    for imperial_key, metric_key in wind_fields:
        if imperial_key in result and result[imperial_key] is not None:
            result[metric_key] = round(MPH_TO_KMH(result[imperial_key]), 1)
            del result[imperial_key]

    # Calculate derived values
    result = calculate_derived_values(result)

    return result


def calculate_derived_values(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate derived meteorological values.

    Calculates:
    - Dew point
    - Heat index
    - Wind chill
    - Feels like temperature
    """
    result = data.copy()

    temp = result.get("temperature_outdoor")
    humidity = result.get("humidity_outdoor")
    wind_speed = result.get("wind_speed")

    if temp is not None and humidity is not None:
        # Dew point (Magnus formula)
        result["dew_point"] = round(calculate_dew_point(temp, humidity), 1)

        # Heat index (only valid for temp >= 27°C and humidity >= 40%)
        if temp >= 27 and humidity >= 40:
            result["heat_index"] = round(calculate_heat_index(temp, humidity), 1)

    if temp is not None and wind_speed is not None:
        # Wind chill (only valid for temp <= 10°C and wind >= 4.8 km/h)
        if temp <= 10 and wind_speed >= 4.8:
            result["wind_chill"] = round(calculate_wind_chill(temp, wind_speed), 1)

    # Feels like temperature
    if temp is not None:
        result["feels_like"] = round(calculate_feels_like(
            temp,
            humidity or 50,
            wind_speed or 0
        ), 1)

    return result


def calculate_dew_point(temp_c: float, humidity: float) -> float:
    """Calculate dew point using Magnus formula."""
    a = 17.27
    b = 237.7
    alpha = ((a * temp_c) / (b + temp_c)) + math.log(humidity / 100.0)
    return (b * alpha) / (a - alpha)


def calculate_heat_index(temp_c: float, humidity: float) -> float:
    """Calculate heat index (apparent temperature in hot conditions)."""
    # Convert to Fahrenheit for the standard formula
    temp_f = temp_c * 9 / 5 + 32

    hi = -42.379 + 2.04901523 * temp_f + 10.14333127 * humidity
    hi -= 0.22475541 * temp_f * humidity
    hi -= 6.83783e-3 * temp_f ** 2
    hi -= 5.481717e-2 * humidity ** 2
    hi += 1.22874e-3 * temp_f ** 2 * humidity
    hi += 8.5282e-4 * temp_f * humidity ** 2
    hi -= 1.99e-6 * temp_f ** 2 * humidity ** 2

    # Convert back to Celsius
    return (hi - 32) * 5 / 9


def calculate_wind_chill(temp_c: float, wind_kmh: float) -> float:
    """Calculate wind chill (apparent temperature in cold/windy conditions)."""
    # Environment Canada formula
    return 13.12 + 0.6215 * temp_c - 11.37 * (wind_kmh ** 0.16) + 0.3965 * temp_c * (wind_kmh ** 0.16)


def calculate_feels_like(temp_c: float, humidity: float, wind_kmh: float) -> float:
    """
    Calculate feels-like temperature.

    Uses heat index for hot weather and wind chill for cold weather.
    """
    if temp_c >= 27 and humidity >= 40:
        return calculate_heat_index(temp_c, humidity)
    elif temp_c <= 10 and wind_kmh >= 4.8:
        return calculate_wind_chill(temp_c, wind_kmh)
    else:
        return temp_c
