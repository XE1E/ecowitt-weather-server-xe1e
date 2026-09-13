"""Tests for the incoming-rain signal (estaciones vecinas + viento propio)."""

from app.services.forecaster import detect_incoming_rain


def _station(bearing="E", precip_mm=1.0, distance_km=5.0):
    return {"id": "s1", "source": "PWS", "bearing": bearing, "precip_mm": precip_mm,
            "distance_km": distance_km}


def test_detects_rain_when_wind_matches_bearing():
    out = detect_incoming_rain([_station(bearing="E")], wind_dir_deg=90, wind_speed_kph=10, own_rain_rate=0)
    assert out is not None
    assert out["bearing"] == "E"


def test_detects_rain_with_adjacent_bearing():
    # Viento de 90° (E) vs. vecina al NE (45°) -- sectores adyacentes, dentro
    # del margen de +/-45° que da _roughly_from.
    out = detect_incoming_rain([_station(bearing="NE")], wind_dir_deg=90, wind_speed_kph=10, own_rain_rate=0)
    assert out is not None


def test_no_signal_when_bearing_opposite_to_wind():
    # Vecina al oeste, viento viene del este -- el viento se ALEJA de ella.
    out = detect_incoming_rain([_station(bearing="W")], wind_dir_deg=90, wind_speed_kph=10, own_rain_rate=0)
    assert out is None


def test_no_signal_with_calm_wind():
    out = detect_incoming_rain([_station(bearing="E")], wind_dir_deg=90, wind_speed_kph=2, own_rain_rate=0)
    assert out is None


def test_no_signal_when_already_raining_here():
    out = detect_incoming_rain([_station(bearing="E")], wind_dir_deg=90, wind_speed_kph=10, own_rain_rate=1.5)
    assert out is None


def test_no_signal_without_own_wind_data():
    assert detect_incoming_rain([_station()], wind_dir_deg=None, wind_speed_kph=None, own_rain_rate=0) is None


def test_no_signal_when_no_station_has_precip():
    out = detect_incoming_rain([_station(precip_mm=0)], wind_dir_deg=90, wind_speed_kph=10, own_rain_rate=0)
    assert out is None


def test_picks_closest_among_multiple_candidates():
    far = _station(bearing="E", distance_km=20.0)
    near = _station(bearing="E", distance_km=3.0)
    out = detect_incoming_rain([far, near], wind_dir_deg=90, wind_speed_kph=10, own_rain_rate=0)
    assert out is near
