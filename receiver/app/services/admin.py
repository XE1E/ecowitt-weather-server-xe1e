"""
Autenticación (usuario/contraseña -> token de sesión) y aplicación de ajustes
para el panel de administración.
"""
import hmac
import secrets
import time
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_SESSIONS: Dict[str, float] = {}  # token -> expiry epoch
SESSION_TTL = 12 * 3600  # 12 h


def admin_enabled(settings) -> bool:
    return bool(getattr(settings, "admin_user", None)) and bool(getattr(settings, "admin_password", None))


def login(settings, user: str, password: str) -> Optional[str]:
    """Valida credenciales y devuelve un token de sesión, o None."""
    if not admin_enabled(settings):
        return None
    ok_user = hmac.compare_digest(str(user), str(settings.admin_user))
    ok_pass = hmac.compare_digest(str(password), str(settings.admin_password))
    if ok_user and ok_pass:
        token = secrets.token_urlsafe(32)
        _SESSIONS[token] = time.time() + SESSION_TTL
        return token
    return None


def valid_session(token: Optional[str]) -> bool:
    if not token:
        return False
    exp = _SESSIONS.get(token)
    if not exp:
        return False
    if time.time() > exp:
        _SESSIONS.pop(token, None)
        return False
    return True


def bearer_token(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def mask(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    s = str(value)
    return ("•" * max(0, len(s) - 4)) + s[-4:] if len(s) > 4 else "••••"


def public_settings(settings) -> Dict[str, Any]:
    """Ajustes actuales para el panel; los tokens van enmascarados."""
    return {
        "alerts_enabled": settings.alerts_enabled,
        "alert_temp_high": settings.alert_temp_high,
        "alert_temp_low": settings.alert_temp_low,
        "alert_wind_high": settings.alert_wind_high,
        "alert_rain_rate": settings.alert_rain_rate,
        "alert_station_offline_minutes": settings.alert_station_offline_minutes,
        "telegram_enabled": settings.telegram_enabled,
        "telegram_bot_token_masked": mask(settings.telegram_bot_token),
        "telegram_chat_id": settings.telegram_chat_id,
        "waqi_token_masked": mask(settings.waqi_token),
    }


def apply_overrides(settings, alert_service, overrides: Dict[str, Any]) -> None:
    """Aplica overrides al objeto settings y sincroniza el servicio de alertas."""
    for key, val in overrides.items():
        if hasattr(settings, key):
            setattr(settings, key, val)
    # Sincronizar el servicio de alertas (captura umbrales en atributos)
    alert_service.enabled = settings.alerts_enabled
    alert_service.temp_high = settings.alert_temp_high
    alert_service.temp_low = settings.alert_temp_low
    alert_service.wind_high = settings.alert_wind_high
    alert_service.rain_rate = settings.alert_rain_rate
    # telegram_* y waqi_token se leen en vivo desde settings, no requieren sync
