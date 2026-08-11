"""
Cámara del exterior: recepción, servido y retención de las fotos.

La cámara (Tapo C325WB) queda en casa **detrás del NAT** y el servidor corre en el
VPS, así que el VPS no puede ir a buscarla: algo en casa saca un JPEG del RTSP cada
pocos minutos y lo EMPUJA aquí. Este módulo sólo ve el resultado de ese empujón.

Decisión de fondo (docs/internal/PLAN-CAMARA-EXTERIOR.md): **fotos periódicas, no
directo 24/7**. Un directo serían ~1 TB/mes de subida desde casa y un proceso de vídeo
corriendo para siempre; para un sitio de clima, la foto cada pocos minutos y el
timelapse dan más y cuestan casi nada.

Qué se guarda:
    <camera_dir>/latest.jpg              la última, servida tal cual
    <camera_dir>/latest.json             su metadato (cuándo se capturó, tamaño)
    <camera_dir>/YYYY-MM-DD/HHMMSS.jpg   histórico, para el timelapse diario

El histórico se poda por DÍAS COMPLETOS y no por número de fotos: si un día la
cadencia falla y sólo llegan diez capturas, borrar "las más viejas" se comería días
enteros de historia buena a cambio de nada.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# Firma de un JPEG (SOI). Se comprueba para no acabar guardando como "foto" el HTML
# de un portal cautivo o una respuesta de error del propio ffmpeg.
_JPEG_MAGIC = b"\xff\xd8\xff"

# Tope por foto. La C325WB da 2K: una captura ronda 200-600 KB, así que 12 MB es
# holgadísimo y a la vez impide que un cliente roto llene el disco de un envío.
MAX_BYTES = 12 * 1024 * 1024


class CameraStore:
    def __init__(self, base_dir: str, retention_days: int = 7, stale_seconds: int = 1200):
        self.base = base_dir
        self.retention_days = max(0, retention_days)
        self.stale_seconds = stale_seconds

    # ── rutas ────────────────────────────────────────────────────────────────
    @property
    def latest_jpg(self) -> str:
        return os.path.join(self.base, "latest.jpg")

    @property
    def latest_meta(self) -> str:
        return os.path.join(self.base, "latest.json")

    @property
    def latest_analysis(self) -> str:
        return os.path.join(self.base, "latest_analysis.json")

    # ── escritura ────────────────────────────────────────────────────────────
    def save(self, data: bytes, taken_at: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Guarda una captura. Devuelve su metadato.

        Levanta ValueError si el contenido no es un JPEG o no tiene tamaño razonable:
        vale más rechazar el envío que dejar `latest.jpg` con basura, porque la página
        del kiosco lo daría por bueno y enseñaría un roto donde debería estar el cielo.
        """
        if len(data) < 1024:
            raise ValueError("imagen demasiado pequeña")
        if len(data) > MAX_BYTES:
            raise ValueError("imagen demasiado grande")
        if not data.startswith(_JPEG_MAGIC):
            raise ValueError("el contenido no es un JPEG")

        ts = taken_at or datetime.now(timezone.utc)
        os.makedirs(self.base, exist_ok=True)

        # Escritura ATÓMICA: a un temporal y luego rename. Si se escribiera encima de
        # latest.jpg, una petición que llegara a mitad del volcado serviría media
        # foto --y el navegador la pintaría a medias, sin error--.
        tmp = self.latest_jpg + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, self.latest_jpg)

        meta = {
            "captured_at": ts.isoformat(),
            "bytes": len(data),
        }
        tmp_meta = self.latest_meta + ".tmp"
        with open(tmp_meta, "w", encoding="utf-8") as f:
            json.dump(meta, f)
        os.replace(tmp_meta, self.latest_meta)

        if self.retention_days > 0:
            self._archive(data, ts)
            self._prune()
        return meta

    def _archive(self, data: bytes, ts: datetime) -> None:
        """Copia al histórico del día, que es lo que alimentará el timelapse."""
        local = ts.astimezone()
        day_dir = os.path.join(self.base, local.strftime("%Y-%m-%d"))
        try:
            os.makedirs(day_dir, exist_ok=True)
            with open(os.path.join(day_dir, local.strftime("%H%M%S") + ".jpg"), "wb") as f:
                f.write(data)
        except OSError as e:
            # Que falle el archivo no debe tumbar la subida: la foto de AHORA ya está
            # guardada y es la que mira el kiosco.
            logger.warning("no se pudo archivar la captura: %s", e)

    def _prune(self) -> None:
        """Borra las carpetas de días anteriores a la retención."""
        limite = (datetime.now().astimezone() - timedelta(days=self.retention_days)).date()
        try:
            for nombre in os.listdir(self.base):
                ruta = os.path.join(self.base, nombre)
                if not os.path.isdir(ruta):
                    continue
                try:
                    dia = datetime.strptime(nombre, "%Y-%m-%d").date()
                except ValueError:
                    continue          # carpeta que no es un día: no es nuestra
                if dia < limite:
                    shutil.rmtree(ruta, ignore_errors=True)
                    logger.info("cámara: purgado %s", nombre)
        except OSError as e:
            logger.warning("no se pudo purgar el histórico: %s", e)

    # ── lectura ──────────────────────────────────────────────────────────────
    def status(self) -> Dict[str, Any]:
        """
        Estado para el kiosco y la web: si hay foto, de cuándo y si está vieja.

        `available` es False mientras no llegue ninguna captura, que es lo que hace
        que la página del display diga "sin imagen" en vez de enseñar un hueco.
        """
        try:
            st = os.stat(self.latest_jpg)
        except OSError:
            return {"available": False, "configured": bool(self.base)}

        captured_at: Optional[str] = None
        try:
            with open(self.latest_meta, encoding="utf-8") as f:
                captured_at = json.load(f).get("captured_at")
        except (OSError, ValueError):
            pass
        # Sin metadato se usa la fecha del archivo: peor, pero no deja al display sin
        # saber si lo que ve es de ahora o de anteayer.
        ts = (datetime.fromisoformat(captured_at) if captured_at
              else datetime.fromtimestamp(st.st_mtime, timezone.utc))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        edad = int((datetime.now(timezone.utc) - ts).total_seconds())
        return {
            "available": True,
            "captured_at": ts.isoformat(),
            "age_seconds": edad,
            "stale": edad > self.stale_seconds,
            "bytes": st.st_size,
        }

    def latest(self) -> Optional[Tuple[bytes, str]]:
        """La última foto y su fecha ISO, o None si todavía no hay ninguna."""
        try:
            with open(self.latest_jpg, "rb") as f:
                data = f.read()
        except OSError:
            return None
        return data, self.status().get("captured_at", "")

    def days(self) -> list:
        """Días con histórico, del más reciente al más antiguo (para el timelapse)."""
        out = []
        try:
            for nombre in sorted(os.listdir(self.base), reverse=True):
                ruta = os.path.join(self.base, nombre)
                if not os.path.isdir(ruta):
                    continue
                try:
                    datetime.strptime(nombre, "%Y-%m-%d")
                except ValueError:
                    continue
                out.append({"date": nombre, "frames": len(os.listdir(ruta))})
        except OSError:
            pass
        return out

    # ── análisis del cielo ───────────────────────────────────────────────────
    def save_analysis(self, analysis: Dict[str, Any]) -> None:
        """Guarda el análisis del cielo de la última captura."""
        os.makedirs(self.base, exist_ok=True)
        tmp = self.latest_analysis + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.latest_analysis)

    def get_analysis(self) -> Optional[Dict[str, Any]]:
        """Lee el último análisis del cielo, si existe."""
        try:
            with open(self.latest_analysis, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def status_with_analysis(self) -> Dict[str, Any]:
        """Status + análisis del cielo en una sola llamada (para la web/kiosco)."""
        result = self.status()
        analysis = self.get_analysis()
        if analysis:
            result["analysis"] = analysis
        return result
