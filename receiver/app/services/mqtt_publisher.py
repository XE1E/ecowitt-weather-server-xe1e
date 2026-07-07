"""
MQTT Publisher with Home Assistant MQTT Discovery.

Publishes the latest weather data as a single JSON state message and, when
Home Assistant discovery is enabled, publishes retained discovery configs so HA
auto-creates the sensor entities. The paho client runs its own network thread;
publish() is thread-safe and non-blocking, so it is safe to call from the async
request handler.
"""

from typing import Any, Dict, Optional
import json
import logging

logger = logging.getLogger(__name__)

# field -> (name, unit, device_class, state_class)
SENSORS: Dict[str, tuple] = {
    "temperature_outdoor": ("Temperatura Exterior", "°C", "temperature", "measurement"),
    "temperature_indoor": ("Temperatura Interior", "°C", "temperature", "measurement"),
    "humidity_outdoor": ("Humedad Exterior", "%", "humidity", "measurement"),
    "humidity_indoor": ("Humedad Interior", "%", "humidity", "measurement"),
    "pressure_relative": ("Presión Relativa", "hPa", "atmospheric_pressure", "measurement"),
    "pressure_absolute": ("Presión Absoluta", "hPa", "atmospheric_pressure", "measurement"),
    "wind_speed": ("Viento", "km/h", "wind_speed", "measurement"),
    "wind_gust": ("Ráfaga", "km/h", "wind_speed", "measurement"),
    "wind_direction": ("Dirección Viento", "°", None, "measurement"),
    "rain_rate": ("Tasa de Lluvia", "mm/h", "precipitation_intensity", "measurement"),
    "rain_daily": ("Lluvia Diaria", "mm", "precipitation", "total_increasing"),
    "uv_index": ("Índice UV", None, None, "measurement"),
    "solar_radiation": ("Radiación Solar", "W/m²", "irradiance", "measurement"),
    "dew_point": ("Punto de Rocío", "°C", "temperature", "measurement"),
    "feels_like": ("Sensación Térmica", "°C", "temperature", "measurement"),
}

DEVICE = {
    "identifiers": ["ecowitt_ws2910"],
    "name": "Ecowitt WS2910",
    "manufacturer": "Ecowitt",
    "model": "WS2910",
}


def _wn31_sensor_def(field: str) -> Optional[tuple]:
    """Discovery definition for a dynamic WN31 channel field, or None."""
    if field.startswith("temperature_ch"):
        ch = field.replace("temperature_ch", "")
        return (f"Temp Canal {ch}", "°C", "temperature", "measurement")
    if field.startswith("humidity_ch"):
        ch = field.replace("humidity_ch", "")
        return (f"Humedad Canal {ch}", "%", "humidity", "measurement")
    return None


def build_state_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """JSON-safe subset of the parsed data (numbers and booleans)."""
    return {k: v for k, v in data.items() if isinstance(v, (int, float, bool))}


class MqttPublisher:
    def __init__(self, settings, client=None):
        self.enabled: bool = settings.mqtt_enabled
        self.base_topic: str = settings.mqtt_topic
        self.state_topic: str = f"{self.base_topic}/state"
        self.hass: bool = settings.hass_discovery
        self.prefix: str = settings.hass_discovery_prefix
        self._settings = settings
        self._client = client
        self._discovery_sent = False

    def connect(self) -> None:
        if not self.enabled:
            return
        try:
            import paho.mqtt.client as mqtt

            client = mqtt.Client()
            if self._settings.mqtt_username:
                client.username_pw_set(
                    self._settings.mqtt_username, self._settings.mqtt_password
                )
            client.connect(self._settings.mqtt_broker, self._settings.mqtt_port)
            client.loop_start()
            self._client = client
            logger.info(
                f"Connected to MQTT broker {self._settings.mqtt_broker}:{self._settings.mqtt_port}"
            )
        except Exception as e:
            logger.error(f"MQTT connection failed: {e}")
            self._client = None

    def publish(self, data: Dict[str, Any]) -> None:
        if not self.enabled or self._client is None:
            return

        if self.hass and not self._discovery_sent:
            self._publish_discovery(data)
            self._discovery_sent = True

        payload = build_state_payload(data)
        self._client.publish(self.state_topic, json.dumps(payload), retain=True)

    def _publish_discovery(self, data: Dict[str, Any]) -> None:
        for field in data:
            sensor = SENSORS.get(field) or _wn31_sensor_def(field)
            if sensor:
                self._publish_sensor_config(field, sensor)
            elif field.startswith("battery_"):
                self._publish_battery_config(field)

    def _publish_sensor_config(self, field: str, sensor: tuple) -> None:
        name, unit, device_class, state_class = sensor
        config: Dict[str, Any] = {
            "name": name,
            "state_topic": self.state_topic,
            "value_template": f"{{{{ value_json.{field} }}}}",
            "unique_id": f"ecowitt_{field}",
            "state_class": state_class,
            "device": DEVICE,
        }
        if unit:
            config["unit_of_measurement"] = unit
        if device_class:
            config["device_class"] = device_class
        topic = f"{self.prefix}/sensor/ecowitt/{field}/config"
        self._client.publish(topic, json.dumps(config), retain=True)

    def _publish_battery_config(self, field: str) -> None:
        # battery_* is True=OK / False=Low. HA battery binary_sensor: ON = problem (low).
        label = field.replace("battery_", "").upper()
        config = {
            "name": f"Batería {label}",
            "state_topic": self.state_topic,
            "value_template": f"{{{{ 'OFF' if value_json.{field} else 'ON' }}}}",
            "payload_on": "ON",
            "payload_off": "OFF",
            "device_class": "battery",
            "entity_category": "diagnostic",
            "unique_id": f"ecowitt_{field}",
            "device": DEVICE,
        }
        topic = f"{self.prefix}/binary_sensor/ecowitt/{field}/config"
        self._client.publish(topic, json.dumps(config), retain=True)

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass
