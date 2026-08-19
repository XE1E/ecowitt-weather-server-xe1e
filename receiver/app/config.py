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

    # Passkey de la estación PRINCIPAL (whitelist). Si se define, el servidor
    # SOLO acepta pushes cuyo passkey sea el de la principal o el de una
    # secundaria registrada; cualquier otro se RECHAZA (403), en vez de tratarse
    # como principal. Protege contra estaciones ajenas/mal configuradas que
    # contaminarían la principal. Vacío = comportamiento previo (no listado =
    # principal) y se registra en log el passkey entrante para poder capturarlo.
    primary_passkey: str = ""

    # Alerts (thresholds in metric units: °C, km/h, mm/h)
    alerts_enabled: bool = False
    alert_temp_high: float = 35.0
    alert_temp_low: float = 0.0
    alert_wind_high: float = 50.0
    alert_gust_high: float = 70.0
    alert_rain_rate: float = 10.0
    alert_rain_daily: float = 40.0
    alert_pressure_high: float = 1035.0
    alert_pressure_low: float = 1000.0
    # Humedad exterior (sobre humidity_outdoor). Baja = aire seco; alta = lluvia
    # inminente.
    alert_humidity_low: float = 25.0
    alert_humidity_high: float = 85.0
    # Humedad INTERIOR (sobre humidity_indoor). Existe porque al retirar la trampa
    # `treat_indoor_as_outdoor` la lectura del GW1100 volvió a humidity_indoor y la
    # vigilancia de moho se quedó sin regla que la evaluara. Alta = riesgo de moho
    # (el rango sano de interior es ~30-60 %); baja = aire demasiado seco.
    alert_humidity_indoor_low: float = 20.0
    alert_humidity_indoor_high: float = 65.0
    # Tendencia de presión: cambio (hPa) dentro de la ventana. 2 niveles por
    # dirección (aviso / fuerte). Caída = posible tormenta; subida = frente frío.
    alert_pressure_drop_warn: float = 1.5
    alert_pressure_drop_strong: float = 3.0
    alert_pressure_rise_warn: float = 1.5
    alert_pressure_rise_strong: float = 3.0
    alert_pressure_trend_window_min: int = 60
    # UV y radiación solar. Solo las reporta la principal (WS69); en una estación
    # sin esos sensores la regla simplemente no se evalúa. El 8 de UV coincide con
    # el umbral "muy alto" de la OMS y con el rojo de UvSolarCard. A 2250 m la
    # irradiancia de mediodía es alta, así que 1000 W/m² es un pico real, no ruido.
    alert_uv_high: float = 8.0
    alert_solar_high: float = 1000.0
    # Punto de rocío: alto = bochorno (el aire ya no admite más humedad), bajo =
    # aire muy seco. Se deriva de temp+humedad, así que aplica a ambas estaciones.
    alert_dew_high: float = 20.0
    alert_dew_low: float = -5.0
    # Sensación térmica (feels_like: heat index si hace calor, wind chill si frío).
    alert_feels_high: float = 38.0
    alert_feels_low: float = -2.0
    # Tendencia de temperatura: cambio (°C) dentro de la ventana, 2 niveles por
    # dirección. Una caída rápida suele ser la llegada de una tormenta.
    alert_temp_drop_warn: float = 3.0
    alert_temp_drop_strong: float = 5.0
    alert_temp_rise_warn: float = 3.0
    alert_temp_rise_strong: float = 5.0
    alert_temp_trend_window_min: int = 60
    # Histéresis anti-spam: la condición debe sostenerse estos minutos antes de
    # avisar (y estar despejada otro tanto antes de normalizar). 0 = inmediato.
    alert_persist_minutes: float = 3.0
    # Reglas deshabilitadas (por clave: temp_high, humidity_low, pressure_drop…).
    # Vacío = todas activas. Es la lista GLOBAL (principal); las secundarias tienen
    # la suya en disabled_rules dentro de su config de estación.
    alert_rules_disabled: List[str] = []
    # Avisar si la estación deja de enviar datos por este tiempo (minutos)
    alert_station_offline_minutes: int = 15
    # Avisos de batería baja y de sensor sin contacto
    alert_battery_enabled: bool = True
    alert_sensor_lost_enabled: bool = True
    # Avisos de calidad del aire (ICA/AQI e IMECA); se revisan cada ~30 min
    alert_air_enabled: bool = False
    alert_aqi_threshold: float = 100.0
    alert_imeca_threshold: float = 100.0
    # Avisos visuales (análisis del cielo con IA). Se evalúan con cada foto.
    # Reglas: sky_storm (cumulonimbus en desarrollo), sky_precipitation (lluvia
    # visible en horizonte), sky_visibility (visibilidad reducida).
    alert_visual_enabled: bool = True
    alert_visual_rules_disabled: List[str] = []

    # Telegram notifications
    telegram_enabled: bool = False
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    # Categorías de alerta que van a Telegram (None = todas). Claves válidas en
    # alerts.ALERT_CATEGORIES: temp (incluye rocío y sensación), humidity, wind,
    # rain, pressure, sun (UV y radiación), station, battery, sensor, air
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

    # WeatherAPI.com - API key gratuita (hasta 1M llamadas/mes)
    # Complementa Open-Meteo con datos más precisos para ciudades grandes
    weatherapi_key: Optional[str] = None

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
    # Altitud de la estación PRINCIPAL (m). Si >0, el servidor CALCULA la presión
    # relativa (nivel del mar) desde la absoluta con la fórmula barométrica ISA,
    # ignorando la relativa que manda la consola (útil cuando la consola no tiene
    # ajuste de altitud, p. ej. WS2910). 0 = usar la relativa de la consola.
    station_altitude_m: float = 0.0

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
    awekas_enabled: bool = False       # AWEKAS (red austriaca)
    awekas_username: Optional[str] = None
    awekas_password: Optional[str] = None
    awekas_latitude: float = 19.380359
    awekas_longitude: float = -99.174564
    awekas_interval: int = 5

    # Seguridad del endpoint de push /data/report/
    ecowitt_secure_enabled: bool = False        # exige ?token= en la petición
    ecowitt_secure_token: Optional[str] = None  # token esperado (query param)
    ecowitt_ip_allowlist: Optional[str] = None  # IPs permitidas (coma); vacío = todas

    # Cámara del exterior (Tapo C325WB). La cámara vive detrás del NAT de casa y el
    # servidor está en el VPS, así que NO se va a buscar la foto: algo en casa la
    # EMPUJA con POST /api/camera/upload. Ver docs/internal/PLAN-CAMARA-EXTERIOR.md.
    #
    # Token propio y no el del panel de administración: lo va a llevar un script
    # desatendido en una máquina de casa, y si se filtra sólo permite subir fotos.
    # Sin token definido, el endpoint de subida queda DESHABILITADO (503): es una
    # ruta de escritura pública y abrirla sin credencial sería una invitación.
    camera_upload_token: Optional[str] = None
    camera_dir: str = "/data/camera"
    # Días de fotos que se conservan para el timelapse (0 = sólo la última).
    camera_retention_days: int = 7
    # A partir de aquí la última foto se considera vieja y se avisa en la web y en el
    # kiosco. 15 min = TRES capturas perdidas con la cadencia de 5 min: así un fallo
    # suelto --un reintento que no llegó, la cámara reiniciándose-- no marca la foto
    # como antigua, pero una caída de verdad sí se ve enseguida.
    camera_stale_seconds: int = 900

    # Análisis del cielo con modelos de visión. Soporta dos proveedores:
    # - Anthropic (Claude): mejor calidad, de pago
    # - Google Gemini: tier gratuito generoso (15 RPM, 1M tokens/día)
    #
    # El proveedor se selecciona con camera_analysis_provider:
    # - "auto" (default): usa Gemini si tiene key, sino Anthropic
    # - "anthropic": fuerza Claude (requiere anthropic_api_key)
    # - "gemini": fuerza Gemini (requiere gemini_api_key)
    camera_analysis_enabled: bool = True
    camera_analysis_provider: str = "auto"  # auto | anthropic | gemini
    # API keys (al menos una requerida si el análisis está habilitado)
    anthropic_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    # Modelos por proveedor (se usan defaults si no se especifican)
    camera_analysis_model_anthropic: str = "claude-sonnet-4-20250514"
    camera_analysis_model_gemini: str = "gemini-flash-latest"
    # Cada cuántos MINUTOS analizar el cielo. NO se analiza en cada captura: a 5 min
    # serían ~288/día y agotan el tier gratuito de Gemini, que empieza a devolver 429
    # y deja el análisis congelado en el último bueno (uno viejo mostrado sobre una
    # foto nueva). El cielo no cambia tanto en 5 min; 15 deja ~72-96/día, holgado, y
    # sigue fresco para una pantalla de pared. 0 = analizar en cada captura.
    camera_analysis_interval_min: int = 15

    # ── Control de la CAPTURA (lo obedece el script de la Pi, que lee estos valores de
    # /api/camera/capture-config en cada corrida). Así se prende/apaga la cámara y se
    # cambia su ritmo y horario desde el panel, sin entrar a la Pi.
    camera_capture_enabled: bool = True
    # Minutos entre capturas. El timer de la Pi corre seguido y el script salta si no ha
    # pasado este rato desde la última.
    camera_capture_interval_min: int = 5
    # Franja horaria de captura (hora local de la Pi, 0-23). De noche la cámara sólo ve
    # negro: capturar y analizar entonces gasta cuota y disco sin aportar. Con
    # start == end se captura las 24 h.
    camera_capture_hour_start: int = 6
    camera_capture_hour_end: int = 20

    # ── Timelapse diario (services/timelapse.py). Los fotogramas ya se archivan por
    # día; esto los junta en un MP4 con ffmpeg EN EL VPS. Ver el módulo para por qué
    # aquí y no en la Pi de casa.
    camera_timelapse_enabled: bool = True
    # Fotogramas por segundo del vídeo. Con la ventana de captura de 06-20 h a 5 min
    # son ~168 capturas, así que a 12 fps el día dura ~14 s: por debajo de eso las
    # nubes dan saltos y por encima se pasa demasiado rápido para verlas moverse.
    camera_timelapse_fps: int = 12
    # Ancho del vídeo. La C325WB da 2K; 1280 baja el archivo a un par de MB sin que se
    # note en pantalla, y el encode de un día entero se queda en segundos.
    camera_timelapse_width: int = 1280
    # Por debajo de esto no se genera nada: con cuatro capturas el "vídeo" sería un
    # pestañeo de un tercio de segundo, y da peor impresión que no ofrecerlo.
    camera_timelapse_min_frames: int = 10
    # Retención de los VÍDEOS, aparte de la de los fotogramas (7 días) y mucho más
    # larga: un día de fotos pesa ~30 MB y su vídeo ~2 MB, así que el timelapse es lo
    # que puede sobrevivir meses. 0 = no purgar nunca.
    camera_timelapse_retention_days: int = 90

    # ¿La página de cámara aparece en el kiosco? Si es False, la celda de condición de la
    # consola vuelve a llevar al pronóstico y el menú no la lista.
    kiosk_camera_enabled: bool = True

    # Timezone (para sincronización con displays ESP32)
    timezone_offset: int = -6  # UTC offset in hours (e.g., -6 for Mexico City)

    # Panel de administración (si faltan credenciales, el panel queda deshabilitado)
    admin_user: Optional[str] = None
    admin_password: Optional[str] = None
    # Alternativa recomendada a admin_password en claro: hash PBKDF2 generado con
    # admin.hash_password(). Si está definido, tiene prioridad sobre admin_password.
    admin_password_hash: Optional[str] = None
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
