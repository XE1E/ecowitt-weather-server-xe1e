"""
Sismos recientes — fuente híbrida: SSN (oficial de México, UNAM) con respaldo USGS.

Se intenta primero el SSN (Servicio Sismológico Nacional): es la fuente oficial
mexicana y detecta sismos locales pequeños con nombres en español. Como su feed
no siempre está disponible, si falla o no devuelve nada se usa USGS (global,
muy estable). El resultado se cachea unos minutos.

Dato externo, no medido por la estación.
"""
import re
import time
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx

try:
    from zoneinfo import ZoneInfo
    _MX = ZoneInfo("America/Mexico_City")
except Exception:  # pragma: no cover
    _MX = timezone(timedelta(hours=-6))

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {"ts": 0.0, "data": {}}
_TTL = 600  # 10 min
_UA = {"user-agent": "clima-xe1e/1.0"}
_SSN_URL = "http://www.ssn.unam.mx/rss/ultimos-sismos.xml"
_USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"


# Traducción de rumbos de USGS (inglés) a español, del más largo al más corto
_DIRS_EN_ES = [
    ("NNE", "NNE"), ("ENE", "ENE"), ("ESE", "ESE"), ("SSE", "SSE"),
    ("SSW", "SSO"), ("WSW", "OSO"), ("WNW", "ONO"), ("NNW", "NNO"),
    ("NE", "NE"), ("NW", "NO"), ("SE", "SE"), ("SW", "SO"),
    ("N", "N"), ("S", "S"), ("E", "E"), ("W", "O"),
]


def _es_place(place: Optional[str]) -> Optional[str]:
    """'8 km WNW of Tepetixtla, Mexico' -> '8 km al ONO de Tepetixtla, México'."""
    if not place:
        return place
    m = re.match(r"^\s*(\d+)\s*km\s+([NSEW]+)\s+of\s+(.+)$", place)
    if m:
        dist, dir_en, rest = m.group(1), m.group(2), m.group(3)
        dir_es = dict(_DIRS_EN_ES).get(dir_en, dir_en)
        place = f"{dist} km al {dir_es} de {rest}"
    else:
        place = re.sub(r"\bnear the coast of\b", "cerca de la costa de", place, flags=re.I)
        place = re.sub(r"\boff the coast of\b", "frente a la costa de", place, flags=re.I)
        place = re.sub(r"\bof\b", "de", place)
    return place.replace("Mexico", "México")


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en km entre dos puntos (esfera)."""
    import math
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _ssn_latlon(desc: str) -> Optional[tuple]:
    """
    Lat/lon de la descripción del SSN, si vienen. El formato ha variado:
    - Antiguo: "Latitud: 16.31 Longitud: -98.42"
    - Nuevo (2026+): "Lat/Lon: 15.27/-93.87"
    Se aceptan ambos formatos.
    """
    # Formato nuevo: "Lat/Lon: 15.27/-93.87"
    m = re.search(r"Lat/Lon[:\s]*(-?\d+(?:\.\d+)?)\s*/\s*(-?\d+(?:\.\d+)?)", desc)
    if m:
        try:
            return float(m.group(1)), float(m.group(2))
        except ValueError:
            pass
    # Formato antiguo: "Latitud: X Longitud: Y"
    la = re.search(r"[Ll]atitud[:\s]*(-?\d+(?:\.\d+)?)", desc)
    lo = re.search(r"[Ll]ongitud[:\s]*(-?\d+(?:\.\d+)?)", desc)
    if la and lo:
        try:
            return float(la.group(1)), float(lo.group(1))
        except ValueError:
            return None
    return None


async def _from_ssn(limit: int, lat: float, lon: float,
                    radius_km: float, min_mag: float) -> List[Dict[str, Any]]:
    """
    Parsea el RSS de últimos sismos del SSN (tolerante a variaciones).

    Aplica los MISMOS criterios que la rama de USGS (magnitud mínima y radio):
    antes el SSN devolvía los últimos sismos de todo México sin filtrar, así que
    la tarjeta rotulada "cerca de la estación" podía mostrar uno de magnitud 3.2 a
    900 km — y el criterio cambiaba según qué fuente hubiera respondido.

    La distancia solo se aplica si la descripción trae coordenadas; si no vienen,
    se conserva el sismo (mejor de más que perder uno cercano por un cambio de
    formato del feed).
    """
    async with httpx.AsyncClient(timeout=6, follow_redirects=True) as client:
        r = await client.get(_SSN_URL, headers=_UA)
        r.raise_for_status()
        root = ET.fromstring(r.text)

    # Namespace para geo:lat y geo:long
    ns = {"geo": "http://www.w3.org/2003/01/geo/wgs84_pos#"}

    quakes: List[Dict[str, Any]] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        desc = (item.findtext("description") or "").strip()
        link = item.findtext("link")

        # Título: "4.1, 15 km al SUROESTE de PINOTEPA NACIONAL, OAX"
        # o "Preliminar: M 4.6, 85 km al SUROESTE de PIJIJIAPAN, CHIS"
        title_clean = re.sub(r"^Preliminar:\s*M?\s*", "", title)
        mm = re.match(r"\s*([\d.]+)\s*,\s*(.+)", title_clean)
        mag = float(mm.group(1)) if mm else None
        place = mm.group(2).strip() if mm else (title or "Sismo")

        # Descripción: Fecha, Lat/Lon, Profundidad (formatos ligeramente variables)
        t = None
        fm = re.search(r"(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})", desc)
        if fm:
            try:
                dt = datetime.strptime(fm.group(1).replace("T", " "), "%Y-%m-%d %H:%M:%S")
                t = dt.replace(tzinfo=_MX).timestamp()  # hora de México -> epoch UTC
            except ValueError:
                t = None
        dm = re.search(r"[Pp]rofundidad[:\s]*([\d.]+)", desc)
        depth = float(dm.group(1)) if dm else None

        if mag is None or mag < min_mag:
            continue

        # Coordenadas: primero de las etiquetas geo:lat/geo:long (más confiable),
        # luego de la descripción como fallback
        coords = None
        geo_lat = item.findtext("geo:lat", namespaces=ns)
        geo_lon = item.findtext("geo:long", namespaces=ns)
        if geo_lat and geo_lon:
            try:
                coords = (float(geo_lat), float(geo_lon))
            except ValueError:
                pass
        if coords is None:
            coords = _ssn_latlon(desc)

        dist = _haversine_km(lat, lon, coords[0], coords[1]) if coords else None
        if dist is not None and dist > radius_km:
            continue
        quakes.append({
            "mag": mag, "place": place, "time": t,
            "depth_km": depth, "url": link,
            "distance_km": round(dist) if dist is not None else None,
        })
        if len(quakes) >= limit:
            break
    return quakes


async def _from_usgs(lat, lon, radius_km, min_mag, limit) -> List[Dict[str, Any]]:
    params = {
        "format": "geojson", "latitude": lat, "longitude": lon,
        "maxradiuskm": radius_km, "minmagnitude": min_mag,
        "orderby": "time", "limit": limit,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(_USGS_URL, params=params, headers=_UA)
        r.raise_for_status()
        js = r.json()

    quakes: List[Dict[str, Any]] = []
    for f in js.get("features", []):
        p = f.get("properties", {})
        g = (f.get("geometry", {}) or {}).get("coordinates", [None, None, None])
        t_ms = p.get("time")
        quakes.append({
            "mag": p.get("mag"), "place": _es_place(p.get("place")),
            "time": (t_ms / 1000.0) if t_ms is not None else None,
            "depth_km": g[2] if len(g) > 2 else None,
            "url": p.get("url"),
        })
    return quakes


async def get_earthquakes(
    lat: float = 19.380359, lon: float = -99.174564,
    radius_km: float = 800.0, min_mag: float = 4.0, limit: int = 6,
) -> Dict[str, Any]:
    now = time.time()
    if _CACHE["data"] and (now - _CACHE["ts"]) < _TTL:
        return _CACHE["data"]

    quakes: List[Dict[str, Any]] = []
    source = None

    # 1) SSN (oficial de México), con los mismos criterios que USGS
    try:
        quakes = await _from_ssn(limit, lat, lon, radius_km, min_mag)
        if quakes:
            source = "SSN"
    except Exception as e:
        logger.info(f"SSN no disponible, se usa USGS: {e}")

    # 2) Respaldo: USGS
    if not quakes:
        try:
            quakes = await _from_usgs(lat, lon, radius_km, min_mag, limit)
            source = "USGS"
        except Exception as e:
            logger.error(f"Error fetching earthquakes (USGS): {e}")
            return _CACHE["data"] or {"quakes": [], "source": None}

    # Se expone el criterio aplicado para que la UI pueda decir de qué habla
    # cuando rotula "cerca de la estación".
    data = {"quakes": quakes, "source": source,
            "radius_km": radius_km, "min_mag": min_mag}
    _CACHE.update(ts=now, data=data)
    return data
