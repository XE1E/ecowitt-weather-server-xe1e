"""Tests for the MQTT publisher and Home Assistant discovery."""

import json
from datetime import datetime
from types import SimpleNamespace

from app.services.mqtt_publisher import MqttPublisher, build_state_payload


def make_settings(**kw):
    base = dict(
        mqtt_enabled=True,
        mqtt_topic="weather/ecowitt",
        hass_discovery=True,
        hass_discovery_prefix="homeassistant",
        mqtt_username=None,
        mqtt_password=None,
        mqtt_broker="localhost",
        mqtt_port=1883,
    )
    base.update(kw)
    return SimpleNamespace(**base)


class FakeClient:
    def __init__(self):
        self.published = []  # list of (topic, payload, retain)

    def publish(self, topic, payload, retain=False):
        self.published.append((topic, payload, retain))


SAMPLE = {
    "temperature_outdoor": 22.5,
    "humidity_outdoor": 60,
    "wind_speed": 10.0,
    "rain_daily": 3.2,
    "temperature_ch1": 21.0,
    "humidity_ch1": 48,
    "battery_wh65": True,
    "battery_ch1": False,
    "station_type": "EasyWeatherPro",   # str -> excluded from state
    "timestamp": datetime(2026, 7, 7),  # datetime -> excluded from state
}


def test_build_state_payload_filters_types():
    payload = build_state_payload(SAMPLE)
    assert payload["temperature_outdoor"] == 22.5
    assert payload["battery_wh65"] is True
    assert "station_type" not in payload  # string excluded
    assert "timestamp" not in payload     # datetime excluded


def test_publish_state_topic():
    pub = MqttPublisher(make_settings(), client=FakeClient())
    pub.publish(SAMPLE)
    topics = {t for t, _, _ in pub._client.published}
    assert "weather/ecowitt/state" in topics
    # State payload is valid JSON
    state = next(p for t, p, _ in pub._client.published if t == "weather/ecowitt/state")
    assert json.loads(state)["temperature_outdoor"] == 22.5


def test_discovery_configs_published():
    pub = MqttPublisher(make_settings(), client=FakeClient())
    pub.publish(SAMPLE)
    topics = {t for t, _, _ in pub._client.published}
    assert "homeassistant/sensor/ecowitt/temperature_outdoor/config" in topics
    assert "homeassistant/sensor/ecowitt/temperature_ch1/config" in topics
    assert "homeassistant/binary_sensor/ecowitt/battery_wh65/config" in topics

    # Discovery config content is well-formed
    cfg_raw = next(
        p for t, p, _ in pub._client.published
        if t == "homeassistant/sensor/ecowitt/temperature_outdoor/config"
    )
    cfg = json.loads(cfg_raw)
    assert cfg["device_class"] == "temperature"
    assert cfg["unit_of_measurement"] == "°C"
    assert cfg["state_topic"] == "weather/ecowitt/state"
    assert cfg["value_template"] == "{{ value_json.temperature_outdoor }}"
    assert cfg["unique_id"] == "ecowitt_temperature_outdoor"


def test_discovery_sent_only_once():
    pub = MqttPublisher(make_settings(), client=FakeClient())
    pub.publish(SAMPLE)
    first = len(pub._client.published)
    pub.publish(SAMPLE)  # second push: only state, no discovery
    second = len(pub._client.published)
    assert second - first == 1  # exactly one new (state) message


def test_disabled_publishes_nothing():
    pub = MqttPublisher(make_settings(mqtt_enabled=False), client=FakeClient())
    pub.publish(SAMPLE)
    assert pub._client.published == []


def test_battery_config_inverts_for_ha():
    pub = MqttPublisher(make_settings(), client=FakeClient())
    pub.publish(SAMPLE)
    cfg_raw = next(
        p for t, p, _ in pub._client.published
        if t == "homeassistant/binary_sensor/ecowitt/battery_ch1/config"
    )
    cfg = json.loads(cfg_raw)
    assert cfg["device_class"] == "battery"
    # True (OK) -> OFF, False (low) -> ON
    assert cfg["value_template"] == "{{ 'OFF' if value_json.battery_ch1 else 'ON' }}"
