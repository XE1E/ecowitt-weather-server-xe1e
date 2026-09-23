"""Tests for the nearby-stations quality filter (Xweather)."""

from app.services.xweather import _normalize, _clean_pressure, _station_trend, _TREND_HIST
from app.services.forecaster import zone_trend as _zone_trend


def _raw(pressure_mb=1013.0, altimeter_mb=None, trust=100, station_id="PWS_TEST", precip_mm=None, elev_m=None):
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
    if precip_mm is not None:
        ob["precipMM"] = precip_mm
    raw = {
        "id": station_id,
        "dataSource": "PWS",
        "relativeTo": {"distanceKM": 5.0, "bearingENG": "NE"},
        "ob": ob,
    }
    if elev_m is not None:
        raw["profile"] = {"elevM": elev_m}
    return raw


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


def test_normalize_extracts_precip_mm():
    out = _normalize(_raw(precip_mm=2.5))
    assert out is not None
    assert out["precip_mm"] == 2.5


def test_normalize_precip_mm_none_when_absent():
    out = _normalize(_raw())
    assert out is not None
    assert out["precip_mm"] is None


def test_clean_pressure_none_passthrough():
    assert _clean_pressure(None) is None


def test_clean_pressure_boundary_values():
    assert _clean_pressure(950.0) == 950.0
    assert _clean_pressure(1050.0) == 1050.0
    assert _clean_pressure(949.9) is None
    assert _clean_pressure(1050.1) is None


# --- Fase 2: tendencia por estación vecina + agregado de zona ---

_H = 3600.0  # 1 hora en segundos, para construir historiales en las pruebas


def test_station_trend_none_without_enough_history():
    # Recién visto por primera vez: sin línea base, no hay tendencia todavía
    # (mismo comportamiento que _delta_over_window en alerts.py tras un reinicio).
    _TREND_HIST.pop("PWS_NEW", None)
    assert _station_trend("PWS_NEW", 0.0, 1020.0) is None


def test_station_trend_computes_delta_over_3h_window():
    _TREND_HIST.pop("PWS_TREND", None)
    _station_trend("PWS_TREND", 0.0, 1020.0)  # línea base, sin tendencia aún
    assert _station_trend("PWS_TREND", 3 * _H, 1017.0) == -3.0


def test_station_trend_none_without_pressure():
    _TREND_HIST.pop("PWS_NOPRESS", None)
    assert _station_trend("PWS_NOPRESS", 0.0, None) is None


def test_zone_trend_prefers_metar_over_median():
    stations = [
        {"source": "METAR_NOAA", "pressure_trend_mb": -2.0},
        {"source": "PWS", "pressure_trend_mb": 5.0},
        {"source": "PWS", "pressure_trend_mb": 6.0},
    ]
    out = _zone_trend(stations)
    assert out["reference"] == "metar"
    assert out["delta_mb"] == -2.0
    assert out["trend"]["code"] == "falling"


def test_zone_trend_falls_back_to_median_without_metar():
    stations = [
        {"source": "PWS", "pressure_trend_mb": 1.0},
        {"source": "PWS", "pressure_trend_mb": 4.0},
        {"source": "PWS", "pressure_trend_mb": 5.0},
    ]
    out = _zone_trend(stations)
    assert out["reference"] == "median"
    assert out["delta_mb"] == 4.0


def test_zone_trend_none_without_any_data():
    assert _zone_trend([{"source": "PWS", "pressure_trend_mb": None}])["delta_mb"] is None


def test_normalize_reduces_absolute_pressure_with_known_elevation():
    # Caso real (2026-09-23): PWS_EDELGRIM, elevM=2254.9, altimeterMB=779 --
    # manda la absoluta como si fuera a nivel del mar. Reducida con ISA queda
    # en el rango de la propia (780 hPa a 2243 m -> ~1024).
    out = _normalize(_raw(pressure_mb=761.0, altimeter_mb=779.0, elev_m=2254.9))
    assert out is not None
    assert 1020.0 <= out["pressure_mb"] <= 1028.0


def test_normalize_leaves_sea_level_pressure_untouched_with_elevation():
    out = _normalize(_raw(pressure_mb=1004.0, altimeter_mb=1025.0, elev_m=2238.0))
    assert out["pressure_mb"] == 1025.0


def test_normalize_drops_absolute_pressure_when_elevation_is_low():
    # Sin elevación creíble (p. ej. elevM=36 mal configurada) no se puede
    # reducir: se descarta como antes.
    out = _normalize(_raw(pressure_mb=771.0, elev_m=36.0))
    assert out["pressure_mb"] is None
