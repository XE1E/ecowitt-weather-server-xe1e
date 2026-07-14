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
        self._settings = settings
        self._client = client
        self._discovery_sent = False
        self._connected = False
        self._last_error: Optional[str] = None
        self._sync_settings()

    def _sync_settings(self) -> None:
        """Sync instance attributes with current settings."""
        self.enabled: bool = self._settings.mqtt_enabled
        self.base_topic: str = self._settings.mqtt_topic
        self.state_topic: str = f"{self.base_topic}/state"
        self.hass: bool = self._settings.hass_discovery
        self.prefix: str = self._settings.hass_discovery_prefix

    @property
    def connected(self) -> bool:
        return self._connected and self._client is not None

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    def get_status(self) -> Dict[str, Any]:
        """Return current MQTT connection status."""
        return {
            "enabled": self.enabled,
            "connected": self.connected,
            "broker": self._settings.mqtt_broker if self.enabled else None,
            "port": self._settings.mqtt_port if self.enabled else None,
            "topic": self.base_topic if self.enabled else None,
            "hass_discovery": self.hass,
            "last_error": self._last_error,
        }

    def connect(self) -> bool:
        """Connect to MQTT broker. Returns True on success."""
        if not self.enabled:
            return False
        try:
            import paho.mqtt.client as mqtt

            client = mqtt.Client()
            if self._settings.mqtt_username:
                client.username_pw_set(
                    self._settings.mqtt_username, self._settings.mqtt_password
                )
            client.on_connect = self._on_connect
            client.on_disconnect = self._on_disconnect
            client.connect(self._settings.mqtt_broker, self._settings.mqtt_port)
            client.loop_start()
            self._client = client
            self._connected = True
            self._last_error = None
            logger.info(
                f"Connected to MQTT broker {self._settings.mqtt_broker}:{self._settings.mqtt_port}"
            )
            return True
        except Exception as e:
            self._last_error = str(e)
            logger.error(f"MQTT connection failed: {e}")
            self._client = None
            self._connected = False
            return False

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected = True
            self._last_error = None
            logger.info("MQTT connected successfully")
        else:
            self._connected = False
            self._last_error = f"Connection refused (code {rc})"
            logger.error(f"MQTT connection refused: {rc}")

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        if rc != 0:
            self._last_error = f"Unexpected disconnect (code {rc})"
            logger.warning(f"MQTT unexpected disconnect: {rc}")

    def reconnect(self) -> bool:
        """Reconnect with current settings. Call after settings change."""
        self.close()
        self._sync_settings()
        self._discovery_sent = False
        if self.enabled:
            return self.connect()
        return True

    def test_connection(self, broker: str, port: int, username: Optional[str], password: Optional[str]) -> Dict[str, Any]:
        """Test MQTT connection without affecting the main client."""
        try:
            import paho.mqtt.client as mqtt
            test_client = mqtt.Client()
            if username:
                test_client.username_pw_set(username, password)
            test_client.connect(broker, port, keepalive=5)
            test_client.disconnect()
            return {"success": True, "message": f"Conexión exitosa a {broker}:{port}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

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
