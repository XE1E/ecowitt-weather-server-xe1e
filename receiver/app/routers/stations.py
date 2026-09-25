"""Estaciones: lista y estado (en línea/sin datos), detección de sensores, alta/baja, registro por MAC (passkeys) y calibración/umbrales propios de cada estación."""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Header, HTTPException

from .. import state
from ..config import settings
from ..deps import require_admin
from ..services import admin as adminsvc
from ..services import settings_store

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/admin/stations/{name}/calibration")
async def admin_get_station_calibration(name: str, authorization: Optional[str] = Header(default=None)):
    """Calibración propia de una estación secundaria (dict de claves cal_*)."""
    require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    cfg = settings_store.get_station_config(settings.settings_file, name)
    return cfg.get("calibration") or {}


@router.post("/api/admin/stations/{name}/calibration")
async def admin_save_station_calibration(
    name: str, body: dict, authorization: Optional[str] = Header(default=None)
):
    """Guarda la calibración propia de una estación secundaria."""
    require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    clean = {k: v for k, v in body.items() if k.startswith("cal_")}
    cfg = settings_store.get_station_config(settings.settings_file, name)
    cfg["calibration"] = clean
    settings_store.save_station_config(settings.settings_file, name, cfg)
    return {"status": "ok", "calibration": clean}


@router.get("/api/admin/stations/{name}/alerts")
async def admin_get_station_alerts(name: str, authorization: Optional[str] = Header(default=None)):
    """Umbrales de alerta propios de una estación secundaria (claves alert_*)."""
    require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    cfg = settings_store.get_station_config(settings.settings_file, name)
    return cfg.get("alert_thresholds") or {}


@router.post("/api/admin/stations/{name}/alerts")
async def admin_save_station_alerts(
    name: str, body: dict, authorization: Optional[str] = Header(default=None)
):
    """Guarda los umbrales y las reglas apagadas propios de una secundaria."""
    require_admin(authorization)
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail="Estación no encontrada")
    clean = {k: v for k, v in body.items() if k.startswith("alert_")}
    cfg = settings_store.get_station_config(settings.settings_file, name)
    cfg["alert_thresholds"] = clean
    if isinstance(body.get("disabled_rules"), list):
        cfg["disabled_rules"] = [r for r in body["disabled_rules"] if isinstance(r, str)]
    settings_store.save_station_config(settings.settings_file, name, cfg)
    return {"status": "ok", "alert_thresholds": clean, "disabled_rules": cfg.get("disabled_rules", [])}


def _persist_registry(secondary_str=None, primary_pk=None):
    """Persiste (settings.json) y aplica EN VIVO cambios al registro de passkeys."""
    current = {}
    if secondary_str is not None:
        current["secondary_stations"] = secondary_str
    if primary_pk is not None:
        current["primary_passkey"] = primary_pk
    settings_store.save_overrides(settings.settings_file, current)
    adminsvc.apply_overrides(settings, state.alert_service, current)


def _mask_pk(pk):
    return (pk[:6] + "..." + pk[-4:]) if pk and len(pk) > 12 else (pk or "")


def _valid_station_name(name):
    return bool(name) and len(name) <= 32 and all(c.isalnum() or c in "_-" for c in name)


@router.get("/api/admin/registry")
async def admin_get_registry(authorization: Optional[str] = Header(default=None)):
    """Registro de estaciones (whitelist de passkey): principal + secundarias."""
    require_admin(authorization)
    primary_pk = getattr(settings, "primary_passkey", "") or ""
    smap = settings.secondary_station_map  # {passkey: nombre}
    return {
        "whitelist_active": bool(primary_pk),
        "primary": {"has_passkey": bool(primary_pk), "passkey_masked": _mask_pk(primary_pk)},
        "secondaries": [{"name": n, "passkey_masked": _mask_pk(p)} for p, n in smap.items()],
    }


@router.put("/api/admin/registry/primary")
async def admin_set_primary_passkey(body: dict, authorization: Optional[str] = Header(default=None)):
    """Define/limpia el passkey de la PRINCIPAL desde su MAC (activa la whitelist)."""
    require_admin(authorization)
    mac = (body.get("mac") or "").strip()
    if not mac:
        _persist_registry(primary_pk="")  # limpia -> whitelist desactivada
        return {"has_passkey": False}
    try:
        pk = settings_store.passkey_from_mac(mac)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _persist_registry(primary_pk=pk)
    return {"has_passkey": True, "passkey_masked": _mask_pk(pk)}


@router.post("/api/admin/registry/secondary")
async def admin_add_secondary(body: dict, authorization: Optional[str] = Header(default=None)):
    """Cambia la MAC (y con ella el passkey) de una secundaria YA dada de alta.

    El alta es sólo `POST /api/admin/stations` (crea también su config y valida
    duplicados); antes esto también daba de alta, sin config y con otras reglas."""
    require_admin(authorization)
    name = (body.get("name") or "").strip()
    mac = (body.get("mac") or "").strip()
    if name not in settings.secondary_station_map.values():
        raise HTTPException(status_code=404, detail=f"Estación '{name}' no encontrada; dala de alta en Estaciones")
    try:
        pk = settings_store.passkey_from_mac(mac)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if pk == (getattr(settings, "primary_passkey", "") or ""):
        raise HTTPException(status_code=400, detail="Ese equipo es la estación principal")
    other = settings.secondary_station_map.get(pk)
    if other and other != name:
        raise HTTPException(status_code=400, detail=f"Ese equipo ya está registrado como '{other}'")
    smap = {p: n for p, n in settings.secondary_station_map.items() if n != name}
    smap[pk] = name
    _persist_registry(secondary_str=",".join(f"{p}:{n}" for p, n in smap.items()))
    return {"name": name, "passkey_masked": _mask_pk(pk)}


@router.delete("/api/admin/registry/secondary/{name}")
async def admin_del_secondary(name: str, authorization: Optional[str] = Header(default=None)):
    """Quita una estación secundaria del registro (deja de aceptar sus pushes)."""
    require_admin(authorization)
    smap = {p: n for p, n in settings.secondary_station_map.items() if n != name}
    _persist_registry(secondary_str=",".join(f"{p}:{n}" for p, n in smap.items()))
    return {"ok": True}


def _detect_sensors(data: dict) -> list:
    """Detecta qué sensores están presentes en los datos de una estación."""
    sensors = []
    if data.get("temperature_outdoor") is not None:
        sensors.append("exterior")
    if data.get("temperature_indoor") is not None:
        sensors.append("interior")
    if data.get("wind_speed") is not None:
        sensors.append("viento")
    if data.get("rain_daily") is not None:
        sensors.append("lluvia")
    if data.get("uv_index") is not None:
        sensors.append("UV")
    if data.get("solar_radiation") is not None:
        sensors.append("solar")
    for i in range(1, 9):
        if data.get(f"temperature_ch{i}") is not None:
            sensors.append(f"WN31-ch{i}")
    return sensors


def _detect_sensors_detail(data: dict, sensor_labels: dict) -> list:
    """
    Detecta sensores con información detallada: lecturas actuales, batería, labels.

    Returns:
        Lista de dicts con info de cada sensor detectado.
    """
    sensors = []

    # Sensor exterior (WS69 para WS2910, WN32 para GW1100)
    if data.get("temperature_outdoor") is not None:
        # Detectar tipo de sensor exterior por batería/modelo.
        #   WS69/WH65 -> battery_wh65 o battery_ws69
        #   WN32      -> battery_wh32 o battery_wh26 (el WN32 ES un WH26, y según
        #                el firmware reporta con una clave o la otra; mirar solo
        #                wh32 lo dejaba sin identificar, con su batería y señal
        #                sin leer, porque ese campo no siempre llega).
        has_ws69 = data.get("battery_wh65") is not None or data.get("battery_ws69") is not None
        has_wn32 = data.get("battery_wh32") is not None or data.get("battery_wh26") is not None
        sensor_type = "WS69" if has_ws69 else ("WN32" if has_wn32 else "Exterior")
        ext = {
            "id": "outdoor",
            "type": sensor_type,
            "category": "exterior",
            "label": sensor_labels.get("outdoor", "Exterior"),
            "temperature": data.get("temperature_outdoor"),
            "humidity": data.get("humidity_outdoor"),
            "battery_ok": next(
                (data[k] for k in ("battery_wh65", "battery_ws69", "battery_wh32", "battery_wh26")
                 if data.get(k) is not None), True),
            "signal": next(
                (data[k] for k in ("signal_wh65", "signal_ws69", "signal_wh32", "signal_wh26")
                 if data.get(k) is not None), None),
            "active": True,
        }
        # Si la estación mide presión pero NO tiene sensor interior separado
        # (p. ej. GW1100 con trampa: su barómetro integrado va como exterior),
        # se muestra la presión en la fila exterior; si hubiera interior, la
        # presión va allí (WS2910).
        if data.get("temperature_indoor") is None and data.get("pressure_relative") is not None:
            ext["pressure"] = data.get("pressure_relative")
        sensors.append(ext)

    # Sensor interior (consola o GW1100)
    if data.get("temperature_indoor") is not None:
        sensors.append({
            "id": "indoor",
            "type": "console",
            "category": "interior",
            "label": sensor_labels.get("indoor", "Interior"),
            "temperature": data.get("temperature_indoor"),
            "humidity": data.get("humidity_indoor"),
            "pressure": data.get("pressure_relative"),
            "battery_ok": True,  # Consola siempre con corriente
            "active": True,
        })

    # Sensores WN31 (canales 1-8)
    for i in range(1, 9):
        temp = data.get(f"temperature_ch{i}")
        if temp is not None:
            sensors.append({
                "id": f"ch{i}",
                "type": "WN31",
                "category": "canal",
                "channel": i,
                "label": sensor_labels.get(f"ch{i}", f"Canal {i}"),
                "temperature": temp,
                "humidity": data.get(f"humidity_ch{i}"),
                "battery_ok": data.get(f"battery_ch{i}", True),
                "signal": data.get(f"signal_ch{i}"),
                "active": True,
            })

    # Viento (parte del WS69)
    if data.get("wind_speed") is not None:
        sensors.append({
            "id": "wind",
            "type": "WS69",
            "category": "viento",
            "label": sensor_labels.get("wind", "Viento"),
            "wind_speed": data.get("wind_speed"),
            "wind_gust": data.get("wind_gust"),
            "wind_direction": data.get("wind_direction"),
            "battery_ok": data.get("battery_wh65", data.get("battery_ws69", True)),
            "signal": data.get("signal_wh65", data.get("signal_ws69")),
            "active": True,
        })

    # Lluvia (parte del WS69)
    if data.get("rain_daily") is not None:
        sensors.append({
            "id": "rain",
            "type": "WS69",
            "category": "lluvia",
            "label": sensor_labels.get("rain", "Lluvia"),
            "rain_rate": data.get("rain_rate"),
            "rain_daily": data.get("rain_daily"),
            "battery_ok": data.get("battery_wh65", data.get("battery_ws69", True)),
            "signal": data.get("signal_wh65", data.get("signal_ws69")),
            "active": True,
        })

    # UV/Solar (parte del WS69)
    if data.get("uv_index") is not None or data.get("solar_radiation") is not None:
        sensors.append({
            "id": "solar",
            "type": "WS69",
            "category": "solar",
            "label": sensor_labels.get("solar", "Solar/UV"),
            "uv_index": data.get("uv_index"),
            "solar_radiation": data.get("solar_radiation"),
            "battery_ok": data.get("battery_wh65", data.get("battery_ws69", True)),
            "signal": data.get("signal_wh65", data.get("signal_ws69")),
            "active": True,
        })

    return sensors


def _station_status(last_received: Optional[str], timeout_minutes: int = 15) -> str:
    """Determina si una estación está online u offline."""
    if not last_received:
        return "unknown"
    try:
        last_dt = datetime.fromisoformat(last_received.replace("Z", "+00:00"))
        # `received_at` se guarda en UTC SIN zona (utcnow().isoformat()). Antes se
        # comparaba con datetime.now(None) -- la hora LOCAL del contenedor (TZ =
        # America/Mexico_City) -- y una estación caída seguía "en línea" ~6 h.
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = (now - last_dt).total_seconds() / 60
        return "online" if delta < timeout_minutes else "offline"
    except Exception:
        return "unknown"


@router.get("/api/stations")
async def list_stations():
    """
    Lista todas las estaciones registradas con su estado actual.

    Incluye la estación principal (name=null) y todas las secundarias
    configuradas en SECONDARY_STATIONS o en settings.json.
    """
    stations_config = settings_store.get_stations_config(settings.settings_file)
    secondary_map = settings.secondary_station_map
    result = []

    # Estación principal (siempre presente)
    principal_data = state.latest_by_station.get(None, {})
    principal_config = stations_config.get("_principal", {})
    principal_timeout = settings.alert_station_offline_minutes
    principal_sensor_labels = settings_store.get_sensor_labels(settings.settings_file, None)
    result.append({
        "name": None,
        "label": principal_config.get("label", "Principal"),
        "last_received": principal_data.get("received_at"),
        "status": _station_status(principal_data.get("received_at"), principal_timeout),
        "sensors": _detect_sensors(principal_data),
        "sensors_detail": _detect_sensors_detail(principal_data, principal_sensor_labels),
        "model": principal_data.get("model"),
        "config": {
            "alerts_enabled": settings.alerts_enabled,
            "watchdog_enabled": True,
            "watchdog_minutes": principal_timeout,
        }
    })

    # Estaciones secundarias (desde .env y/o settings.json)
    all_secondary_names = set(secondary_map.values())
    for name in all_secondary_names:
        passkey = next((k for k, v in secondary_map.items() if v == name), None)
        station_data = state.latest_by_station.get(name, {})
        station_config = settings_store.get_station_config(settings.settings_file, name)
        timeout = station_config.get("watchdog_minutes", 15)
        station_sensor_labels = settings_store.get_sensor_labels(settings.settings_file, name)
        result.append({
            "name": name,
            "label": station_config.get("label") or name,
            "passkey_hint": settings_store.mask_passkey(passkey) if passkey else None,
            "last_received": station_data.get("received_at"),
            "status": _station_status(station_data.get("received_at"), timeout),
            "sensors": _detect_sensors(station_data),
            "sensors_detail": _detect_sensors_detail(station_data, station_sensor_labels),
            "model": station_data.get("model"),
            "config": station_config,
        })

    return {"stations": result, "count": len(result)}


@router.get("/api/stations/{name}")
async def get_station(name: str):
    """Obtiene el estado detallado de una estación específica."""
    if name == "_principal" or name == "principal":
        name_key = None
        config = settings_store.get_station_config(settings.settings_file, "_principal")
    else:
        name_key = name
        if name not in settings.secondary_station_map.values():
            raise HTTPException(status_code=404, detail=f"Estación '{name}' no encontrada")
        config = settings_store.get_station_config(settings.settings_file, name)

    station_data = state.latest_by_station.get(name_key, {})
    # La principal usa el "sin datos" global (su watchdog_minutes propio se retiró,
    # ver settings_store.RETIRED_PRINCIPAL_KEYS), igual que en list_stations.
    timeout = (settings.alert_station_offline_minutes if name_key is None
               else config.get("watchdog_minutes", 15))
    sensor_labels = settings_store.get_sensor_labels(
        settings.settings_file,
        None if name == "_principal" or name == "principal" else name
    )

    return {
        "name": name_key,
        "label": config.get("label") or name or "Principal",
        "last_received": station_data.get("received_at"),
        "status": _station_status(station_data.get("received_at"), timeout),
        "sensors": _detect_sensors(station_data),
        "sensors_detail": _detect_sensors_detail(station_data, sensor_labels),
        "model": station_data.get("model"),
        "config": config,
        "sensor_labels": sensor_labels,
        "current_data": station_data if station_data else None,
    }


@router.put("/api/stations/{name}")
async def update_station(name: str, body: dict = Body(...),
                        authorization: Optional[str] = Header(default=None)):
    """Actualiza la configuración de una estación (requiere sesión admin)."""
    require_admin(authorization)
    if name == "_principal" or name == "principal":
        station_key = "_principal"
    else:
        if name not in settings.secondary_station_map.values():
            raise HTTPException(status_code=404, detail=f"Estación '{name}' no encontrada")
        station_key = name

    # Actualizar config general de la estación
    if "config" in body:
        new_config = body["config"]
        settings_store.save_station_config(settings.settings_file, station_key, new_config)

    # Actualizar labels de sensores
    if "sensor_labels" in body:
        station_for_labels = None if station_key == "_principal" else station_key
        for sensor_id, label in body["sensor_labels"].items():
            settings_store.save_sensor_label(
                settings.settings_file, sensor_id, label, station_for_labels
            )

    return {"ok": True, "message": "Configuración actualizada"}


@router.post("/api/admin/stations")
async def create_station(body: dict = Body(...), authorization: Optional[str] = Header(default=None)):
    """Crea una estación secundaria y la da de alta en el registro de passkeys.

    Hace falta la MAC o el passkey (`mac` o `passkey`, cualquiera de los dos
    acepta ambos formatos, ver `settings_store.passkey_from_identifier`): sin
    él la estación no podría recibir datos -- con la whitelist activa un
    passkey desconocido se rechaza con 403, y sin whitelist sus pushes caerían
    en la principal. Antes esto escribía en `settings.secondary_station_map`
    (una property que se recalcula en cada lectura, así que el cambio se
    perdía) y en `station_passkeys` (una clave que nadie lee): la estación
    "creada" nunca quedaba registrada. Ahora usa `_persist_registry`, el mismo
    camino que Admin → Estaciones → Registro.
    """
    require_admin(authorization)
    name = (body.get("name") or "").strip().lower()
    ident = (body.get("mac") or body.get("passkey") or "").strip()

    if not _valid_station_name(name):
        raise HTTPException(status_code=400, detail="Nombre inválido (letras, números, - o _; máx. 32)")
    if name in ("principal", "_principal", "primary"):
        raise HTTPException(status_code=400, detail="Nombre reservado")
    smap = settings.secondary_station_map
    if name in smap.values():
        raise HTTPException(status_code=400, detail=f"Ya existe una estación con nombre '{name}'")
    if not ident:
        raise HTTPException(status_code=400, detail="Hace falta la MAC o el passkey de la estación")
    try:
        pk = settings_store.passkey_from_identifier(ident)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if pk in smap:
        raise HTTPException(status_code=400, detail=f"Ese equipo ya está registrado como '{smap[pk]}'")
    if pk == (getattr(settings, "primary_passkey", "") or ""):
        raise HTTPException(status_code=400, detail="Ese equipo es la estación principal")

    settings_store.save_station_config(settings.settings_file, name, {
        "label": name.title(),
        "watchdog_enabled": True,
        "watchdog_minutes": 15,
        "alerts_enabled": False,
    })
    smap = {**smap, pk: name}
    _persist_registry(secondary_str=",".join(f"{p}:{n}" for p, n in smap.items()))
    return {"ok": True, "name": name, "passkey_masked": _mask_pk(pk),
            "message": f"Estación '{name}' creada"}


@router.delete("/api/admin/stations/{name}")
async def delete_station(name: str, authorization: Optional[str] = Header(default=None)):
    """Elimina una estación secundaria (no elimina datos históricos).

    La quita del registro de passkeys (deja de aceptar sus pushes EN VIVO, vía
    `_persist_registry`) y borra su configuración. Antes sólo la borraba de una
    copia temporal del mapa, así que la estación "eliminada" se seguía
    aceptando.
    """
    require_admin(authorization)

    if name in ("principal", "_principal"):
        raise HTTPException(status_code=400, detail="No se puede eliminar la estación principal")

    all_settings = settings_store.load_all_settings(settings.settings_file)
    has_config = name in (all_settings.get("stations") or {})
    if name not in settings.secondary_station_map.values() and not has_config:
        raise HTTPException(status_code=404, detail=f"Estación '{name}' no encontrada")

    smap = {p: n for p, n in settings.secondary_station_map.items() if n != name}
    _persist_registry(secondary_str=",".join(f"{p}:{n}" for p, n in smap.items()))

    # Recargar: _persist_registry acaba de escribir settings.json. strict: se va a
    # reescribir, y sobre un archivo ilegible borraría todo.
    all_settings = settings_store.load_all_settings(settings.settings_file, strict=True)
    if name in (all_settings.get("stations") or {}):
        del all_settings["stations"][name]
    all_settings.pop("station_passkeys", None)  # residuo de la versión anterior, nadie lo lee
    settings_store.save_all_settings(settings.settings_file, all_settings)

    state.latest_by_station.pop(name, None)
    return {"ok": True, "message": f"Estación '{name}' eliminada"}
