"""Tests for the nearby-stations quality filter (Xweather)."""

from app.services.xweather import _normalize, _clean_pressure


def _raw(pressure_mb=1013.0, trust=100, station_id="PWS_TEST"):
    return {
        "id": station_id,
        "dataSource": "PWS",
        "relativeTo": {"distanceKM": 5.0, "bearingENG": "NE"},
        "ob": {
            "dateTimeISO": "2026-09-13T00:45:00-06:00",
            "tempC": 15.0,
            "humidity": 60,
            "pressureMB": pressure_mb,
            "windSpeedKPH": 10.0,
            "windDirDEG": 180,
            "trustFactor": trust,
        },
    }


def test_normalize_keeps_plausible_pressure():
    out = _normalize(_raw(pressure_mb=1013.0))
    assert out is not None
    assert out["pressure_mb"] == 1013.0


def test_normalize_drops_unconverted_absolute_pressure():
    # Caso real visto en producción: PWS con altitud mal configurada manda
    # presión absoluta cruda (~771 hPa en CDMX) en vez de corregida a nivel
    # del mar -- ver PLAN-ESTACIONES-VECINAS.md.
    out = _normalize(_raw(pressure_mb=771.0))
    assert out is not None
    assert out["pressure_mb"] is None
    # El resto de los campos se conserva; solo se descarta la presión mala.
    assert out["temp_c"] == 15.0


def test_normalize_excludes_low_trust_station():
    out = _normalize(_raw(trust=10))
    assert out is None


def test_normalize_keeps_station_without_trust_factor():
    raw = _raw()
    del raw["ob"]["trustFactor"]
    out = _normalize(raw)
    assert out is not None


def test_clean_pressure_none_passthrough():
    assert _clean_pressure(None) is None


def test_clean_pressure_boundary_values():
    assert _clean_pressure(950.0) == 950.0
    assert _clean_pressure(1050.0) == 1050.0
    assert _clean_pressure(949.9) is None
    assert _clean_pressure(1050.1) is None
