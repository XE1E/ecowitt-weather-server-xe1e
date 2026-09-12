"""Tests para las mejoras inspiradas en WeeWX: calibración, QC, derivados, pronóstico."""

from types import SimpleNamespace

from app.services.calibration import apply_calibration
from app.services.quality import quality_check, spike_check, stats_check
from app.services.converter import calculate_derived_values, calculate_humidex, calculate_cloud_base
from app.services.forecaster import local_forecast, classify_trend
from app.services.publishers import build_cwop_packet, _aprs_lat, _aprs_lon
from app.services.aggregator import (
    local_day_bounds_utc, flatten_stats, all_time_records,
    period_summary, monthly_records, noaa_month, noaa_year, build_records,
    on_this_day, et0_hargreaves, daily_et0,
)
from app.services.windrose import compute_wind_rose
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


# ---------- QC estadístico (z-score) ----------
def test_stats_check_disabled_by_default():
    s = SimpleNamespace(qc_stats_enabled=False)
    stats = {"temperature_outdoor": {"mean": 20.0, "stddev": 2.0}}
    out, flagged = stats_check({"temperature_outdoor": 40.0}, stats, s)
    assert out["temperature_outdoor"] == 40.0  # nunca modifica el dato
    assert flagged == []


def test_stats_check_flags_outlier_without_discarding():
    s = SimpleNamespace(qc_stats_enabled=True, qc_stats_z_threshold=5.0)
    # media 20, stddev 2 -> 40°C es z=10, muy por encima del umbral 5
    stats = {"temperature_outdoor": {"mean": 20.0, "stddev": 2.0}}
    out, flagged = stats_check({"temperature_outdoor": 40.0}, stats, s)
    assert out["temperature_outdoor"] == 40.0  # se conserva, no se descarta
    assert flagged == [("temperature_outdoor", 40.0, 10.0)]


def test_stats_check_within_normal_range_not_flagged():
    s = SimpleNamespace(qc_stats_enabled=True, qc_stats_z_threshold=5.0)
    stats = {"temperature_outdoor": {"mean": 20.0, "stddev": 2.0}}
    out, flagged = stats_check({"temperature_outdoor": 24.0}, stats, s)  # z=2
    assert flagged == []


def test_stats_check_skips_near_zero_stddev():
    # Serie casi constante (p. ej. interior climatizado): no debe disparar
    # por variaciones mínimas, aunque el z-score matemático sea enorme.
    s = SimpleNamespace(qc_stats_enabled=True, qc_stats_z_threshold=5.0)
    stats = {"temperature_indoor": {"mean": 22.0, "stddev": 0.01}}
    out, flagged = stats_check({"temperature_indoor": 22.5}, stats, s)
    assert flagged == []


def test_stats_check_no_cache_yet():
    s = SimpleNamespace(qc_stats_enabled=True)
    out, flagged = stats_check({"temperature_outdoor": 999.0}, {}, s)
    assert flagged == []


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


# ---------- Filtro de picos ----------
def test_spike_rejects_impossible_jump():
    s = SimpleNamespace(qc_spike_enabled=True)
    now = datetime(2026, 7, 8, 12, 2, 0)
    prev = {"temperature_outdoor": 20.0, "received_at": "2026-07-08T12:00:00"}
    out, rejected = spike_check({"temperature_outdoor": 45.0}, prev, s, now=now)
    assert out["temperature_outdoor"] is None
    assert ("temperature_outdoor", 45.0, 20.0) in rejected


def test_spike_allows_normal_change():
    s = SimpleNamespace(qc_spike_enabled=True)
    now = datetime(2026, 7, 8, 12, 2, 0)
    prev = {"temperature_outdoor": 20.0, "received_at": "2026-07-08T12:00:00"}
    out, rejected = spike_check({"temperature_outdoor": 21.5}, prev, s, now=now)
    assert out["temperature_outdoor"] == 21.5
    assert rejected == []


def test_spike_skipped_when_previous_is_stale():
    # Lectura previa de hace >15 min: un salto grande puede ser legítimo -> no filtrar
    s = SimpleNamespace(qc_spike_enabled=True)
    now = datetime(2026, 7, 8, 13, 0, 0)
    prev = {"temperature_outdoor": 20.0, "received_at": "2026-07-08T12:00:00"}
    out, rejected = spike_check({"temperature_outdoor": 45.0}, prev, s, now=now)
    assert out["temperature_outdoor"] == 45.0
    assert rejected == []


def test_spike_disabled_or_no_previous():
    off = SimpleNamespace(qc_spike_enabled=False)
    out, rej = spike_check({"temperature_outdoor": 99.0}, {"temperature_outdoor": 20.0, "received_at": "2026-07-08T12:00:00"}, off, now=datetime(2026, 7, 8, 12, 1))
    assert out["temperature_outdoor"] == 99.0 and rej == []
    on = SimpleNamespace(qc_spike_enabled=True)
    out2, rej2 = spike_check({"temperature_outdoor": 99.0}, None, on)
    assert out2["temperature_outdoor"] == 99.0 and rej2 == []


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


def test_derived_values_zero_humidity_no_crash():
    """humidity_outdoor=0.0 pasa quality_check sin filtrarse (rango 0.0-100.0
    inclusive); antes esto tumbaba /data/report/ entero con
    ValueError: math domain error dentro de calculate_dew_point."""
    out = calculate_derived_values({"temperature_outdoor": 20.0, "humidity_outdoor": 0.0})
    assert "dew_point" not in out
    assert "humidex" not in out
    assert "cloud_base" not in out
    # El resto de derivados que no dependen de humedad sigue calculándose
    assert "feels_like" in out


def test_humidex_present_below_20_degrees():
    # Regresión: el medidor "Índice humedad" de Instrumentos se quedaba sin
    # aguja en días frescos (p. ej. 16°C) porque humidex solo se calculaba
    # sobre 20°C -- la fórmula es válida a cualquier temperatura, así que
    # ahora se calcula siempre que haya un punto de rocío válido.
    out = calculate_derived_values({"temperature_outdoor": 16.2, "humidity_outdoor": 87.0})
    assert "humidex" in out
    # A esta temperatura no hay bochorno fuerte: el valor debe quedar
    # razonablemente cerca de la temperatura real, no disparado.
    assert abs(out["humidex"] - 16.2) < 5.0


def test_wind_chill_falls_back_to_temp_outside_valid_range():
    # Regresión: el medidor "Con viento" (Punto de rocío) se quedaba sin
    # aguja casi siempre en CDMX, porque wind_chill exige temp<=10°C Y
    # viento>=4.8 km/h a la vez -- fuera de ese rango ahora cae a la
    # temperatura real (mismo criterio que feels_like), en vez de omitirse.
    out = calculate_derived_values({"temperature_outdoor": 16.2, "wind_speed": 2.2})
    assert out["wind_chill"] == 16.2

    # Sin dato de viento tampoco debe quedar ausente.
    out2 = calculate_derived_values({"temperature_outdoor": 16.2})
    assert out2["wind_chill"] == 16.2


def test_wind_chill_uses_formula_when_conditions_met():
    out = calculate_derived_values({"temperature_outdoor": 5.0, "wind_speed": 20.0})
    # Con frío real y viento fuerte, el chill debe ser menor que la temperatura.
    assert out["wind_chill"] < 5.0


def test_heat_index_falls_back_to_temp_outside_valid_range():
    # Regresión: el "Heat Index" de Weathercloud se quedaba en blanco casi
    # siempre en CDMX (rara vez llega a 27°C+40% humedad a la vez).
    out = calculate_derived_values({"temperature_outdoor": 16.2, "humidity_outdoor": 87.0})
    assert out["heat_index"] == 16.2


def test_heat_index_uses_formula_when_conditions_met():
    out = calculate_derived_values({"temperature_outdoor": 30.0, "humidity_outdoor": 60.0})
    # Con calor y humedad reales, el heat index debe ser mayor que la temperatura.
    assert out["heat_index"] > 30.0


# ---------- Pronóstico local ----------
def test_trend_classification():
    assert classify_trend(-4.0)["code"] == "falling_fast"
    assert classify_trend(0.0)["code"] == "steady"
    assert classify_trend(2.0)["code"] == "rising"
    assert classify_trend(None)["code"] == "unknown"


def test_local_forecast_rising_high():
    # 1032 hPa, no 1025: los umbrales se recalibraron para la CDMX en el commit
    # 115016d (alta >= 1030 en vez de >= 1022, porque a 2240 m la media local ya es
    # 1027 y con el umbral estándar casi todos los días salían "altos"). El test se
    # quedó con el valor viejo y llevaba fallando desde entonces.
    fc = local_forecast(1032.0, 1027.0)
    assert fc["available"] is True
    assert fc["level"] == "high"
    assert fc["trend"]["code"] in ("rising", "rising_fast")
    assert "mejor" in fc["forecast"].lower() or "buen" in fc["forecast"].lower()


def test_local_forecast_cdmx_media_es_normal():
    """La media local (~1027 hPa) tiene que salir NORMAL, que es justo el punto de la
    recalibración: con los umbrales estándar habría salido "alta"."""
    assert local_forecast(1027.0, 1027.0)["level"] == "normal"
    assert local_forecast(1030.0, 1030.0)["level"] == "high"
    assert local_forecast(1023.9, 1023.9)["level"] == "low"


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


def test_period_summary_pressure_extremes():
    """La presion del periodo sale con fecha (`_best`), que es lo que pinta el kiosco."""
    rows = [
        {"date": "2026-07-01", "press_min": 1010.2, "press_max": 1015.0},
        {"date": "2026-07-02", "press_min": 1008.5, "press_max": 1019.4},
    ]
    p = period_summary(rows)
    assert p["press_max"] == {"value": 1019.4, "date": "2026-07-02"}
    assert p["press_min"] == {"value": 1008.5, "date": "2026-07-02"}


def test_on_this_day():
    rows = [
        {"date": "2024-07-10", "temp_max": 26.0, "temp_min": 11.0, "rain_total": 3.0},
        {"date": "2025-07-10", "temp_max": 28.0, "temp_min": 12.0, "rain_total": 8.0},
        {"date": "2026-07-10", "temp_max": 25.0, "temp_min": 10.0, "rain_total": 0.0},  # año en curso, se excluye
        {"date": "2025-07-11", "temp_max": 30.0, "temp_min": 9.0, "rain_total": 0.0},
    ]
    e = on_this_day(rows, today=datetime(2026, 7, 10))
    assert e["month_day"] == "07-10"
    assert e["count"] == 2                       # 2024 y 2025 (no 2026)
    assert e["years"][0]["date"] == "2025-07-10"  # más reciente primero
    assert e["warmest"]["value"] == 28.0


# ---------- Rosa de vientos ----------
def test_wind_rose_sectors():
    recs = [
        {"wind_direction": 0, "wind_speed": 10},    # N
        {"wind_direction": 5, "wind_speed": 20},    # N
        {"wind_direction": 90, "wind_speed": 15},   # E
        {"wind_direction": 180, "wind_speed": 0.2}, # calma (< 1.0)
    ]
    rose = compute_wind_rose(recs)
    assert rose["total"] == 4
    assert rose["calm_pct"] == 25.0
    n = next(s for s in rose["sectors"] if s["label"] == "N")
    assert n["count"] == 2
    assert n["avg_speed"] == 15.0
    assert n["max_speed"] == 20.0
    assert rose["dominant"] == "N"


# ---------- Evapotranspiración (Hargreaves) ----------
def test_et0_hargreaves_reasonable():
    # Día de verano en CDMX (lat 19.4), doy ~190: ET0 típico ~3–6 mm
    et = et0_hargreaves(tmin=12.0, tmax=26.0, tmean=19.0, lat_deg=19.4, doy=190)
    assert 2.0 < et < 8.0
    # Menor rango térmico -> menor ET
    et2 = et0_hargreaves(tmin=17.0, tmax=20.0, tmean=18.5, lat_deg=19.4, doy=190)
    assert et2 < et


def test_period_summary_et_total():
    rows = [
        {"date": "2026-07-01", "temp_min": 12.0, "temp_max": 26.0, "temp_avg": 19.0, "rain_total": 0},
        {"date": "2026-07-02", "temp_min": 13.0, "temp_max": 27.0, "temp_avg": 20.0, "rain_total": 0},
    ]
    s_no_lat = period_summary(rows)
    assert "et_total" not in s_no_lat          # sin lat, no se calcula
    s = period_summary(rows, lat=19.4)
    assert s["et_total"] is not None and s["et_total"] > 0
    assert daily_et0(rows[0], 19.4) is not None
