"""Tests para webcam_overlay.build_webcam_jpeg (cintillo de datos para AWEKAS/Weathercloud)."""
import io

from PIL import Image

from app.services.webcam_overlay import (
    build_webcam_jpeg, build_webcam_wide_jpeg, CANVAS_W, CANVAS_H, WIDE_W, WIDE_H, _compass_es,
)


def _fake_photo(w, h, color=(120, 140, 180)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG")
    return buf.getvalue()


_WEATHER = {
    "temperature_outdoor": 15.4,
    "humidity_outdoor": 80.0,
    "pressure_relative": 1028.3,
    "rain_rate": 0.0,
    "rain_24h": 2.3,
    "wind_speed": 12.0,
    "wind_direction": 186,
    "solar_radiation": 320.0,
    "uv_index": 4,
}


def test_output_is_exact_canvas_size():
    jpeg = build_webcam_jpeg(_fake_photo(1600, 904), _WEATHER)
    im = Image.open(io.BytesIO(jpeg))
    assert im.size == (CANVAS_W, CANVAS_H)


def test_output_is_valid_jpeg():
    jpeg = build_webcam_jpeg(_fake_photo(1600, 904), _WEATHER)
    im = Image.open(io.BytesIO(jpeg))
    assert im.format == "JPEG"


def test_handles_16_9_photo_without_cropping():
    # 1600x904 (16:9) a 800 de ancho da 452 de alto -- bastante margen sobre
    # MIN_BANNER_H (110), así que no debería recortarse nada.
    jpeg = build_webcam_jpeg(_fake_photo(1600, 904, color=(0, 255, 0)), _WEATHER)
    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    # A media altura de la foto (bien lejos del cintillo) debe seguir verde.
    assert im.getpixel((CANVAS_W // 2, 200))[1] > 200


def test_handles_near_square_photo_by_cropping_not_shrinking_banner():
    # Una foto casi cuadrada dejaría menos de MIN_BANNER_H libres si se
    # respetara el aspecto -- debe recortarse la foto, no encoger el cintillo.
    jpeg = build_webcam_jpeg(_fake_photo(800, 700), _WEATHER)
    im = Image.open(io.BytesIO(jpeg))
    assert im.size == (CANVAS_W, CANVAS_H)


def test_missing_weather_fields_render_placeholder_not_crash():
    jpeg = build_webcam_jpeg(_fake_photo(1600, 904), {})
    im = Image.open(io.BytesIO(jpeg))
    assert im.size == (CANVAS_W, CANVAS_H)


def test_compass_es_matches_weather_ts_alphabet():
    # Mismo alfabeto que weather.ts::cardinal() (N/NE/E/SE/S/SO/O/NO), no el
    # inglés (SW/W/NW) que usan xweather.py/netatmo.py para las vecinas.
    assert _compass_es(0) == "N"
    assert _compass_es(90) == "E"
    assert _compass_es(180) == "S"
    assert _compass_es(225) == "SO"
    assert _compass_es(270) == "O"
    assert _compass_es(315) == "NO"


def test_compass_es_none_is_placeholder():
    assert _compass_es(None) == "--"


def test_wide_is_exact_16_9_for_any_photo():
    # Windy recorta lo que no sea 16:9: la salida debe ser SIEMPRE 1600x900,
    # venga la foto 16:9 casi exacta, 4:3 o más panorámica.
    for w, h in ((1600, 904), (1280, 960), (2000, 800)):
        im = Image.open(io.BytesIO(build_webcam_wide_jpeg(_fake_photo(w, h), _WEATHER)))
        assert im.size == (WIDE_W, WIDE_H) == (1600, 900)


def test_wide_keeps_photo_visible_above_banner():
    # El cintillo va superpuesto abajo; arriba debe verse la foto tal cual.
    im = Image.open(io.BytesIO(build_webcam_wide_jpeg(_fake_photo(1600, 904, (200, 30, 30)), _WEATHER)))
    r, g, b = im.getpixel((800, 300))
    assert r > 150 and g < 80 and b < 80


def test_wide_missing_weather_does_not_crash():
    im = Image.open(io.BytesIO(build_webcam_wide_jpeg(_fake_photo(1600, 904), {})))
    assert im.size == (1600, 900)
