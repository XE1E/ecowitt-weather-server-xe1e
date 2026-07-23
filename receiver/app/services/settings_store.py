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


def _write_json_secure(path: str, data: Dict[str, Any]) -> None:
    """Escribe JSON y restringe permisos a 600 (el archivo guarda secretos:
    tokens de Telegram/SMTP/WAQI, claves de redes, etc.)."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    try:
        os.chmod(path, 0o600)
    except OSError as e:  # p. ej. sistemas de archivos sin soporte de permisos
        logger.warning("No se pudo aplicar chmod 600 a %s: %s", path, e)

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
    "telegram_categories",
    # Notificaciones por correo (SMTP)
    "email_enabled", "smtp_host", "smtp_port", "smtp_user", "smtp_password",
    "smtp_tls", "email_from", "email_to", "email_categories",
    "waqi_token",
    # Control de calidad
    "qc_enabled",
    "qc_spike_enabled",
    # Calibración
    "cal_enabled",
    "cal_temp_offset", "cal_humidity_offset",  # globales (compat)
    "cal_temp_outdoor", "cal_temp_indoor",
    "cal_temp_ch1", "cal_temp_ch2", "cal_temp_ch3", "cal_temp_ch4",
    "cal_temp_ch5", "cal_temp_ch6", "cal_temp_ch7", "cal_temp_ch8",
    "cal_hum_outdoor", "cal_hum_indoor",
    "cal_hum_ch1", "cal_hum_ch2", "cal_hum_ch3", "cal_hum_ch4",
    "cal_hum_ch5", "cal_hum_ch6", "cal_hum_ch7", "cal_hum_ch8",
    "cal_pressure_offset",
    "cal_wind_mult", "cal_wind_dir_offset",
    "cal_rain_mult",
    "cal_solar_mult", "cal_uv_offset",
    # Publicación a redes públicas (*_interval = minutos entre envíos)
    "wu_enabled", "wu_station_id", "wu_station_key", "wu_interval",
    "pws_enabled", "pws_station_id", "pws_password", "pws_interval",
    "windy_enabled", "windy_api_key", "windy_interval",
    "owm_enabled", "owm_api_key", "owm_station_id", "owm_interval",
    "cwop_enabled", "cwop_callsign", "cwop_passcode",
    "cwop_latitude", "cwop_longitude", "cwop_interval",
    # Seguridad del endpoint de push
    "ecowitt_secure_enabled", "ecowitt_secure_token", "ecowitt_ip_allowlist",
    # MQTT / Home Assistant
    "mqtt_enabled", "mqtt_broker", "mqtt_port",
    "mqtt_username", "mqtt_password", "mqtt_topic",
    "hass_discovery", "hass_discovery_prefix",
    # Timezone
    "timezone_offset",
}

# Claves sensibles: se enmascaran al mostrarse y "en blanco = conservar" al guardar
SECRET_KEYS = {
    "telegram_bot_token",
    "smtp_password",
    "ecowitt_secure_token",
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
    "watchdog_enabled": True,
    "watchdog_minutes": 15,
    "alerts_enabled": False,
    "publish_enabled": False,
    "mqtt_enabled": False,
    # Calibración propia de la estación (secundarias). Dict de claves cal_*
    # (mismo formato que las globales). Vacío = sin calibración para esa estación.
    "calibration": {},
    # Umbrales de alerta propios (secundarias). Dict de claves alert_* (temp/viento/
    # lluvia/presión). Las no definidas caen a los umbrales globales.
    "alert_thresholds": {},
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
    # Merge dentro del archivo completo para NO borrar claves no editables
    # (p. ej. "stations" con los sensor_labels/configs, o "setup_completed").
    # Antes se reescribía el archivo solo con EDITABLE_KEYS y se perdían.
    clean = {k: v for k, v in overrides.items() if k in EDITABLE_KEYS}
    data = load_all_settings(path)
    data.update(clean)
    _write_json_secure(path, data)


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
    """Guarda todo el archivo de settings (permisos 600)."""
    _write_json_secure(path, data)


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


# ---------------------------------------------------------------------------
# Setup wizard status
# ---------------------------------------------------------------------------

def get_setup_completed(path: str) -> bool:
    """Retorna True si el wizard de configuración inicial se ha completado."""
    data = load_all_settings(path)
    return data.get("setup_completed", False)


def set_setup_completed(path: str, completed: bool = True) -> None:
    """Marca el wizard de configuración como completado."""
    data = load_all_settings(path)
    data["setup_completed"] = completed
    save_all_settings(path, data)


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
