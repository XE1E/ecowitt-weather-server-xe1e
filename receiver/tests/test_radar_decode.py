"""Lectura de dBZ del radar SACMEX a partir de colores (services/radar_decode.py).

Sintéticas: ecos semitransparentes al 40 % sobre un mapa, como los pinta SACMEX.
Reales: recortes de 120x120 px alrededor de la estación del 2026-09-24, con los que
se afinó el decodificador (18:12, lluvia de 2 mm/h en el pluviómetro; 04:09, eco
disperso de madrugada sin lluvia). Si SACMEX cambia sus colores o el encuadre,
estas pruebas lo delatan.
"""
import os

import numpy as np
from PIL import Image

from app.services import radar_decode as rd

LAT, LON = 19.380359, -99.174564
DATA = os.path.join(os.path.dirname(__file__), "data", "radar")


def _blend(level_idx: int, bg_px: np.ndarray) -> np.ndarray:
    """Color que tendría un eco de ese nivel pintado al 40 % sobre el fondo."""
    return np.round(rd.LEGEND[level_idx] - (1 - rd.ALPHA) * (255 - bg_px)).astype(np.int32)


def _mapa():
    rng = np.random.default_rng(0)
    bg = rng.integers(215, 245, size=(rd.IMG_H, rd.IMG_W, 3)).astype(np.int32)
    bg[300:304, :] = (250, 230, 120)      # "carretera" amarilla, como las del mapa
    return bg


def test_decodes_semitransparent_rain_and_ignores_the_map():
    bg = _mapa()
    frame = bg.copy()
    i25 = int(np.where(rd.LEVELS == 25)[0][0])
    i45 = int(np.where(rd.LEVELS == 45)[0][0])
    frame[80:140, 180:260] = _blend(i25, bg[80:140, 180:260])      # celda de 25 dBZ
    frame[100:120, 200:230] = _blend(i45, bg[100:120, 200:230])    # núcleo de 45 dBZ
    z = rd.decode(frame, bg)
    assert (z[90:95, 190:250] == 25).all()
    assert (z[105:115, 205:225] == 45).all()
    assert (z[300:304] == rd.NO_ECHO).all()          # la carretera es fondo, no eco
    assert (z[200:] == rd.NO_ECHO).all()


def test_isolated_pixels_and_sparse_streaks_are_removed():
    bg = _mapa()
    frame = bg.copy()
    i30 = int(np.where(rd.LEVELS == 30)[0][0])
    frame[200, 200] = _blend(i30, bg[200, 200])                     # pixel suelto
    for x in range(100, 400, 9):                                    # rayas ralas (clutter)
        frame[250:252, x:x + 3] = _blend(i30, bg[250:252, x:x + 3])
    z = rd.decode(frame, bg)
    assert (z == rd.NO_ECHO).all()
    assert (rd.decode(frame, bg, clean=False) != rd.NO_ECHO).sum() > 100  # sin limpiar sí salen


def test_background_is_the_median_so_a_passing_echo_does_not_stick():
    bg = _mapa()
    frames = [bg.copy() for _ in range(5)]
    frames[0][10:20, 10:20] = (0, 128, 0)
    frames[1][10:20, 10:20] = (0, 128, 0)
    assert (rd.background(frames) == bg).all()


def _real(name):
    x0, y0 = map(int, open(os.path.join(DATA, "offset.txt")).read().split())
    crop = np.asarray(Image.open(os.path.join(DATA, name)).convert("RGB"), dtype=np.int32)
    bgc = np.asarray(Image.open(os.path.join(DATA, "fondo.png")).convert("RGB"), dtype=np.int32)
    # Se colocan en su lugar dentro de una imagen del tamaño real (fuera del recorte,
    # cuadro = fondo → sin eco), para que máscaras y coordenadas sean las de verdad.
    frame = np.full((rd.IMG_H, rd.IMG_W, 3), 235, dtype=np.int32)
    bg = frame.copy()
    n = crop.shape[0]
    frame[y0:y0 + n, x0:x0 + n] = crop
    bg[y0:y0 + n, x0:x0 + n] = bgc
    return rd.decode(frame, bg)


def test_real_rain_afternoon_reads_light_rain_over_the_station():
    z = _real("lluvia_1812.png")
    near = rd.max_near(z, LAT, LON, 1)
    # Pluviómetro: 2.0 mm/h a las 18:10 → ~30 dBZ por Marshall-Palmer.
    assert near is not None and 20 <= near <= 40
    vals = z[z != rd.NO_ECHO]
    assert vals.size > 3000 and 20 <= int(np.median(vals)) <= 35


def test_real_dawn_clutter_is_not_rain_near_the_station():
    z = _real("clutter_0409.png")
    assert rd.max_near(z, LAT, LON, 3) is None


def test_max_near_reads_the_echo_over_a_point():
    z = np.full((rd.IMG_H, rd.IMG_W), rd.NO_ECHO, dtype=np.int16)
    x, y = rd.to_px(LAT, LON)
    z[int(y) - 1:int(y) + 2, int(x) - 1:int(x) + 2] = 40
    assert rd.max_near(z, LAT, LON) == 40
    assert rd.max_near(z, 19.2, -99.0) is None


def test_render_paints_echoes_and_leaves_the_rest_transparent():
    z = np.full((4, 4), rd.NO_ECHO, dtype=np.int16)
    z[0, 0] = 50
    img = np.asarray(rd.render(z))
    i50 = int(np.where(rd.LEVELS == 50)[0][0])
    assert tuple(img[0, 0, :3]) == tuple(rd.LEGEND[i50].astype(np.uint8)) and img[0, 0, 3] == 255
    assert img[1, 1, 3] == 0
