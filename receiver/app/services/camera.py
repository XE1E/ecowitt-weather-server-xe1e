"""
Cámara del exterior: recepción, servido y retención de las fotos.

La cámara (Tapo C325WB) queda en casa **detrás del NAT** y el servidor corre en el
VPS, así que el VPS no puede ir a buscarla: algo en casa saca un JPEG del RTSP cada
pocos minutos y lo EMPUJA aquí. Este módulo sólo ve el resultado de ese empujón.

Decisión de fondo (docs/archivo/PLAN-CAMARA-EXTERIOR.md): **fotos periódicas, no
directo 24/7**. Un directo serían ~1 TB/mes de subida desde casa y un proceso de vídeo
corriendo para siempre; para un sitio de clima, la foto cada pocos minutos y el
timelapse dan más y cuestan casi nada.

Qué se guarda:
    <camera_dir>/latest.jpg              la última, servida tal cual
    <camera_dir>/latest.json             su metadato (cuándo se capturó, tamaño)
    <camera_dir>/YYYY-MM-DD/HHMMSS.jpg   fotogramas del día, para el timelapse
    <camera_dir>/analysis/YYYY-MM-DD.json  el análisis del cielo de ese día
    <camera_dir>/timelapse/YYYY-MM-DD.mp4  su vídeo (lo escribe services/timelapse.py)

El histórico de FOTOS se poda por DÍAS COMPLETOS y no por número de fotos: si un día la
cadencia falla y sólo llegan diez capturas, borrar "las más viejas" se comería días
enteros de historia buena a cambio de nada.

El análisis del cielo vive FUERA de la carpeta del día, igual que el vídeo. Antes se
guardaba dentro (`<camera_dir>/YYYY-MM-DD/analysis.json`) y por tanto **moría con los
fotogramas a los 7 días**: la curva de cómo se nubló un día --que es el registro más
interesante y el más barato, unos 6 KB frente a los 25 MB de sus fotos-- desaparecía a la
semana. Al sacarlo tiene retención propia, por omisión ninguna: se guarda para siempre.
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
    def __init__(self, base_dir: str, retention_days: int = 7, stale_seconds: int = 1200,
                 analysis_retention_days: int = 0):
        self.base = base_dir
        self.retention_days = max(0, retention_days)
        self.stale_seconds = stale_seconds
        # Retención propia del histórico de análisis, independiente de la de las fotos.
        # 0 = no purgar nunca, que es el default: son ~6 KB al día.
        self.analysis_retention_days = max(0, analysis_retention_days)

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

    @property
    def analysis_history(self) -> str:
        return os.path.join(self.base, "analysis_history.json")

    @property
    def analysis_dir(self) -> str:
        """Carpeta del histórico diario de análisis, hermana de `timelapse/`.

        El nombre NO parsea como fecha, así que `_prune` --que borra carpetas de día
        vencidas-- la ignora sola. Es lo mismo que protege a los vídeos.
        """
        return os.path.join(self.base, "analysis")

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
        if self.analysis_retention_days > 0:
            self.prune_analysis(self.analysis_retention_days)
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
                # Sólo los .jpg: en esa carpeta vive también `analysis.json` (el
                # histórico de análisis del día), que contaba como un fotograma más.
                try:
                    n = sum(1 for x in os.listdir(ruta) if x.lower().endswith(".jpg"))
                except OSError:
                    n = 0
                out.append({"date": nombre, "frames": n})
        except OSError:
            pass
        return out

    # ── análisis del cielo ───────────────────────────────────────────────────

    # Cuántos análisis guardar para calcular tendencias (~1 hora con cadencia 5 min)
    HISTORY_SIZE = 12

    def save_analysis(self, analysis: Dict[str, Any], validation: Optional[Dict[str, Any]] = None) -> None:
        """Guarda el análisis del cielo de la última captura y lo agrega al historial.

        `validation` es el resultado de `sky_validation.validate_analysis()` contra el
        pronóstico de ESTE momento, si se pudo calcular. Se calcula una sola vez aquí
        --no en el endpoint `/api/camera/analysis/validation`, que sólo corre cuando
        alguien tiene el dashboard abierto y no garantiza una muestra por captura--
        para que el histórico diario tenga una serie confiable de aciertos/desacuerdos.
        """
        os.makedirs(self.base, exist_ok=True)
        tmp = self.latest_analysis + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.latest_analysis)
        self._append_to_history(analysis)
        self._append_to_daily(analysis, validation)

    def _load_history(self) -> list:
        """Carga el historial de análisis."""
        try:
            with open(self.analysis_history, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return []

    def _save_history(self, history: list) -> None:
        """Guarda el historial de análisis."""
        tmp = self.analysis_history + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False)
        os.replace(tmp, self.analysis_history)

    def _append_to_history(self, analysis: Dict[str, Any]) -> None:
        """Agrega un análisis al historial, manteniendo solo los últimos N."""
        if analysis.get("error"):
            return
        history = self._load_history()
        entry = {
            "ts": analysis.get("analyzed_at", datetime.now(timezone.utc).isoformat()),
            "coverage": analysis.get("cloud_coverage_pct", 0),
            "condition": analysis.get("sky_condition", "unknown"),
            "development": analysis.get("development", "unknown"),
            "precip": analysis.get("precipitation_visible", False),
        }
        history.append(entry)
        if len(history) > self.HISTORY_SIZE:
            history = history[-self.HISTORY_SIZE:]
        self._save_history(history)

    def get_trend(self) -> Optional[Dict[str, Any]]:
        """
        Calcula tendencia del cielo basada en análisis recientes.

        Retorna None si no hay suficiente historial (mínimo 3 análisis).
        """
        history = self._load_history()
        if len(history) < 3:
            return None

        # Comparar primera y última mitad del historial
        mid = len(history) // 2
        old_half = history[:mid]
        new_half = history[mid:]

        old_cov = sum(h["coverage"] for h in old_half) / len(old_half)
        new_cov = sum(h["coverage"] for h in new_half) / len(new_half)
        cov_delta = new_cov - old_cov

        # Tendencia de cobertura: cambio de >10% es significativo
        if cov_delta > 10:
            cov_trend = "increasing"
        elif cov_delta < -10:
            cov_trend = "decreasing"
        else:
            cov_trend = "stable"

        # Tendencia de desarrollo (building -> stable -> dissipating)
        dev_order = {"building": 2, "stable": 1, "dissipating": 0, "unknown": 1}
        old_dev = sum(dev_order.get(h["development"], 1) for h in old_half) / len(old_half)
        new_dev = sum(dev_order.get(h["development"], 1) for h in new_half) / len(new_half)
        dev_delta = new_dev - old_dev

        if dev_delta > 0.5:
            dev_trend = "intensifying"
        elif dev_delta < -0.5:
            dev_trend = "weakening"
        else:
            dev_trend = "stable"

        # Detectar si apareció precipitación
        old_precip = any(h["precip"] for h in old_half)
        new_precip = any(h["precip"] for h in new_half)
        precip_appearing = new_precip and not old_precip

        # Generar resumen textual: frase completa, sin íconos/flechas que haya
        # que descifrar -- ver docs/archivo/PLAN-ANALISIS-CIELO-PRONOSTICO.md.
        cov_delta_abs = abs(round(cov_delta))
        if precip_appearing:
            summary = "Puede haber empezado a llover: apareció precipitación en las fotos recientes"
        elif cov_trend == "increasing" and dev_trend == "intensifying":
            summary = "Nublándose y las nubes se ven más activas: posible tormenta"
        elif cov_trend == "increasing":
            summary = f"Nublándose: la cobertura de nubes subió {cov_delta_abs}%"
        elif cov_trend == "decreasing":
            summary = f"Despejando: la cobertura de nubes bajó {cov_delta_abs}%"
        else:
            summary = "Sin cambios notables en el cielo"

        return {
            "coverage_trend": cov_trend,
            "coverage_delta": round(cov_delta, 1),
            "development_trend": dev_trend,
            "precip_appearing": precip_appearing,
            "summary": summary,
            "samples": len(history),
            "span_minutes": self._history_span_minutes(history),
        }

    def _history_span_minutes(self, history: list) -> int:
        """Calcula cuántos minutos cubre el historial."""
        if len(history) < 2:
            return 0
        try:
            first = datetime.fromisoformat(history[0]["ts"].replace("Z", "+00:00"))
            last = datetime.fromisoformat(history[-1]["ts"].replace("Z", "+00:00"))
            return int((last - first).total_seconds() / 60)
        except (KeyError, ValueError):
            return 0

    # ── histórico diario de análisis ─────────────────────────────────────────

    def _daily_analysis_path(self, date_str: str) -> str:
        """Ruta al análisis de un día. `date_str` llega de la URL en `get_daily_analysis`,
        así que se valida: sin esto un `../..` saldría de la carpeta."""
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except (ValueError, TypeError):
            raise ValueError(f"fecha inválida: {date_str!r}")
        return os.path.join(self.analysis_dir, f"{date_str}.json")

    def _daily_analysis_path_legacy(self, date_str: str) -> str:
        """Dónde vivía antes: dentro de la carpeta del día. Sólo lo usa la migración."""
        return os.path.join(self.base, date_str, "analysis.json")

    def _append_to_daily(self, analysis: Dict[str, Any], validation: Optional[Dict[str, Any]] = None) -> None:
        """Agrega un análisis (y su validación contra el pronóstico, si la hay) al
        archivo diario correspondiente."""
        if analysis.get("error"):
            return
        ts_str = analysis.get("analyzed_at", "")
        if not ts_str:
            return
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            date_str = ts.astimezone().strftime("%Y-%m-%d")
        except ValueError:
            return

        try:
            daily = self.get_daily_analysis(date_str) or []
        except ValueError:
            return

        # Agregar entrada compacta
        entry = {
            "ts": ts_str,
            "coverage": analysis.get("cloud_coverage_pct", 0),
            "condition": analysis.get("sky_condition", "unknown"),
            "cloud_type": analysis.get("cloud_type", "unknown"),
            "visibility": analysis.get("visibility", "unknown"),
            "development": analysis.get("development", "unknown"),
            "precip": analysis.get("precipitation_visible", False),
        }
        # Campos opcionales: sin pronóstico disponible en ese momento, `validation`
        # llega en None y la entrada se queda sin ellos (no rompe lecturas viejas).
        if validation and validation.get("validated"):
            entry["match"] = validation.get("match")
            entry["forecast_condition"] = validation.get("forecast_condition")
            forecast_coverage = (validation.get("details") or {}).get("forecast_coverage")
            if forecast_coverage is not None:
                entry["forecast_coverage_pct"] = forecast_coverage
        daily.append(entry)
        self._write_daily_analysis(date_str, daily)

    def _write_daily_analysis(self, date_str: str, entradas: list) -> None:
        """Vuelca el histórico de un día. Atómico, como el resto de escrituras de aquí."""
        path = self._daily_analysis_path(date_str)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(entradas, f, ensure_ascii=False)
        os.replace(tmp, path)

    def get_daily_analysis(self, date_str: str) -> Optional[list]:
        """Histórico de análisis de un día (YYYY-MM-DD), o None si no hay."""
        try:
            path = self._daily_analysis_path(date_str)
        except ValueError:
            return None
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def get_analysis_days(self) -> list:
        """Lista los días que tienen análisis guardados, del más reciente al más antiguo."""
        out = []
        try:
            for nombre in sorted(os.listdir(self.analysis_dir), reverse=True):
                base, ext = os.path.splitext(nombre)
                if ext != ".json":
                    continue
                try:
                    datetime.strptime(base, "%Y-%m-%d")
                except ValueError:
                    continue
                try:
                    with open(os.path.join(self.analysis_dir, nombre), encoding="utf-8") as f:
                        data = json.load(f)
                    out.append({"date": base, "count": len(data)})
                except (OSError, ValueError):
                    pass
        except OSError:
            pass
        return out

    def get_accuracy_stats(self, days: int = 30) -> Dict[str, Any]:
        """Qué tan seguido coincide la cámara con el pronóstico, en los últimos N días.

        Cuenta las entradas diarias que sí trajeron `match` (o sea, las que se
        pudieron validar contra un pronóstico en el momento de la captura -- ver
        `_append_to_daily`). Sin datos antiguos con esa marca, el promedio simplemente
        arranca desde que se activó esta persistencia: no hay migración retroactiva.
        """
        limite = (datetime.now().astimezone() - timedelta(days=max(0, days) - 1)).date()
        conteo = {"exact": 0, "close": 0, "differ": 0, "conflict": 0}
        dias_con_datos = 0
        try:
            nombres = sorted(os.listdir(self.analysis_dir))
        except OSError:
            nombres = []
        for nombre in nombres:
            base, ext = os.path.splitext(nombre)
            if ext != ".json":
                continue
            try:
                dia = datetime.strptime(base, "%Y-%m-%d").date()
            except ValueError:
                continue
            if dia < limite:
                continue
            entradas = self.get_daily_analysis(base) or []
            tuvo_match = False
            for e in entradas:
                m = e.get("match")
                if m in conteo:
                    conteo[m] += 1
                    tuvo_match = True
            if tuvo_match:
                dias_con_datos += 1

        total = sum(conteo.values())
        return {
            "days_requested": days,
            "days_with_data": dias_con_datos,
            "total": total,
            "counts": conteo,
            "pct": {
                k: round(v * 100 / total, 1) if total else 0
                for k, v in conteo.items()
            },
        }

    # Mayor a menor: cómo se ordena la visibilidad reportada por el análisis de IA
    # (ver sky_analyzer.py). "unknown" o cualquier valor no reconocido queda al final.
    _VISIBILITY_RANK = {"excellent": 4, "good": 3, "moderate": 2, "poor": 1, "very_poor": 0}

    def best_of_day(self, date_str: str) -> Optional[Dict[str, Any]]:
        """La entrada con mejor visibilidad reportada ese día (excluye la noche,
        salvo que el día entero haya sido de noche).

        "Mejor" no es un juicio estético -- eso pediría otra pasada de IA sólo para
        esto, y sin fotos reales para probar el criterio no vale la pena arriesgar
        el esquema del análisis. Es la métrica más honesta que ya se guarda para
        "se ve bien y se ve lejos". A empate, gana la primera del día.
        """
        entradas = self.get_daily_analysis(date_str) or []
        if not entradas:
            return None
        candidatas = [e for e in entradas if e.get("condition") != "night"] or entradas
        return max(candidatas, key=lambda e: self._VISIBILITY_RANK.get(e.get("visibility"), -1))

    def frame_path(self, date_str: str, ts_str: str) -> Optional[str]:
        """Ruta al fotograma archivado (ver `_archive`) que corresponde a un `ts` ISO
        dentro del día `date_str`, o None si el `ts` no se pudo interpretar."""
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            return None
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).astimezone()
        except ValueError:
            return None
        return os.path.join(self.base, date_str, ts.strftime("%H%M%S") + ".jpg")

    # ── migración y retención del histórico de análisis ──────────────────────

    def migrate_daily_analysis(self) -> int:
        """
        Sube los `analysis.json` que quedaron dentro de las carpetas de día.

        Se ejecuta al arrancar y es IDEMPOTENTE: lo ya migrado no está en el origen.
        Corre contrarreloj con la poda de fotogramas --lo que no se migre antes de que
        el día venza se pierde con la carpeta--, así que conviene que vaya en el
        arranque y no bajo demanda. Devuelve cuántos días movió.
        """
        movidos = 0
        try:
            nombres = sorted(os.listdir(self.base))
        except OSError:
            return 0
        for nombre in nombres:
            try:
                datetime.strptime(nombre, "%Y-%m-%d")
            except ValueError:
                continue
            viejo = self._daily_analysis_path_legacy(nombre)
            if not os.path.exists(viejo):
                continue
            try:
                with open(viejo, encoding="utf-8") as f:
                    entradas = json.load(f)
                if not isinstance(entradas, list):
                    continue
                # Si ya hubiera destino, se FUNDEN por marca de tiempo en vez de
                # sobrescribir: perder análisis en una migración sería el peor final
                # posible para el dato que se está intentando salvar.
                previas = self.get_daily_analysis(nombre) or []
                vistas = {e.get("ts") for e in previas}
                fundidas = previas + [e for e in entradas if e.get("ts") not in vistas]
                fundidas.sort(key=lambda e: e.get("ts") or "")
                self._write_daily_analysis(nombre, fundidas)
                os.remove(viejo)
                movidos += 1
            except (OSError, ValueError) as e:
                logger.warning("no se pudo migrar el análisis de %s: %s", nombre, e)
        if movidos:
            logger.info("análisis del cielo: %d día(s) movidos a %s", movidos, self.analysis_dir)
        return movidos

    def prune_analysis(self, retention_days: int) -> int:
        """Borra los análisis más viejos que la retención. 0 = no purgar nunca."""
        if retention_days <= 0:
            return 0
        limite = (datetime.now().astimezone() - timedelta(days=retention_days)).date()
        quitados = 0
        try:
            for nombre in os.listdir(self.analysis_dir):
                base, ext = os.path.splitext(nombre)
                if ext != ".json":
                    continue
                try:
                    dia = datetime.strptime(base, "%Y-%m-%d").date()
                except ValueError:
                    continue
                if dia < limite:
                    try:
                        os.remove(os.path.join(self.analysis_dir, nombre))
                        quitados += 1
                    except OSError:
                        pass
        except OSError:
            pass
        return quitados

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
