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

# Sensores cuya presencia se vigila para "sensor perdido": clave del dato -> nombre
_SENSOR_PRESENCE = {
    "temperature_outdoor": "outdoor",
    "temperature_ch1": "ch1", "temperature_ch2": "ch2", "temperature_ch3": "ch3",
    "temperature_ch4": "ch4", "temperature_ch5": "ch5", "temperature_ch6": "ch6",
    "temperature_ch7": "ch7", "temperature_ch8": "ch8",
}


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
        # Estado de "estación caída" por estación: {station_name: bool}
        # None = principal, "gw1100" = secundaria, etc.
        self.stations_offline: Dict[Optional[str], bool] = {}
        # Sensores vistos alguna vez (para detectar "sensor perdido")
        self.known_sensors: set = set()

    @property
    def station_offline(self) -> bool:
        """Retrocompatibilidad: estado offline de la estación principal."""
        return self.stations_offline.get(None, False)

    @station_offline.setter
    def station_offline(self, value: bool):
        """Retrocompatibilidad: estado offline de la estación principal."""
        self.stations_offline[None] = value

    # Etiquetas legibles por sensor (batería / contacto)
    _SENSOR_LABELS = {
        "outdoor": "estación exterior",
        "indoor": "consola interior",
        "ws69": "estación exterior (WS69)", "wh65": "estación exterior",
        "wh26": "sensor T/H", "wh25": "consola", "wh40": "pluviómetro",
        "wh57": "sensor de rayos", "wh68": "estación", "wh80": "anemómetro",
        "wh90": "estación", "wh31": "sensor T/H",
    }

    def _sensor_label(self, name: str) -> str:
        if name in self._SENSOR_LABELS:
            return self._SENSOR_LABELS[name]
        if name.startswith("ch"):
            return f"canal {name[2:]} (WN31)"
        return name

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

        # Viento sostenido
        wind = data.get("wind_speed")
        if wind is None:
            wind = data.get("wind_gust")
        if wind is not None:
            rules["wind_high"] = (
                wind >= self.wind_high,
                f"💨 Viento fuerte: {wind} km/h (≥ {self.wind_high} km/h)",
            )

        # Ráfaga (pico de viento)
        gust = data.get("wind_gust")
        gust_hi = getattr(self._settings, "alert_gust_high", 70.0)
        if gust is not None:
            rules["gust_high"] = (
                gust >= gust_hi,
                f"🌬️ Ráfaga fuerte: {gust} km/h (≥ {gust_hi} km/h)",
            )

        rain = data.get("rain_rate")
        if rain is not None:
            rules["rain_rate"] = (
                rain >= self.rain_rate,
                f"🌧️ Lluvia intensa: {rain} mm/h (≥ {self.rain_rate} mm/h)",
            )

        # Lluvia acumulada del día
        rain_day = data.get("rain_daily")
        rain_day_hi = getattr(self._settings, "alert_rain_daily", 40.0)
        if rain_day is not None:
            rules["rain_daily"] = (
                rain_day >= rain_day_hi,
                f"🌧️ Lluvia acumulada alta: {rain_day} mm hoy (≥ {rain_day_hi} mm)",
            )

        # Presión alta / baja (a nivel del mar)
        press = data.get("pressure_relative")
        if press is not None:
            p_hi = getattr(self._settings, "alert_pressure_high", 1030.0)
            p_lo = getattr(self._settings, "alert_pressure_low", 1000.0)
            rules["pressure_high"] = (
                press >= p_hi,
                f"📈 Presión alta: {press} hPa (≥ {p_hi} hPa)",
            )
            rules["pressure_low"] = (
                press <= p_lo,
                f"📉 Presión baja: {press} hPa (≤ {p_lo} hPa)",
            )

        # Batería baja: campos battery_* binarios (True=OK / False=baja).
        if getattr(self._settings, "alert_battery_enabled", True):
            for key, val in data.items():
                if not key.startswith("battery_") or not isinstance(val, bool):
                    continue
                name = key[len("battery_"):]
                rules[f"battery_{name}"] = (
                    val is False,
                    f"🔋 Batería baja: {self._sensor_label(name)}",
                )

        # Sensor perdido: un sensor visto antes que deja de reportar.
        if getattr(self._settings, "alert_sensor_lost_enabled", True):
            for skey in list(_SENSOR_PRESENCE):
                present = data.get(skey) is not None
                if present:
                    self.known_sensors.add(skey)
                if skey in self.known_sensors:
                    rules[f"sensor_{skey}"] = (
                        not present,
                        f"📡 Sensor sin contacto: {self._sensor_label(_SENSOR_PRESENCE[skey])}",
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

    async def check_air(self, aqi: Optional[float], imeca: Optional[float]) -> None:
        """
        Evalúa la calidad del aire (ICA/AQI e IMECA) contra los umbrales
        configurables y notifica en las transiciones (dispara al superar,
        normaliza al volver por debajo). Los umbrales se leen en vivo de settings.
        """
        s = self._settings
        if not self.enabled or not getattr(s, "alert_air_enabled", False):
            return
        aqi_th = getattr(s, "alert_aqi_threshold", 100.0)
        imeca_th = getattr(s, "alert_imeca_threshold", 100.0)
        checks = []
        if aqi is not None:
            checks.append(("aqi_high", aqi >= aqi_th,
                           f"🌫️ Calidad del aire alta (AQI): {round(aqi)} (≥ {round(aqi_th)})"))
        if imeca is not None:
            checks.append(("imeca_high", imeca >= imeca_th,
                           f"🌫️ IMECA alto: {round(imeca)} (≥ {round(imeca_th)})"))
        for key, triggered, message in checks:
            if triggered and key not in self.active:
                self.active[key] = message
                await self._safe_notify(f"⚠️ ALERTA — {message}")
            elif not triggered and key in self.active:
                self.active.pop(key, None)
                await self._safe_notify(f"✅ Normalizado — {message}")

    async def send(self, text: str) -> None:
        """Enviar una notificación suelta."""
        await self._safe_notify(text)

    async def check_station(
        self,
        last_iso,
        now,
        threshold_s: float,
        station: Optional[str] = None,
        label: str = "XE1E"
    ):
        """
        Evalúa si una estación está caída (sin datos) o se recuperó, y notifica
        en las transiciones. Devuelve el texto enviado o None.

        Args:
            last_iso: timestamp ISO de la última lectura
            now: datetime actual
            threshold_s: umbral en segundos para considerar offline
            station: None para principal, nombre para secundarias
            label: etiqueta legible de la estación para el mensaje
        """
        if not last_iso:
            return None
        try:
            age = (now - datetime.fromisoformat(last_iso)).total_seconds()
        except (ValueError, TypeError):
            return None

        was_offline = self.stations_offline.get(station, False)

        if age > threshold_s and not was_offline:
            self.stations_offline[station] = True
            msg = f"🔌 La estación **{label}** no envía datos desde hace {int(age // 60)} min."
            await self._safe_notify(msg)
            return msg

        if age <= threshold_s and was_offline:
            self.stations_offline[station] = False
            msg = f"✅ La estación **{label}** volvió a enviar datos."
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
