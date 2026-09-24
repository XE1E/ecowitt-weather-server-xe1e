"""Configuración común de las pruebas.

Las rutas de datos por omisión del receiver apuntan a /data (el volumen de Docker).
Se redirigen a una carpeta temporal ANTES de que cualquier prueba importe
`app.config`/`app.main`, para que importar la app no escriba logs ni settings.json
fuera de la prueba.
"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="receiver-tests-")
for _var, _sub in {
    "LOG_DIR": "logs",
    "SETTINGS_FILE": "settings.json",
    "KIOSK_LOCAL_FILE": "kiosk_local.json",
    "CAMERA_DIR": "camera",
    "FORECAST_LOG_DIR": "forecast_log",
    "RADAR_ARCHIVE_DIR": "radar_sacmex",
    "DIGEST_STATE_FILE": "digest_state.json",
    "BACKUP_STATUS_DIR": "backups",
}.items():
    os.environ.setdefault(_var, os.path.join(_TMP, _sub))
