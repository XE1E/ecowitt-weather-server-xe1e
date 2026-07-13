"""
Almacén de ajustes editables (overrides) en un archivo JSON.

Permite editar en caliente ciertos ajustes desde el panel de administración
sin tocar el .env ni reiniciar. Solo se persiste una lista blanca de claves.
"""
import json
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Solo estas claves se pueden editar/persistir desde el panel
EDITABLE_KEYS = {
    "alerts_enabled",
    "alert_temp_high",
    "alert_temp_low",
    "alert_wind_high",
    "alert_gust_high",
    "alert_rain_rate",
    "alert_rain_daily",
    "alert_pressure_high",
    "alert_pressure_low",
    "alert_station_offline_minutes",
    "alert_battery_enabled",
    "alert_sensor_lost_enabled",
    "alert_air_enabled",
    "alert_aqi_threshold",
    "alert_imeca_threshold",
    "telegram_enabled",
    "telegram_bot_token",
    "telegram_chat_id",
    "waqi_token",
    # Control de calidad
    "qc_enabled",
    "qc_spike_enabled",
    # Calibración
    "cal_enabled",
    "cal_temp_offset",
    "cal_humidity_offset",
    "cal_pressure_offset",
    "cal_wind_mult",
    "cal_rain_mult",
    # Publicación a redes públicas
    "wu_enabled", "wu_station_id", "wu_station_key",
    "pws_enabled", "pws_station_id", "pws_password",
    "windy_enabled", "windy_api_key",
    "owm_enabled", "owm_api_key", "owm_station_id",
    "cwop_enabled", "cwop_callsign", "cwop_passcode",
    "cwop_latitude", "cwop_longitude",
    # MQTT / Home Assistant
    "mqtt_enabled", "mqtt_broker", "mqtt_port",
    "mqtt_username", "mqtt_password", "mqtt_topic",
}

# Claves sensibles: se enmascaran al mostrarse y "en blanco = conservar" al guardar
SECRET_KEYS = {
    "telegram_bot_token",
    "waqi_token",
    "wu_station_key",
    "pws_password",
    "windy_api_key",
    "mqtt_password",
    "owm_api_key",
    "cwop_passcode",
}

# Configuración por defecto para una estación
DEFAULT_STATION_CONFIG = {
    "label": "",
    "alerts_enabled": False,
    "publish_enabled": False,
    "mqtt_enabled": False,
    "watchdog_enabled": True,
    "watchdog_minutes": 15,
}


def load_overrides(path: str) -> Dict[str, Any]:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {k: v for k, v in data.items() if k in EDITABLE_KEYS}
    except Exception as e:
        logger.error(f"No se pudo leer settings: {e}")
    return {}


def save_overrides(path: str, overrides: Dict[str, Any]) -> None:
    clean = {k: v for k, v in overrides.items() if k in EDITABLE_KEYS}
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2)


# ---------------------------------------------------------------------------
# Gestión de estaciones (Etapa 2)
# ---------------------------------------------------------------------------

def load_all_settings(path: str) -> Dict[str, Any]:
    """Carga todo el archivo de settings (no solo EDITABLE_KEYS)."""
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"No se pudo leer settings: {e}")
    return {}


def save_all_settings(path: str, data: Dict[str, Any]) -> None:
    """Guarda todo el archivo de settings."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_stations_config(path: str) -> Dict[str, Dict[str, Any]]:
    """Obtiene la configuración de todas las estaciones."""
    data = load_all_settings(path)
    return data.get("stations", {})


def get_station_config(path: str, name: str) -> Dict[str, Any]:
    """Obtiene la configuración de una estación específica."""
    stations = get_stations_config(path)
    config = stations.get(name, {})
    return {**DEFAULT_STATION_CONFIG, **config}


def save_station_config(path: str, name: str, config: Dict[str, Any]) -> None:
    """Guarda la configuración de una estación."""
    data = load_all_settings(path)
    if "stations" not in data:
        data["stations"] = {}
    data["stations"][name] = {
        k: v for k, v in config.items()
        if k in DEFAULT_STATION_CONFIG
    }
    save_all_settings(path, data)


def delete_station_config(path: str, name: str) -> bool:
    """Elimina la configuración de una estación. Retorna True si existía."""
    data = load_all_settings(path)
    if "stations" in data and name in data["stations"]:
        del data["stations"][name]
        save_all_settings(path, data)
        return True
    return False


def mask_passkey(passkey: str) -> str:
    """Enmascara un passkey mostrando solo los últimos 4 caracteres."""
    if not passkey or len(passkey) <= 4:
        return "****"
    return f"...{passkey[-4:]}"


# ---------------------------------------------------------------------------
# Labels de sensores (WN31, etc.)
# ---------------------------------------------------------------------------

def get_sensor_labels(path: str, station: Optional[str] = None) -> Dict[str, str]:
    """
    Obtiene los labels personalizados de sensores para una estación.

    Args:
        path: Ruta al archivo settings.json
        station: Nombre de la estación (None para principal)

    Returns:
        Dict con sensor_id -> label, ej: {"ch1": "Sala", "ch2": "Recámara"}
    """
    data = load_all_settings(path)
    station_key = station or "_principal"
    stations = data.get("stations", {})
    station_data = stations.get(station_key, {})
    return station_data.get("sensor_labels", {})


def save_sensor_label(path: str, sensor_id: str, label: str, station: Optional[str] = None) -> None:
    """
    Guarda el label de un sensor específico.

    Args:
        path: Ruta al archivo settings.json
        sensor_id: ID del sensor (ej: "ch1", "ch2")
        label: Nombre personalizado
        station: Nombre de la estación (None para principal)
    """
    data = load_all_settings(path)
    station_key = station or "_principal"

    if "stations" not in data:
        data["stations"] = {}
    if station_key not in data["stations"]:
        data["stations"][station_key] = {}
    if "sensor_labels" not in data["stations"][station_key]:
        data["stations"][station_key]["sensor_labels"] = {}

    if label:
        data["stations"][station_key]["sensor_labels"][sensor_id] = label
    else:
        data["stations"][station_key]["sensor_labels"].pop(sensor_id, None)

    save_all_settings(path, data)
