"""
Weather Alerts Service

Evaluates configurable thresholds against incoming (metric) weather data and
sends notifications (Telegram, or the log as fallback). Keeps per-rule state so
a sustained condition notifies once on trigger and once when it clears, instead
of spamming on every reading.
"""

from typing import Any, Awaitable, Callable, Dict, Optional, Tuple
from datetime import datetime
import logging

import httpx

logger = logging.getLogger(__name__)

# Notifier signature: async (text: str) -> None
Notifier = Callable[[str], Awaitable[None]]


class AlertService:
    def __init__(self, settings, notifier: Optional[Notifier] = None):
        self.enabled: bool = settings.alerts_enabled
        self.temp_high: float = settings.alert_temp_high
        self.temp_low: float = settings.alert_temp_low
        self.wind_high: float = settings.alert_wind_high
        self.rain_rate: float = settings.alert_rain_rate

        self._settings = settings
        self._notifier: Notifier = notifier or self._default_notifier
        # Rule keys currently triggered -> their message (dict so /api/alerts
        # can expose the active alerts; `key in self.active` still works)
        self.active: Dict[str, str] = {}
        # Estado de "estación caída" (sin datos)
        self.station_offline: bool = False

    def evaluate(self, data: Dict[str, Any]) -> Dict[str, Tuple[bool, str]]:
        """Return {rule_key: (triggered, message)} for the rules that apply."""
        rules: Dict[str, Tuple[bool, str]] = {}

        temp = data.get("temperature_outdoor")
        if temp is not None:
            rules["temp_high"] = (
                temp >= self.temp_high,
                f"🌡️ Temperatura alta: {temp}°C (≥ {self.temp_high}°C)",
            )
            rules["temp_low"] = (
                temp <= self.temp_low,
                f"🥶 Temperatura baja: {temp}°C (≤ {self.temp_low}°C)",
            )

        # Prefer gust for a wind alert, fall back to sustained wind speed
        wind = data.get("wind_gust")
        if wind is None:
            wind = data.get("wind_speed")
        if wind is not None:
            rules["wind_high"] = (
                wind >= self.wind_high,
                f"💨 Viento fuerte: {wind} km/h (≥ {self.wind_high} km/h)",
            )

        rain = data.get("rain_rate")
        if rain is not None:
            rules["rain_rate"] = (
                rain >= self.rain_rate,
                f"🌧️ Lluvia intensa: {rain} mm/h (≥ {self.rain_rate} mm/h)",
            )

        return rules

    async def process(self, data: Dict[str, Any]) -> None:
        """Evaluate rules and notify on state transitions."""
        if not self.enabled:
            return

        for key, (triggered, message) in self.evaluate(data).items():
            if triggered and key not in self.active:
                self.active[key] = message
                await self._safe_notify(f"⚠️ ALERTA — {message}")
            elif not triggered and key in self.active:
                self.active.pop(key, None)
                await self._safe_notify(f"✅ Normalizado — {message}")

    async def send(self, text: str) -> None:
        """Enviar una notificación suelta."""
        await self._safe_notify(text)

    async def check_station(self, last_iso, now, threshold_s: float):
        """
        Evalúa si la estación está caída (sin datos) o se recuperó, y notifica en
        las transiciones. Devuelve el texto enviado o None. `now` y `last_iso` se
        pasan como argumentos para que sea testeable.
        """
        if not last_iso:
            return None
        try:
            age = (now - datetime.fromisoformat(last_iso)).total_seconds()
        except (ValueError, TypeError):
            return None
        if age > threshold_s and not self.station_offline:
            self.station_offline = True
            msg = f"🔌 La estación XE1E no envía datos desde hace {int(age // 60)} min."
            await self._safe_notify(msg)
            return msg
        if age <= threshold_s and self.station_offline:
            self.station_offline = False
            msg = "✅ La estación XE1E volvió a enviar datos."
            await self._safe_notify(msg)
            return msg
        return None

    async def _safe_notify(self, text: str) -> None:
        try:
            await self._notifier(text)
        except Exception as e:  # never let a notification failure break ingestion
            logger.error(f"Alert notification failed: {e}")

    async def _default_notifier(self, text: str) -> None:
        s = self._settings
        if s.telegram_enabled and s.telegram_bot_token and s.telegram_chat_id:
            url = f"https://api.telegram.org/bot{s.telegram_bot_token}/sendMessage"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    url, json={"chat_id": s.telegram_chat_id, "text": text}
                )
                resp.raise_for_status()
            logger.info(f"Telegram alert sent: {text}")
        else:
            # Telegram not configured: surface the alert in the log
            logger.warning(f"[ALERT] {text}")
