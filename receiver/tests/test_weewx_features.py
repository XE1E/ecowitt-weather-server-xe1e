"""Tests para las mejoras inspiradas en WeeWX: calibración, QC, derivados, pronóstico."""

from types import SimpleNamespace

from app.services.calibration import apply_calibration
from app.services.quality import quality_check
from app.services.converter import calculate_derived_values, calculate_humidex, calculate_cloud_base
from app.services.forecaster import local_forecast, classify_trend
from app.services.publishers import build_cwop_packet, _aprs_lat, _aprs_lon
from app.services.aggregator import (
    local_day_bounds_utc, flatten_stats, all_time_records,
    period_summary, monthly_records, noaa_month, noaa_year, build_records,
)
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


# ---------- Acumuladores / resumen diario ----------
def test_local_day_bounds_utc():
    # CDMX es UTC-6: el día local 2026-07-08 empieza a las 06:00Z y dura 24 h
    start, stop, start_dt = local_day_bounds_utc(datetime(2026, 7, 8))
    assert start == "2026-07-08T06:00:00Z"
    assert stop == "2026-07-09T06:00:00Z"


def test_flatten_stats():
    stats = {"stats": {
        "temperature_outdoor": {"min": 12.0, "max": 24.0, "avg": 18.0,
                                "min_time": "t1", "max_time": "t2"},
        "wind_gust": {"min": 0, "max": 30.0, "avg": 10, "max_time": "tg"},
        "rain_daily": {"min": 0, "max": 6.2, "avg": 3},
    }}
    f = flatten_stats(stats)
    assert f["temp_min"] == 12.0 and f["temp_max"] == 24.0
    assert f["temp_max_time"] == "t2"
    assert f["gust_max"] == 30.0
    assert f["rain_total"] == 6.2
    assert "hum_min" not in f  # sin datos de humedad -> no aparece


def test_all_time_records():
    rows = [
        {"date": "2026-07-01", "temp_max": 25.0, "temp_min": 10.0, "rain_total": 2.0},
        {"date": "2026-07-02", "temp_max": 28.5, "temp_min": 8.0, "rain_total": 12.0},
        {"date": "2026-07-03", "temp_max": 26.0, "temp_min": 9.0, "rain_total": 0.0},
    ]
    rec = all_time_records(rows)
    assert rec["temp_max"] == {"value": 28.5, "date": "2026-07-02"}
    assert rec["temp_min"] == {"value": 8.0, "date": "2026-07-02"}
    assert rec["rain_max_day"] == {"value": 12.0, "date": "2026-07-02"}
    assert rec["days"] == 3


# ---------- Récords ampliados + NOAA ----------
_SAMPLE = [
    {"date": "2025-07-10", "temp_avg": 19.0, "temp_max": 27.0, "temp_min": 11.0, "rain_total": 5.0, "wind_avg": 7, "wind_max": 14, "gust_max": 20},
    {"date": "2026-06-15", "temp_avg": 20.0, "temp_max": 29.0, "temp_min": 12.0, "rain_total": 0.0, "wind_avg": 8, "wind_max": 16, "gust_max": 25},
    {"date": "2026-07-01", "temp_avg": 18.0, "temp_max": 24.0, "temp_min": 10.0, "rain_total": 12.0, "wind_avg": 6, "wind_max": 12, "gust_max": 18},
    {"date": "2026-07-02", "temp_avg": 22.0, "temp_max": 28.5, "temp_min": 9.0, "rain_total": 0.1, "wind_avg": 9, "wind_max": 18, "gust_max": 30},
]


def test_period_summary():
    s = period_summary(_SAMPLE)
    assert s["days"] == 4
    assert s["high"] == {"value": 29.0, "date": "2026-06-15"}
    assert s["low"] == {"value": 9.0, "date": "2026-07-02"}
    assert s["rain_total"] == 17.1
    assert s["rain_days"] == 2          # 5.0 y 12.0 >= 0.2 (0.0 y 0.1 no)
    assert s["hdd"] > 0                 # temps medias < 18.3 aportan HDD


def test_monthly_records():
    mr = monthly_records(_SAMPLE)
    # julio (7) agrupa 2025-07 y 2026-07
    assert mr[7]["temp_max"]["value"] == 28.5
    assert mr[7]["temp_min"]["value"] == 9.0
    assert mr[6]["temp_max"]["value"] == 29.0  # junio


def test_noaa_month_and_year():
    m = noaa_month(_SAMPLE, 2026, 7)
    assert m["scope"] == "month"
    assert len(m["days"]) == 2
    assert m["days"][0]["date"] == "2026-07-01"
    assert m["summary"]["rain_total"] == 12.1
    y = noaa_year(_SAMPLE, 2026)
    assert y["scope"] == "year"
    assert {mm["month"] for mm in y["months"]} == {6, 7}


def test_build_records_periods():
    b = build_records(_SAMPLE, today=datetime(2026, 7, 3))
    assert b["yesterday"]["date"] == "2026-07-02"
    assert b["this_month"]["days"] == 2          # ambos de 2026-07
    assert b["this_year"]["days"] == 3           # 2026-06 + 2026-07
    assert b["all_time"]["temp_max"]["value"] == 29.0
