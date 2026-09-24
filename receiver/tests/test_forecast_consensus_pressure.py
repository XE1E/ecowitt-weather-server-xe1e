"""La presión ya no avisa lluvia en el consenso (verificada: 13% de acierto a 3 h)."""
from app.services.forecast_consensus import _determine_current, _generate_alerts, pressure_forecast


def test_pressure_falling_fast_is_described_but_not_a_rain_warning():
    out = pressure_forecast(1018.0, 1026.0)  # -8 hPa en 3 h
    assert out["trend"] == "falling_fast"
    assert out["storm_likely"] is False and out["hours_to_rain"] is None
    assert "lluvia" not in out["message"].lower()


def test_pressure_without_history_is_unknown():
    assert pressure_forecast(1020.0, None)["trend"] == "unknown"


def test_current_condition_ignores_pressure_and_uses_forecast():
    falling = {"storm_likely": True, "hours_to_rain": 1}  # aunque llegara marcado
    cur = _determine_current({"rain_rate": 0}, falling, [{"code": 2}])
    assert cur["storm_approaching"] is False
    assert cur["label"] == "Parcialmente nublado"


def test_no_pressure_alert():
    alerts = _generate_alerts({"pressure": {"storm_likely": True, "message": "x"}, "hourly": []})
    assert all(a["type"] != "pressure" for a in alerts)
