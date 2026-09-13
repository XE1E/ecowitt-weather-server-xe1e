"""Tests for the nearby-stations quality filter (Netatmo)."""

from app.services.netatmo import (
    _normalize, _clean_pressure, _station_trend, _bearing_compass, _haversine_km, _TREND_HIST,
)

OUR_LAT, OUR_LON = 19.380359, -99.174564


def _raw(pressure=1013.6, temp=15.0, humidity=60, wind_strength=10.0, wind_angle=180,
         station_id="70:ee:50:aa:bb:cc", lat=19.41, lon=-99.17, ts=1700000000, with_wind=True,
         rain_live=None):
    measures = {
        "02:00:00:aa:bb:cc": {"type": ["temperature", "humidity"], "res": {str(ts): [temp, humidity]}},
        station_id: {"type": ["pressure"], "res": {str(ts): [pressure]}},
    }
    if with_wind:
        measures["03:00:00:aa:bb:cc"] = {
            "type": ["wind_strength", "wind_angle", "gust_strength", "gust_angle"],
            "res": {str(ts): [wind_strength, wind_angle, wind_strength + 5, wind_angle]},
        }
    if rain_live is not None:
        measures["04:00:00:aa:bb:cc"] = {
            "type": ["rain_live", "rain_60min", "rain_24h"],
            "res": {str(ts): [rain_live, rain_live * 2, rain_live * 5]},
        }
    return {"_id": station_id, "place": {"location": [lon, lat]}, "measures": measures}


def test_normalize_combines_modules_into_one_station():
    out = _normalize(_raw(), OUR_LAT, OUR_LON, now=0.0)
    assert out is not None
    assert out["id"] == "netatmo:70:ee:50:aa:bb:cc"
    assert out["source"] == "NETATMO"
    assert out["temp_c"] == 15.0
    assert out["humidity"] == 60
    assert out["pressure_mb"] == 1013.6
    assert out["wind_speed_kph"] == 10.0
    assert out["wind_dir_deg"] == 180
    assert out["distance_km"] > 0
    assert out["bearing"] in {"N", "NE", "E", "SE", "S", "SW", "W", "NW"}
    assert out["observed_at"] is not None


def test_normalize_works_without_wind_module():
    out = _normalize(_raw(with_wind=False), OUR_LAT, OUR_LON, now=0.0)
    assert out is not None
    assert out["wind_speed_kph"] is None
    assert out["wind_dir_deg"] is None


def test_normalize_extracts_rain_when_module_present():
    out = _normalize(_raw(rain_live=1.2), OUR_LAT, OUR_LON, now=0.0)
    assert out is not None
    assert out["precip_mm"] == 1.2


def test_normalize_precip_none_without_rain_module():
    out = _normalize(_raw(), OUR_LAT, OUR_LON, now=0.0)
    assert out is not None
    assert out["precip_mm"] is None


def test_normalize_drops_implausible_pressure():
    # Mismo bug visto con Xweather/GW1100: presión absoluta cruda sin
    # corregir a nivel del mar (ver PLAN-ESTACIONES-VECINAS.md).
    out = _normalize(_raw(pressure=771.0), OUR_LAT, OUR_LON, now=0.0)
    assert out is not None
    assert out["pressure_mb"] is None
    assert out["temp_c"] == 15.0  # el resto del dato se conserva


def test_normalize_none_without_location():
    raw = _raw()
    raw["place"] = {}
    assert _normalize(raw, OUR_LAT, OUR_LON, now=0.0) is None


def test_normalize_none_without_any_measures():
    raw = _raw()
    raw["measures"] = {}
    assert _normalize(raw, OUR_LAT, OUR_LON, now=0.0) is None


def test_clean_pressure_boundary_values():
    assert _clean_pressure(950.0) == 950.0
    assert _clean_pressure(1050.0) == 1050.0
    assert _clean_pressure(949.9) is None
    assert _clean_pressure(1050.1) is None


def test_bearing_compass_cardinal_directions():
    # Un punto directamente al norte/este/sur/oeste de nuestra estación.
    assert _bearing_compass(0.0, 0.0, 1.0, 0.0) == "N"
    assert _bearing_compass(0.0, 0.0, 0.0, 1.0) == "E"
    assert _bearing_compass(0.0, 0.0, -1.0, 0.0) == "S"
    assert _bearing_compass(0.0, 0.0, 0.0, -1.0) == "W"


def test_haversine_km_zero_for_same_point():
    assert _haversine_km(OUR_LAT, OUR_LON, OUR_LAT, OUR_LON) == 0.0


# --- Tendencia por estación vecina (mismo mecanismo que xweather.py) ---

_H = 3600.0


def test_station_trend_none_without_enough_history():
    _TREND_HIST.pop("NETATMO_NEW", None)
    assert _station_trend("NETATMO_NEW", 0.0, 1020.0) is None


def test_station_trend_computes_delta_over_3h_window():
    _TREND_HIST.pop("NETATMO_TREND", None)
    _station_trend("NETATMO_TREND", 0.0, 1020.0)
    assert _station_trend("NETATMO_TREND", 3 * _H, 1017.0) == -3.0
