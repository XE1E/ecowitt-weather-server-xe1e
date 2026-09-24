"""Lectura de dBZ del radar SACMEX a partir de colores, sobre imágenes sintéticas."""
import numpy as np

from app.services import radar_decode as rd


def _mapa():
    rng = np.random.default_rng(0)
    bg = rng.integers(200, 240, size=(rd.IMG_H, rd.IMG_W, 3)).astype(np.int32)
    bg[300:304, :] = (255, 255, 80)  # "carretera" con el mismo amarillo de 35 dBZ
    return bg


def test_decodes_a_rain_cell_and_ignores_the_map_and_speckles():
    bg = _mapa()
    frame = bg.copy()
    frame[100:120, 200:230] = (0, 255, 0)     # celda de 25 dBZ
    frame[150:153, 150:170] = (255, 127, 0)   # banda de 45 dBZ, 3 px de alto
    frame[200, 200] = (252, 0, 10)            # pixel suelto: ruido
    z = rd.decode(frame, bg)
    assert (z[100:120, 200:230] == 25).all()
    assert (z[150:153, 150:170] == 45).all()
    assert z[200, 200] == rd.NO_ECHO
    assert (z[300:304] == rd.NO_ECHO).all()   # la carretera está en el fondo
    assert (z == rd.NO_ECHO).sum() == z.size - 20 * 30 - 3 * 20


def test_background_is_the_median_so_a_passing_echo_does_not_stick():
    bg = _mapa()
    frames = [bg.copy() for _ in range(5)]
    frames[0][10:20, 10:20] = (0, 128, 0)
    frames[1][10:20, 10:20] = (0, 128, 0)
    assert (rd.background(frames) == bg).all()


def test_max_near_reads_the_echo_over_a_point():
    z = np.full((rd.IMG_H, rd.IMG_W), rd.NO_ECHO, dtype=np.int16)
    x, y = rd.to_px(19.380359, -99.174564)
    z[int(y) - 1:int(y) + 2, int(x) - 1:int(x) + 2] = 40
    assert rd.max_near(z, 19.380359, -99.174564) == 40
    assert rd.max_near(z, 19.2, -99.0) is None


def test_render_paints_echoes_and_leaves_the_rest_transparent():
    z = np.full((4, 4), rd.NO_ECHO, dtype=np.int16)
    z[0, 0] = 50
    img = np.asarray(rd.render(z))
    assert tuple(img[0, 0]) == (252, 0, 10, 255)
    assert img[1, 1, 3] == 0
