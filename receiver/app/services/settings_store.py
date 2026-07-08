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
