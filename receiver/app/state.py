"""
Estado compartido del receiver: los objetos que usan main.py y los routers
(app/routers/*). Viven aquí, y no en main.py, para que un router nunca tenga que
importar main (import circular). Los routers los leen como `state.X` (atributo del
módulo), así las pruebas pueden sustituirlos.
"""
from typing import Dict, Optional

from .config import settings
from .services.alerts import AlertService
from .services.mqtt_publisher import MqttPublisher
from .services.camera import CameraStore
from .services.storage import InfluxDBStorage
from .services.timelapse import TimelapseService

storage = InfluxDBStorage(
    url=settings.influxdb_url,
    token=settings.influxdb_token,
    org=settings.influxdb_org,
    bucket=settings.influxdb_bucket,
)

# Última lectura en memoria, por estación. Clave None = estación principal;
# clave "nombre" = estación secundaria (p. ej. un GW1100). Acceso rápido para
# /api/current y para pasar la lectura previa al filtro de picos por estación.
latest_by_station: Dict[Optional[str], dict] = {}

# Weather alerts (Telegram / correo)
alert_service = AlertService(settings)

# MQTT publisher (with Home Assistant discovery)
mqtt_publisher = MqttPublisher(settings)


# Cámara del exterior: la foto la EMPUJA la Raspberry de casa (está detrás del NAT)
# hacia el VPS. Ver docs/archivo/PLAN-CAMARA-EXTERIOR.md y services/camera.py.
timelapse = TimelapseService(
    base_dir=settings.camera_dir,
    fps=settings.camera_timelapse_fps,
    width=settings.camera_timelapse_width,
    min_frames=settings.camera_timelapse_min_frames,
    retention_days=settings.camera_timelapse_retention_days,
)

camera = CameraStore(
    base_dir=settings.camera_dir,
    retention_days=settings.camera_retention_days,
    stale_seconds=settings.camera_stale_seconds,
    analysis_retention_days=settings.camera_analysis_retention_days,
)


def station_pressure_hpa() -> Optional[float]:
    """
    Presión ABSOLUTA de la principal (hPa), para convertir µg/m³ → ppm en el IMECA
    con el volumen molar del sitio. A 2240 m la diferencia contra 1 atm cambia el
    índice de categoría (ver imeca.molar_volume). None => se supone nivel del mar.
    """
    return (latest_by_station.get(None) or {}).get("pressure_absolute")
