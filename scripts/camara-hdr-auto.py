#!/usr/bin/env python3
"""
*** BLOQUEADO, NO DESPLEGAR TAL CUAL (2026-08-31) ***
La autenticación de pytapo contra esta cámara (C325WB) falla con "Invalid
authentication data" -- probado con la cuenta de cámara, con admin+contraseña
de la cuenta TP-Link y con el correo de esa cuenta, los tres con el mismo
error. Es un bug de compatibilidad sin resolver entre pytapo y el firmware de
esta cámara (ver docs/archivo/PLAN-HDR-CAMARA.md para la evidencia completa y
las dos vías descartadas -- pytapo y ONVIF). El cálculo de posición del sol de
este archivo sigue siendo correcto y reutilizable; sólo la llamada final a
pytapo.setHDR() no funciona contra esta cámara.

Enciende/apaga el HDR de la cámara Tapo según la posición REAL del sol.

Por qué: la cámara mira a un rumbo fijo y el sol entra en el encuadre como una
bola que sobreexpone el aire alrededor -- se ve como bruma/nubosidad ligera
cerca del sol aunque el resto de la imagen esté limpio (confirmado en fotos
reales, 2026-08-31). Tapo no tiene un "WDR"/"BLC" con ese nombre, pero sí HDR
(realza sombras/altas luces), controlable sin la app vía la librería `pytapo`
usando la misma "cuenta de cámara" que ya usa captura-camara.sh para RTSP.

Por qué por posición solar y no por horario fijo: el rumbo de la cámara es
fijo, pero el arco por donde amanece se mueve bastante a lo largo del año --
un horario fijo se quedaría corto en unas épocas y sobrando en otras. Aquí se
usa el azimut/altura real del sol que YA calcula el servidor (pyephem, el
mismo dato de la página de Astronomía) vía el endpoint público
GET /api/almanac -- no hace falta credenciales ni tocar el servidor para esto.

Limitación conocida: pytapo no expone una forma de LEER el HDR actual de la
cámara (sólo `setHDR`), así que este script recuerda el último estado que
ÉL PUSO en un archivo junto al script (.camara-hdr.state). Si alguien cambia
el HDR a mano desde la app Tapo, ese archivo queda desincronizado hasta el
siguiente cambio real de estado -- no es grave (el intervalo entre encendido
y apagado son horas), pero conviene saberlo.

Requiere:
  pip3 install pytapo

Corre en la MISMA red local que la cámara. Configuración en camara.env (ver
camara.env.example) -- variables CAMERA_HDR_AUTO / CAMERA_BEARING_DEG /
CAMERA_TILT_DEG / CAMERA_FOV_H_DEG / CAMERA_FOV_V_DEG.

Antes de confiar en esto: CALIBRA CAMERA_BEARING_DEG. Ver
docs/archivo/PLAN-HDR-CAMARA.md -- un rumbo mal calibrado puede encender el
HDR a horas que no tocan (o nunca encenderlo). Por eso, sin CAMERA_BEARING_DEG
puesto explícitamente, el script NO ADIVINA: se sale sin tocar nada.

Uso:
  python3 camara-hdr-auto.py [-e camara.env] [-v]

Pensado para un timer de systemd cada 5 min (scripts/systemd/camara-hdr.*).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.request
from pathlib import Path

DIR = Path(__file__).resolve().parent
STATE_FILE = DIR / ".camara-hdr.state"


def leer_env(ruta: Path) -> dict:
    """Lee KEY=VALUE de camara.env (mismo formato que usa captura-camara.sh),
    sin pisar variables que systemd ya haya puesto en el entorno."""
    valores: dict = {}
    if ruta.is_file():
        for linea in ruta.read_text(encoding="utf-8").splitlines():
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            clave, _, valor = linea.partition("=")
            valores[clave.strip()] = valor.strip().strip('"')
    for clave, valor in valores.items():
        os.environ.setdefault(clave, valor)
    return {**valores, **os.environ}


def angulo_diff(a: float, b: float) -> float:
    """Diferencia angular más corta entre dos rumbos (0-360), en [0, 180]."""
    d = abs(a - b) % 360
    return min(d, 360 - d)


def sol_en_encuadre(sun_az: float, sun_alt: float, cfg: dict) -> bool:
    """True si, con la geometría configurada, el sol cae dentro del campo de
    visión de la cámara ahora mismo (y sobre el horizonte)."""
    rumbo = float(cfg["CAMERA_BEARING_DEG"])
    fov_h = float(cfg.get("CAMERA_FOV_H_DEG", 106))   # spec C325WB
    fov_v = float(cfg.get("CAMERA_FOV_V_DEG", 56))    # spec C325WB
    tilt = float(cfg.get("CAMERA_TILT_DEG", 0))       # 0 = cámara a nivel

    if sun_alt <= 0:
        return False  # bajo el horizonte: de noche no hay glare que mitigar
    en_horizontal = angulo_diff(sun_az, rumbo) <= (fov_h / 2)
    en_vertical = (tilt - fov_v / 2) <= sun_alt <= (tilt + fov_v / 2)
    return en_horizontal and en_vertical


def obtener_sol(api_url: str) -> tuple:
    with urllib.request.urlopen(f"{api_url.rstrip('/')}/api/almanac", timeout=10) as r:
        data = json.load(r)
    if not data.get("available"):
        raise RuntimeError("almanac no disponible")
    sun = data["sun"]
    return float(sun["azimuth"]), float(sun["altitude"])


def leer_estado():
    if not STATE_FILE.is_file():
        return None
    return STATE_FILE.read_text().strip() == "on"


def guardar_estado(on: bool) -> None:
    STATE_FILE.write_text("on" if on else "off")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-e", "--env", default=str(DIR / "camara.env"))
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S",
    )
    log = logging.getLogger("camara-hdr")

    cfg = leer_env(Path(args.env))

    if cfg.get("CAMERA_HDR_AUTO", "true").lower() in ("false", "0", "no"):
        log.info("CAMERA_HDR_AUTO=false: desactivado, no se hace nada")
        return 0

    if not cfg.get("CAMERA_USER") or cfg.get("CAMERA_USER") == "CAMBIAR":
        log.info("camara sin configurar todavia: no se hace nada")
        return 0

    if not cfg.get("CAMERA_BEARING_DEG"):
        log.warning(
            "falta CAMERA_BEARING_DEG en camara.env -- sin calibrar, no se "
            "adivina el rumbo. Ver docs/guias/camara-hdr-auto.md"
        )
        return 1

    try:
        sun_az, sun_alt = obtener_sol(cfg.get("API_URL", "https://clima.xe1e.net"))
    except Exception as e:
        log.warning(f"no se pudo consultar /api/almanac: {e}")
        return 1

    deseado = sol_en_encuadre(sun_az, sun_alt, cfg)
    actual = leer_estado()

    if actual is not None and actual == deseado:
        log.info(
            f"sin cambio (HDR {'ON' if deseado else 'OFF'}, "
            f"sol az={sun_az:.0f}° alt={sun_alt:.0f}°)"
        )
        return 0

    try:
        from pytapo import Tapo
    except ImportError:
        log.warning("falta el paquete pytapo (pip3 install pytapo); no se puede tocar el HDR")
        return 1

    try:
        tapo = Tapo(cfg["CAMERA_IP"], cfg["CAMERA_USER"], cfg["CAMERA_PASS"])
        tapo.setHDR(deseado)
    except Exception as e:
        log.warning(f"fallo al hablar con la camara: {e}")
        return 1

    guardar_estado(deseado)
    previo = "ON" if actual else ("OFF" if actual is not None else "desconocido")
    log.info(
        f"HDR -> {'ON' if deseado else 'OFF'} "
        f"(sol az={sun_az:.0f}° alt={sun_alt:.0f}°, antes era {previo})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
