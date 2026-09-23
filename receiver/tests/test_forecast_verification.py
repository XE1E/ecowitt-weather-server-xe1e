"""Tests de la verificación de pronósticos contra lo observado."""

from datetime import datetime, timedelta, timezone

from app.services import forecast_verification as fv

TZ = timezone(timedelta(hours=-6))  # CDMX sin horario de verano; no depende de tzdata
T0 = datetime(2026, 9, 20, 18, 0, tzinfo=timezone.utc)  # 12:00 en CDMX


def _rain_series(hours=12, wet=()):
    """rain_total cada 10 min; `wet` = índices de muestra en los que cae 0.5 mm."""
    out, acc = [], 0.0
    for i in range(hours * 6 + 1):
        if i in wet:
            acc += 0.5
        out.append((T0 + timedelta(minutes=10 * i), acc))
    return out


def test_rain_index_between_and_threshold():
    rain = fv.RainIndex(_rain_series(wet={6}))  # cae entre la muestra 5 y la 6 (T0+1h)
    assert rain.between(T0, T0 + timedelta(hours=1)) == 0.5
    assert rain.between(T0 + timedelta(hours=1), T0 + timedelta(hours=2)) == 0.0
    assert rain.rained(T0 + timedelta(minutes=30), T0 + timedelta(minutes=90))


def test_rain_index_ignores_yearly_reset():
    series = [(T0, 380.0), (T0 + timedelta(minutes=10), 0.0), (T0 + timedelta(minutes=20), 0.3)]
    rain = fv.RainIndex(series)
    assert round(rain.between(T0, T0 + timedelta(minutes=20)), 1) == 0.3


def test_contingency_metrics():
    pairs = [(True, True)] * 2 + [(False, True)] + [(True, False)] * 3 + [(False, False)] * 4
    m = fv.contingency(pairs)
    assert (m["hits"], m["misses"], m["false_alarms"], m["correct_negatives"]) == (2, 1, 3, 4)
    assert m["pod"] == 66.7
    assert m["far"] == 60.0
    assert m["csi"] == 33.3
    assert m["accuracy"] == 60.0


def test_contingency_csi_none_with_too_few_events():
    # "Nunca llueve" en días secos: exactitud perfecta pero sin casos de lluvia
    # no hay nada que calificar -- el CSI no debe inventarse un 0 ni un 100.
    m = fv.contingency([(False, False)] * 10)
    assert m["csi"] is None and m["accuracy"] == 100.0


def _entry(minutes, condition="partly_cloudy", fc="partly_cloudy", precip=False, **kw):
    return {"ts": (T0 + timedelta(minutes=minutes)).isoformat(), "condition": condition,
            "forecast_condition": fc, "precip": precip, **kw}


def test_cases_now_scores_both_sources_against_gauge():
    rain = fv.RainIndex(_rain_series(wet={18}))  # lluvia a T0+3h
    entries = [
        _entry(180, condition="rainy", fc="rainy"),   # ambos aciertan
        _entry(360, fc="rainy"),                      # Open-Meteo: falsa alarma
        _entry(420, condition="night", fc="rainy"),   # de noche: se omite
        {"ts": (T0 + timedelta(minutes=450)).isoformat(), "condition": "clear"},  # sin pronóstico
    ]
    cases = fv.cases_now(entries, rain)
    assert len(cases) == 2
    assert cases[0][1] == {"openmeteo": True, "camera": True} and cases[0][2] is True
    assert cases[1][1] == {"openmeteo": True, "camera": False} and cases[1][2] is False


def test_pressure_predictions_detects_falling_trend():
    # 1024 constante 3 h y luego cae 2 hPa en 3 h: "bajando" -> avisa lluvia.
    series = []
    for i in range(37):  # 6 h cada 10 min
        p = 1024.0 if i <= 18 else 1024.0 - (i - 18) * (2.0 / 18)
        series.append((T0 + timedelta(minutes=10 * i), p))
    preds = dict(fv.pressure_predictions(series))
    assert preds[T0 + timedelta(hours=3)] is False
    assert preds[T0 + timedelta(hours=6)] is True


def test_cases_next3h_merges_log_and_skips_open_windows():
    rain = fv.RainIndex(_rain_series(hours=6, wet={20}))  # lluvia a T0+3h20
    snaps = [
        {"ts": (T0 + timedelta(hours=1, seconds=4)).isoformat(),
         "p": {"openmeteo": {"prob": 80, "rain": True}, "smn": {"prob": None, "rain": None}}},
        {"ts": (T0 + timedelta(hours=4)).isoformat(), "p": {"openmeteo": {"rain": True}}},
    ]
    cases = fv.cases_next3h([], snaps, rain)
    # La 2a foto (T0+4h) aún no cumple sus 3 h dentro de los datos: no se califica.
    assert len(cases) == 1
    t, preds, obs = cases[0]
    assert t == T0 + timedelta(hours=1)
    assert preds == {"openmeteo": True}  # SMN sin dato no cuenta como "no llueve"
    assert obs is True


def test_summarize_ranks_by_csi_not_accuracy():
    # A: nunca avisa (exactitud alta, CSI nulo). B: avisa todas las lluvias con
    # algunas falsas alarmas. B debe quedar arriba.
    cases = []
    for i in range(20):
        obs = i < 4
        cases.append((T0 + timedelta(hours=i), {"a": False, "b": obs or i in (4, 5)}, obs))
    out = fv.summarize(cases, ("a", "b"), TZ)
    assert [r["key"] for r in out["ranking"]] == ["b", "a"]
    assert out["observed_pct"] == 20.0
    assert out["by_hour"] and "predicted_pct" in out["by_hour"][0]
    assert out["trend"][-1]["csi"]["b"] == 66.7


def test_sky_summary_bias_and_steps():
    entries = [
        _entry(0, condition="clear", fc="overcast", coverage=10, forecast_coverage_pct=90),
        _entry(10, condition="partly_cloudy", fc="partly_cloudy", coverage=40, forecast_coverage_pct=50),
        _entry(20, condition="rainy", fc="overcast"),          # desacuerdo de lluvia
        _entry(30, condition="night", fc="clear"),             # noche: fuera
    ]
    s = fv.sky_summary(entries)
    assert s["n"] == 2
    assert s["steps"] == {"0": 1, "1": 0, "2+": 1}
    assert s["coverage_bias_pct"] == 45.0
    assert s["rain_disagreements"] == 1


def test_max_prob_next_hours_window():
    now = datetime(2026, 9, 20, 14, 25)
    times = [f"2026-09-20T{h:02d}:00" for h in range(12, 20)]
    probs = [90, 90, 10, 20, 60, 30, 95, 95]
    # Ventana: 14, 15, 16, 17 -> máximo 60 (ni las 13 ni las 18 cuentan).
    assert fv.max_prob_next_hours(times, probs, now) == 60
    assert fv.prob_prediction(60) == {"prob": 60, "rain": True}
    assert fv.prob_prediction(None) == {"prob": None, "rain": None}


def test_forecast_log_roundtrip_and_prune(tmp_path):
    log = fv.ForecastLog(str(tmp_path), TZ, retention_days=2)
    old = datetime(2026, 9, 1, 18, 0, tzinfo=timezone.utc)
    log.append({"ts": old.isoformat(), "p": {}}, now=old)
    now = datetime(2026, 9, 20, 18, 0, tzinfo=timezone.utc)
    log.append({"ts": now.isoformat(), "p": {"own": {"rain": False}}}, now=now)
    assert log.first_day() == "2026-09-20"  # el viejo se podó
    assert len(log.read_range(3, now=now)) == 1
