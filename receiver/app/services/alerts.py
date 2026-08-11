"""
Weather Alerts Service

Evaluates configurable thresholds against incoming (metric) weather data and
sends notifications (Telegram, or the log as fallback). Keeps per-rule state so
a sustained condition notifies once on trigger and once when it clears, instead
of spamming on every reading.
"""

from typing import Any, Awaitable, Callable, Dict, List, Optional, Set, Tuple
from datetime import datetime, timedelta
from collections import deque
from email.message import EmailMessage
import asyncio
import logging
import smtplib
import ssl

import httpx

logger = logging.getLogger(__name__)

# Notifier signature: async (text: str) -> None
Notifier = Callable[[str], Awaitable[None]]

# Categorías de alerta que el usuario puede enrutar por canal (Telegram/correo).
ALERT_CATEGORIES = ["temp", "wind", "rain", "pressure", "humidity", "sun", "station", "battery", "sensor", "air", "visual"]


def _category_for(rule_key: str) -> str:
    """Mapea una clave de regla (temp_high, battery_ch1, ...) a su categoría."""
    if rule_key.startswith("temp_"):
        return "temp"
    # Rocío y sensación térmica son familia de temperatura: se derivan de ella y
    # quien quiere avisos de calor/frío los quiere juntos, no en otro canal.
    if rule_key.startswith("dew_") or rule_key.startswith("feels_"):
        return "temp"
    if rule_key in ("uv_high", "solar_high"):
        return "sun"
    if rule_key in ("wind_high", "gust_high"):
        return "wind"
    if rule_key.startswith("rain_"):
        return "rain"
    if rule_key.startswith("pressure_"):
        return "pressure"
    if rule_key.startswith("humidity_"):
        return "humidity"
    if rule_key.startswith("station_offline"):
        return "station"
    if rule_key.startswith("battery_"):
        return "battery"
    if rule_key.startswith("sensor_"):
        return "sensor"
    if rule_key in ("aqi_high", "imeca_high"):
        return "air"
    if rule_key.startswith("sky_"):
        return "visual"
    return "other"


# Reglas de TENDENCIA: son las únicas cuyo mensaje ya describe el caso normal
# ("Presión sin caída relevante"), así que al normalizar se puede usar tal cual.
# El resto son de umbral y su texto solo tiene sentido cuando están disparadas.
_TREND_RULES = {"pressure_drop", "pressure_rise", "temp_drop", "temp_rise"}

# Días sin dar señal tras los que se asume que un sensor se retiró a propósito y
# se deja de vigilar. Sin esto, quitar un WN31 dejaba su alerta activa para
# siempre: la avería temporal y la retirada deliberada se veían igual.
SENSOR_FORGET_DAYS = 7


# Reglas que NO usan histéresis (avisan de inmediato):
#  - gust_high: pico peligroso, no debe esperar.
#  - sensor_* y battery_*: tienen su propia lógica de presencia/estado.
def _persist_exempt(rule_key: str) -> bool:
    return (
        rule_key == "gust_high"
        or rule_key.startswith("sensor_")
        or rule_key.startswith("battery_")
    )

# Sensores cuya presencia se vigila para "sensor perdido": clave del dato -> nombre
_SENSOR_PRESENCE = {
    "temperature_outdoor": "outdoor",
    # El interior también se vigila: con el GW1100 reportando como interior, su
    # caída era el único sensor cuya desaparición no avisaba.
    "temperature_indoor": "indoor",
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
        # Si no inyectan notifier usamos el propio (Telegram + correo, con
        # enrutado por categoría). Un notifier inyectado (tests) recibe solo el
        # texto, así que el filtro por categoría solo aplica al notifier propio.
        self._using_default: bool = notifier is None
        self._notifier: Notifier = notifier or self._default_notifier
        # Rule keys currently triggered -> their message (dict so /api/alerts
        # can expose the active alerts; `key in self.active` still works)
        self.active: Dict[str, str] = {}
        # Tracking when alerts were triggered (for history)
        self._active_since: Dict[str, str] = {}  # key -> ISO timestamp
        # Estado de "estación caída" por estación: {station_name: bool}
        # None = principal, "gw1100" = secundaria, etc.
        self.stations_offline: Dict[Optional[str], bool] = {}
        # Sensores vistos alguna vez, POR ESTACIÓN (para "sensor perdido").
        # None = principal. Aísla la detección entre estaciones.
        # sensor -> última vez que reportó, por estación. Con la fecha se puede
        # distinguir el sensor caído hace un rato del retirado hace semanas.
        self.known_sensors: Dict[Optional[str], Dict[str, datetime]] = {}
        # Sensores olvidados en la última evaluación, para que `process` avise.
        self._just_forgotten: List[str] = []
        self.known_batteries: Dict[Optional[str], set] = {}
        # Historial POR ESTACIÓN para las tendencias: deque de (datetime, valor).
        # None = principal. Se aísla entre estaciones.
        self._pressure_hist: Dict[Optional[str], deque] = {}
        self._temp_hist: Dict[Optional[str], deque] = {}
        # Histéresis: momento en que una regla EMPEZÓ a cumplirse / a despejarse
        # (por clave namespaceada). Se usa para exigir persistencia antes de
        # avisar o normalizar. {nkey: datetime}
        self._pending_on: Dict[str, datetime] = {}
        self._pending_off: Dict[str, datetime] = {}
        # Alert history: deque of {key, message, timestamp, resolved_at?}
        self._history: deque = deque(maxlen=100)

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

    def evaluate(self, data: Dict[str, Any], station: Optional[str] = None,
                 thresholds: Optional[Dict[str, Any]] = None,
                 now: Optional[datetime] = None,
                 qc_rejected: Optional[Set[str]] = None) -> Dict[str, Tuple[bool, str]]:
        """Return {rule_key: (triggered, message)} for the rules that apply.

        `station` aísla el estado (sensor perdido, buffer de presión) por estación.
        `thresholds` sobreescribe los umbrales globales (por estación); las claves
        sin definir caen al valor global de settings. `now` permite fijar el reloj
        (pruebas de tendencia de presión).

        `qc_rejected` son los campos que el control de calidad acaba de anular en
        ESTA lectura. Se usa para no confundir "el sensor no reportó" con "reportó
        una lectura imposible y la filtramos" (ver la regla de sensor perdido).
        """
        rules: Dict[str, Tuple[bool, str]] = {}
        ov = thresholds or {}
        now = now or datetime.utcnow()

        def T(key: str, default: float) -> float:
            v = ov.get(key)
            return v if v is not None else getattr(self._settings, key, default)

        temp = data.get("temperature_outdoor")
        if temp is not None:
            t_hi = T("alert_temp_high", 35.0)
            t_lo = T("alert_temp_low", 0.0)
            rules["temp_high"] = (temp >= t_hi, f"🌡️ Temperatura alta: {temp}°C (≥ {t_hi}°C)")
            rules["temp_low"] = (temp <= t_lo, f"🥶 Temperatura baja: {temp}°C (≤ {t_lo}°C)")

            # Tendencia de temperatura: misma mecánica que la de presión (buffer
            # por estación + línea base de hace ~ventana). Una caída rápida suele
            # ser la llegada de una tormenta; una subida rápida, insolación fuerte.
            t_win = int(T("alert_temp_trend_window_min", 60))
            t_delta = self._push_and_delta(self._temp_hist, station, now, temp, t_win)
            if t_delta is not None:
                t_drop = -t_delta  # positivo si BAJÓ
                lvl = self._two_level(t_drop, T("alert_temp_drop_warn", 3.0),
                                      T("alert_temp_drop_strong", 5.0))
                if lvl:
                    rules["temp_drop"] = (True, f"🌡️↓ Temperatura cayendo {t_drop:.1f}°C/{t_win}min ({lvl})")
                else:
                    rules["temp_drop"] = (False, f"Temperatura sin caída relevante ({t_delta:+.1f}°C/{t_win}min)")
                lvl = self._two_level(t_delta, T("alert_temp_rise_warn", 3.0),
                                      T("alert_temp_rise_strong", 5.0))
                if lvl:
                    rules["temp_rise"] = (True, f"🌡️↑ Temperatura subiendo {t_delta:.1f}°C/{t_win}min ({lvl})")
                else:
                    rules["temp_rise"] = (False, f"Temperatura sin subida relevante ({t_delta:+.1f}°C/{t_win}min)")

        # Punto de rocío: alto = bochorno; bajo = aire muy seco. Derivado de
        # temp+humedad, así que existe también en la remota.
        dew = data.get("dew_point")
        if dew is not None:
            d_hi = T("alert_dew_high", 20.0)
            d_lo = T("alert_dew_low", -5.0)
            rules["dew_high"] = (dew >= d_hi, f"🥵 Punto de rocío alto: {dew}°C (≥ {d_hi}°C) — ambiente bochornoso")
            rules["dew_low"] = (dew <= d_lo, f"🌵 Punto de rocío bajo: {dew}°C (≤ {d_lo}°C) — aire muy seco")

        # Sensación térmica: heat index si hace calor, wind chill si hace frío.
        feels = data.get("feels_like")
        if feels is not None:
            f_hi = T("alert_feels_high", 38.0)
            f_lo = T("alert_feels_low", -2.0)
            rules["feels_high"] = (feels >= f_hi, f"🥵 Sensación térmica alta: {feels}°C (≥ {f_hi}°C)")
            rules["feels_low"] = (feels <= f_lo, f"🧊 Sensación térmica baja: {feels}°C (≤ {f_lo}°C)")

        # UV y radiación solar: solo la principal las trae (WS69). Si la estación
        # no tiene esos sensores, la regla no se registra y no aparece en /api/alerts.
        uv = data.get("uv_index")
        if uv is not None:
            uv_hi = T("alert_uv_high", 8.0)
            rules["uv_high"] = (uv >= uv_hi, f"😎 Índice UV alto: {uv} (≥ {uv_hi}) — evita el sol directo")

        solar = data.get("solar_radiation")
        if solar is not None:
            s_hi = T("alert_solar_high", 1000.0)
            rules["solar_high"] = (solar >= s_hi, f"☀️ Radiación solar alta: {solar} W/m² (≥ {s_hi} W/m²)")

        # Viento sostenido
        wind = data.get("wind_speed")
        if wind is None:
            wind = data.get("wind_gust")
        if wind is not None:
            w_hi = T("alert_wind_high", 50.0)
            rules["wind_high"] = (wind >= w_hi, f"💨 Viento fuerte: {wind} km/h (≥ {w_hi} km/h)")

        # Ráfaga (pico de viento)
        gust = data.get("wind_gust")
        if gust is not None:
            g_hi = T("alert_gust_high", 70.0)
            rules["gust_high"] = (gust >= g_hi, f"🌬️ Ráfaga fuerte: {gust} km/h (≥ {g_hi} km/h)")

        rain = data.get("rain_rate")
        if rain is not None:
            r_hi = T("alert_rain_rate", 10.0)
            rules["rain_rate"] = (rain >= r_hi, f"🌧️ Lluvia intensa: {rain} mm/h (≥ {r_hi} mm/h)")

        # Lluvia acumulada del día
        rain_day = data.get("rain_daily")
        if rain_day is not None:
            rd_hi = T("alert_rain_daily", 40.0)
            rules["rain_daily"] = (rain_day >= rd_hi, f"🌧️ Lluvia acumulada alta: {rain_day} mm hoy (≥ {rd_hi} mm)")

        # Presión alta / baja (a nivel del mar)
        press = data.get("pressure_relative")
        if press is not None:
            p_hi = T("alert_pressure_high", 1035.0)
            p_lo = T("alert_pressure_low", 1000.0)
            rules["pressure_high"] = (press >= p_hi, f"📈 Presión alta: {press} hPa (≥ {p_hi} hPa)")
            rules["pressure_low"] = (press <= p_lo, f"📉 Presión baja: {press} hPa (≤ {p_lo} hPa)")

            # Tendencia de presión: cambio dentro de la ventana (buffer por estación).
            window = int(T("alert_pressure_trend_window_min", 60))
            delta = self._push_and_delta(self._pressure_hist, station, now, press, window)
            if delta is not None:
                drop = -delta  # positivo si CAYÓ
                lvl = self._two_level(drop, T("alert_pressure_drop_warn", 1.5),
                                      T("alert_pressure_drop_strong", 3.0))
                if lvl:
                    rules["pressure_drop"] = (True, f"⛈️ Presión cayendo {drop:.1f} hPa/{window}min ({lvl}) — posible tormenta")
                else:
                    rules["pressure_drop"] = (False, f"Presión sin caída relevante ({delta:+.1f} hPa/{window}min)")
                lvl = self._two_level(delta, T("alert_pressure_rise_warn", 1.5),
                                      T("alert_pressure_rise_strong", 3.0))
                if lvl:
                    rules["pressure_rise"] = (True, f"🌬️ Presión subiendo {delta:.1f} hPa/{window}min ({lvl}) — posible frente frío")
                else:
                    rules["pressure_rise"] = (False, f"Presión sin subida relevante ({delta:+.1f} hPa/{window}min)")

        # Humedad exterior (baja = aire seco; alta = lluvia).
        hum = data.get("humidity_outdoor")
        if hum is not None:
            h_lo = T("alert_humidity_low", 25.0)
            h_hi = T("alert_humidity_high", 85.0)
            rules["humidity_low"] = (hum <= h_lo, f"🏜️ Humedad exterior baja: {hum}% (≤ {h_lo}%)")
            rules["humidity_high"] = (hum >= h_hi, f"💧 Humedad exterior alta: {hum}% (≥ {h_hi}%)")

        # Humedad INTERIOR. Necesita regla propia: mientras el GW1100 usó la trampa
        # `treat_indoor_as_outdoor`, su lectura entraba por humidity_outdoor y la
        # vigilancia de moho iba con el umbral exterior. Al retirar la trampa esa
        # lectura volvió a humidity_indoor, que NADIE evaluaba, así que la alarma de
        # moho quedó sin vigilar. Los umbrales se pueden sobreescribir por estación.
        hum_in = data.get("humidity_indoor")
        if hum_in is not None:
            hi_lo = T("alert_humidity_indoor_low", 20.0)
            hi_hi = T("alert_humidity_indoor_high", 65.0)
            rules["humidity_indoor_low"] = (
                hum_in <= hi_lo,
                f"🏜️ Humedad interior baja: {hum_in}% (≤ {hi_lo}%) — aire muy seco",
            )
            rules["humidity_indoor_high"] = (
                hum_in >= hi_hi,
                f"🦠 Humedad interior alta: {hum_in}% (≥ {hi_hi}%) — riesgo de moho",
            )

        # Batería baja: campos battery_* binarios (True=OK / False=baja).
        # Solo alerta de baterías que se han visto en ESTA estación (evita que
        # un WN31 del WS2910 aparezca en alertas del GW1100).
        if getattr(self._settings, "alert_battery_enabled", True):
            known_batt = self.known_batteries.setdefault(station, set())
            for key, val in data.items():
                if not key.startswith("battery_") or not isinstance(val, bool):
                    continue
                name = key[len("battery_"):]
                known_batt.add(name)
                rules[f"battery_{name}"] = (
                    val is False,
                    f"🔋 Batería baja: {self._sensor_label(name)}",
                )

        # Sensor perdido: un sensor visto antes que deja de reportar (por estación).
        self._just_forgotten = []
        if getattr(self._settings, "alert_sensor_lost_enabled", True):
            known = self.known_sensors.setdefault(station, {})
            rejected = qc_rejected or set()
            for skey in list(_SENSOR_PRESENCE):
                present = data.get(skey) is not None
                if present:
                    known[skey] = now
                if skey not in known:
                    continue
                # Retirado: tras SENSOR_FORGET_DAYS sin señal se asume que se quitó
                # a propósito y se deja de vigilar. Si vuelve, se re-registra solo
                # en el `if present` de arriba.
                if not present and (now - known[skey]) > timedelta(days=SENSOR_FORGET_DAYS):
                    known.pop(skey, None)
                    self._just_forgotten.append(skey)
                    continue
                # Un valor que el QC acaba de anular NO es un sensor perdido: el
                # sensor SÍ reportó, solo que la lectura era imposible (pico o
                # fuera de rango) y la filtramos poniéndola a None. Sin esta
                # excepción, cuanto mejor hace su trabajo el QC más falsos
                # "sensor sin contacto" genera — y encima las reglas sensor_*
                # están exentas de histéresis, así que avisarían de inmediato.
                if not present and skey in rejected:
                    continue
                rules[f"sensor_{skey}"] = (
                    not present,
                    f"📡 Sensor sin contacto: {self._sensor_label(_SENSOR_PRESENCE[skey])}",
                )

        return rules

    def _push_and_delta(self, store: Dict[Optional[str], deque], station: Optional[str],
                        now: datetime, value: float, window_min: int) -> Optional[float]:
        """Guarda la lectura en el buffer de esa estación y devuelve su tendencia.

        Comparte la mecánica entre presión y temperatura: mantiene un deque por
        estación, poda lo que ya cae fuera del doble de la ventana y delega el
        cálculo en `_delta_over_window`.
        """
        hist = store.setdefault(station, deque(maxlen=1440))
        hist.append((now, value))
        cutoff = now - timedelta(minutes=window_min * 2)
        while hist and hist[0][0] < cutoff:
            hist.popleft()
        return self._delta_over_window(hist, now, window_min)

    @staticmethod
    def _two_level(delta: Optional[float], warn: float, strong: float) -> Optional[str]:
        """Nivel de una tendencia: None si no llega al aviso, si no 'aviso'/'fuerte'."""
        if delta is None or delta < warn:
            return None
        return "fuerte" if delta >= strong else "aviso"

    def _delta_over_window(self, hist: deque, now: datetime, window_min: int) -> Optional[float]:
        """Cambio del valor = actual − línea base de hace ~`window_min`.

        Devuelve None si aún no hay historia suficiente (línea base con al menos
        media ventana de antigüedad), de modo que tras un reinicio no dispara
        hasta acumular ~1 h de lecturas. Positivo = subió; negativo = cayó.
        """
        if len(hist) < 2:
            return None
        target = now - timedelta(minutes=window_min)
        baseline = min(hist, key=lambda e: abs((e[0] - target).total_seconds()))
        if (now - baseline[0]) < timedelta(minutes=window_min * 0.5):
            return None
        return hist[-1][1] - baseline[1]

    def get_history(self, limit: int = 20, hours: int = 24) -> List[Dict[str, Any]]:
        """Return recent alert history within the last N hours."""
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        result = []
        for entry in reversed(self._history):
            try:
                ts = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
                if ts.replace(tzinfo=None) >= cutoff:
                    result.append(entry)
                if len(result) >= limit:
                    break
            except (KeyError, ValueError):
                continue
        return result

    def _add_to_history(self, key: str, message: str, resolved: bool = False,
                        station: Optional[str] = None) -> None:
        """Add an alert event to history."""
        now = datetime.utcnow().isoformat() + "Z"
        if resolved:
            # Find the matching active alert in history and mark it resolved
            for entry in reversed(self._history):
                if entry["key"] == key and "resolved_at" not in entry:
                    entry["resolved_at"] = now
                    break
        else:
            # New alert triggered
            self._active_since[key] = now
            self._history.append({
                "key": key,
                "message": message,
                "timestamp": now,
                "station": station,
            })

    async def process(self, data: Dict[str, Any], station: Optional[str] = None,
                      label: Optional[str] = None,
                      thresholds: Optional[Dict[str, Any]] = None,
                      now: Optional[datetime] = None,
                      disabled: Optional[List[str]] = None,
                      qc_rejected: Optional[Set[str]] = None) -> None:
        """
        Evalúa reglas y notifica en las transiciones, POR ESTACIÓN.
        El estado (active/historial) se namespacea por estación y el mensaje se
        etiqueta con la estación cuando no es la principal. `thresholds` permite
        umbrales propios por estación (caen a los globales si no se definen).
        `now` fija el reloj (pruebas de histéresis/tendencia). `disabled` es la
        lista de reglas apagadas: para la principal (None) usa la global de
        settings; una secundaria pasa la suya (independiente).
        """
        if not self.enabled:
            return

        prefix = "" if station is None else f"{station}:"
        tag = "" if station is None else f"[{label or station}] "
        now = now or datetime.utcnow()
        # Persistencia (minutos) que la condición debe sostenerse antes de avisar
        # o normalizar. 0 = inmediato (ráfaga y reglas exentas).
        persist = float(getattr(self._settings, "alert_persist_minutes", 3.0) or 0)
        # Reglas apagadas: la secundaria pasa la suya; la principal (disabled=None)
        # cae a la lista global de settings.
        if disabled is None:
            disabled = getattr(self._settings, "alert_rules_disabled", []) or []
        disabled_set = set(disabled)

        for key, (triggered, message) in self.evaluate(
            data, station=station, thresholds=thresholds, now=now, qc_rejected=qc_rejected
        ).items():
            nkey = f"{prefix}{key}"

            # Regla apagada: no dispara y, si estaba activa, se limpia EN SILENCIO
            # (sin "Normalizado") junto con sus temporizadores.
            if key in disabled_set:
                self.active.pop(nkey, None)
                self._active_since.pop(nkey, None)
                self._pending_on.pop(nkey, None)
                self._pending_off.pop(nkey, None)
                continue

            cat = _category_for(key)
            need = timedelta(minutes=0 if _persist_exempt(key) else persist)
            is_active = nkey in self.active

            if triggered and not is_active:
                # Candidato a ACTIVAR: exige persistencia sostenida.
                self._pending_off.pop(nkey, None)
                first = self._pending_on.setdefault(nkey, now)
                if now - first >= need:
                    self._pending_on.pop(nkey, None)
                    self.active[nkey] = tag + message
                    self._add_to_history(nkey, tag + message, resolved=False, station=station)
                    await self._safe_notify(f"⚠️ ALERTA — {tag}{message}", category=cat)
            elif not triggered and is_active:
                # Candidato a NORMALIZAR: exige la condición despejada y sostenida.
                self._pending_on.pop(nkey, None)
                first = self._pending_off.setdefault(nkey, now)
                if now - first >= need:
                    self._pending_off.pop(nkey, None)
                    prev_msg = self.active[nkey]
                    self._add_to_history(nkey, prev_msg, resolved=True, station=station)
                    self.active.pop(nkey, None)
                    self._active_since.pop(nkey, None)
                    # El aviso de normalización NO puede reusar el texto de alerta:
                    # daba "✅ Normalizado — 🌡️ Temperatura alta: 22 °C (≥ 35 °C)",
                    # que se lee contradictorio. Las de tendencia sí traen un texto
                    # propio para el caso normal; para las de umbral se usa solo la
                    # CONDICIÓN que estaba activa (lo anterior a los dos puntos),
                    # sin el valor que ya no la cumple.
                    normal = (tag + message) if key in _TREND_RULES else prev_msg.split(":", 1)[0].strip()
                    await self._safe_notify(f"✅ Normalizado — {normal}", category=cat)
            else:
                # Estado estable: cancela cualquier cuenta regresiva pendiente
                # (esto mata el parpadeo alrededor del umbral).
                self._pending_on.pop(nkey, None)
                self._pending_off.pop(nkey, None)

        # Sensores que se dejan de vigilar por llevar demasiado sin reportar. Se
        # avisa UNA vez y se limpia su estado: si el sensor vuelve, se re-registra
        # solo y su alerta puede dispararse de nuevo con normalidad.
        for skey in self._just_forgotten:
            nk = f"{prefix}sensor_{skey}"
            self.active.pop(nk, None)
            self._active_since.pop(nk, None)
            self._pending_on.pop(nk, None)
            self._pending_off.pop(nk, None)
            lbl = self._sensor_label(_SENSOR_PRESENCE[skey])
            await self._safe_notify(
                f"🔕 {tag}Se deja de vigilar {lbl}: {SENSOR_FORGET_DAYS} días sin reportar. "
                f"Si vuelve a dar señal se re-registra solo.",
                category="sensor",
            )
        self._just_forgotten = []

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
                self._add_to_history(key, message, resolved=False)
                await self._safe_notify(f"⚠️ ALERTA — {message}", category="air")
            elif not triggered and key in self.active:
                self._add_to_history(key, self.active[key], resolved=True)
                self.active.pop(key, None)
                self._active_since.pop(key, None)
                await self._safe_notify(f"✅ Normalizado — {message}", category="air")

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

        key = f"station_offline_{station or 'principal'}"
        if age > threshold_s and not was_offline:
            self.stations_offline[station] = True
            msg = f"🔌 La estación **{label}** no envía datos desde hace {int(age // 60)} min."
            self._add_to_history(key, msg, resolved=False)
            await self._safe_notify(msg, category="station")
            return msg

        if age <= threshold_s and was_offline:
            self.stations_offline[station] = False
            msg = f"✅ La estación **{label}** volvió a enviar datos."
            self._add_to_history(key, f"Estación {label} offline", resolved=True)
            await self._safe_notify(msg, category="station")
            return msg

        return None

    async def _safe_notify(self, text: str, category: Optional[str] = None) -> None:
        try:
            if self._using_default:
                await self._default_notifier(text, category)
            else:
                # Notifier inyectado (tests): contrato de un solo argumento.
                await self._notifier(text)
        except Exception as e:  # never let a notification failure break ingestion
            logger.error(f"Alert notification failed: {e}")

    def _channel_allows(self, channel: str, category: Optional[str]) -> bool:
        """
        ¿El canal (`telegram`/`email`) debe recibir esta categoría?
        category=None (mensajes sueltos/pruebas) => siempre. Lista de categorías
        None en settings => todas; lista vacía => ninguna.
        """
        if category is None:
            return True
        cats = getattr(self._settings, f"{channel}_categories", None)
        if cats is None:
            return True
        return category in cats

    async def _default_notifier(self, text: str, category: Optional[str] = None) -> None:
        s = self._settings
        tg_on = bool(s.telegram_enabled and s.telegram_bot_token and s.telegram_chat_id)
        em_on = bool(getattr(s, "email_enabled", False)
                     and getattr(s, "smtp_host", None) and getattr(s, "email_to", None))

        if tg_on and self._channel_allows("telegram", category):
            try:
                await self._send_telegram(text)
            except Exception as e:
                logger.error(f"Telegram alert failed: {e}")

        if em_on and self._channel_allows("email", category):
            try:
                await self._send_email(text)
            except Exception as e:
                logger.error(f"Email alert failed: {e}")

        if not tg_on and not em_on:
            # Ningún canal configurado: al menos deja rastro en el log.
            logger.warning(f"[ALERT] {text}")

    async def _send_telegram(self, text: str) -> None:
        s = self._settings
        url = f"https://api.telegram.org/bot{s.telegram_bot_token}/sendMessage"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={"chat_id": s.telegram_chat_id, "text": text})
            resp.raise_for_status()
        logger.info(f"Telegram alert sent: {text}")

    async def _send_email(self, text: str, subject: Optional[str] = None) -> None:
        # smtplib es bloqueante: lo corremos en un hilo para no frenar el loop.
        await asyncio.to_thread(self._send_email_sync, text, subject)

    def _send_email_sync(self, text: str, subject: Optional[str] = None) -> None:
        s = self._settings
        recipients = [a.strip() for a in str(s.email_to).replace(";", ",").split(",") if a.strip()]
        if not recipients:
            logger.warning("Email sin destinatarios; omitido")
            return
        sender = getattr(s, "email_from", None) or s.smtp_user or recipients[0]

        msg = EmailMessage()
        # Asunto: una línea corta a partir del texto (sin saltos).
        msg["Subject"] = subject or f"Estación Clima XE1E — {text.splitlines()[0][:80]}"
        msg["From"] = sender
        msg["To"] = ", ".join(recipients)
        msg.set_content(text)

        host = s.smtp_host
        port = int(getattr(s, "smtp_port", 587) or 587)
        ctx = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15, context=ctx) as srv:
                if s.smtp_user:
                    srv.login(s.smtp_user, s.smtp_password or "")
                srv.send_message(msg, from_addr=sender, to_addrs=recipients)
        else:
            with smtplib.SMTP(host, port, timeout=15) as srv:
                if getattr(s, "smtp_tls", True):
                    srv.starttls(context=ctx)
                if s.smtp_user:
                    srv.login(s.smtp_user, s.smtp_password or "")
                srv.send_message(msg, from_addr=sender, to_addrs=recipients)
        logger.info(f"Email alert sent to {recipients}")

    # --- Alertas visuales (análisis del cielo con IA) ---
    # Histéresis: contador de análisis consecutivos con la condición activa.
    # Requiere N análisis seguidos para disparar (evita falsos positivos).
    _sky_consecutive: Dict[str, int] = {}
    _SKY_HYSTERESIS = 2  # análisis consecutivos requeridos

    async def check_sky(self, analysis: Optional[Dict[str, Any]]) -> None:
        """
        Evalúa el análisis del cielo y dispara alertas visuales.

        Reglas:
        - sky_storm: cumulonimbus + development=building → tormenta formándose
        - sky_precipitation: precipitation_visible=true → lluvia aproximándose
        - sky_visibility: visibility=poor/very_poor → visibilidad reducida

        Usa histéresis: la condición debe cumplirse en N análisis consecutivos
        para disparar, evitando falsos positivos por variaciones del modelo.
        """
        s = self._settings
        if not self.enabled:
            logger.debug("check_sky: alertas deshabilitadas globalmente")
            return
        if not getattr(s, "alert_visual_enabled", True):
            logger.debug("check_sky: alertas visuales deshabilitadas")
            return
        if not analysis or analysis.get("error"):
            logger.debug("check_sky: análisis inválido o con error")
            return
        logger.info("check_sky: evaluando análisis %s/%s/%s",
                    analysis.get("sky_condition"), analysis.get("cloud_type"),
                    analysis.get("development"))

        # Reglas deshabilitadas
        disabled = set(getattr(s, "alert_visual_rules_disabled", []) or [])

        sky_cond = analysis.get("sky_condition", "")
        cloud_type = analysis.get("cloud_type", "")
        development = analysis.get("development", "")
        visibility = analysis.get("visibility", "")

        # Tormenta: condición tormentosa O nubes de desarrollo vertical creciendo
        storm_condition = (
            sky_cond == "stormy"
            or (cloud_type in ("cumulonimbus", "cumulus") and development == "building")
        )

        checks = [
            (
                "sky_storm",
                storm_condition,
                f"⛈️ Condiciones tormentosas: {cloud_type or sky_cond}, desarrollo {development or 'activo'}",
            ),
            (
                "sky_precipitation",
                analysis.get("precipitation_visible") is True,
                f"🌧️ Precipitación visible: se observa lluvia en el horizonte",
            ),
            (
                "sky_visibility",
                visibility in ("poor", "very_poor"),
                f"🌫️ Visibilidad reducida: {visibility}",
            ),
        ]

        for key, triggered, message in checks:
            if key in disabled:
                # Regla apagada: limpiar estado
                self.active.pop(key, None)
                self._sky_consecutive.pop(key, None)
                continue

            was_active = key in self.active

            if triggered:
                # Incrementar contador de consecutivos
                self._sky_consecutive[key] = self._sky_consecutive.get(key, 0) + 1
                logger.info("check_sky: %s triggered, consecutivos=%d/%d",
                            key, self._sky_consecutive[key], self._SKY_HYSTERESIS)
                # Disparar solo si cumple histéresis
                if self._sky_consecutive[key] >= self._SKY_HYSTERESIS and not was_active:
                    self.active[key] = message
                    self._add_to_history(key, message, resolved=False)
                    logger.info("check_sky: DISPARANDO ALERTA %s", key)
                    await self._safe_notify(f"⚠️ ALERTA VISUAL — {message}", category="visual")
            else:
                # Condición no cumplida: resetear contador
                if self._sky_consecutive.get(key, 0) > 0:
                    logger.debug("check_sky: %s no triggered, reseteando contador", key)
                self._sky_consecutive[key] = 0
                if was_active:
                    self._add_to_history(key, self.active[key], resolved=True)
                    self.active.pop(key, None)
                    await self._safe_notify(f"✅ Normalizado — {message}", category="visual")

    # --- Pruebas desde el panel (fuerzan el envío por un canal concreto) ---
    async def send_test_telegram(self) -> None:
        await self._send_telegram("🧪 Mensaje de prueba desde Estacion Clima XE1E")

    async def send_test_email(self) -> None:
        await self._send_email(
            "Este es un mensaje de prueba desde tu Estación Clima XE1E.\n\n"
            "Si lo recibes, las notificaciones por correo están configuradas correctamente.",
            subject="🧪 Prueba — Estación Clima XE1E",
        )
