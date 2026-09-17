"""Tests del resumen semanal por correo (services/digest.py)."""
from datetime import date, datetime

from app.services.digest import build_weekly_digest, is_due, week_id, week_range


def _row(d, temp_max=None, temp_min=None, temp_avg=None, rain_total=None, gust_max=None):
    row = {"date": d}
    if temp_max is not None:
        row["temp_max"] = temp_max
    if temp_min is not None:
        row["temp_min"] = temp_min
    if temp_avg is not None:
        row["temp_avg"] = temp_avg
    if rain_total is not None:
        row["rain_total"] = rain_total
    if gust_max is not None:
        row["gust_max"] = gust_max
    return row


# ---------- week_range ----------
def test_week_range_excludes_today():
    """El día en curso no tiene resumen todavía (lo escribe el rollup al cerrar)."""
    start, end, days = week_range(date(2026, 9, 22))  # martes
    assert end == "2026-09-21"
    assert start == "2026-09-15"
    assert len(days) == 7
    assert "2026-09-22" not in days


# ---------- week_id / is_due ----------
def test_week_id_format():
    assert week_id(date(2026, 9, 16)) == "2026-W38"


def test_is_due_true_on_configured_day_and_hour():
    now = datetime(2026, 9, 21, 8, 0)  # lunes 21 a las 8am
    assert now.weekday() == 0
    assert is_due(now, weekday=0, hour=7, last_sent_week=None) is True


def test_is_due_false_before_the_hour():
    now = datetime(2026, 9, 21, 6, 0)  # antes de las 7am
    assert is_due(now, weekday=0, hour=7, last_sent_week=None) is False


def test_is_due_false_on_other_weekday():
    now = datetime(2026, 9, 22, 8, 0)  # martes
    assert is_due(now, weekday=0, hour=7, last_sent_week=None) is False


def test_is_due_false_if_already_sent_this_week():
    now = datetime(2026, 9, 21, 9, 0)
    assert is_due(now, weekday=0, hour=7, last_sent_week=week_id(now.date())) is False


def test_is_due_true_again_next_week():
    """No se repite en la MISMA semana, pero sí en la siguiente vuelta al lunes."""
    last_week = week_id(date(2026, 9, 14))  # semana anterior
    now = datetime(2026, 9, 21, 8, 0)
    assert is_due(now, weekday=0, hour=7, last_sent_week=last_week) is True


# ---------- build_weekly_digest ----------
def test_empty_week_gives_no_data_message():
    out = build_weekly_digest([], [], "2026-09-15", "2026-09-21")
    assert "sin datos registrados" in out["body"]
    assert "2026-09-15" in out["subject"] and "2026-09-21" in out["subject"]


def test_extremes_and_dates_reported():
    week = [
        _row("2026-09-15", temp_max=28.0, temp_min=12.0, temp_avg=20.0, rain_total=0.0, gust_max=20.0),
        _row("2026-09-18", temp_max=31.5, temp_min=10.0, temp_avg=22.0, rain_total=5.0, gust_max=45.0),
    ]
    out = build_weekly_digest(week, [], "2026-09-15", "2026-09-21")
    assert "31.5 °C (el 2026-09-18)" in out["body"]
    assert "10.0 °C (el 2026-09-18)" in out["body"]
    assert "45.0 km/h (el 2026-09-18)" in out["body"]
    assert "5.0 mm" in out["body"]


def test_compares_against_previous_week():
    week = [_row("2026-09-18", temp_avg=25.0, rain_total=10.0)]
    prev = [_row("2026-09-11", temp_avg=20.0, rain_total=2.0)]
    out = build_weekly_digest(week, prev, "2026-09-15", "2026-09-21")
    assert "+5.0 °C vs la semana anterior" in out["body"]
    assert "+8.0 mm" in out["body"]


def test_negative_deltas_show_minus_not_double_sign():
    week = [_row("2026-09-18", temp_avg=15.0, rain_total=1.0)]
    prev = [_row("2026-09-11", temp_avg=20.0, rain_total=5.0)]
    out = build_weekly_digest(week, prev, "2026-09-15", "2026-09-21")
    assert "-5.0 °C vs la semana anterior" in out["body"]
    assert "-4.0 mm" in out["body"]
    assert "--" not in out["body"]


def test_best_photo_link_included_when_given():
    week = [_row("2026-09-18", temp_avg=20.0)]
    out = build_weekly_digest(week, [], "2026-09-15", "2026-09-21", best_photo_date="2026-09-17")
    assert "https://clima.xe1e.net/api/camera/best/2026-09-17.jpg" in out["body"]


def test_no_photo_line_when_none_available():
    week = [_row("2026-09-18", temp_avg=20.0)]
    out = build_weekly_digest(week, [], "2026-09-15", "2026-09-21", best_photo_date=None)
    assert "camera/best" not in out["body"]


def test_missing_fields_report_sin_dato_not_crash():
    week = [_row("2026-09-18")]  # sin ningún campo numérico
    out = build_weekly_digest(week, [], "2026-09-15", "2026-09-21")
    assert "sin dato" in out["body"]
