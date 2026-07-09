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


async def _from_ssn(limit: int) -> List[Dict[str, Any]]:
    """Parsea el RSS de últimos sismos del SSN (tolerante a variaciones)."""
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        r = await client.get(_SSN_URL, headers=_UA)
        r.raise_for_status()
        root = ET.fromstring(r.text)

    quakes: List[Dict[str, Any]] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        desc = (item.findtext("description") or "").strip()
        link = item.findtext("link")

        # Título: "4.1, 15 km al SUROESTE de PINOTEPA NACIONAL, OAX"
        mm = re.match(r"\s*([\d.]+)\s*,\s*(.+)", title)
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

        if mag is not None:
            quakes.append({
                "mag": mag, "place": place, "time": t,
                "depth_km": depth, "url": link,
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
            "mag": p.get("mag"), "place": p.get("place"),
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

    # 1) SSN (oficial de México)
    try:
        quakes = await _from_ssn(limit)
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

    data = {"quakes": quakes, "source": source}
    _CACHE.update(ts=now, data=data)
    return data
