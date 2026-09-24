"""
Lee la reflectividad (dBZ) de los cuadros del radar SACMEX a partir de sus
colores, para poder medir cosas (lluvia sobre la estación, movimiento de ecos)
en vez de sólo mostrarlos. Ver PENDIENTES §2.g.

Cómo se leen los colores (muestreado 2026-09-24):
- La leyenda de la imagen está dibujada al 40 % sobre blanco; los ecos, con el
  color pleno. Invirtiendo esa mezcla (pleno = 255 - (255 - leyenda) / 0.4) sale
  la paleta de abajo, que es la que efectivamente aparece en los ecos.
- Los amarillos y naranjas de 35-45 dBZ son casi los de las carreteras del mapa,
  así que el color solo no basta: se compara cada cuadro contra el FONDO (la
  mediana de muchos cuadros del historial, que deja el mapa y quita lo que cambia)
  y sólo cuenta lo que difiere de él.
- Queda mucho eco disperso de 1-3 px (clutter / aire claro: de madrugada, sin
  lluvia, dibuja arcos alrededor del radar). Una apertura morfológica de 3 px lo
  quita; la lluvia de verdad forma manchas más grandes.

Umbrales pendientes de afinar con cuadros de una tarde de lluvia.
"""
import glob
import os
from typing import List, Optional

import numpy as np
from PIL import Image, ImageFilter

# Color pleno de cada nivel de la escala (0, 5, ..., 70 dBZ); 75 es blanco y se
# omite a propósito: se confunde con el fondo del mapa y a esa intensidad no va a
# ser lo único que haya alrededor.
PALETTE = np.array([
    (130, 255, 255), (10, 230, 230), (0, 163, 250), (0, 0, 120), (130, 255, 0),
    (0, 255, 0), (0, 128, 0), (255, 255, 75), (242, 170, 0), (255, 127, 0),
    (252, 0, 10), (207, 15, 0), (125, 0, 125), (247, 0, 255), (162, 0, 245),
], dtype=np.int32)
LEVELS = np.arange(0, 75, 5, dtype=np.int16)
NO_ECHO = -1

IMG_W, IMG_H = 702, 512
MAP_W = 510            # a la derecha está el panel de texto/leyenda: no es mapa
_LOGO = (0, 0, 100, 95)  # logo de SEGIAGUA (x0, y0, x1, y1)

# Calibración (igual que SacmexRadarCard.tsx, 2026-09-23): centro del radar en la
# imagen y escala, sacados de 4 poblados rotulados en el mapa.
RADAR_LAT, RADAR_LON = 19.342639, -99.089472
RADAR_PX, RADAR_PY = 254, 252
PX_PER_KM = 3.3

BG_DIFF = 60     # suma |ΔRGB| mínima contra el fondo para que cuente como eco
PAL_DIST = 80    # distancia RGB máxima al color de la escala más cercano
SPECKLE_PX = 3   # ecos más angostos que esto se consideran ruido


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


def despeckle(z: np.ndarray, size: int = SPECKLE_PX) -> np.ndarray:
    mask = Image.fromarray(((z != NO_ECHO) * 255).astype(np.uint8))
    mask = mask.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size))
    return np.where(np.asarray(mask) > 0, z, NO_ECHO).astype(np.int16)


def decode(frame: np.ndarray, bg: np.ndarray, clean: bool = True) -> np.ndarray:
    """dBZ por pixel (NO_ECHO donde no hay eco), mismo tamaño que la imagen."""
    diff = np.abs(frame - bg).sum(-1)
    dist2 = ((frame[:, :, None, :] - PALETTE[None, None]) ** 2).sum(-1)
    k = dist2.argmin(-1)
    ok = (diff > BG_DIFF) & (dist2.min(-1) < PAL_DIST ** 2)
    z = np.where(ok, LEVELS[k], NO_ECHO).astype(np.int16)
    z[:, MAP_W:] = NO_ECHO
    x0, y0, x1, y1 = _LOGO
    z[y0:y1, x0:x1] = NO_ECHO
    return despeckle(z) if clean else z


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
    for lvl, color in zip(LEVELS, PALETTE):
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
