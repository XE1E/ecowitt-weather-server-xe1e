"""Kiosco: lecturas del BME280 del display (con mín/máx del día) y su configuración."""
import json
import logging
import os
import secrets
from datetime import datetime
from typing import Any, Dict
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, HTTPException, Request

from ..config import settings
from ..services import security as secsvc

logger = logging.getLogger(__name__)
router = APIRouter()
_MX_TZ = ZoneInfo("America/Mexico_City")


_KIOSK_LOCAL_FILE = os.environ.get("KIOSK_LOCAL_FILE", "/data/kiosk_local.json")


_kiosk_local: Dict[str, Any] = {"latest": None, "day": None, "min": {}, "max": {}}


def _kiosk_local_load() -> None:
    """Restaura el estado persistido, si hay. El `day` se carga tal cual: si es de
    un día anterior, el primer POST que llegue detecta el cambio y reinicia los
    min/max, igual que si el proceso no se hubiera reiniciado."""
    try:
        with open(_KIOSK_LOCAL_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return                      # no existe, o quedó corrupto: se empieza limpio
    if not isinstance(data, dict):
        return
    _kiosk_local.update(
        latest=data.get("latest"),
        day=data.get("day"),
        min=data.get("min") or {},
        max=data.get("max") or {},
    )
    print(f"[kiosk] estado local restaurado (día {_kiosk_local['day']})", flush=True)


def _kiosk_local_save() -> None:
    """Guarda con escritura atómica (archivo temporal + replace) para no dejar un
    JSON truncado si el contenedor muere justo durante el guardado."""
    tmp = f"{_KIOSK_LOCAL_FILE}.tmp"
    try:
        os.makedirs(os.path.dirname(_KIOSK_LOCAL_FILE) or ".", exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_kiosk_local, fh)
        os.replace(tmp, _KIOSK_LOCAL_FILE)
    except OSError as e:
        print(f"[kiosk] no se pudo guardar {_KIOSK_LOCAL_FILE}: {e}", flush=True)


# Rangos físicos aceptados del BME280 del display: lo de fuera se ignora. El endpoint
# es público (el firmware del display aún no manda token), así que sin esto cualquiera
# podía escribir valores absurdos en la página 2 del kiosco.
_KIOSK_RANGES = {"temperature": (-20.0, 60.0), "humidity": (0.0, 100.0), "pressure": (500.0, 1100.0)}


_kiosk_limiter = secsvc.RateLimiter()


@router.post("/api/kiosk/local")
async def kiosk_local_post(request: Request, body: dict = Body(...)):
    """Recibe la lectura del BME280 del display (temperature °C, humidity %, pressure hPa)."""
    token = getattr(settings, "kiosk_local_token", "") or ""
    if token and not secrets.compare_digest(request.headers.get("x-kiosk-token", ""), token):
        raise HTTPException(status_code=401, detail="Token inválido")
    # El display manda una lectura cada ~30 s: 12/min por IP es holgado.
    if not _kiosk_limiter.allow(secsvc.client_ip(request) or "?", limit=12, window_s=60):
        raise HTTPException(status_code=429, detail="Demasiadas peticiones")
    today = datetime.now(_MX_TZ).strftime("%Y-%m-%d")
    if _kiosk_local["day"] != today:
        _kiosk_local.update(day=today, min={}, max={})
    vals: Dict[str, float] = {}
    for k in ("temperature", "humidity", "pressure"):
        v = body.get(k)
        lo, hi = _KIOSK_RANGES[k]
        if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi:
            fv = round(float(v), 1)
            vals[k] = fv
            _kiosk_local["min"][k] = round(min(_kiosk_local["min"].get(k, fv), fv), 1)
            _kiosk_local["max"][k] = round(max(_kiosk_local["max"].get(k, fv), fv), 1)
    _kiosk_local["latest"] = {**vals, "received_at": datetime.utcnow().isoformat()}
    _kiosk_local_save()
    return {"ok": True}


@router.get("/api/kiosk/local")
async def kiosk_local_get():
    """Último BME280 local + min/max del día, para la página kiosco (página 2)."""
    return {
        "latest": _kiosk_local["latest"],
        "min": _kiosk_local["min"],
        "max": _kiosk_local["max"],
        "day": _kiosk_local["day"],
    }


@router.get("/api/kiosk/config")
async def kiosk_config():
    """Config pública que leen las páginas del kiosco (consola, menú) para decidir qué
    mostrar. De momento sólo si la cámara aparece; se puede ampliar sin romper nada."""
    return {"camera_enabled": settings.kiosk_camera_enabled}


# Al arrancar: recuperar la última lectura y los mín/máx del día (sobreviven reinicios).
_kiosk_local_load()
