"""
Lee la reflectividad (dBZ) de los cuadros del radar SACMEX a partir de sus
colores, para poder medir cosas (lluvia sobre la estación, movimiento de ecos)
en vez de sólo mostrarlos. Ver PENDIENTES §2.g.

Cómo se leen los colores (afinado con la tarde de lluvia del 2026-09-24):
- Los ecos están pintados SEMITRANSPARENTES sobre el mapa, con la misma opacidad
  que la leyenda (~40 %). Sobre blanco dan exactamente el color de la leyenda; sobre
  el beige de la ciudad, un color más oscuro. El modelo: la leyenda es L = a·C +
  (1-a)·255 y un eco sobre el fondo b es p = a·C + (1-a)·b, así que el color
  esperado de cada nivel EN CADA PIXEL es  p = L − (1-a)·(255 − b).  Con el fondo
  conocido no hace falta el color pleno C: basta la leyenda medida y a = 0.40
  (ajustado: minimiza la distancia de los pixeles de eco a la escala).
  La v1 (ese mismo día, con sólo cuadros de madrugada) suponía ecos en color pleno:
  con lluvia real leía 35-45 dBZ donde el pluviómetro medía 1-3 mm/h (~25-30 dBZ).
- El FONDO es la mediana de muchos cuadros del historial (deja el mapa, quita lo
  que cambia); sólo cuenta como eco lo que difiere de él.
- Limpieza, en este orden: (1) densidad local (ventana ~2 km): quita pixeles
  sueltos; (2) densidad a mayor escala (~6 km): la lluvia llena áreas, el eco
  disperso de madrugada (clutter, arcos alrededor del radar) deja huecos entre sus
  rayas; (3) mediana 3x3 de los niveles: un pixel de otro color en el borde entre
  dos colores (ruido del JPEG) toma el de sus vecinos.
Resultado del 24-09: sobre la estación, 25-40 dBZ en la lluvia de 18:10-19:10
(Marshall-Palmer: 30 dBZ = 2.7 mm/h; el pluviómetro midió 2.0-2.9 mm/h) y nada
cerca de la estación en el clutter de madrugada.
"""
import glob
import os
from typing import List, Optional

import numpy as np
from PIL import Image, ImageFilter

# Colores de la LEYENDA tal como se ven en la imagen (5, 10, ..., 70 dBZ), muestreados
# de su barra. 0 y 75 dBZ se omiten: blanco/casi blanco, se confunden con el mapa.
LEGEND = np.array([
    (0x9c, 0xf7, 0xf8), (0x9a, 0xda, 0xfd), (0x9a, 0x9a, 0xcd), (0xce, 0xff, 0x9a), (0x99, 0xff, 0x99),
    (0x9b, 0xcd, 0x9b), (0xff, 0xff, 0xb7), (0xfb, 0xde, 0x99), (0xff, 0xcd, 0x99), (0xff, 0x98, 0x9f),
    (0xee, 0x9f, 0x99), (0xcd, 0x9a, 0xce), (0xff, 0x99, 0xff), (0xdb, 0x9a, 0xfb),
], dtype=np.float32)
LEVELS = np.arange(5, 75, 5, dtype=np.int16)
ALPHA = 0.40     # opacidad de los ecos (la misma que la leyenda)
NO_ECHO = -1

IMG_W, IMG_H = 702, 512
MAP_W = 510            # a la derecha está el panel de texto/leyenda: no es mapa
_LOGO = (0, 0, 100, 95)  # logo de SEGIAGUA (x0, y0, x1, y1)

# Calibración (igual que SacmexRadarCard.tsx, 2026-09-23): centro del radar en la
# imagen y escala, sacados de 4 poblados rotulados en el mapa.
RADAR_LAT, RADAR_LON = 19.342639, -99.089472
RADAR_PX, RADAR_PY = 254, 252
PX_PER_KM = 3.3

BG_DIFF = 45       # suma |dRGB| mínima contra el fondo para que cuente como eco
MAX_DIST = 70      # distancia RGB máxima al color esperado del nivel más cercano
DENS_NEAR = (7, 0.35)    # (ventana px, fracción mínima de eco) ~2 km: quita sueltos
DENS_FAR = (21, 0.45)    # ~6 km: quita el clutter en rayas (a 0.55 ya se pierde lluvia)


def to_array(data: bytes) -> np.ndarray:
    from io import BytesIO
    return np.asarray(Image.open(BytesIO(data)).convert("RGB"), dtype=np.int32)


def to_px(lat: float, lon: float):
    """Pixel (x, y) en la imagen original de una coordenada."""
    kx = (lon - RADAR_LON) * 111.32 * np.cos(np.radians(RADAR_LAT))
    ky = (lat - RADAR_LAT) * 110.57
    return RADAR_PX + kx * PX_PER_KM, RADAR_PY - ky * PX_PER_KM


def background(frames: List[np.ndarray]) -> np.ndarray:
    """Mapa sin ecos: mediana por pixel. Con cuadros de varios días, un pixel sólo
    queda "pintado" si llovió encima más de la mitad de las veces."""
    stack = np.stack([f.astype(np.uint8) for f in frames])
    out = np.empty(stack.shape[1:], dtype=np.int32)
    for y in range(0, stack.shape[1], 64):  # por franjas: la mediana de golpe pide ~1 GB
        out[y:y + 64] = np.median(stack[:, y:y + 64], axis=0)
    return out


def _density(ok: np.ndarray, win: int) -> np.ndarray:
    """Fracción de pixeles con eco en una ventana de win x win alrededor de cada pixel."""
    m = Image.fromarray((ok * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(win // 2))
    return np.asarray(m) / 255.0


def decode(frame: np.ndarray, bg: np.ndarray, clean: bool = True) -> np.ndarray:
    """dBZ por pixel (NO_ECHO donde no hay eco), mismo tamaño que la imagen."""
    f, b = frame.astype(np.float32), bg.astype(np.float32)
    expected = LEGEND[None, None] - (1 - ALPHA) * (255 - b[:, :, None, :])   # (h, w, niveles, 3)
    d2 = ((f[:, :, None, :] - expected) ** 2).sum(-1)
    k = d2.argmin(-1)
    ok = (np.abs(f - b).sum(-1) > BG_DIFF) & (d2.min(-1) < MAX_DIST ** 2)
    ok[:, MAP_W:] = False
    x0, y0, x1, y1 = _LOGO
    ok[y0:y1, x0:x1] = False
    if clean:
        ok &= _density(ok, DENS_NEAR[0]) >= DENS_NEAR[1]
        ok &= _density(ok, DENS_FAR[0]) >= DENS_FAR[1]
    z = np.where(ok, LEVELS[k], NO_ECHO).astype(np.int16)
    if clean:
        med = np.asarray(Image.fromarray((z + 1).astype(np.uint8)).filter(ImageFilter.MedianFilter(3)))
        med = med.astype(np.int16) - 1
        z = np.where(ok & (med != NO_ECHO), med, NO_ECHO).astype(np.int16)
    return z


def max_near(z: np.ndarray, lat: float, lon: float, radius_km: float = 1.0) -> Optional[int]:
    """dBZ máximo a menos de radius_km de un punto (None si no hay eco)."""
    x, y = to_px(lat, lon)
    r = radius_km * PX_PER_KM
    yy, xx = np.ogrid[:z.shape[0], :z.shape[1]]
    near = z[(xx - x) ** 2 + (yy - y) ** 2 <= r * r]
    v = int(near.max()) if near.size else NO_ECHO
    return None if v == NO_ECHO else v


def render(z: np.ndarray) -> Image.Image:
    """Ecos decodificados en PNG transparente, con los colores de la escala: para
    revisar a ojo que la lectura cuadre con la imagen original."""
    out = np.zeros((*z.shape, 4), dtype=np.uint8)
    for lvl, color in zip(LEVELS, LEGEND.astype(np.uint8)):
        sel = z == lvl
        out[sel, :3] = color
        out[sel, 3] = 255
    return Image.fromarray(out, "RGBA")


def background_from_archive(archive_dir: str, max_frames: int = 72) -> Optional[np.ndarray]:
    """Fondo con cuadros repartidos en todo el historial (no los últimos: una
    tormenta de una hora seguida se volvería "fondo"). None si hay muy pocos."""
    files = sorted(glob.glob(os.path.join(archive_dir, "*", "EWR-MAXZ*.JPG")))
    if len(files) < 10:
        return None
    step = max(1, len(files) // max_frames)
    frames = []
    for f in files[::step][:max_frames]:
        try:
            with open(f, "rb") as fh:
                a = to_array(fh.read()).astype(np.uint8)
        except OSError:
            continue
        if a.shape == (IMG_H, IMG_W, 3):
            frames.append(a)
    return background(frames) if len(frames) >= 10 else None


_bg_cache = {"ts": 0.0, "bg": None}
_BG_TTL = 6 * 3600  # el mapa no cambia; basta rehacerlo de vez en cuando


def cached_background(archive_dir: str) -> Optional[np.ndarray]:
    import time
    if _bg_cache["bg"] is None or time.time() - _bg_cache["ts"] > _BG_TTL:
        bg = background_from_archive(archive_dir)
        if bg is not None:
            _bg_cache.update(ts=time.time(), bg=bg)
    return _bg_cache["bg"]
