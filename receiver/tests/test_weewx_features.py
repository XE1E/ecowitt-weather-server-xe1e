"""Tests para las mejoras inspiradas en WeeWX: calibración, QC, derivados, pronóstico."""

from types import SimpleNamespace

from app.services.calibration import apply_calibration
from app.services.quality import quality_check
from app.services.converter import calculate_derived_values, calculate_humidex, calculate_cloud_base
from app.services.forecaster import local_forecast, classify_trend
from app.services.publishers import build_cwop_packet, _aprs_lat, _aprs_lon
from datetime import datetime


# ---------- Calibración ----------
def _cal_settings(**kw):
    base = dict(cal_enabled=True, cal_temp_offset=0.0, cal_humidity_offset=0.0,
                cal_pressure_offset=0.0, cal_wind_mult=1.0, cal_rain_mult=1.0)
    base.update(kw)
    return SimpleNamespace(**base)


def test_calibration_disabled_is_noop():
    s = _cal_settings(cal_enabled=False, cal_temp_offset=5.0)
    data = {"temperature_outdoor": 20.0}
    assert apply_calibration(data, s)["temperature_outdoor"] == 20.0


def test_calibration_temp_offset():
    s = _cal_settings(cal_temp_offset=-0.5)
    out = apply_calibration({"temperature_outdoor": 20.0, "temperature_ch1": 18.0}, s)
    assert out["temperature_outdoor"] == 19.5
    assert out["temperature_ch1"] == 17.5


def test_calibration_wind_mult_and_humidity_clamp():
    s = _cal_settings(cal_wind_mult=1.1, cal_humidity_offset=20.0)
    out = apply_calibration({"wind_speed": 10.0, "humidity_outdoor": 95.0}, s)
    assert out["wind_speed"] == 11.0
    assert out["humidity_outdoor"] == 100.0  # clamp a 100


# ---------- Control de calidad ----------
def test_qc_rejects_out_of_range():
    s = SimpleNamespace(qc_enabled=True)
    data = {"temperature_outdoor": 150.0, "humidity_outdoor": 55.0}
    out, rejected = quality_check(data, s)
    assert out["temperature_outdoor"] is None
    assert out["humidity_outdoor"] == 55.0
    assert ("temperature_outdoor", 150.0) in rejected


def test_qc_disabled_keeps_everything():
    s = SimpleNamespace(qc_enabled=False)
    data = {"temperature_outdoor": 999.0}
    out, rejected = quality_check(data, s)
    assert out["temperature_outdoor"] == 999.0
    assert rejected == []


# ---------- Variables derivadas ----------
def test_humidex_and_cloud_base():
    # Humidex > temperatura cuando hay humedad
    assert calculate_humidex(30.0, 20.0) > 30.0
    # Base de nubes ~125 m por °C de spread
    assert abs(calculate_cloud_base(25.0, 15.0) - 1250.0) < 1.0
    assert calculate_cloud_base(20.0, 25.0) == 0.0  # spread negativo -> 0


def test_derived_values_include_new_fields():
    out = calculate_derived_values({"temperature_outdoor": 30.0, "humidity_outdoor": 60.0})
    assert "dew_point" in out
    assert "humidex" in out
    assert "cloud_base" in out


# ---------- Pronóstico local ----------
def test_trend_classification():
    assert classify_trend(-4.0)["code"] == "falling_fast"
    assert classify_trend(0.0)["code"] == "steady"
    assert classify_trend(2.0)["code"] == "rising"
    assert classify_trend(None)["code"] == "unknown"


def test_local_forecast_rising_high():
    fc = local_forecast(1025.0, 1020.0)
    assert fc["available"] is True
    assert fc["level"] == "high"
    assert fc["trend"]["code"] in ("rising", "rising_fast")
    assert "mejor" in fc["forecast"].lower() or "buen" in fc["forecast"].lower()


def test_local_forecast_no_pressure():
    assert local_forecast(None, None)["available"] is False


# ---------- CWOP / APRS ----------
def test_aprs_coordinate_formatting():
    assert _aprs_lat(19.380359) == "1922.82N"
    assert _aprs_lon(-99.174564) == "09910.47W"


def test_cwop_packet_structure():
    data = {
        "wind_direction": 180, "wind_speed": 16.0, "wind_gust": 24.0,
        "temperature_outdoor": 20.0, "humidity_outdoor": 55.0,
        "pressure_relative": 1013.2, "rain_hourly": 2.54, "rain_daily": 5.08,
    }
    pkt = build_cwop_packet("XE1E", 19.380359, -99.174564, data, datetime(2026, 7, 8, 13, 5))
    assert pkt.startswith("XE1E>APRS,TCPIP*:@081305z")
    assert "1922.82N/09910.47W_" in pkt
    assert "t068" in pkt          # 20°C -> 68°F
    assert "h55" in pkt
    assert "b10132" in pkt        # 1013.2 hPa -> décimas
    assert "r010" in pkt          # 2.54 mm -> 0.1 in -> 10 centésimas
