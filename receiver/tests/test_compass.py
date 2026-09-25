"""Rumbo cardinal común (services/compass.py): mismos resultados que las tablas
que tenía cada servicio."""
from app.services import compass


def test_eight_points_in_both_languages():
    assert [compass.point(d) for d in (0, 44, 46, 90, 180, 225, 270, 337.4, 359)] == \
        ["N", "NE", "NE", "E", "S", "SW", "W", "NW", "N"]
    assert compass.point(225, compass.ES8) == "SO" and compass.point(270, compass.ES8) == "O"


def test_sixteen_points_and_edges():
    assert compass.point(22.5, compass.EN16) == "NNE"
    assert compass.point(191.25, compass.EN16) in ("S", "SSW")
    assert compass.point(-10, compass.EN16) == "N"
    assert compass.point(None) is None
