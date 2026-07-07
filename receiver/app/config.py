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

    # Alerts (thresholds in metric units: °C, km/h, mm/h)
    alerts_enabled: bool = False
    alert_temp_high: float = 35.0
    alert_temp_low: float = 0.0
    alert_wind_high: float = 50.0
    alert_rain_rate: float = 10.0

    # Telegram notifications
    telegram_enabled: bool = False
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None

    # Server
    debug: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
