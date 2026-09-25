"""Panel de administración: sesión, ajustes, estado del sistema, respaldos, pruebas de notificaciones, MQTT, asistente inicial, actualizaciones, logs y el resumen semanal por correo."""
import asyncio
import json
import logging
import os
import platform
import secrets
import shutil
import smtplib
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Body, Header, HTTPException, Request
from pydantic import BaseModel

from .. import state
from ..config import settings
from ..deps import require_admin
from ..logs import memory_log_handler
from ..services import admin as adminsvc
from ..services import backup_status, digest, r2_quota, settings_store
from ..services import security as secsvc
from ..services.alerts import AlertService

logger = logging.getLogger(__name__)
router = APIRouter()


# Limitadores de tasa (en memoria, por IP): login y endpoint de ingesta.
_login_limiter = secsvc.RateLimiter()


class LoginBody(BaseModel):
    user: str
    password: str


@router.post("/api/admin/login")
async def admin_login(body: LoginBody, request: Request):
    ip = secsvc.client_ip(request)
    # Anti-fuerza-bruta: máx. 5 intentos por IP por minuto.
    if not _login_limiter.allow(ip or "?", limit=5, window_s=60):
        logger.warning("Login admin bloqueado por rate-limit desde %s", ip or "?")
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera un momento.")
    token = adminsvc.login(settings, body.user, body.password)
    if not token:
        logger.warning("Login admin FALLIDO (user=%r) desde %s", body.user, ip or "?")
        raise HTTPException(status_code=401, detail="Credenciales inválidas o panel deshabilitado")
    logger.info("Login admin OK desde %s", ip or "?")
    return {"token": token}


@router.post("/api/admin/logout")
async def admin_logout(authorization: Optional[str] = Header(default=None)):
    """Revoca el token de sesión en el servidor (no solo en el cliente)."""
    adminsvc.logout(adminsvc.bearer_token(authorization))
    return {"status": "ok"}


@router.get("/api/admin/settings")
async def admin_get_settings(authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    return adminsvc.public_settings(settings)


@router.post("/api/admin/settings")
async def admin_save_settings(body: dict, authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    incoming = {k: v for k, v in body.items() if k in settings_store.EDITABLE_KEYS}
    # No sobreescribir claves secretas si vienen vacías (en blanco = conservar)
    for tk in settings_store.SECRET_KEYS:
        if tk in incoming and (incoming[tk] is None or incoming[tk] == ""):
            incoming.pop(tk)
    # Validar/coaccionar tipos según el modelo Settings (evita corromper la
    # config con tipos inválidos, p. ej. un puerto o un umbral no numérico).
    for k in list(incoming.keys()):
        v = incoming[k]
        if v is None:
            continue
        cur = getattr(settings, k, None)
        try:
            if isinstance(cur, bool):
                incoming[k] = v if isinstance(v, bool) else str(v).strip().lower() in ("1", "true", "yes", "on")
            elif isinstance(cur, int) and not isinstance(cur, bool):
                incoming[k] = int(float(v))
            elif isinstance(cur, float):
                incoming[k] = float(v)
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail=f"Valor inválido para '{k}'")
    current = settings_store.load_overrides(settings.settings_file)
    current.update(incoming)
    settings_store.save_overrides(settings.settings_file, current)
    adminsvc.apply_overrides(settings, state.alert_service, current)
    # Reconectar MQTT si cambió alguna configuración relacionada
    mqtt_keys = {"mqtt_enabled", "mqtt_broker", "mqtt_port", "mqtt_username",
                 "mqtt_password", "mqtt_topic", "hass_discovery", "hass_discovery_prefix"}
    if mqtt_keys & set(incoming.keys()):
        state.mqtt_publisher.reconnect()
    return {"status": "ok", "applied": list(incoming.keys())}


@router.get("/api/admin/status")
async def admin_status(authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    return {
        "station_offline": state.alert_service.station_offline,
        "last_received": state.latest_by_station.get(None, {}).get("received_at"),
        "active_alerts": [{"key": k, "message": m} for k, m in state.alert_service.active.items()],
        "alert_history": state.alert_service.get_history(limit=20),
        "alerts_enabled": settings.alerts_enabled,
        "telegram_enabled": settings.telegram_enabled,
        "email_enabled": settings.email_enabled,
        "mqtt_enabled": settings.mqtt_enabled,
        "waqi_configured": bool(settings.waqi_token),
        "ecowitt_secure_enabled": settings.ecowitt_secure_enabled,
        "admin_enabled": adminsvc.admin_enabled(settings),
        "publication": {
            "wu": settings.wu_enabled,
            "windy": settings.windy_enabled,
            "pws": settings.pws_enabled,
            "owm": settings.owm_enabled,
            "cwop": settings.cwop_enabled,
            "awekas": settings.awekas_enabled,
            "wow_be": settings.wow_be_enabled,
            "weathercloud": settings.weathercloud_enabled,
        },
    }


def _read_meminfo() -> Dict[str, int]:
    """Lee /proc/meminfo (compartido con el host) -> {clave: kB}."""
    info: Dict[str, int] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                if rest:
                    info[key.strip()] = int(rest.strip().split()[0])  # kB
    except OSError:
        pass
    return info


def _os_pretty_name() -> str:
    """Nombre del SO. Prefiere /host/os-release (montado desde el host, p. ej.
    Ubuntu) sobre /etc/os-release (imagen base del contenedor, Debian)."""
    for path in ("/host/os-release", "/etc/os-release"):
        try:
            with open(path) as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        return line.split("=", 1)[1].strip().strip('"')
        except OSError:
            continue
    return platform.system()


def _host_hostname() -> str:
    """Hostname del host (montado en /host/hostname). Dentro del contenedor
    platform.node() devuelve el ID del contenedor, no el del servidor."""
    try:
        with open("/host/hostname") as f:
            name = f.read().strip()
            if name:
                return name
    except OSError:
        pass
    return platform.node()


def _human_duration(seconds: float) -> str:
    s = int(seconds)
    d, rem = divmod(s, 86400)
    h, rem = divmod(rem, 3600)
    m, _ = divmod(rem, 60)
    parts: List[str] = []
    if d:
        parts.append(f"{d}d")
    if h:
        parts.append(f"{h}h")
    if not d:
        parts.append(f"{m}m")
    return " ".join(parts)


@router.get("/api/admin/backup-status")
async def admin_backup_status(authorization: Optional[str] = Header(default=None)):
    """Estado de los respaldos a R2 para el panel (Sistema): última corrida
    exitosa por categoría y si las credenciales de R2 están configuradas."""
    require_admin(authorization)
    r2_configured = bool(
        settings.r2_bucket and settings.r2_account_id
        and settings.r2_access_key_id and settings.r2_secret_access_key
    )
    return {
        "r2_configured": r2_configured,
        "r2_bucket": settings.r2_bucket if r2_configured else None,
        "backup_api_configured": bool(settings.backup_api_token),
        # Fotos no tiene retención propia en R2 (ver scripts/backup-camera-fotos.sh):
        # sigue esta, así que el panel la muestra para no obligar a ir a Cámara.
        "camera_retention_days": settings.camera_retention_days,
        "categories": backup_status.read_all(settings.backup_status_dir),
    }


@router.get("/api/admin/r2-usage")
async def admin_r2_usage(authorization: Optional[str] = Header(default=None)):
    """Uso de R2 del mes en curso vs. el tier gratis (ver services/r2_quota.py).

    Requiere `cloudflare_api_token` (DISTINTO a las claves S3 de R2) — sin él,
    responde `configured: false` en vez de un error, porque es una función
    opcional y no todos los que configuran R2 necesitan vigilar la cuota."""
    require_admin(authorization)
    if not (settings.cloudflare_api_token and settings.r2_account_id and settings.r2_bucket):
        return {"configured": False}
    usage = await r2_quota.get_r2_usage(
        settings.r2_account_id, settings.cloudflare_api_token, settings.r2_bucket
    )
    return {"configured": True, **usage}


@router.get("/api/admin/system-info")
async def admin_system_info(request: Request, authorization: Optional[str] = Header(default=None)):
    """Datos técnicos del servidor: SO, disco, memoria, CPU, uptime.

    Disco/memoria/CPU/uptime son del HOST: el contenedor comparte /proc y el
    volumen /data vive sobre el disco del host. El nombre del SO se lee de
    /host/os-release (montado desde el host) para reportar el SO real.
    """
    require_admin(authorization)
    GB = 1024 ** 3

    mem = _read_meminfo()
    mem_total = mem.get("MemTotal", 0) * 1024
    mem_avail = mem.get("MemAvailable", 0) * 1024
    mem_used = max(0, mem_total - mem_avail)

    try:
        du = shutil.disk_usage("/data")
        disk_total, disk_used, disk_free = du.total, du.used, du.free
    except OSError:
        disk_total = disk_used = disk_free = 0

    try:
        with open("/proc/uptime") as f:
            up = float(f.read().split()[0])
    except OSError:
        up = 0.0

    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        load1 = load5 = load15 = 0.0

    retention_days = os.environ.get("DATA_RETENTION_DAYS", "90").strip()
    retention = "Infinita" if retention_days in ("0", "") else f"{retention_days} días"

    return {
        "os": {
            "name": _os_pretty_name(),
            "kernel": platform.release(),
            "arch": platform.machine(),
            "hostname": _host_hostname(),
        },
        "cpu": {
            "cores": os.cpu_count(),
            "load_1m": round(load1, 2),
            "load_5m": round(load5, 2),
            "load_15m": round(load15, 2),
        },
        "memory": {
            "total_gb": round(mem_total / GB, 2),
            "used_gb": round(mem_used / GB, 2),
            "available_gb": round(mem_avail / GB, 2),
            "used_pct": round(mem_used / mem_total * 100, 1) if mem_total else None,
        },
        "disk": {
            "total_gb": round(disk_total / GB, 2),
            "used_gb": round(disk_used / GB, 2),
            "free_gb": round(disk_free / GB, 2),
            "used_pct": round(disk_used / disk_total * 100, 1) if disk_total else None,
        },
        "uptime": {"seconds": int(up), "human": _human_duration(up)},
        "runtime": {
            "python": platform.python_version(),
            "app_version": request.app.version,
            "influxdb_url": settings.influxdb_url,
            "data_retention": retention,
        },
    }


@router.post("/api/admin/test-telegram")
async def admin_test_telegram(authorization: Optional[str] = Header(default=None)):
    """Envía un mensaje de prueba a Telegram."""
    require_admin(authorization)
    if not settings.telegram_enabled or not settings.telegram_bot_token or not settings.telegram_chat_id:
        raise HTTPException(status_code=400, detail="Telegram no configurado")
    try:
        await state.alert_service.send_test_telegram()
        return {"status": "ok", "message": "Mensaje enviado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/admin/test-email")
async def admin_test_email(authorization: Optional[str] = Header(default=None)):
    """Envía un correo de prueba con la configuración SMTP actual."""
    require_admin(authorization)
    if not settings.email_enabled or not settings.smtp_host or not settings.email_to:
        raise HTTPException(status_code=400, detail="Correo no configurado (falta host o destinatario)")
    try:
        await state.alert_service.send_test_email()
        return {"status": "ok", "message": "Correo enviado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/admin/test-digest")
async def admin_test_digest(authorization: Optional[str] = Header(default=None)):
    """Envía el resumen semanal AHORA MISMO (con los datos reales de los últimos
    7 días), sin esperar al día/hora programados y sin marcar la semana como
    ya enviada -- ver `_build_and_send_digest(force=True)`."""
    require_admin(authorization)
    if not settings.email_enabled or not settings.smtp_host or not settings.email_to:
        raise HTTPException(status_code=400, detail="Correo no configurado (falta host o destinatario)")
    try:
        await _build_and_send_digest(force=True)
        return {"status": "ok", "message": "Resumen enviado"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/admin/test-all")
async def admin_test_all(authorization: Optional[str] = Header(default=None)):
    """Prueba los canales configurados (Telegram, correo, MQTT) y devuelve el
    resultado por servicio. ok=None significa 'no configurado' (se omite)."""
    require_admin(authorization)
    results = []

    async def _try(name, cond, coro_factory):
        if not cond:
            results.append({"service": name, "ok": None, "message": "No configurado"})
            return
        try:
            await coro_factory()
            results.append({"service": name, "ok": True, "message": "Enviado"})
        except Exception as e:
            results.append({"service": name, "ok": False, "message": str(e)[:150]})

    await _try("Telegram",
               settings.telegram_enabled and settings.telegram_bot_token and settings.telegram_chat_id,
               state.alert_service.send_test_telegram)
    await _try("Correo",
               settings.email_enabled and settings.smtp_host and settings.email_to,
               state.alert_service.send_test_email)

    if settings.mqtt_enabled:
        try:
            r = state.mqtt_publisher.test_connection(
                settings.mqtt_broker, settings.mqtt_port,
                settings.mqtt_username, settings.mqtt_password)
            results.append({"service": "MQTT", "ok": bool(r.get("success")),
                            "message": r.get("message", "")})
        except Exception as e:
            results.append({"service": "MQTT", "ok": False, "message": str(e)[:150]})
    else:
        results.append({"service": "MQTT", "ok": None, "message": "No configurado"})

    return {"results": results}


_GITHUB_REPO = os.environ.get("GITHUB_REPO", "XE1E/ecowitt-weather-server-xe1e")


@router.get("/api/admin/updates")
async def admin_updates(authorization: Optional[str] = Header(default=None)):
    """Consulta los últimos commits de la rama main en GitHub (repo público).
    Si GIT_SHA está horneado en la imagen, calcula cuántos commits de atraso hay."""
    require_admin(authorization)
    url = f"https://api.github.com/repos/{_GITHUB_REPO}/commits?sha=main&per_page=15"
    current = os.environ.get("GIT_SHA")  # se hornea en build (incremento 2); puede faltar
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"Accept": "application/vnd.github+json"})
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo consultar GitHub: {e}")
    commits = [{
        "sha": c["sha"][:7],
        "message": (c.get("commit", {}).get("message", "") or "").splitlines()[0][:120],
        "date": c.get("commit", {}).get("author", {}).get("date"),
        "url": c.get("html_url"),
    } for c in data]
    latest = commits[0] if commits else None
    behind = None
    if current and commits:
        shas = [c["sha"] for c in commits]
        if current[:7] in shas:
            behind = shas.index(current[:7])   # nº de commits más nuevos que el actual
    return {
        "repo": _GITHUB_REPO,
        "current_sha": current[:7] if current else None,
        "latest": latest,
        "behind": behind,
        "commits": commits,
    }


@router.get("/api/admin/setup-status")
async def admin_setup_status(authorization: Optional[str] = Header(default=None)):
    """Retorna si el wizard de configuración inicial se ha completado."""
    require_admin(authorization)
    return {"setup_completed": settings_store.get_setup_completed(settings.settings_file)}


@router.get("/api/admin/logs")
async def admin_logs(
    limit: int = 100,
    minutes: Optional[int] = None,
    authorization: Optional[str] = Header(default=None)
):
    """
    Retorna los últimos logs del sistema. Con `minutes` filtra por ventana de
    tiempo real (recomendado) en vez de `limit` por cantidad de líneas.
    """
    require_admin(authorization)
    if minutes is not None:
        logs = memory_log_handler.get_logs_since(minutes=min(minutes, 240))
    else:
        logs = memory_log_handler.get_logs(limit=min(limit, 1500))
    return {"logs": logs}


@router.get("/api/admin/mqtt/status")
async def admin_mqtt_status(authorization: Optional[str] = Header(default=None)):
    """Retorna el estado de la conexión MQTT."""
    require_admin(authorization)
    return state.mqtt_publisher.get_status()


@router.post("/api/admin/mqtt/test")
async def admin_mqtt_test(body: dict, authorization: Optional[str] = Header(default=None)):
    """Prueba la conexión MQTT con los parámetros dados."""
    require_admin(authorization)
    broker = body.get("broker") or settings.mqtt_broker
    port = body.get("port") or settings.mqtt_port
    username = body.get("username") or settings.mqtt_username
    password = body.get("password") or settings.mqtt_password
    result = state.mqtt_publisher.test_connection(broker, port, username, password)
    return result


@router.post("/api/admin/mqtt/reconnect")
async def admin_mqtt_reconnect(authorization: Optional[str] = Header(default=None)):
    """Fuerza reconexión MQTT con la configuración actual."""
    require_admin(authorization)
    success = state.mqtt_publisher.reconnect()
    return {"success": success, "status": state.mqtt_publisher.get_status()}


@router.post("/api/admin/setup-complete")
async def admin_setup_complete(authorization: Optional[str] = Header(default=None)):
    """Marca el wizard de configuración como completado."""
    require_admin(authorization)
    settings_store.set_setup_completed(settings.settings_file, True)
    return {"status": "ok"}


def _alert_service_with(**overrides) -> AlertService:
    """Servicio de alertas con los ajustes actuales + credenciales aún SIN guardar
    (las que se están probando en el asistente). Así la prueba usa exactamente el
    mismo código de envío que las alertas reales: correo en un hilo (smtplib es
    bloqueante), SSL en el 465, corrección del remitente… Antes el asistente tenía
    su propia copia, que bloqueaba el servidor mientras conectaba y no hacía SSL."""
    return AlertService(settings.model_copy(update=overrides))


@router.post("/api/admin/wizard/test-telegram")
async def admin_wizard_test_telegram(
    body: dict,
    authorization: Optional[str] = Header(default=None)
):
    """Prueba credenciales de Telegram durante el wizard (sin guardarlas aún)."""
    require_admin(authorization)
    bot_token = body.get("bot_token")
    chat_id = body.get("chat_id")
    if not bot_token or not chat_id:
        raise HTTPException(status_code=400, detail="Faltan bot_token o chat_id")
    svc = _alert_service_with(telegram_bot_token=bot_token, telegram_chat_id=chat_id)
    try:
        await svc.send_test_telegram()
        return {"status": "ok", "message": "Mensaje enviado correctamente"}
    except httpx.HTTPStatusError as e:
        try:
            desc = e.response.json().get("description")
        except Exception:
            desc = None
        return {"status": "error", "message": desc or f"Telegram respondió {e.response.status_code}"}
    except Exception as e:
        logger.warning("Prueba de Telegram del asistente falló: %s", e)
        return {"status": "error", "message": "No se pudo contactar a Telegram"}


@router.post("/api/admin/wizard/test-email")
async def admin_wizard_test_email(
    body: dict,
    authorization: Optional[str] = Header(default=None)
):
    """Prueba credenciales de correo durante el wizard (sin guardarlas aún)."""
    require_admin(authorization)
    smtp_host = body.get("smtp_host")
    to_addresses = body.get("to_addresses")
    if not smtp_host or not to_addresses:
        raise HTTPException(status_code=400, detail="Faltan smtp_host o to_addresses")
    svc = _alert_service_with(
        smtp_host=smtp_host,
        smtp_port=int(body.get("smtp_port") or 587),
        smtp_user=body.get("smtp_user"),
        smtp_password=body.get("smtp_password"),
        email_from=body.get("from_address"),
        email_to=to_addresses,
        smtp_tls=bool(body.get("starttls", True)),
    )
    try:
        await svc.send_test_email()
        return {"status": "ok", "message": "Correo enviado correctamente"}
    except smtplib.SMTPAuthenticationError:
        return {"status": "error", "message": "Error de autenticación SMTP"}
    except (smtplib.SMTPConnectError, OSError):
        return {"status": "error", "message": "No se pudo conectar al servidor SMTP"}
    except Exception as e:
        logger.warning("Prueba de correo del asistente falló: %s", e)
        return {"status": "error", "message": f"El envío falló: {type(e).__name__}"}


@router.get("/api/backup/r2-credentials")
async def backup_r2_credentials(request: Request):
    """
    Credenciales de Cloudflare R2 para scripts/backup-*.sh.

    Esos scripts corren por cron en el VPS, FUERA del contenedor, y las
    credenciales ahora se configuran desde Admin (settings.json) y no en el
    .env: por eso las piden aquí en vez de leerlas de un archivo. Autenticación
    por token propio en `X-Backup-Token`, NO el del panel de administración —
    mismo motivo que camera_upload_token: si se filtra, sólo permite leer estas
    credenciales, no entrar al panel ni a nada más.

    Sin `BACKUP_API_TOKEN` configurado responde 503: es una ruta que devuelve
    secretos, y dejarla abierta "hasta que la configure" expondría R2 a quien
    sea que la encuentre.
    """
    esperado = settings.backup_api_token
    if not esperado:
        raise HTTPException(status_code=503, detail="Respaldo a R2 no configurado")

    recibido = request.headers.get("X-Backup-Token") or ""
    if not secrets.compare_digest(recibido, esperado):
        raise HTTPException(status_code=401, detail="Token inválido")

    return {
        "r2_account_id": settings.r2_account_id,
        "r2_access_key_id": settings.r2_access_key_id,
        "r2_secret_access_key": settings.r2_secret_access_key,
        "r2_bucket": settings.r2_bucket,
        "r2_timelapse_retention_days": settings.r2_timelapse_retention_days,
        "r2_analisis_retention_days": settings.r2_analisis_retention_days,
        "r2_archivo_retention_days": settings.r2_archivo_retention_days,
        "r2_influx_keep": settings.r2_influx_keep,
    }


@router.post("/api/admin/docker-health")
async def report_docker_health(request: Request, body: Dict[str, Any] = Body(...)):
    """
    Recibe qué contenedores del stack están "unhealthy" ahora mismo, desde
    `scripts/check-docker-health.sh` (cron en el HOST, fuera de los
    contenedores -- ninguno de ellos puede ver a los demás ni tiene acceso al
    socket de Docker para consultar `docker inspect` sobre sí mismo).

    Autenticación por token propio en `X-Docker-Health-Token`, NO el del panel
    de administración -- mismo motivo que `backup_api_token`: si se filtra,
    sólo permite reportar salud de contenedores, no entrar al panel ni a nada
    más. Sin `DOCKER_HEALTH_API_TOKEN` configurado responde 503.
    """
    esperado = settings.docker_health_api_token
    if not esperado:
        raise HTTPException(status_code=503, detail="Monitoreo de Docker no configurado")

    recibido = request.headers.get("X-Docker-Health-Token") or ""
    if not secrets.compare_digest(recibido, esperado):
        raise HTTPException(status_code=401, detail="Token inválido")

    unhealthy = body.get("unhealthy") or []
    if not isinstance(unhealthy, list):
        raise HTTPException(status_code=400, detail="'unhealthy' debe ser una lista")

    await state.alert_service.check_docker_health([str(x) for x in unhealthy])
    return {"status": "ok"}


def _read_digest_state() -> Optional[str]:
    """Última semana ISO ya enviada (o None si nunca), desde `digest_state_file`."""
    try:
        with open(settings.digest_state_file, encoding="utf-8") as f:
            return json.load(f).get("last_sent_week")
    except (OSError, ValueError):
        return None


def _write_digest_state(week: str) -> None:
    try:
        os.makedirs(os.path.dirname(settings.digest_state_file), exist_ok=True)
        tmp = settings.digest_state_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"last_sent_week": week}, f)
        os.replace(tmp, settings.digest_state_file)
    except OSError as e:
        logger.warning("no se pudo guardar el estado del resumen semanal: %s", e)


async def _build_and_send_digest(force: bool = False) -> None:
    """
    Arma y manda el resumen semanal. `force=True` (usado por el botón "Enviar
    prueba" del panel) ignora `email_digest_enabled`/el día-hora configurados y
    NO actualiza `digest_state_file` -- una prueba no debe "gastar" el envío
    de la semana real.
    """
    week_start, week_end, week_dates = digest.week_range(datetime.now().astimezone().date())
    _, _, prev_dates = digest.week_range(datetime.strptime(week_start, "%Y-%m-%d").date())

    all_rows = await state.storage.query_daily_summaries(start="-16d")
    week_set, prev_set = set(week_dates), set(prev_dates)
    week_rows = [r for r in all_rows if str(r.get("date")) in week_set]
    prev_rows = [r for r in all_rows if str(r.get("date")) in prev_set]

    best_photo_date = state.camera.best_of_week(week_dates)

    msg = digest.build_weekly_digest(week_rows, prev_rows, week_start, week_end, best_photo_date=best_photo_date)
    if force:
        msg["subject"] = "🧪 Prueba — " + msg["subject"]
    await state.alert_service.send_digest(msg["subject"], msg["body"])
    if not force:
        _write_digest_state(digest.week_id(datetime.now().astimezone().date()))


async def email_digest_task():
    """Revisa cada hora (mismo idiom que timelapse_task/daily_rollup_task) si
    toca mandar el resumen semanal (email_digest_enabled + día/hora configurados,
    ver digest.is_due). El estado de "ya se mandó esta semana" vive en un
    archivito propio (digest_state_file) para no duplicar si el receiver se
    reinicia el mismo día programado."""
    await asyncio.sleep(180)  # gracia inicial
    while True:
        try:
            if getattr(settings, "email_digest_enabled", False):
                now = datetime.now().astimezone()
                if digest.is_due(now, settings.email_digest_weekday, settings.email_digest_hour, _read_digest_state()):
                    await _build_and_send_digest(force=False)
                    logger.info("Resumen semanal enviado")
        except Exception as e:
            logger.error(f"Resumen semanal falló: {e}")
        await asyncio.sleep(3600)
