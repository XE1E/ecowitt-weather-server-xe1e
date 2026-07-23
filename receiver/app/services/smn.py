"""
Pronóstico oficial del SMN (CONAGUA) por municipio de México.

Descarga los servicios web del SMN (gzip con TODOS los municipios) y filtra el
municipio pedido (por defecto Benito Juárez, CDMX: ides=9, idmun=14):
  - method=1: pronóstico por día (4 días)  ·  archivo pequeño (~0.3 MB)
  - method=3: pronóstico por hora (48 h)    ·  archivo grande (~7 MB)
El SMN publica un pronóstico nuevo cada hora (a los :15); aquí se cachea ~30 min.

- El diario (method=1) se cachea COMPLETO (para la lista de municipios y para
  filtrar cualquiera al instante).
- El horario (method=3) se cachea POR municipio (se descarga bajo demanda).
"""
import gzip
import json
import time
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo("America/Mexico_City")
except Exception:  # pragma: no cover
    _TZ = None

_BASE = "https://smn.conagua.gob.mx/tools/GUI/webservices/?method="
IDES, IDMUN = "9", "14"   # Benito Juárez, Ciudad de México
_TTL = 1800               # 30 min

_daily_cache: Dict[str, Any] = {"ts": 0.0, "rows": None}
_muni_cache: Dict[str, Any] = {"ts": 0.0, "list": None}
_hourly_cache: Dict[str, Dict[str, Any]] = {}   # "ides:idmun" -> {ts, hours}
_MAX_HOURLY = 24          # municipios con horario en caché (evita crecer sin fin)


def _f(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _iso_date(dloc: str) -> str:
    return f"{dloc[0:4]}-{dloc[4:6]}-{dloc[6:8]}" if len(dloc) >= 8 else dloc


def _iso_hour(hloc: str) -> str:
    return f"{hloc[0:4]}-{hloc[4:6]}-{hloc[6:8]}T{hloc[9:11]}:00" if len(hloc) >= 11 else hloc


async def _fetch(method: int) -> List[Dict[str, Any]]:
    url = f"{_BASE}{method}"
    async with httpx.AsyncClient(timeout=40) as client:
        r = await client.get(url, headers={"User-Agent": "ecowitt-weather-server"})
        r.raise_for_status()
        raw = r.content
    try:
        raw = gzip.decompress(raw)
    except Exception:
        pass
    return json.loads(raw)


async def _daily_all() -> List[Dict[str, Any]]:
    now = time.time()
    if _daily_cache["rows"] and (now - _daily_cache["ts"]) < _TTL:
        return _daily_cache["rows"]
    rows = await _fetch(1)
    _daily_cache.update(ts=now, rows=rows)
    return rows


async def municipios() -> List[Dict[str, Any]]:
    """Lista única de municipios (para autocompletar): ides, idmun, nes, nmun."""
    now = time.time()
    if _muni_cache["list"] and (now - _muni_cache["ts"]) < _TTL:
        return _muni_cache["list"]
    rows = await _daily_all()
    seen: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for r in rows:
        key = (str(r.get("ides")), str(r.get("idmun")))
        if key not in seen:
            seen[key] = {"ides": key[0], "idmun": key[1],
                         "nes": r.get("nes"), "nmun": r.get("nmun")}
    lst = sorted(seen.values(), key=lambda x: (x["nes"] or "", x["nmun"] or ""))
    _muni_cache.update(ts=now, list=lst)
    return lst


async def _hourly_for(ides: str, idmun: str) -> List[Dict[str, Any]]:
    key = f"{ides}:{idmun}"
    now = time.time()
    c = _hourly_cache.get(key)
    if c and (now - c["ts"]) < _TTL:
        return c["hours"]
    rows = await _fetch(3)
    mine = [x for x in rows if str(x.get("ides")) == ides and str(x.get("idmun")) == idmun]
    if len(_hourly_cache) >= _MAX_HOURLY:  # evicción del más viejo
        oldest = min(_hourly_cache, key=lambda k: _hourly_cache[k]["ts"])
        _hourly_cache.pop(oldest, None)
    _hourly_cache[key] = {"ts": now, "hours": mine}
    return mine


async def get_forecast(ides: str = IDES, idmun: str = IDMUN, hourly: bool = True) -> Dict[str, Any]:
    ides, idmun = str(ides), str(idmun)
    daily_all = await _daily_all()
    mine = sorted(
        [x for x in daily_all if str(x.get("ides")) == ides and str(x.get("idmun")) == idmun],
        key=lambda x: int(x.get("ndia", 0) or 0),
    )
    if not mine:
        return {"source": "SMN CONAGUA", "municipio": None, "days": [], "hours": []}

    days = [{
        "date": _iso_date(d.get("dloc", "")),
        "tmax": _f(d.get("tmax")), "tmin": _f(d.get("tmin")),
        "prob_precip": _f(d.get("probprec")), "precip": _f(d.get("prec")),
        "sky": d.get("desciel"),
        "wind": _f(d.get("velvien")), "wind_dir": d.get("dirvienc"),
        "gust": _f(d.get("raf")), "cloud": _f(d.get("cc")),
    } for d in mine]

    hours: List[Dict[str, Any]] = []
    if hourly:
        try:
            hraw = await _hourly_for(ides, idmun)
            now_local = datetime.now(_TZ).strftime("%Y%m%dT%H") if _TZ else ""
            hraw = sorted(hraw, key=lambda x: x.get("hloc", ""))
            if now_local:
                hraw = [h for h in hraw if h.get("hloc", "") >= now_local] or hraw
            hours = [{
                "time": _iso_hour(h.get("hloc", "")),
                "temp": _f(h.get("temp")), "humidity": _f(h.get("hr")), "dew": _f(h.get("dpt")),
                "prob_precip": _f(h.get("probprec")), "precip": _f(h.get("prec")),
                "sky": h.get("desciel"),
                "wind": _f(h.get("velvien")), "wind_dir": h.get("dirvienc"), "gust": _f(h.get("raf")),
            } for h in hraw[:48]]
        except Exception as e:
            logger.error(f"SMN hourly failed: {e}")

    m0 = mine[0]
    return {
        "source": "SMN CONAGUA",
        "ides": ides, "idmun": idmun,
        "municipio": f"{m0.get('nmun')}, {m0.get('nes')}",
        "nmun": m0.get("nmun"), "nes": m0.get("nes"),
        "lat": _f(m0.get("lat")), "lon": _f(m0.get("lon")),
        "fetched_at": datetime.utcnow().isoformat(),
        "days": days,
        "hours": hours,
    }
