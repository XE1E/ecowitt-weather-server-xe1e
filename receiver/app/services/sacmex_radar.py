"""
Radar meteorológico del SACMEX (Sistema de Aguas de la Ciudad de México),
servido desde nuestro backend para la pestaña Radar.

Por qué pasa por aquí y no se incrusta: la página del SACMEX
(aplicaciones.sacmex.cdmx.gob.mx/radar-meteorologico/) manda
`X-Frame-Options: SAMEORIGIN`, así que un iframe sale en blanco; y la lista de
cuadros vigentes sólo viene dentro de su HTML, que el navegador no puede leer
desde otro origen. Las imágenes sí son públicas (JPG de reflectividad
compuesta, uno cada ~5 min).

Así, además, SACMEX recibe UNA consulta cada _TTL (no una por visitante) y si
su sitio falla se siguen sirviendo los últimos cuadros buenos, marcados
`stale`. Mismo patrón que satellite.py / xweather.py.
"""
import re
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

BASE = "https://aplicaciones.sacmex.cdmx.gob.mx"
PAGE_URL = f"{BASE}/radar-meteorologico/"
_IMG_PATH = "/radar/imageRadar/max1/"
_TTL = 300          # 5 min, el ritmo del propio radar
_TIMEOUT = 20.0
_MAX_FRAMES = 12
_UA = {"User-Agent": "ecowitt-weather-server (clima.xe1e.net)"}

# Nombre de cuadro: EWR-MAXZ<aammdd>_<hhmmss>r032XMax1.JPG, hora LOCAL de CDMX
# (el propio JPG la rotula "CST"). El id se valida con esto antes de pedir nada
# a SACMEX: el endpoint de imagen nunca arma una URL con texto libre.
FRAME_RE = re.compile(r"EWR-MAXZ(\d{6})_(\d{6})r\d{3}XMax1\.JPG")
_CDMX = timezone(timedelta(hours=-6))  # CDMX sin horario de verano

_state: Dict[str, Any] = {"ts": 0.0, "frames": [], "ok_ts": 0.0}
_images: Dict[str, bytes] = {}


def parse_frames(html: str) -> List[Dict[str, Any]]:
    """Cuadros que lista la página, en orden cronológico y sin duplicados."""
    seen = set()
    out: List[Dict[str, Any]] = []
    for m in FRAME_RE.finditer(html):
        name = m.group(0)
        if name in seen:
            continue
        seen.add(name)
        try:
            t = datetime.strptime(m.group(1) + m.group(2), "%y%m%d%H%M%S").replace(tzinfo=_CDMX)
        except ValueError:
            continue
        out.append({"id": name, "time": t.astimezone(timezone.utc).isoformat()})
    out.sort(key=lambda f: f["time"])
    return out[-_MAX_FRAMES:]


async def _fetch_image(client: httpx.AsyncClient, frame_id: str) -> Optional[bytes]:
    r = await client.get(f"{BASE}{_IMG_PATH}{frame_id}", headers=_UA)
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image/"):
        raise ValueError(f"respuesta no es imagen: {r.headers.get('content-type')}")
    return r.content


async def refresh(force: bool = False) -> None:
    """Relee la lista y baja los cuadros nuevos. Nunca lanza: ante error se
    conservan los cuadros anteriores."""
    now = time.time()
    if not force and now - _state["ts"] < _TTL:
        return
    _state["ts"] = now
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            r = await client.get(PAGE_URL, headers=_UA)
            r.raise_for_status()
            frames = parse_frames(r.text)
            if not frames:
                raise ValueError("la página no trae cuadros de radar")
            for f in frames:
                if f["id"] not in _images:
                    _images[f["id"]] = await _fetch_image(client, f["id"])
    except Exception as e:
        logger.warning(f"Radar SACMEX no disponible ({e}); se sirven los últimos cuadros buenos")
        return
    keep = {f["id"] for f in frames}
    for k in list(_images):
        if k not in keep:
            _images.pop(k, None)
    _state["frames"] = frames
    _state["ok_ts"] = now


async def get_frames() -> Dict[str, Any]:
    await refresh()
    frames = [f for f in _state["frames"] if f["id"] in _images]
    last = frames[-1]["time"] if frames else None
    age = None
    if last:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds() / 60
    return {
        "source": "SACMEX · Gobierno de la Ciudad de México",
        "source_url": PAGE_URL,
        "frames": [{"id": f["id"], "time": f["time"]} for f in frames],
        "latest_age_minutes": round(age, 1) if age is not None else None,
        # Viejo si el radar mismo dejó de publicar (último cuadro > 30 min) o si
        # nosotros no hemos podido refrescar en 3 ciclos.
        "stale": bool((age is not None and age > 30) or
                      (_state["ok_ts"] and time.time() - _state["ok_ts"] > 3 * _TTL)),
    }


def get_image(frame_id: str) -> Optional[bytes]:
    if not FRAME_RE.fullmatch(frame_id or ""):
        return None
    return _images.get(frame_id)
