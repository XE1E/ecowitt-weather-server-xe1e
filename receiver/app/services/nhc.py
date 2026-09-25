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
import io
import math
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
_IMG_TTL = 900
_MAX_IMGS = 40

_storms_cache: Dict[str, Any] = {"ts": 0.0, "data": None}
_track_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}   # kmz url -> (ts, puntos)
_img_cache: Dict[str, Tuple[float, bytes, str]] = {}               # url -> (ts, bytes, content-type)

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
            "graficas_url": (s.get("forecastGraphics") or {}).get("url"),
            "avisos_costeros": con_avisos,
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


async def get_img(url: str) -> Optional[Tuple[bytes, str]]:
    now = time.time()
    c = _img_cache.get(url)
    if c and now - c[0] < _IMG_TTL:
        return c[1], c[2]
    try:
        r = await _get(url)
        ctype = r.headers.get("content-type", "image/png").split(";")[0]
        if not ctype.startswith("image/"):
            raise ValueError(f"no es imagen: {ctype}")
    except Exception as e:
        if c:
            return c[1], c[2]
        logger.info("NHC imagen no disponible %s (%s)", url, e)
        return None
    if len(_img_cache) >= _MAX_IMGS:
        _img_cache.pop(min(_img_cache, key=lambda k: _img_cache[k][0]), None)
    _img_cache[url] = (now, r.content, ctype)
    return r.content, ctype
