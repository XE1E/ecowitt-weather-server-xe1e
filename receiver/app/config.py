from pydantic_settings import BaseSettings
from typing import List, Optional


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

    # Estaciones secundarias (solo lectura). Mapa "passkey:nombre" separado por
    # comas, p. ej. "ABC123...:gw1100". Cualquier passkey NO listado se trata
    # como la estación principal (sus datos NO llevan tag 'station').
    secondary_stations: str = ""

    # Alerts (thresholds in metric units: °C, km/h, mm/h)
    alerts_enabled: bool = False
    alert_temp_high: float = 35.0
    alert_temp_low: float = 0.0
    alert_wind_high: float = 50.0
    alert_gust_high: float = 70.0
    alert_rain_rate: float = 10.0
    alert_rain_daily: float = 40.0
    alert_pressure_high: float = 1030.0
    alert_pressure_low: float = 1000.0
    # Avisar si la estación deja de enviar datos por este tiempo (minutos)
    alert_station_offline_minutes: int = 15
    # Avisos de batería baja y de sensor sin contacto
    alert_battery_enabled: bool = True
    alert_sensor_lost_enabled: bool = True
    # Avisos de calidad del aire (ICA/AQI e IMECA); se revisan cada ~30 min
    alert_air_enabled: bool = False
    alert_aqi_threshold: float = 100.0
    alert_imeca_threshold: float = 100.0

    # Telegram notifications
    telegram_enabled: bool = False
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    # Categorías de alerta que van a Telegram (None = todas). Claves válidas en
    # alerts.ALERT_CATEGORIES: temp, wind, rain, pressure, station, battery, sensor, air
    telegram_categories: Optional[List[str]] = None

    # Notificaciones por correo (SMTP)
    email_enabled: bool = False
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_tls: bool = True                    # STARTTLS (usa SMTP_SSL si el puerto es 465)
    email_from: Optional[str] = None         # remitente (por defecto = smtp_user)
    email_to: Optional[str] = None           # destinatarios separados por coma
    email_categories: Optional[List[str]] = None  # None = todas

    # Air quality (WAQI / aqicn.org) - token gratuito de aqicn.org/data-platform/token
    waqi_token: Optional[str] = None

    # Control de calidad (QC): descarta lecturas fuera de rango antes de guardar
    qc_enabled: bool = True
    # Filtro de picos: descarta saltos imposibles entre lecturas consecutivas
    qc_spike_enabled: bool = True

    # Calibración de sensores (offsets se suman; multiplicadores escalan; 1.0 = sin cambio)
    cal_enabled: bool = False
    # Globales (compat; se conservan pero la UI usa los por-sensor de abajo)
    cal_temp_offset: float = 0.0       # °C
    cal_humidity_offset: float = 0.0   # %
    # Offsets de temperatura por sensor (°C)
    cal_temp_outdoor: float = 0.0
    cal_temp_indoor: float = 0.0
    cal_temp_ch1: float = 0.0
    cal_temp_ch2: float = 0.0
    cal_temp_ch3: float = 0.0
    cal_temp_ch4: float = 0.0
    cal_temp_ch5: float = 0.0
    cal_temp_ch6: float = 0.0
    cal_temp_ch7: float = 0.0
    cal_temp_ch8: float = 0.0
    # Offsets de humedad por sensor (%)
    cal_hum_outdoor: float = 0.0
    cal_hum_indoor: float = 0.0
    cal_hum_ch1: float = 0.0
    cal_hum_ch2: float = 0.0
    cal_hum_ch3: float = 0.0
    cal_hum_ch4: float = 0.0
    cal_hum_ch5: float = 0.0
    cal_hum_ch6: float = 0.0
    cal_hum_ch7: float = 0.0
    cal_hum_ch8: float = 0.0
    # Presión (hPa), viento, lluvia, solar/UV
    cal_pressure_offset: float = 0.0   # hPa (rel + abs)
    cal_wind_mult: float = 1.0
    cal_wind_dir_offset: float = 0.0   # grados (alineación de veleta)
    cal_rain_mult: float = 1.0
    cal_solar_mult: float = 1.0        # ganancia radiación solar
    cal_uv_offset: float = 0.0         # offset índice UV

    # Publicación a redes públicas (uploaders tipo WeeWX)
    # *_interval: minutos mínimos entre envíos a esa red (0 = cada ingesta).
    wu_enabled: bool = False           # Weather Underground
    wu_station_id: Optional[str] = None
    wu_station_key: Optional[str] = None
    wu_interval: int = 1
    pws_enabled: bool = False          # PWSWeather
    pws_station_id: Optional[str] = None
    pws_password: Optional[str] = None
    pws_interval: int = 5
    windy_enabled: bool = False        # Windy.com
    windy_api_key: Optional[str] = None
    windy_interval: int = 5
    owm_enabled: bool = False          # OpenWeatherMap
    owm_api_key: Optional[str] = None
    owm_station_id: Optional[str] = None
    owm_interval: int = 5
    cwop_enabled: bool = False         # CWOP / APRS-IS (entra a MADIS/NOAA)
    cwop_callsign: Optional[str] = None    # indicativo ham (XE1E) o designador CWxxxx
    cwop_passcode: str = "-1"              # -1 para designadores CW; passcode APRS si es indicativo ham
    cwop_latitude: float = 19.380359
    cwop_longitude: float = -99.174564
    cwop_interval: int = 10            # CWOP recomienda 10-15 min

    # Seguridad del endpoint de push /data/report/
    ecowitt_secure_enabled: bool = False        # exige ?token= en la petición
    ecowitt_secure_token: Optional[str] = None  # token esperado (query param)
    ecowitt_ip_allowlist: Optional[str] = None  # IPs permitidas (coma); vacío = todas

    # Timezone (para sincronización con displays ESP32)
    timezone_offset: int = -6  # UTC offset in hours (e.g., -6 for Mexico City)

    # Panel de administración (si faltan credenciales, el panel queda deshabilitado)
    admin_user: Optional[str] = None
    admin_password: Optional[str] = None
    settings_file: str = "/data/settings.json"

    # Server
    debug: bool = False

    @property
    def secondary_station_map(self) -> dict:
        """Parsea SECONDARY_STATIONS ("passkey:nombre,...") a {passkey: nombre}."""
        result: dict = {}
        for pair in self.secondary_stations.split(","):
            pair = pair.strip()
            if not pair or ":" not in pair:
                continue
            passkey, name = pair.split(":", 1)
            passkey, name = passkey.strip(), name.strip()
            if passkey and name:
                result[passkey] = name
        return result

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
