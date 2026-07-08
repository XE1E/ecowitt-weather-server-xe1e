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
    # Avisar si la estación deja de enviar datos por este tiempo (minutos)
    alert_station_offline_minutes: int = 15

    # Telegram notifications
    telegram_enabled: bool = False
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None

    # Air quality (WAQI / aqicn.org) - token gratuito de aqicn.org/data-platform/token
    waqi_token: Optional[str] = None

    # Control de calidad (QC): descarta lecturas fuera de rango antes de guardar
    qc_enabled: bool = True

    # Calibración de sensores (offsets se suman; multiplicadores escalan; 1.0 = sin cambio)
    cal_enabled: bool = False
    cal_temp_offset: float = 0.0       # °C
    cal_humidity_offset: float = 0.0   # %
    cal_pressure_offset: float = 0.0   # hPa
    cal_wind_mult: float = 1.0
    cal_rain_mult: float = 1.0

    # Publicación a redes públicas (uploaders tipo WeeWX)
    wu_enabled: bool = False           # Weather Underground
    wu_station_id: Optional[str] = None
    wu_station_key: Optional[str] = None
    pws_enabled: bool = False          # PWSWeather
    pws_station_id: Optional[str] = None
    pws_password: Optional[str] = None
    windy_enabled: bool = False        # Windy.com
    windy_api_key: Optional[str] = None
    owm_enabled: bool = False          # OpenWeatherMap
    owm_api_key: Optional[str] = None
    owm_station_id: Optional[str] = None
    cwop_enabled: bool = False         # CWOP / APRS-IS (entra a MADIS/NOAA)
    cwop_callsign: Optional[str] = None    # indicativo ham (XE1E) o designador CWxxxx
    cwop_passcode: str = "-1"              # -1 para designadores CW; passcode APRS si es indicativo ham
    cwop_latitude: float = 19.380359
    cwop_longitude: float = -99.174564

    # Panel de administración (si faltan credenciales, el panel queda deshabilitado)
    admin_user: Optional[str] = None
    admin_password: Optional[str] = None
    settings_file: str = "/data/settings.json"

    # Server
    debug: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
