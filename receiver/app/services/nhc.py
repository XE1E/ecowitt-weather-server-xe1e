"""
Ciclones tropicales activos (NHC · NOAA) en el Atlántico y el Pacífico, con la
cercanía a México calculada aquí.

Fuentes (dominio público, gobierno de EE. UU.):
  - CurrentStorms.json: todas las tormentas activas (desde depresión tropical),
    con posición, viento, presión, movimiento y ligas a sus productos.
  - <ID>_<adv>adv_TRACK.kmz: trayectoria pronosticada (puntos a 12-120 h con hora
    y viento). Con ella se estima si el pronóstico toca México y a qué distancia.
  - Imágenes: cono de pronóstico EN ESPAÑOL (storm_graphics/.../*_5day_cone_es.png)
    y perspectiva a 7 días por océano (xgtwo/two_{pac,atl}_7d0.png).

Los avisos OFICIALES para México los emite el SMN; esto es informativo. La
geometría de México es aproximada (unos 100 vértices): sirve para "a unos 300 km
de Manzanillo", no para decidir evacuaciones.
"""
import html
import io
import json
import math
import os
import re
import time
import logging
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://www.nhc.noaa.gov"
_UA = {"User-Agent": "clima-xe1e/1.0 (estacion meteorologica personal)"}
_TTL = 600            # 10 min: el NHC publica cada 3-6 h, más seguido no aporta
# Imágenes: cada minuto como mucho se le PREGUNTA al NHC si cambió (If-Modified-
# Since -> 304 sin cuerpo si no). Así el cono/mensajes nuevos aparecen a 1-2 min de
# publicados sin volver a bajar 400 KB cada vez. (Antes: 15 min fijos; la imagen
# podía ir un aviso detrás de los datos.)
_IMG_TTL = 60
_MAX_IMGS = 40

_storms_cache: Dict[str, Any] = {"ts": 0.0, "data": None, "raw": None}
_track_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}   # kmz url -> (ts, puntos)
_img_cache: Dict[str, Dict[str, Any]] = {}   # url -> {ts, data, ctype, last_modified}

# ── Geometría aproximada de México (lat, lon, nombre del lugar costero o None) ──
# Recorrido: frontera norte de oeste a este, costa del Golfo y Caribe, frontera
# sur, costa del Pacífico hacia el norte hasta el delta del Colorado y la
# península de Baja California (costa este hacia el sur, oeste hacia el norte).
_BORDE: List[Tuple[float, float, Optional[str]]] = [
    (32.53, -117.12, "Tijuana, B.C."),
    # frontera norte (no es costa)
    (32.72, -115.00, None), (32.72, -114.72, None), (32.49, -114.81, None),
    (31.86, -112.87, None), (31.33, -111.07, None), (31.33, -108.21, None),
    (31.78, -108.21, None), (31.78, -106.53, None), (31.40, -106.00, None),
    (30.60, -104.90, None), (29.60, -104.50, None), (28.98, -103.30, None),
    (29.75, -102.70, None), (29.77, -101.40, None), (29.30, -100.90, None),
    (28.30, -100.30, None), (27.50, -99.50, None), (26.40, -99.10, None),
    (26.06, -98.20, None),
    # Golfo de México
    (25.95, -97.15, "Matamoros, Tamps."), (23.80, -97.75, "La Pesca, Tamps."),
    (22.25, -97.85, "Tampico, Tamps."), (20.95, -97.30, "Tuxpan, Ver."),
    (20.20, -96.70, "Nautla, Ver."), (19.20, -96.10, "Veracruz, Ver."),
    (18.77, -95.75, "Alvarado, Ver."), (18.15, -94.40, "Coatzacoalcos, Ver."),
    (18.60, -92.60, "Frontera, Tab."), (18.65, -91.80, "Cd. del Carmen, Camp."),
    (19.35, -90.70, "Champotón, Camp."), (19.85, -90.55, "Campeche, Camp."),
    (20.85, -90.40, "Celestún, Yuc."), (21.30, -89.65, "Progreso, Yuc."),
    (21.60, -88.15, "Río Lagartos, Yuc."), (21.60, -87.05, "Cabo Catoche, Q. Roo"),
    # Caribe mexicano
    (21.10, -86.80, "Cancún, Q. Roo"), (20.20, -87.45, "Tulum, Q. Roo"),
    (19.80, -87.50, "Punta Allen, Q. Roo"), (18.70, -87.70, "Mahahual, Q. Roo"),
    (18.50, -88.30, "Chetumal, Q. Roo"),
    # frontera sur (no es costa)
    (17.80, -89.15, None), (17.82, -90.98, None), (17.25, -90.98, None),
    (17.25, -91.43, None), (16.08, -90.44, None), (16.07, -91.73, None),
    (15.25, -92.20, None),
    # Pacífico, de Chiapas hacia el norte
    (14.53, -92.23, "Puerto Chiapas, Chis."), (15.90, -93.90, "Tonalá, Chis."),
    (16.17, -95.20, "Salina Cruz, Oax."), (15.75, -96.13, "Huatulco, Oax."),
    (15.86, -97.07, "Puerto Escondido, Oax."), (16.25, -98.20, "Pinotepa Nacional, Oax."),
    (16.85, -99.90, "Acapulco, Gro."), (17.64, -101.55, "Zihuatanejo, Gro."),
    (17.95, -102.20, "Lázaro Cárdenas, Mich."), (18.30, -103.30, "Maruata, Mich."),
    (19.05, -104.33, "Manzanillo, Col."), (19.20, -104.68, "Barra de Navidad, Jal."),
    (20.40, -105.70, "Cabo Corrientes, Jal."), (20.65, -105.25, "Puerto Vallarta, Jal."),
    (21.55, -105.30, "San Blas, Nay."), (23.20, -106.42, "Mazatlán, Sin."),
    (24.60, -107.90, "Altata, Sin."), (25.60, -109.05, "Topolobampo, Sin."),
    (27.90, -110.90, "Guaymas, Son."), (28.80, -111.95, "Bahía Kino, Son."),
    (31.30, -113.55, "Puerto Peñasco, Son."), (31.70, -114.50, "Golfo de Santa Clara, Son."),
    (31.80, -114.80, None),
    # Baja California: costa del Golfo de California hacia el sur…
    (31.00, -114.85, "San Felipe, B.C."), (28.95, -113.55, "Bahía de los Ángeles, B.C."),
    (27.34, -112.27, "Santa Rosalía, B.C.S."), (26.90, -111.98, "Mulegé, B.C.S."),
    (26.00, -111.35, "Loreto, B.C.S."), (24.15, -110.30, "La Paz, B.C.S."),
    (23.15, -109.45, "San José del Cabo, B.C.S."), (22.88, -109.90, "Cabo San Lucas, B.C.S."),
    # …y costa del Pacífico hacia el norte
    (23.45, -110.22, "Todos Santos, B.C.S."), (24.60, -112.10, "Bahía Magdalena, B.C.S."),
    (26.70, -113.60, "Punta Abreojos, B.C.S."), (27.85, -115.10, "Punta Eugenia, B.C.S."),
    (27.95, -114.10, "Guerrero Negro, B.C.S."), (30.05, -115.75, "El Rosario, B.C."),
    (30.50, -115.95, "San Quintín, B.C."), (31.85, -116.60, "Ensenada, B.C."),
]
# Guerrero Negro está tierra adentro de Punta Eugenia en el recorrido: se deja
# fuera del polígono (lo cruzaría) y sólo cuenta como lugar costero.
_POLIGONO = [(la, lo) for la, lo, n in _BORDE if n != "Guerrero Negro, B.C.S."]
_COSTA = [(la, lo, n) for la, lo, n in _BORDE if n]
# Segmentos de costa: pares consecutivos donde AMBOS extremos son costa.
_SEG_COSTA = [(_BORDE[i], _BORDE[i + 1]) for i in range(len(_BORDE) - 1)
              if _BORDE[i][2] and _BORDE[i + 1][2] and "Guerrero Negro" not in (_BORDE[i][2] + _BORDE[i + 1][2])]
_SEG_COSTA.append((_BORDE[-1], _BORDE[0]))  # Ensenada -> Tijuana

CLASIFICACION = {
    "TD": "Depresión tropical", "TS": "Tormenta tropical", "HU": "Huracán",
    "MH": "Huracán mayor", "STD": "Depresión subtropical", "STS": "Tormenta subtropical",
    "SD": "Depresión subtropical", "SS": "Tormenta subtropical",
    "PTC": "Potencial ciclón tropical", "PC": "Ciclón post-tropical",
    "EX": "Ciclón extratropical", "LO": "Remanente", "DB": "Perturbación",
    "TY": "Tifón", "STY": "Supertifón",
}
_CUENCA = {"al": "Atlántico", "ep": "Pacífico", "cp": "Pacífico central"}
_RUMBOS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"]
# Zonas horarias que usa el NHC en sus productos -> horas respecto a UTC.
_TZ = {"UTC": 0, "GMT": 0, "AST": -4, "EDT": -4, "EST": -5, "CDT": -5, "CST": -6,
       "MDT": -6, "MST": -7, "PDT": -7, "PST": -8, "HST": -10, "HDT": -9}

UMBRAL_AMENAZA_KM = 500   # "media": el centro pasa (o está) a menos de esto de la costa
UMBRAL_ALTA_KM = 150      # "alta": prácticamente sobre la costa, o tocando tierra


def categoria_ss(kt: Optional[float]) -> Optional[int]:
    """Escala Saffir-Simpson a partir del viento sostenido en nudos."""
    if kt is None or kt < 64:
        return None
    for cat, tope in ((1, 82), (2, 95), (3, 112), (4, 136)):
        if kt <= tope:
            return cat
    return 5


def rumbo(deg: Optional[float]) -> Optional[str]:
    if deg is None:
        return None
    return _RUMBOS[int((deg % 360) / 22.5 + 0.5) % 16]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def en_mexico(lat: float, lon: float) -> bool:
    """Punto dentro del polígono aproximado de México (ray casting)."""
    dentro = False
    n = len(_POLIGONO)
    for i in range(n):
        (la1, lo1), (la2, lo2) = _POLIGONO[i], _POLIGONO[(i + 1) % n]
        if (la1 > lat) != (la2 > lat):
            x = lo1 + (lat - la1) * (lo2 - lo1) / (la2 - la1)
            if lon < x:
                dentro = not dentro
    return dentro


def _dist_segmento_km(lat: float, lon: float, a: Tuple, b: Tuple) -> float:
    """Distancia de un punto a un segmento de costa (proyección local en km)."""
    k = math.cos(math.radians(lat)) * 111.32
    ax, ay = (a[1] - lon) * k, (a[0] - lat) * 110.57
    bx, by = (b[1] - lon) * k, (b[0] - lat) * 110.57
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
    px, py = ax + t * dx, ay + t * dy
    return math.hypot(px, py)


def cercania(lat: float, lon: float) -> Dict[str, Any]:
    """Distancia a la costa de México, el lugar costero más cercano y si el punto
    ya está sobre territorio mexicano."""
    d = min(_dist_segmento_km(lat, lon, a, b) for a, b in _SEG_COSTA)
    lugar = min(_COSTA, key=lambda c: haversine_km(lat, lon, c[0], c[1]))
    sobre = en_mexico(lat, lon)
    return {"km_costa": 0.0 if sobre else round(d), "lugar": lugar[2], "sobre_tierra": sobre}


# ── Descargas ──────────────────────────────────────────────────────────────────
async def _get(url: str, timeout: float = 30) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout, headers=_UA, follow_redirects=True) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r


def _parse_valid(txt: str) -> Optional[str]:
    """'5:00 PM MST September 25, 2026' -> ISO UTC ('2026-09-26T00:00:00Z')."""
    m = re.search(r"(\d{1,2}):(\d{2})\s*([AP]M)\s+([A-Z]{3})\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", txt)
    if not m:
        return None
    hh, mm, ap, tz, mes, dia, anio = m.groups()
    try:
        dt = datetime.strptime(f"{mes} {dia} {anio} {hh}:{mm} {ap}", "%B %d %Y %I:%M %p")
    except ValueError:
        return None
    off = _TZ.get(tz)
    if off is None:
        return None
    return (dt - timedelta(hours=off)).replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_track_kml(kml: str) -> List[Dict[str, Any]]:
    """Puntos del pronóstico (sin el inicial): horas, hora válida, lat, lon, viento."""
    puntos = []
    for pm in kml.split("<Placemark")[1:]:
        if "<Point>" not in pm:
            continue
        hr = re.search(r"(\d+)\s*hr Forecast", pm)
        coords = re.search(r"<Point>\s*<coordinates>\s*([-\d.]+),([-\d.]+)", pm)
        if not hr or not coords:
            continue
        valid = re.search(r"Valid at:\s*([^<]+)", pm)
        viento = re.search(r"Maximum Wind:\s*(\d+)\s*knots", pm)
        racha = re.search(r"Wind Gusts:\s*(\d+)\s*knots", pm)
        puntos.append({
            "horas": int(hr.group(1)),
            "valido": _parse_valid(valid.group(1)) if valid else None,
            "lat": float(coords.group(2)), "lon": float(coords.group(1)),
            "viento_kt": int(viento.group(1)) if viento else None,
            "racha_kt": int(racha.group(1)) if racha else None,
        })
    return sorted(puntos, key=lambda p: p["horas"])


async def _track(kmz_url: Optional[str]) -> List[Dict[str, Any]]:
    if not kmz_url:
        return []
    now = time.time()
    c = _track_cache.get(kmz_url)
    if c and now - c[0] < _TTL * 6:   # la URL cambia con cada aviso: una hora sobra
        return c[1]
    try:
        r = await _get(kmz_url)
        z = zipfile.ZipFile(io.BytesIO(r.content))
        kml_name = next(n for n in z.namelist() if n.lower().endswith(".kml"))
        pts = parse_track_kml(z.read(kml_name).decode("utf-8", "replace"))
    except Exception as e:
        logger.warning("NHC: no se pudo leer la trayectoria %s (%s)", kmz_url, e)
        return c[1] if c else []
    if len(_track_cache) > 30:
        _track_cache.clear()
    _track_cache[kmz_url] = (now, pts)
    return pts


def _densificar(ini: Tuple[float, float], pts: List[Dict[str, Any]], pasos: int = 8):
    """Puntos intermedios de la trayectoria (el centro no salta de punto en punto:
    entre dos pronósticos a 24 h puede pasar mucho más cerca de la costa)."""
    ruta = [(0, ini[0], ini[1], None)] + [(p["horas"], p["lat"], p["lon"], p["valido"]) for p in pts]
    for (h1, la1, lo1, _), (h2, la2, lo2, v2) in zip(ruta, ruta[1:]):
        for k in range(1, pasos + 1):
            f = k / pasos
            yield h1 + (h2 - h1) * f, la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f, v2 if k == pasos else None


def evaluar(lat: float, lon: float, pts: List[Dict[str, Any]], con_avisos: bool) -> Dict[str, Any]:
    """Cercanía actual + máximo acercamiento pronosticado + nivel de amenaza."""
    ahora = cercania(lat, lon)
    mejor = {"km_costa": ahora["km_costa"], "lugar": ahora["lugar"], "horas": 0}
    toca_tierra = None
    for h, la, lo, _ in _densificar((lat, lon), pts):
        c = cercania(la, lo)
        if c["km_costa"] < mejor["km_costa"]:
            mejor = {"km_costa": c["km_costa"], "lugar": c["lugar"], "horas": round(h)}
        if c["sobre_tierra"] and toca_tierra is None:
            toca_tierra = {"horas": round(h), "lugar": c["lugar"]}
    # Las horas del pronóstico cuentan desde la hora sinóptica del aviso (no desde la
    # emisión): se recupera con el primer punto con hora válida.
    t0 = next((datetime.strptime(p["valido"], "%Y-%m-%dT%H:%M:%SZ") - timedelta(hours=p["horas"])
               for p in pts if p.get("valido")), None)
    for d in (mejor, toca_tierra):
        if d is not None:
            d["hora"] = ((t0 + timedelta(hours=d["horas"])).strftime("%Y-%m-%dT%H:%M:%SZ")
                         if t0 and d["horas"] else None)
    minimo = mejor["km_costa"]
    if ahora["sobre_tierra"] or toca_tierra or minimo <= UMBRAL_ALTA_KM:
        nivel = "alta"
    elif minimo <= UMBRAL_AMENAZA_KM or (con_avisos and minimo <= 1000):
        nivel = "media"
    else:
        nivel = "baja"
    return {"ahora": ahora, "acercamiento": mejor, "toca_tierra": toca_tierra, "nivel": nivel}


def _imagenes(atcf: str, cuenca: str) -> Dict[str, Optional[str]]:
    """Ligas a las imágenes (servidas por nuestro proxy /api/ciclones/img/...)."""
    if cuenca not in ("al", "ep"):
        return {"cono": None, "mensajes": None}   # las del Pacífico central las publica el CPHC, otro sitio
    base = f"/api/ciclones/img/{atcf.upper()}"
    # "mensajes" (Key Messages) sólo existe para algunas tormentas: si el NHC no la
    # publica, el proxy responde 404 y la página la oculta.
    return {"cono": f"{base}/cono", "mensajes": f"{base}/mensajes"}


# ── Textos del NHC: probabilidades de viento (PWS) y avisos costeros (TCP) ──────
_texto_cache: Dict[str, Tuple[float, str]] = {}   # url -> (ts, texto del <pre>)


async def _texto(url: Optional[str]) -> Optional[str]:
    """Contenido del <pre> de un producto de texto del NHC (caché 10 min)."""
    if not url:
        return None
    now = time.time()
    c = _texto_cache.get(url)
    if c and now - c[0] < _TTL:
        return c[1]
    try:
        r = await _get(url)
        m = re.search(r"<pre[^>]*>(.*?)</pre>", r.text, re.S | re.I)
        txt = html.unescape(m.group(1)) if m else r.text
    except Exception as e:
        logger.info("NHC texto no disponible %s (%s)", url, e)
        return c[1] if c else None
    if len(_texto_cache) > 40:
        _texto_cache.clear()
    _texto_cache[url] = (now, txt)
    return txt


# Localidades de México que usa el NHC en sus tablas (nombre abreviado en
# mayúsculas -> nombre para mostrar). Las que no estén aquí se muestran aparte
# como "otras" con el nombre tal cual (Hawái, EE. UU., Centroamérica…).
_PWS_MX = {
    "ISLA GUADALUPE": "Isla Guadalupe", "PUNTA EUGENIA": "Punta Eugenia", "P ABREOJOS": "Punta Abreojos",
    "CABO SAN LUCAS": "Cabo San Lucas", "SAN JOSE CABO": "San José del Cabo", "LA PAZ": "La Paz",
    "LORETO": "Loreto", "SANTA ROSALIA": "Santa Rosalía", "SAN FELIPE": "San Felipe",
    "BAHIA KINO": "Bahía Kino", "GUAYMAS": "Guaymas", "HERMOSILLO": "Hermosillo",
    "HUATABAMPO": "Huatabampo", "LOS MOCHIS": "Los Mochis", "CULIACAN": "Culiacán",
    "MAZATLAN": "Mazatlán", "SAN BLAS": "San Blas", "TEPIC": "Tepic", "P VALLARTA": "Puerto Vallarta",
    "BARRA NAVIDAD": "Barra de Navidad", "MANZANILLO": "Manzanillo", "L CARDENAS": "Lázaro Cárdenas",
    "LAZARO CARDENAS": "Lázaro Cárdenas", "ZIHUATANEJO": "Zihuatanejo", "ACAPULCO": "Acapulco",
    "P MALDONADO": "Punta Maldonado", "P ANGEL": "Puerto Ángel", "P ESCONDIDO": "Puerto Escondido",
    "HUATULCO": "Huatulco", "SALINA CRUZ": "Salina Cruz", "TAPACHULA": "Tapachula",
    "ISLA SOCORRO": "Isla Socorro", "ISLA CLARION": "Isla Clarión", "ISLAS MARIAS": "Islas Marías",
    "GUADALAJARA": "Guadalajara", "NOGALES": "Nogales", "CIUDAD OBREGON": "Ciudad Obregón",
    "MATAMOROS": "Matamoros", "SOTO LA MARINA": "Soto la Marina", "TAMPICO": "Tampico",
    "TUXPAN": "Tuxpan", "VERACRUZ": "Veracruz", "COATZACOALCOS": "Coatzacoalcos",
    "FRONTERA": "Frontera", "CD DEL CARMEN": "Ciudad del Carmen", "CAMPECHE": "Campeche",
    "MERIDA": "Mérida", "PROGRESO": "Progreso", "CANCUN": "Cancún", "COZUMEL": "Cozumel",
    "CHETUMAL": "Chetumal", "TULUM": "Tulum", "ISLA MUJERES": "Isla Mujeres",
    "MONTERREY": "Monterrey", "LA PESCA": "La Pesca", "MX/GUAT BORDER": "Frontera México-Guatemala",
}
_PWS_LINEA = re.compile(r"^(?P<lugar>\S.*?)\s+(?P<kt>34|50|64)\s+(?P<resto>(?:X|\d+).*)$")


def parse_pws(txt: str) -> List[Dict[str, Any]]:
    """Probabilidad ACUMULADA a 5 días de vientos de 34/50/64 kt por localidad.

    Cada renglón: 'LORETO         34  X   X( X) ... 33(71)   1(72)'; el último
    número entre paréntesis es la acumulada al final del periodo (X = <1 %)."""
    lugares: Dict[str, Dict[str, Any]] = {}
    for linea in txt.splitlines():
        m = _PWS_LINEA.match(linea.rstrip())
        if not m:
            continue
        nombre = m.group("lugar").strip()
        if re.match(r"^\d+N\s+\d+W$", nombre):   # puntos de mar ("20N 115W")
            continue
        acum = re.findall(r"\(\s*(X|\d+)\)", m.group("resto"))
        val = acum[-1] if acum else m.group("resto").split()[0]
        pct = 0 if val == "X" else int(val)
        d = lugares.setdefault(nombre, {
            "lugar": _PWS_MX.get(nombre, nombre.title()), "mexico": nombre in _PWS_MX,
            "p34": 0, "p50": 0, "p64": 0,
        })
        d[f"p{m.group('kt')}"] = pct
    return sorted(lugares.values(), key=lambda d: (-d["p64"], -d["p50"], -d["p34"]))


_TIPOS_AVISO = {
    "hurricane warning": ("Aviso de huracán", "aviso"),
    "hurricane watch": ("Vigilancia de huracán", "vigilancia"),
    "tropical storm warning": ("Aviso de tormenta tropical", "aviso"),
    "tropical storm watch": ("Vigilancia de tormenta tropical", "vigilancia"),
    "storm surge warning": ("Aviso de marea de tormenta", "aviso"),
    "storm surge watch": ("Vigilancia de marea de tormenta", "vigilancia"),
}
_MX_RE = re.compile(
    r"Mexico|Baja California|Sonora|Sinaloa|Nayarit|Jalisco|Colima|Michoac|Guerrero|Oaxaca|Chiapas|"
    r"Tehuantepec|Yucat|Quintana Roo|Campeche|Tabasco|Veracruz|Tamaulipas|Cabo San Lucas|Los Cabos|"
    r"Cozumel|Canc[uú]n|Chetumal|Tulum|Manzanillo|Acapulco|Mazatl|Puerto Vallarta|Loreto|Guaymas|"
    r"Isla Socorro|Islas Mar[ií]as|Revillagigedo|Todos Santos|Punta Abreojos|"
    # Puntos de corte que el NHC usa en costas mexicanas. Se omiten los que
    # también existen fuera (Cabo Corrientes y Santa Fe en Cuba, San Felipe…):
    # basta con que el otro extremo de la zona esté en la lista.
    r"Punta Eugenia|Bahia Tortugas|Puerto San Andresito|Cabo San Lazaro|Puerto San Carlos|"
    r"San Jose del Cabo|Los Barriles|La Paz|San Evaristo|Mulege|Santa Rosalia|Bahia de los Angeles|"
    r"Bahia San Juan Bautista|Puerto Penasco|Bahia Kino|Huatabampo|Topolobampo|Altata|Escuinapa|"
    r"San Blas|Playa Perula|Punta Mita|Barra de Navidad|Punta San Telmo|Lazaro Cardenas|"
    r"Tecpan de Galeana|Zihuatanejo|Punta Maldonado|Pinotepa|Puerto Escondido|Puerto Angel|Huatulco|"
    r"Salina Cruz|Pijijiapan|Puerto Madero|Barra de Tonala|Barra (?:El|del) Mezquital|La Pesca|"
    r"Rio San Fernando|Cabo Rojo|Tuxpan|Punta El Lagarto|Frontera|Celestun|Progreso|Cabo Catoche|"
    r"Chiquila|Puerto Morelos|Punta Allen|Costa Maya|Isla Mujeres|Sabancuy|Ciudad del Carmen", re.I)
_DIAS = {"Monday": "lunes", "Tuesday": "martes", "Wednesday": "miércoles", "Thursday": "jueves",
         "Friday": "viernes", "Saturday": "sábado", "Sunday": "domingo"}


def _cuando_es(t: str) -> str:
    """'tonight or early Saturday' -> 'esta noche o temprano el sábado' (lo común)."""
    t = t.strip().rstrip(".")
    for en, es in _DIAS.items():
        t = re.sub(rf"\bearly {en}\b", f"temprano el {es}", t)
        t = re.sub(rf"\blate {en}\b", f"tarde el {es}", t)
        t = re.sub(rf"\b{en} night\b", f"el {es} por la noche", t)
        t = re.sub(rf"\bon {en}\b", f"el {es}", t)
        t = re.sub(rf"\b{en}\b", f"el {es}", t)
    for en, es in (("later today", "más tarde hoy"), ("tonight", "esta noche"), ("today", "hoy"),
                   ("this morning", "esta mañana"), ("this afternoon", "esta tarde"),
                   ("this evening", "esta noche"), (" or ", " o "), (" and ", " y ")):
        t = t.replace(en, es)
    return t


def traducir_zona(z: str) -> str:
    """Traducción de las fórmulas fijas del NHC para zonas costeras."""
    z = z.strip()
    lados = {"southern ": "sur ", "northern ": "norte ", "western ": "oeste ", "eastern ": "este "}
    z = re.sub(r"^The (southern |northern |western |eastern )?coast of Mexico",
               lambda m: "La costa " + lados.get(m.group(1) or "", "") + "de México", z)
    z = re.sub(r"^The Cabo Verde Islands", "Islas de Cabo Verde", z)
    z = re.sub(r"^The Yucatan Peninsula", "La península de Yucatán", z)
    z = re.sub(r"\bnorthward to\b", "hacia el norte hasta", z)
    z = re.sub(r"\bsouthward to\b", "hacia el sur hasta", z)
    for en, es in (("north of", "al norte de"), ("south of", "al sur de"), ("east of", "al este de"),
                   ("west of", "al oeste de"), ("including", "incluyendo")):
        z = re.sub(rf"\b{en}\b", es, z)
    z = re.sub(r"\bfrom\b", "de", z)
    z = re.sub(r"\bto\b", "a", z)
    z = re.sub(r"\band\b", "y", z)
    return z


def parse_avisos_tcp(txt: str) -> Dict[str, Any]:
    """Vigilancias y avisos costeros vigentes del aviso público (TCP)."""
    i = txt.find("WATCHES AND WARNINGS")
    if i < 0:
        return {"vigentes": [], "notas": [], "mexico": None}
    sec = txt[i:]
    fin = re.search(r"\n\s*\n[A-Z][A-Z /]+\n-{4,}", sec[30:])
    if fin:
        sec = sec[:30 + fin.start()]
    vigentes: List[Dict[str, Any]] = []
    actual: Optional[Dict[str, Any]] = None
    for linea in sec.splitlines():
        t = linea.strip()
        m = re.match(r"^An? (.+?) (?:is|are) in effect for\.\.\.$", t)
        if m:
            tipo_en = m.group(1).strip()
            tipo, grado = _TIPOS_AVISO.get(tipo_en.lower(), (tipo_en, "aviso" if "Warning" in tipo_en else "vigilancia"))
            actual = {"tipo": tipo, "grado": grado, "tipo_en": tipo_en, "zonas": []}
            vigentes.append(actual)
            continue
        if t.startswith("*") and actual is not None:
            zona_en = t.lstrip("* ").strip()
            actual["zonas"].append({"zona": traducir_zona(zona_en), "zona_en": zona_en,
                                    "mexico": bool(_MX_RE.search(zona_en))})
            continue
        if not t:
            actual = None
    # Respaldo por si una zona no trae ningún nombre conocido: "The government of
    # Mexico has issued a Hurricane Watch from Punta Eugenia southward to Santa Fe."
    # (sólo aparece en el aviso en que cambia; por eso la lista de arriba manda).
    cuerpo_mx = " ".join(re.findall(r"[^.]*government of Mexico[^.]*\.", " ".join(txt[i:].split())))
    for v in vigentes:
        for z in v["zonas"]:
            ini = re.split(r"\s+to\s+", z["zona_en"])[0].strip()
            if not z["mexico"] and len(ini) > 3 and ini in cuerpo_mx:
                z["mexico"] = True
    # Notas del tipo "Interests in Baja California Sur should closely monitor…"
    notas = []
    cuerpo = " ".join(sec.split())
    for m in re.finditer(r"Interests (?:in|elsewhere in|along|elsewhere along) (.+?) should (?:closely )?"
                         r"monitor the progress of (?:this system|[A-Z][a-z]+)\.", cuerpo):
        lugar = m.group(1)
        notas.append({"texto": f"En {traducir_zona(lugar)} deben seguir de cerca la evolución de este sistema.",
                      "mexico": bool(_MX_RE.search(lugar))})
    for m in re.finditer(r"(Watches or warnings|Additional watches|Additional warnings|Watches|Warnings) "
                         r"(?:could|may|will likely|will probably) be required for (?:a )?portions? of "
                         r"(?:the area|the coast|this area)(?: (.+?))?\.", cuerpo):
        que = {"Watches": "vigilancias", "Warnings": "avisos", "Additional watches": "más vigilancias",
               "Additional warnings": "más avisos", "Watches or warnings": "vigilancias o avisos"}[m.group(1)]
        cuando = f" {_cuando_es(m.group(2))}" if m.group(2) else ""
        notas.append({"texto": f"Podrían emitirse {que} para parte de esa zona{cuando}.", "mexico": None})
    # Grado más alto que toca a México (para el nivel de amenaza y las alertas).
    grados = [v["grado"] for v in vigentes if any(z["mexico"] for z in v["zonas"])]
    mexico = "aviso" if "aviso" in grados else ("vigilancia" if grados else None)
    return {"vigentes": vigentes, "notas": notas, "mexico": mexico}


def _num(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def get_ciclones(est_lat: float, est_lon: float) -> Dict[str, Any]:
    """Tormentas activas del Atlántico y Pacífico con su cercanía a México.

    Si el NHC no responde se sirve la última copia (marcada `stale`)."""
    now = time.time()
    c = _storms_cache
    if c["data"] is not None and now - c["ts"] < _TTL:
        return c["data"]
    try:
        raw = (await _get(f"{_BASE}/CurrentStorms.json")).json()
    except Exception as e:
        if c["data"] is not None:
            logger.warning("NHC no responde (%s); se sirve la copia de hace %.0f min", e, (now - c["ts"]) / 60)
            return {**c["data"], "stale": True}
        raise

    c["raw"] = raw.get("activeStorms") or []
    tormentas = []
    for s in raw.get("activeStorms") or []:
        atcf = str(s.get("id") or "").lower()          # "ep172026"
        cuenca = atcf[:2]
        if cuenca not in _CUENCA:
            continue
        lat, lon = _num(s.get("latitudeNumeric")), _num(s.get("longitudeNumeric"))
        if lat is None or lon is None:
            continue
        kt = _num(s.get("intensity"))
        clase = str(s.get("classification") or "").upper()
        pts = await _track((s.get("forecastTrack") or {}).get("kmzFile"))
        con_avisos = bool(s.get("windWatchesWarnings"))
        ev = evaluar(lat, lon, pts, con_avisos)
        tcp = await _texto((s.get("publicAdvisory") or {}).get("url"))
        avisos = parse_avisos_tcp(tcp) if tcp else {"vigentes": [], "notas": [], "mexico": None}
        # Un aviso (warning) vigente en costa mexicana ES amenaza; una vigilancia
        # (watch), al menos "se acerca" — aunque la geometría diga otra cosa.
        if avisos["mexico"] == "aviso":
            ev["nivel"] = "alta"
        elif avisos["mexico"] == "vigilancia" and ev["nivel"] == "baja":
            ev["nivel"] = "media"
        pws = await _texto((s.get("windSpeedProbabilities") or {}).get("url"))
        probs = parse_pws(pws) if pws else []
        adv = s.get("publicAdvisory") or {}
        tormentas.append({
            "id": atcf,
            "nombre": s.get("name"),
            "clase": clase,
            "tipo": CLASIFICACION.get(clase, clase or "Ciclón"),
            "categoria": categoria_ss(kt) if clase in ("HU", "MH") else None,
            "cuenca": cuenca,
            "oceano": _CUENCA[cuenca],
            "viento_kt": kt,
            "viento_kmh": round(kt * 1.852) if kt is not None else None,
            "presion_mb": _num(s.get("pressure")),
            "lat": lat, "lon": lon,
            "movimiento": {
                "rumbo_deg": _num(s.get("movementDir")),
                "rumbo": rumbo(_num(s.get("movementDir"))),
                "kmh": round(_num(s.get("movementSpeed")) * 1.609) if _num(s.get("movementSpeed")) is not None else None,
            },
            "actualizado": s.get("lastUpdate"),
            "aviso_num": adv.get("advNum"),
            "aviso_url": adv.get("url"),
            "discusion_num": (s.get("forecastDiscussion") or {}).get("advNum"),
            "discusion_url": (s.get("forecastDiscussion") or {}).get("url"),
            "graficas_url": (s.get("forecastGraphics") or {}).get("url"),
            "avisos_costeros": con_avisos,
            "avisos": avisos,
            "probabilidades": probs,
            "km_estacion": round(haversine_km(lat, lon, est_lat, est_lon)),
            "pronostico": pts,
            **ev,
            "imagenes": _imagenes(atcf, cuenca),
        })

    orden = {"alta": 0, "media": 1, "baja": 2}
    tormentas.sort(key=lambda t: (orden[t["nivel"]], t["acercamiento"]["km_costa"]))
    data = {
        "fuente": "NHC · NOAA",
        "actualizado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tormentas": tormentas,
        "amenaza": tormentas[0]["nivel"] if tormentas else None,
        "stale": False,
    }
    c.update(ts=now, data=data)
    return data


# ── Mapa: cono y líneas de avisos costeros (KMZ del NHC) ─────────────────────
_kml_cache: Dict[str, Tuple[float, str]] = {}   # kmz url -> (ts, kml). La URL cambia con cada aviso.
_WW_TIPO = {"HWR": "Aviso de huracán", "HWA": "Vigilancia de huracán",
            "TWR": "Aviso de tormenta tropical", "TWA": "Vigilancia de tormenta tropical"}


async def _kml(kmz_url: Optional[str]) -> Optional[str]:
    if not kmz_url:
        return None
    now = time.time()
    c = _kml_cache.get(kmz_url)
    if c and now - c[0] < _TTL * 6:
        return c[1]
    try:
        r = await _get(kmz_url)
        z = zipfile.ZipFile(io.BytesIO(r.content))
        kml = z.read(next(n for n in z.namelist() if n.lower().endswith(".kml"))).decode("utf-8", "replace")
    except Exception as e:
        logger.info("NHC KMZ no disponible %s (%s)", kmz_url, e)
        return c[1] if c else None
    if len(_kml_cache) > 40:
        _kml_cache.clear()
    _kml_cache[kmz_url] = (now, kml)
    return kml


def _coords(txt: str, paso: int = 1) -> List[List[float]]:
    """'lon,lat,0 lon,lat,0 …' -> [[lat, lon], …] (cada `paso` puntos, sin perder el último)."""
    pts = []
    for par in txt.split():
        p = par.split(",")
        if len(p) >= 2:
            try:
                pts.append([round(float(p[1]), 3), round(float(p[0]), 3)])
            except ValueError:
                pass
    if paso > 1 and len(pts) > 2:
        pts = pts[::paso] + ([pts[-1]] if (len(pts) - 1) % paso else [])
    return pts


def parse_cono(kml: str) -> List[List[List[float]]]:
    """Anillos exteriores del cono (el NHC a veces lo parte en varios polígonos)."""
    anillos = []
    for m in re.finditer(r"<outerBoundaryIs>.*?<coordinates>(.*?)</coordinates>", kml, re.S):
        c = _coords(m.group(1), paso=3)   # ~1,000 puntos por cono: con 1 de cada 3 sobra
        if len(c) >= 3:
            anillos.append(c)
    return anillos


def parse_ww(kml: str) -> List[Dict[str, Any]]:
    """Tramos de costa con vigilancia/aviso: [{tipo, clave, coords}]."""
    out = []
    for pm in kml.split("<Placemark")[1:]:
        estilo = re.search(r"<styleUrl>#(\w+)</styleUrl>", pm)
        coords = re.search(r"<LineString>\s*<coordinates>(.*?)</coordinates>", pm, re.S)
        if not estilo or not coords:
            continue
        clave = estilo.group(1).upper()
        out.append({"clave": clave, "tipo": _WW_TIPO.get(clave, clave), "coords": _coords(coords.group(1))})
    return out


async def get_mapa(raw_storms: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Geometría para el mapa de la página: cono y avisos por tormenta."""
    if raw_storms is None:
        # La lista cruda ya la guarda get_ciclones (misma caché de 10 min); sólo si
        # aún no hay (recién arrancado) se baja aquí.
        raw_storms = _storms_cache.get("raw")
        if raw_storms is None:
            try:
                raw_storms = (await _get(f"{_BASE}/CurrentStorms.json")).json().get("activeStorms") or []
            except Exception as e:
                logger.info("NHC mapa: sin lista de tormentas (%s)", e)
                raw_storms = []
    out = []
    for s in raw_storms:
        atcf = str(s.get("id") or "").lower()
        if atcf[:2] not in _CUENCA:
            continue
        cono = await _kml((s.get("trackCone") or {}).get("kmzFile"))
        ww = await _kml((s.get("windWatchesWarnings") or {}).get("kmzFile"))
        out.append({"id": atcf, "cono": parse_cono(cono) if cono else [], "avisos": parse_ww(ww) if ww else []})
    return {"tormentas": out}


# ── Satélite: cuadros GOES centrados en la tormenta (NOAA STAR "floaters") ───
_SAT_BASE = "https://cdn.star.nesdis.noaa.gov/FLOATER/data"
_sat_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_SAT_RE = re.compile(r'href="((\d{4})(\d{3})(\d{2})(\d{2})_(GOES\d+)-ABI-FL-GEOCOLOR-([A-Z]{2}\d{6})-500x500\.jpg)"')


async def get_satelite(atcf: str, cuadros: int = 12, cada_min: int = 30) -> Dict[str, Any]:
    """Últimas ~6 h de imágenes GeoColor (un cuadro cada 30 min), más la más reciente.

    Las URLs son directas a NOAA (dominio público): el navegador las baja sin pasar
    por el VPS. Aquí sólo se lee el índice del directorio (caché 5 min)."""
    atcf = atcf.upper()
    if not re.match(r"^(AL|EP|CP)\d{6}$", atcf):
        return {"cuadros": []}
    now = time.time()
    c = _sat_cache.get(atcf)
    if c and now - c[0] < 300:
        return c[1]
    carpeta = f"{_SAT_BASE}/{atcf}/GEOCOLOR/"
    try:
        r = await _get(carpeta)
        todos = []
        for m in _SAT_RE.finditer(r.text):
            nombre, anio, dia, hh, mm, sat, _ = m.groups()
            dt = datetime(int(anio), 1, 1, int(hh), int(mm), tzinfo=timezone.utc) + timedelta(days=int(dia) - 1)
            todos.append((dt, nombre, sat))
        todos = sorted(set(todos))
    except Exception as e:
        logger.info("Satélite flotante no disponible %s (%s)", atcf, e)
        return c[1] if c else {"cuadros": []}
    elegidos: List[Tuple[datetime, str, str]] = []
    for dt, nombre, sat in reversed(todos):          # del más nuevo hacia atrás
        if not elegidos or (elegidos[-1][0] - dt) >= timedelta(minutes=cada_min - 2):
            elegidos.append((dt, nombre, sat))
        if len(elegidos) >= cuadros:
            break
    elegidos.reverse()
    data = {
        "cuadros": [{"hora": dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "url": carpeta + nombre} for dt, nombre, _ in elegidos],
        "grande": f"{carpeta}latest.jpg",
        "satelite": elegidos[-1][2] if elegidos else None,
        "pagina": f"https://www.star.nesdis.noaa.gov/goes/floater.php?stormid={atcf}",
    }
    if len(_sat_cache) > 20:
        _sat_cache.clear()
    _sat_cache[atcf] = (now, data)
    return data


# ── Bitácora de la temporada ──────────────────────────────────────────────────
# El NHC no da un resumen de temporada en JSON: se arma aquí anotando cada
# tormenta que aparece (cada 10 min, desde cyclone_watch_task). Sólo cuenta desde
# que existe esta función (2026-09-25); lo anterior no está.
_NIVEL_ORD = {"baja": 0, "media": 1, "alta": 2}


def _ruta_temporada(directorio: str, anio: int) -> str:
    return os.path.join(directorio, f"temporada-{anio}.json")


def leer_temporada(directorio: str, anio: int) -> Dict[str, Any]:
    try:
        with open(_ruta_temporada(directorio, anio), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        logger.warning("Bitácora de temporada %s ilegible: %s", anio, e)
        return {}


def registrar_temporada(directorio: str, tormentas: List[Dict[str, Any]]) -> None:
    """Actualiza por tormenta: nombre, fechas, máximos de viento/categoría, mínimo
    de presión y el nivel de amenaza más alto que alcanzó para México."""
    por_anio: Dict[int, List[Dict[str, Any]]] = {}
    for t in tormentas:
        try:
            por_anio.setdefault(int(t["id"][-4:]), []).append(t)
        except (ValueError, KeyError):
            continue
    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for anio, ts in por_anio.items():
        log = leer_temporada(directorio, anio)
        for t in ts:
            e = log.setdefault(t["id"], {"id": t["id"], "cuenca": t["cuenca"], "primera": ahora})
            e["nombre"] = t["nombre"]           # una depresión puede recibir nombre después
            e["ultima"] = ahora
            kt = t.get("viento_kt")
            if kt is not None and kt >= (e.get("max_kt") or 0):
                e.update(max_kt=kt, max_tipo=t["tipo"], max_categoria=t.get("categoria"))
            if t.get("presion_mb") is not None and t["presion_mb"] < (e.get("min_mb") or 9999):
                e["min_mb"] = t["presion_mb"]
            if _NIVEL_ORD[t["nivel"]] >= _NIVEL_ORD.get(e.get("nivel_max", "baja"), 0):
                e["nivel_max"] = t["nivel"]
            if t.get("toca_tierra") and not e.get("toco_tierra"):
                e["toco_tierra"] = t["toca_tierra"]["lugar"]   # pronosticado, no confirmado
        try:
            os.makedirs(directorio, exist_ok=True)
            tmp = _ruta_temporada(directorio, anio) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(log, f, ensure_ascii=False)
            os.replace(tmp, _ruta_temporada(directorio, anio))
        except OSError as ex:
            logger.warning("No se pudo guardar la bitácora de temporada: %s", ex)


def resumen_temporada(directorio: str, anio: int) -> Dict[str, Any]:
    log = leer_temporada(directorio, anio)
    ts = sorted(log.values(), key=lambda e: e.get("primera", ""))
    def cuenta(cu: List[str]) -> Dict[str, int]:
        sub = [e for e in ts if e.get("cuenca") in cu]
        return {
            "total": len(sub),
            "tormentas": sum(1 for e in sub if (e.get("max_kt") or 0) >= 34),
            "huracanes": sum(1 for e in sub if (e.get("max_kt") or 0) >= 64),
            "mayores": sum(1 for e in sub if (e.get("max_kt") or 0) >= 96),
        }
    return {"anio": anio, "desde": ts[0]["primera"] if ts else None, "tormentas": ts,
            "pacifico": cuenta(["ep", "cp"]), "atlantico": cuenta(["al"])}


# ── Imágenes (proxy con caché: el navegador no depende de nhc.noaa.gov) ───────
_OUTLOOK = {"pacifico": "xgtwo/two_pac_7d0.png", "atlantico": "xgtwo/two_atl_7d0.png"}
_IMG_TORMENTA = {"cono": "5day_cone_es.png", "mensajes": "spanish_key_messages.png"}
_ATCF_RE = re.compile(r"^(AL|EP)(\d{2})(\d{4})$")


def img_url(atcf: str, tipo: str) -> Optional[str]:
    """URL del NHC para una imagen permitida (lista blanca: nada de URLs libres)."""
    if atcf == "outlook":
        p = _OUTLOOK.get(tipo)
        return f"{_BASE}/{p}" if p else None
    m = _ATCF_RE.match(atcf.upper())
    archivo = _IMG_TORMENTA.get(tipo)
    if not m or not archivo:
        return None
    # La carpeta del Atlántico es "AT06" aunque el id sea "AL062026" (verificado 2026-09-25).
    carpeta = f"{'AT' if m.group(1) == 'AL' else m.group(1)}{m.group(2)}"
    return f"{_BASE}/storm_graphics/{carpeta}/{atcf.upper()}_{archivo}"


async def get_img(url: str) -> Optional[Dict[str, Any]]:
    """{data, ctype, last_modified} de una imagen del NHC, revalidada cada minuto."""
    now = time.time()
    c = _img_cache.get(url)
    if c and now - c["ts"] < _IMG_TTL:
        return c
    headers = dict(_UA)
    if c and c.get("last_modified"):
        headers["If-Modified-Since"] = c["last_modified"]
    try:
        async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as cl:
            r = await cl.get(url)
        if r.status_code == 304 and c:
            c["ts"] = now
            return c
        r.raise_for_status()
        ctype = r.headers.get("content-type", "image/png").split(";")[0]
        if not ctype.startswith("image/"):
            raise ValueError(f"no es imagen: {ctype}")
    except Exception as e:
        if c:
            return c   # el NHC no responde: mejor la última buena
        logger.info("NHC imagen no disponible %s (%s)", url, e)
        return None
    if url not in _img_cache and len(_img_cache) >= _MAX_IMGS:
        _img_cache.pop(min(_img_cache, key=lambda k: _img_cache[k]["ts"]), None)
    entry = {"ts": now, "data": r.content, "ctype": ctype, "last_modified": r.headers.get("last-modified")}
    _img_cache[url] = entry
    return entry
