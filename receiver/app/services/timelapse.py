"""
Timelapse diario de la cámara del exterior.

`CameraStore` ya archiva cada captura en `<camera_dir>/YYYY-MM-DD/HHMMSS.jpg`; esto
junta los fotogramas de un día en un **MP4** con ffmpeg. Era la última casilla sin
marcar de `docs/internal/PLAN-CAMARA-EXTERIOR.md`, que dejó a propósito sin decidir
"generarlo en el VPS o en casa": se hace **en el VPS**, porque los fotogramas ya están
aquí y el otro candidato --la Raspberry Pi de casa-- es un nodo IRLP en producción al
que no conviene meterle un encode, además de que habría que subir el vídeo por el
enlace de casa, que es el recurso escaso.

Se descartó también animar los JPEG en el navegador: a tamaño completo son ~50 MB de
tráfico por día, y bajarlo a base de miniaturas pedía otra dependencia (Pillow) más un
reproductor a mano, para acabar con algo que no se puede compartir ni buscar. Un MP4
sale a un par de MB, lo reproduce cualquier `<video>` y se descarga.

Dónde vive el vídeo:
    <camera_dir>/timelapse/YYYY-MM-DD.mp4    el vídeo del día
    <camera_dir>/timelapse/YYYY-MM-DD.json   con cuántos fotogramas se usaron

Los vídeos van FUERA de las carpetas de día a propósito. Así la poda de fotogramas
(`CameraStore._prune`, 7 días) no se los lleva, y el timelapse se convierte en lo que
sobrevive: las fotos de un día pesan ~30 MB y su vídeo ~2 MB, así que se pueden guardar
meses de días por lo que cuestan unos pocos días de fotogramas. Tienen su propia
retención, mucho más larga.

El `.json` de al lado es lo que permite saber si el vídeo de HOY está al día: si han
llegado más capturas que las que se usaron, hay que regenerarlo. Comparar fechas de
archivo sería más frágil (el mp4 se escribe *después* de leer los fotogramas, así que
siempre es más nuevo que ellos).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Días que se están generando ahora mismo, para que la API pueda decir "generándose"
# en vez de "no existe" --que en la web se leería como un error--.
_generando: set = set()


class TimelapseError(Exception):
    """Algo impide generar el vídeo (pocos fotogramas, ffmpeg ausente, encode roto)."""


def _valid_date(date_str: str) -> str:
    """
    Valida la fecha y la devuelve en su forma CANÓNICA (YYYY-MM-DD).

    NO es cosmético: `date_str` llega de la URL y se usa para construir rutas. Sin esta
    comprobación, un `../../etc` convertiría el endpoint en una lectura arbitraria de
    disco.

    Se normaliza además de validar porque `strptime("%Y-%m-%d")` acepta también
    `2026-8-1`, sin ceros de relleno: pasaría el filtro de seguridad, pero produciría
    nombres de archivo que no cuadran con las carpetas de día que escribe la cámara.
    Volviendo a formatear, las dos formas apuntan al mismo sitio.
    """
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        raise TimelapseError(f"fecha inválida: {date_str!r} (se espera YYYY-MM-DD)")


class TimelapseService:
    def __init__(
        self,
        base_dir: str,
        fps: int = 12,
        width: int = 1280,
        min_frames: int = 10,
        retention_days: int = 90,
        crf: int = 23,
    ):
        self.base = base_dir
        self.fps = max(1, fps)
        self.width = max(160, width)
        self.min_frames = max(2, min_frames)
        self.retention_days = max(0, retention_days)
        self.crf = crf
        self._lock: Optional[asyncio.Lock] = None
        self._lock_loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_lock(self) -> asyncio.Lock:
        """
        Candado de encode, creado dentro del loop que lo va a usar.

        Un solo encode a la vez: sin esto, dos visitantes pidiendo el mismo día recién
        empezado lanzarían dos ffmpeg contra el mismo archivo de salida.

        Se crea aquí y no en el módulo porque un `asyncio.Lock()` construido al importar
        se ata al PRIMER loop en que se usa y luego revienta con "bound to a different
        event loop" en cualquier otro. En producción hay un solo loop y da igual, pero
        los tests de este repo llaman `asyncio.run()` una vez por test, así que el
        segundo que tocara el candado fallaría sin que nada estuviera mal.
        """
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        return self._lock

    # ── rutas ────────────────────────────────────────────────────────────────
    @property
    def out_dir(self) -> str:
        return os.path.join(self.base, "timelapse")

    def video_path(self, date_str: str) -> str:
        return os.path.join(self.out_dir, f"{_valid_date(date_str)}.mp4")

    def meta_path(self, date_str: str) -> str:
        return os.path.join(self.out_dir, f"{_valid_date(date_str)}.json")

    def day_dir(self, date_str: str) -> str:
        return os.path.join(self.base, _valid_date(date_str))

    # ── inspección ───────────────────────────────────────────────────────────
    def frames(self, date_str: str) -> List[str]:
        """Fotogramas del día, en orden cronológico (rutas absolutas).

        Filtra por extensión porque en esa misma carpeta vive `analysis.json`, el
        histórico de análisis del cielo del día.
        """
        d = self.day_dir(date_str)
        try:
            nombres = sorted(n for n in os.listdir(d) if n.lower().endswith(".jpg"))
        except OSError:
            return []
        return [os.path.join(d, n) for n in nombres]

    def _meta(self, date_str: str) -> Optional[Dict[str, Any]]:
        try:
            with open(self.meta_path(date_str), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def status(self, date_str: str) -> Dict[str, Any]:
        """Qué hay de este día: fotogramas, vídeo, si está al día y si se está generando."""
        date_str = _valid_date(date_str)
        n = len(self.frames(date_str))
        meta = self._meta(date_str)
        usados = int(meta.get("frames", 0)) if meta else 0
        try:
            bytes_ = os.path.getsize(self.video_path(date_str))
        except OSError:
            bytes_ = 0
        listo = bytes_ > 0
        # Los fps del METADATO, no los de la configuración de ahora: si se cambian en el
        # panel, los vídeos ya codificados siguen durando lo que duran.
        fps = int(meta.get("fps") or self.fps) if meta else self.fps
        return {
            "date": date_str,
            "frames": n,
            "video": listo,
            "bytes": bytes_,
            "fps": fps,
            "seconds": round(usados / max(1, fps), 1) if usados else 0,
            "frames_used": usados,
            # Han llegado capturas nuevas desde el último encode: el vídeo de HOY se
            # queda corto durante el día, y esto es lo que hace que se regenere.
            "stale": listo and n > usados,
            "generating": date_str in _generando,
            "enough_frames": n >= self.min_frames,
        }

    def days(self) -> List[Dict[str, Any]]:
        """Estado de todos los días con fotogramas o con vídeo, del más nuevo al más viejo."""
        fechas = set()
        for d in (self.base, self.out_dir):
            try:
                for nombre in os.listdir(d):
                    # splitext y no nombre[:-4]: ".json" son CINCO caracteres, así que
                    # recortar cuatro dejaba "2026-08-18.j" y el día se ignoraba.
                    base, ext = os.path.splitext(nombre)
                    if ext not in (".mp4", ".json", ""):
                        continue
                    try:
                        datetime.strptime(base, "%Y-%m-%d")
                    except ValueError:
                        continue
                    fechas.add(base)
            except OSError:
                continue
        return [self.status(f) for f in sorted(fechas, reverse=True)]

    # ── generación ───────────────────────────────────────────────────────────
    async def ensure(
        self, date_str: str, force: bool = False, refresh_stale: bool = True
    ) -> Dict[str, Any]:
        """
        Genera el vídeo del día si hace falta y devuelve su estado.

        - `force`: regenera aunque esté al día (botón del panel).
        - `refresh_stale`: si el vídeo existe pero le faltan las capturas nuevas,
          rehacerlo. Lo usa la tarea periódica, que es la dueña de la frescura. El
          endpoint público lo pasa en False a propósito: si cada visita regenerara el
          día en curso, un par de visitantes bastarían para tener ffmpeg corriendo sin
          parar, y un vídeo al que le faltan los últimos minutos se ve perfectamente.

        Levanta TimelapseError si no hay fotogramas suficientes o si ffmpeg falla.
        """
        date_str = _valid_date(date_str)

        def _ya_esta(st: Dict[str, Any]) -> bool:
            if force or not st["video"]:
                return False
            return not (st["stale"] and refresh_stale)

        st = self.status(date_str)
        if _ya_esta(st):
            return st
        if not st["enough_frames"]:
            raise TimelapseError(
                f"{date_str}: {st['frames']} fotograma(s), hacen falta {self.min_frames}"
            )

        async with self._get_lock():
            # Otro pidió el mismo día mientras se esperaba el turno del candado.
            st = self.status(date_str)
            if _ya_esta(st):
                return st
            _generando.add(date_str)
            try:
                usados = await self._encode(date_str)
            finally:
                _generando.discard(date_str)
        logger.info("timelapse %s: %d fotogramas", date_str, usados)
        return self.status(date_str)

    async def _encode(self, date_str: str) -> int:
        frames = self.frames(date_str)
        if len(frames) < self.min_frames:
            raise TimelapseError(f"{date_str}: se quedó sin fotogramas suficientes")

        os.makedirs(self.out_dir, exist_ok=True)
        salida = self.video_path(date_str)
        tmp_video = salida + ".tmp.mp4"
        lista = os.path.join(self.out_dir, f".{date_str}.list")

        # Demuxer `concat` con una duración explícita por fotograma. Es lo que permite
        # nombres irregulares (`HHMMSS.jpg` con huecos donde falló la captura) sin
        # depender de que ffmpeg venga con soporte de glob, y fija la velocidad exacta.
        # El último archivo se repite sin `duration` porque, según la documentación del
        # demuxer, si no la duración del último fotograma se ignora y el vídeo se corta.
        dur = 1.0 / self.fps
        try:
            with open(lista, "w", encoding="utf-8") as f:
                for ruta in frames:
                    f.write(f"file '{ruta}'\nduration {dur:.6f}\n")
                f.write(f"file '{frames[-1]}'\n")

            cmd = [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", lista,
                # `-2` mantiene la proporción y fuerza altura par, que h264 exige.
                "-vf", f"scale={self.width}:-2",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", str(self.crf),
                # yuv420p o Safari y buena parte de los móviles no lo reproducen.
                "-pix_fmt", "yuv420p",
                # faststart mueve el índice al principio: el vídeo empieza a verse sin
                # haberse descargado entero.
                "-movflags", "+faststart",
                "-r", str(self.fps),
                tmp_video,
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                raise TimelapseError(
                    f"ffmpeg falló ({proc.returncode}): {err.decode(errors='replace').strip()[:400]}"
                )
            if not os.path.exists(tmp_video) or os.path.getsize(tmp_video) == 0:
                raise TimelapseError("ffmpeg terminó bien pero no dejó vídeo")

            # Rename atómico: si se escribiera directamente sobre el mp4, una petición
            # a mitad del encode serviría un vídeo truncado.
            os.replace(tmp_video, salida)
            meta = {
                "date": date_str,
                "frames": len(frames),
                "fps": self.fps,
                "width": self.width,
                "generated_at": datetime.now().astimezone().isoformat(),
            }
            tmp_meta = self.meta_path(date_str) + ".tmp"
            with open(tmp_meta, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False)
            os.replace(tmp_meta, self.meta_path(date_str))
            return len(frames)
        except FileNotFoundError as e:
            # ffmpeg ausente de la imagen. Se distingue del resto porque no es un fallo
            # del encode sino de despliegue, y el mensaje tiene que decirlo.
            raise TimelapseError(f"ffmpeg no está instalado en el contenedor: {e}")
        finally:
            for f in (lista, tmp_video):
                try:
                    os.remove(f)
                except OSError:
                    pass

    def prune(self) -> int:
        """Borra los vídeos más viejos que la retención. Devuelve cuántos quitó."""
        if self.retention_days <= 0:
            return 0
        limite = (datetime.now().astimezone() - timedelta(days=self.retention_days)).date()
        quitados = 0
        try:
            for nombre in os.listdir(self.out_dir):
                base, ext = os.path.splitext(nombre)
                if ext not in (".mp4", ".json"):
                    continue
                try:
                    dia = datetime.strptime(base, "%Y-%m-%d").date()
                except ValueError:
                    continue
                if dia < limite:
                    try:
                        os.remove(os.path.join(self.out_dir, nombre))
                        quitados += 1
                    except OSError:
                        pass
        except OSError:
            return quitados
        if quitados:
            logger.info("timelapse: purgados %d archivo(s)", quitados)
        return quitados

    def disk_bytes(self) -> int:
        """Cuánto ocupan los vídeos guardados (para el panel)."""
        total = 0
        try:
            for nombre in os.listdir(self.out_dir):
                if nombre.endswith(".mp4"):
                    try:
                        total += os.path.getsize(os.path.join(self.out_dir, nombre))
                    except OSError:
                        pass
        except OSError:
            pass
        return total

    @staticmethod
    def ffmpeg_available() -> bool:
        """¿Hay ffmpeg? Lo usa /api/camera/diag para que el fallo se vea en el panel."""
        return shutil.which("ffmpeg") is not None
