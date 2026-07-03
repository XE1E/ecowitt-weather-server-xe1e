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
