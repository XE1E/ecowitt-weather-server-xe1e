"""
Imagen especial de la cámara para AWEKAS (y servicios de webcam similares).

AWEKAS muestra la webcam en una caja ~4:3 (verificado 2026-09-14 con una
captura real de cómo la renderiza: 540x404, centrando nuestra foto 16:9 con
franjas negras arriba y abajo). En vez de dejar que esas franjas queden en
negro, se genera un lienzo 4:3 propio con la foto alineada arriba y un
cintillo de datos de la estación abajo, en el espacio que sobra.

La foto se reescala a `CANVAS_W` de ancho SIN recortar ni distorsionar: la
altura que le sobre respecto a `CANVAS_H` es exactamente el alto del
cintillo. Solo si la foto llegara a ser más cuadrada de lo esperado (menos
alto libre que `MIN_BANNER_H`) se recorta el sobrante por abajo -- nunca se
encoge el cintillo por debajo de ese mínimo.
"""
import io
import logging
from typing import Any, Dict, Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

CANVAS_W = 800
CANVAS_H = 600
MIN_BANNER_H = 110
HEADER_H = 28

BANNER_BG = (15, 23, 42)       # slate-900, igual que el fondo oscuro del dashboard
HEADER_BG = (2, 132, 199)      # sky-600
HEADER_TEXT = (255, 255, 255)
HEADER_SUB_TEXT = (224, 242, 254)
DIVIDER_COLOR = (51, 65, 85)   # slate-700
LABEL_COLOR = (148, 163, 184)  # slate-400
VALUE_COLOR = (241, 245, 249)  # slate-100
SUB_COLOR = (125, 211, 252)    # sky-300

# Mismo alfabeto de 8 puntos en español que weather.ts::cardinal() en el
# dashboard (N/NE/E/SE/S/SO/O/NO) -- para que el rumbo se lea igual en todo
# el sitio, no otro alfabeto distinto solo para esta imagen.
_COMPASS_ES = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]

# Candidatos de fuente TTF, en orden: la que instala el Dockerfile en
# producción (fonts-dejavu-core) primero, con alternativas para poder
# probar esto fuera del contenedor (Windows/macOS) sin que reviente.
_BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
_REGULAR_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def _load_font(bold: bool, size: int) -> ImageFont.FreeTypeFont:
    for path in (_BOLD_CANDIDATES if bold else _REGULAR_CANDIDATES):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    # Último recurso: la fuente bitmap por defecto de PIL (siempre existe,
    # pero se ve tosca) -- mejor que reventar si un entorno no tiene ninguna
    # de las rutas de arriba.
    logger.warning("Sin fuente TTF disponible para el cintillo de AWEKAS, usando la de PIL por defecto")
    return ImageFont.load_default()


def _compass_es(deg: Optional[float]) -> str:
    if deg is None:
        return "--"
    return _COMPASS_ES[round((deg % 360) / 45) % 8]


def _fmt(value: Optional[float], template: str, none: str = "--") -> str:
    return template.format(value) if value is not None else none


def build_awekas_jpeg(photo_bytes: bytes, weather: Dict[str, Any], quality: int = 88) -> bytes:
    """Compone la foto + cintillo de datos y devuelve el JPEG resultante.

    `weather` son las claves de `/api/current` (temperature_outdoor,
    humidity_outdoor, pressure_relative, rain_rate, rain_24h, wind_speed,
    wind_direction, solar_radiation, uv_index) -- todas opcionales, se
    muestra "--" si falta alguna en vez de fallar.
    """
    photo = Image.open(io.BytesIO(photo_bytes)).convert("RGB")
    ow, oh = photo.size
    new_h_full = round(CANVAS_W * oh / ow) if ow else CANVAS_H

    if new_h_full > CANVAS_H - MIN_BANNER_H:
        resized = photo.resize((CANVAS_W, new_h_full), Image.LANCZOS)
        photo_h = CANVAS_H - MIN_BANNER_H
        resized = resized.crop((0, 0, CANVAS_W, photo_h))  # alineada arriba: se recorta por abajo
    else:
        photo_h = new_h_full
        resized = photo.resize((CANVAS_W, photo_h), Image.LANCZOS)

    banner_h = CANVAS_H - photo_h

    canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), BANNER_BG)
    canvas.paste(resized, (0, 0))
    draw = ImageDraw.Draw(canvas)

    # --- Encabezado: marca de la estación ---
    y0 = photo_h
    draw.rectangle([0, y0, CANVAS_W, y0 + HEADER_H], fill=HEADER_BG)
    f_header = _load_font(bold=True, size=16)
    f_header_small = _load_font(bold=False, size=13)
    draw.text((14, y0 + 5), "XE1E STATION", font=f_header, fill=HEADER_TEXT)
    draw.text((CANVAS_W - 14, y0 + 6), "clima.xe1e.net", font=f_header_small,
               fill=HEADER_SUB_TEXT, anchor="ra")

    # --- Cuadrícula de datos ---
    cols = [
        ("TEMPERATURA", _fmt(weather.get("temperature_outdoor"), "{:.1f}\u00b0C"), ""),
        ("HUMEDAD", _fmt(weather.get("humidity_outdoor"), "{:.0f}%"), ""),
        ("PRESION", _fmt(weather.get("pressure_relative"), "{:.1f} hPa"), ""),
        ("LLUVIA 24H", _fmt(weather.get("rain_24h"), "{:.1f} mm"),
         _fmt(weather.get("rain_rate"), "{:.1f} mm/h")),
        ("VIENTO", _fmt(weather.get("wind_speed"), "{:.0f} km/h"),
         _compass_es(weather.get("wind_direction"))),
        ("RADIACION", _fmt(weather.get("solar_radiation"), "{:.0f} W/m\u00b2"),
         _fmt(weather.get("uv_index"), "UV {:.0f}")),
    ]

    grid_y0 = y0 + HEADER_H
    grid_h = banner_h - HEADER_H
    col_w = CANVAS_W / len(cols)

    f_label = _load_font(bold=False, size=13)
    f_value = _load_font(bold=True, size=22)
    f_sub = _load_font(bold=False, size=14)

    for i, (label, value, sub) in enumerate(cols):
        cx = int(col_w * i + col_w / 2)
        if i > 0:
            x = int(col_w * i)
            draw.line([(x, grid_y0 + 8), (x, grid_y0 + grid_h - 8)], fill=DIVIDER_COLOR, width=1)
        draw.text((cx, grid_y0 + 10), label, font=f_label, fill=LABEL_COLOR, anchor="ma")
        draw.text((cx, grid_y0 + grid_h / 2 - 4), value, font=f_value, fill=VALUE_COLOR, anchor="mm")
        if sub:
            draw.text((cx, grid_y0 + grid_h - 12), sub, font=f_sub, fill=SUB_COLOR, anchor="ms")

    out = io.BytesIO()
    canvas.save(out, "JPEG", quality=quality)
    return out.getvalue()
