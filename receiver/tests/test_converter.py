"""Tests for unit converter."""

import pytest
from app.services.converter import (
    convert_to_metric,
    calculate_dew_point,
    calculate_feels_like
)


def test_fahrenheit_to_celsius():
    """Test temperature conversion."""
    data = {"temperature_outdoor_f": 77.0}
    result = convert_to_metric(data)
    assert "temperature_outdoor" in result
    assert abs(result["temperature_outdoor"] - 25.0) < 0.1


def test_inches_to_mm():
    """Test rain conversion."""
    data = {"rain_daily_in": 1.0}
    result = convert_to_metric(data)
    assert "rain_daily" in result
    assert abs(result["rain_daily"] - 25.4) < 0.1


def test_mph_to_kmh():
    """Test wind speed conversion."""
    data = {"wind_speed_mph": 10.0}
    result = convert_to_metric(data)
    assert "wind_speed" in result
    assert abs(result["wind_speed"] - 16.09) < 0.1


def test_wind_avg10m_mph_to_kmh():
    """El promedio de 10 min se convierte como el resto de las velocidades.

    El WS2910 no lo manda (es del protocolo Wunderground), pero si un
    dispositivo lo reporta debe llegar en km/h como wind_speed, no crudo en mph.
    """
    data = {"wind_speed_avg10m_mph": 10.0}
    result = convert_to_metric(data)
    assert "wind_speed_avg10m" in result
    assert abs(result["wind_speed_avg10m"] - 16.09) < 0.1


def test_inhg_to_hpa():
    """Test pressure conversion."""
    data = {"pressure_relative_inhg": 29.92}
    result = convert_to_metric(data)
    assert "pressure_relative" in result
    assert abs(result["pressure_relative"] - 1013.25) < 1.0


def test_dew_point_calculation():
    """Test dew point calculation."""
    dew_point = calculate_dew_point(25.0, 60.0)
    assert abs(dew_point - 16.7) < 0.5


def test_feels_like_hot():
    """Test feels like in hot conditions."""
    feels = calculate_feels_like(35.0, 70.0, 5.0)
    assert feels > 35.0  # Should feel hotter due to humidity


def test_feels_like_cold():
    """Test feels like in cold conditions."""
    feels = calculate_feels_like(5.0, 50.0, 20.0)
    assert feels < 5.0  # Should feel colder due to wind


def test_vpd_is_converted_to_kpa():
    """El VPD llega del gateway en inHg y debe salir en kPa.

    Sin la conversión se guardaba en InfluxDB en imperial —con todo lo demás en
    métrico— y se publicaba así por MQTT: 2.73 kPa reales se veían como "0.81".
    """
    from app.services.parser import parse_ecowitt_data

    parsed = parse_ecowitt_data({"vpd": "0.807", "tempf": "83.5"})
    assert parsed["vpd_inhg"] == 0.807          # el parser lo marca como imperial
    out = convert_to_metric(parsed)
    assert "vpd_inhg" not in out                # y el converter lo consume
    assert abs(out["vpd"] - 2.733) < 0.01       # 0.807 inHg = 2.73 kPa


def test_gateway_diagnostics_are_not_measurements():
    """runtime/heap/interval son diagnóstico del datalogger, no medidas.

    Se escribían como campos de InfluxDB y se publicaban por MQTT junto a la
    temperatura.
    """
    from app.services.parser import parse_ecowitt_data, get_fields

    parsed = parse_ecowitt_data({
        "tempf": "83.5", "runtime": "695678", "heap": "22600", "interval": "60",
    })
    fields = get_fields(parsed)
    assert "temperature_outdoor_f" in fields
    for k in ("runtime", "heap", "interval"):
        # Ni en InfluxDB, ni en el dict en memoria: ese alimenta /api/current y el
        # payload de MQTT, así que excluirlos solo de get_fields no bastaba.
        assert k not in fields, f"{k} no debería escribirse como medición"
        assert k not in parsed, f"{k} no debería llegar a /api/current ni a MQTT"
