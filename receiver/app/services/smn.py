"""
Pronóstico oficial del SMN (CONAGUA) para Benito Juárez, Ciudad de México.

Descarga los servicios web del SMN (gzip con TODOS los municipios), filtra el
municipio (ides=9, idmun=14) y normaliza:
  - method=1: pronóstico por día (4 días)
  - method=3: pronóstico por hora (48 h)
El SMN publica un pronóstico nuevo cada hora (a los :15); aquí se cachea ~30 min.
"""
import gzip
import json
import time
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

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
_cache: Dict[str, Any] = {"ts": 0.0, "data": None}


def _f(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _iso_date(dloc: str) -> str:
    # "20260723T00" -> "2026-07-23"
    return f"{dloc[0:4]}-{dloc[4:6]}-{dloc[6:8]}" if len(dloc) >= 8 else dloc


def _iso_hour(hloc: str) -> str:
    # "20260722T18" -> "2026-07-22T18:00"
    return f"{hloc[0:4]}-{hloc[4:6]}-{hloc[6:8]}T{hloc[9:11]}:00" if len(hloc) >= 11 else hloc


async def _fetch_filtered(method: int) -> List[Dict[str, Any]]:
    url = f"{_BASE}{method}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers={"User-Agent": "ecowitt-weather-server"})
        r.raise_for_status()
        raw = r.content
    try:
        raw = gzip.decompress(raw)
    except Exception:
        pass  # algunos métodos pueden venir sin comprimir
    arr = json.loads(raw)  # json detecta utf-8
    return [x for x in arr if str(x.get("ides")) == IDES and str(x.get("idmun")) == IDMUN]


async def get_forecast() -> Dict[str, Any]:
    now = time.time()
    if _cache["data"] and (now - _cache["ts"]) < _TTL:
        return _cache["data"]

    try:
        daily_raw = await _fetch_filtered(1)
        hourly_raw = await _fetch_filtered(3)
    except Exception as e:
        logger.error(f"SMN fetch failed: {e}")
        return _cache["data"] or {"source": "SMN CONAGUA", "municipio":
                                  "Benito Juárez, Ciudad de México", "days": [], "hours": []}

    daily = sorted(daily_raw, key=lambda x: int(x.get("ndia", 0) or 0))
    days = [{
        "date": _iso_date(d.get("dloc", "")),
        "tmax": _f(d.get("tmax")), "tmin": _f(d.get("tmin")),
        "prob_precip": _f(d.get("probprec")), "precip": _f(d.get("prec")),
        "sky": d.get("desciel"),
        "wind": _f(d.get("velvien")), "wind_dir": d.get("dirvienc"),
        "gust": _f(d.get("raf")), "cloud": _f(d.get("cc")),
    } for d in daily]

    # Solo horas de ahora en adelante (hloc en hora local; comparación léxica ok).
    now_local = datetime.now(_TZ).strftime("%Y%m%dT%H") if _TZ else ""
    hourly = sorted(hourly_raw, key=lambda x: x.get("hloc", ""))
    if now_local:
        hourly = [h for h in hourly if h.get("hloc", "") >= now_local] or hourly
    hours = [{
        "time": _iso_hour(h.get("hloc", "")),
        "temp": _f(h.get("temp")), "humidity": _f(h.get("hr")), "dew": _f(h.get("dpt")),
        "prob_precip": _f(h.get("probprec")), "precip": _f(h.get("prec")),
        "sky": h.get("desciel"),
        "wind": _f(h.get("velvien")), "wind_dir": h.get("dirvienc"), "gust": _f(h.get("raf")),
    } for h in hourly[:48]]

    data = {
        "source": "SMN CONAGUA",
        "municipio": "Benito Juárez, Ciudad de México",
        "lat": _f(daily_raw[0].get("lat")) if daily_raw else None,
        "lon": _f(daily_raw[0].get("lon")) if daily_raw else None,
        "fetched_at": datetime.utcnow().isoformat(),
        "days": days,
        "hours": hours,
    }
    _cache.update(ts=now, data=data)
    return data
