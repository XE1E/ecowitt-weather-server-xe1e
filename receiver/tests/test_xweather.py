"""Tests for the nearby-stations quality filter (Xweather)."""

from app.services.xweather import _normalize, _clean_pressure


def _raw(pressure_mb=1013.0, altimeter_mb=None, trust=100, station_id="PWS_TEST"):
    ob = {
        "dateTimeISO": "2026-09-13T00:45:00-06:00",
        "tempC": 15.0,
        "humidity": 60,
        "pressureMB": pressure_mb,
        "windSpeedKPH": 10.0,
        "windDirDEG": 180,
        "trustFactor": trust,
    }
    if altimeter_mb is not None:
        ob["altimeterMB"] = altimeter_mb
    return {
        "id": station_id,
        "dataSource": "PWS",
        "relativeTo": {"distanceKM": 5.0, "bearingENG": "NE"},
        "ob": ob,
    }


def test_normalize_prefers_altimeter_over_pressure_mb():
    # Caso real visto en producción: MMMX (METAR del aeropuerto) traía
    # pressureMB=1013 pero altimeterMB=1027 -- la estación propia marcaba
    # 1027.3, casi idéntica al QNH (altimeterMB), nada parecida a la
    # "reducida a nivel del mar" (pressureMB). Ver PLAN-ESTACIONES-VECINAS.md.
    out = _normalize(_raw(pressure_mb=1013.0, altimeter_mb=1027.0))
    assert out is not None
    assert out["pressure_mb"] == 1027.0


def test_normalize_falls_back_to_pressure_mb_without_altimeter():
    # Algunas PWS no reportan altimeterMB -- cae a pressureMB en vez de
    # quedarse sin dato.
    out = _normalize(_raw(pressure_mb=1013.0, altimeter_mb=None))
    assert out is not None
    assert out["pressure_mb"] == 1013.0


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
