"""
Almacén de ajustes editables (overrides) en un archivo JSON.

Permite editar en caliente ciertos ajustes desde el panel de administración
sin tocar el .env ni reiniciar. Solo se persiste una lista blanca de claves.
"""
import json
import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Solo estas claves se pueden editar/persistir desde el panel
EDITABLE_KEYS = {
    "alerts_enabled",
    "alert_temp_high",
    "alert_temp_low",
    "alert_wind_high",
    "alert_rain_rate",
    "alert_station_offline_minutes",
    "telegram_enabled",
    "telegram_bot_token",
    "telegram_chat_id",
    "waqi_token",
    # Control de calidad
    "qc_enabled",
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
}

# Claves sensibles: se enmascaran al mostrarse y "en blanco = conservar" al guardar
SECRET_KEYS = {
    "telegram_bot_token",
    "waqi_token",
    "wu_station_key",
    "pws_password",
    "windy_api_key",
    "owm_api_key",
    "cwop_passcode",
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
