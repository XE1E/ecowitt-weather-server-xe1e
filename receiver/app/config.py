from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # InfluxDB
    influxdb_url: str = "http://localhost:8086"
    influxdb_token: str = ""
    influxdb_org: str = "weather"
    influxdb_bucket: str = "ecowitt"

    # MQTT
    mqtt_enabled: bool = False
    mqtt_broker: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: Optional[str] = None
    mqtt_password: Optional[str] = None
    mqtt_topic: str = "weather/ecowitt"

    # Home Assistant
    hass_discovery: bool = True
    hass_discovery_prefix: str = "homeassistant"

    # Units
    output_unit_system: str = "metric"  # metric or imperial

    # Server
    debug: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
