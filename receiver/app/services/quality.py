"""
Control de calidad de datos (idea tomada de StdQC de WeeWX).

Descarta valores físicamente imposibles antes de guardarlos, para que un dato
basura (interferencia, sensor sin batería, glitch de firmware) no ensucie las
gráficas ni dispare alertas falsas. Los valores fuera de rango se ponen a None
(se omiten) y se registra un aviso; el resto del dato se conserva.

`stats_check` es una capa más suave: no descarta nada, solo SEÑALA un valor
estadísticamente raro contra el historial de la propia estación (z-score).

Los límites están en unidades métricas. Ojo con la presión en la CDMX (~2240 m):
la presión RELATIVA viene ya reducida a nivel del mar (~1013 hPa), mientras que
la ABSOLUTA local es mucho menor (~770 hPa).
"""
from typing import Any, Dict, Optional, Tuple
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# campo -> (min, max) permitido
BOUNDS: Dict[str, Tuple[float, float]] = {
    "temperature_outdoor": (-40.0, 60.0),
    "temperature_indoor": (-20.0, 70.0),
    "temperature_ch1": (-40.0, 60.0), "temperature_ch2": (-40.0, 60.0),
    "temperature_ch3": (-40.0, 60.0), "temperature_ch4": (-40.0, 60.0),
    "temperature_ch5": (-40.0, 60.0), "temperature_ch6": (-40.0, 60.0),
    "temperature_ch7": (-40.0, 60.0), "temperature_ch8": (-40.0, 60.0),
    "humidity_outdoor": (0.0, 100.0),
    "humidity_indoor": (0.0, 100.0),
    "pressure_relative": (900.0, 1100.0),
    "pressure_absolute": (650.0, 850.0),   # CDMX ~2240 m
    "wind_speed": (0.0, 250.0),
    "wind_gust": (0.0, 320.0),
    "wind_gust_max_daily": (0.0, 320.0),
    "wind_direction": (0.0, 360.0),
    "rain_rate": (0.0, 500.0),
    # OJO con el nombre: el campo es "uv_index" (así lo mapea parser.py). Con la
    # clave "uv" este límite NUNCA se aplicaba, porque no existe en el dato.
    "uv_index": (0.0, 20.0),
    "solar_radiation": (0.0, 1500.0),
}


# Salto máximo permitido entre dos lecturas CONSECUTIVAS (unidades métricas).
# Solo campos "suaves": el viento y la lluvia varían a saltos de forma legítima,
# así que NO se filtran por picos.
SPIKE_LIMITS: Dict[str, float] = {
    "temperature_outdoor": 8.0,
    "temperature_indoor": 8.0,
    "temperature_ch1": 8.0, "temperature_ch2": 8.0, "temperature_ch3": 8.0,
    "temperature_ch4": 8.0, "temperature_ch5": 8.0, "temperature_ch6": 8.0,
    "temperature_ch7": 8.0, "temperature_ch8": 8.0,
    "humidity_outdoor": 40.0,
    "humidity_indoor": 40.0,
    "pressure_relative": 6.0,
    "pressure_absolute": 6.0,
}

# Antigüedad máxima de la lectura previa para aplicar el filtro (segundos).
# Tras una interrupción larga, un cambio grande es legítimo y no debe filtrarse.
SPIKE_MAX_AGE_S = 15 * 60


def _age_seconds(previous: Dict[str, Any], now: datetime) -> Optional[float]:
    iso = previous.get("received_at") if previous else None
    if not iso:
        return None
    try:
        prev_t = datetime.fromisoformat(str(iso))
        return (now - prev_t).total_seconds()
    except (ValueError, TypeError):
        return None


def spike_check(
    data: Dict[str, Any],
    previous: Optional[Dict[str, Any]],
    settings,
    now: Optional[datetime] = None,
) -> Tuple[Dict[str, Any], list]:
    """
    Descarta un valor si SALTA de forma imposible respecto a la lectura anterior
    (glitch de sensor/interferencia). Devuelve (data_filtrada, rechazados).
    Se omite si: está desactivado, no hay lectura previa, o la previa es vieja
    (> SPIKE_MAX_AGE_S), en cuyo caso un cambio grande puede ser real.
    """
    if not getattr(settings, "qc_spike_enabled", True):
        return data, []
    if not previous:
        return data, []
    now = now or datetime.utcnow()
    age = _age_seconds(previous, now)
    if age is None or age > SPIKE_MAX_AGE_S:
        return data, []

    result = data.copy()
    rejected = []
    for field, limit in SPIKE_LIMITS.items():
        cur = result.get(field)
        prev = previous.get(field)
        if cur is None or prev is None:
            continue
        try:
            if abs(cur - prev) > limit:
                rejected.append((field, cur, prev))
                result[field] = None
        except TypeError:
            continue
    if rejected:
        logger.warning(
            "QC pico rechazó %d valor(es): %s",
            len(rejected), ", ".join(f"{k}={c} (prev {p})" for k, c, p in rejected)
        )
    return result, rejected


def stats_check(
    data: Dict[str, Any], station_stats: Optional[Dict[str, Dict[str, float]]], settings,
) -> Tuple[Dict[str, Any], list]:
    """
    QC estadístico: señala (sin descartar) un valor cuyo z-score contra la
    media/desviación histórica de ESA estación se sale del umbral.

    A diferencia de `quality_check`/`spike_check`, esto NO modifica `data` --
    un valor físicamente posible pero estadísticamente raro puede ser real
    (una ola de calor, un frente frío), así que no se pierde el dato: solo se
    reporta para que las alertas avisen si la desviación se SOSTIENE varias
    lecturas (ver AlertService.check_stats_outlier).

    `station_stats` viene de services/stats_cache.py (caché en memoria,
    refrescada en segundo plano) -- NUNCA se consulta InfluxDB aquí, este
    check corre en el camino caliente de /data/report.

    Devuelve (data SIN CAMBIOS, marcados) -- marcados es lista de
    (campo, valor, z_score).
    """
    if not getattr(settings, "qc_stats_enabled", False):
        return data, []
    threshold = float(getattr(settings, "qc_stats_z_threshold", 5.0))
    flagged = []
    for field, stat in (station_stats or {}).items():
        v = data.get(field)
        if v is None:
            continue
        mean, stddev = stat.get("mean"), stat.get("stddev")
        # stddev casi nulo (serie muy estable, p. ej. interior climatizado):
        # cualquier variación mínima dispararía un z-score enorme sin ser un
        # fallo real. Se omite el campo en vez de avisar en falso.
        if mean is None or not stddev or stddev < 0.05:
            continue
        try:
            z = abs(v - mean) / stddev
        except TypeError:
            continue
        if z >= threshold:
            flagged.append((field, v, round(z, 1)))
    if flagged:
        logger.warning(
            "QC estadístico: %d valor(es) dudoso(s) (z-score >= %.1f): %s",
            len(flagged), threshold,
            ", ".join(f"{k}={v} (z={z})" for k, v, z in flagged)
        )
    return data, flagged


def quality_check(data: Dict[str, Any], settings) -> Tuple[Dict[str, Any], list]:
    """
    Devuelve (data_filtrada, rechazados). `rechazados` es una lista de
    (campo, valor) para registro. Si el QC está desactivado, no toca nada.
    """
    if not getattr(settings, "qc_enabled", True):
        return data, []
    result = data.copy()
    rejected = []
    for field, (lo, hi) in BOUNDS.items():
        v = result.get(field)
        if v is None:
            continue
        try:
            if v < lo or v > hi:
                rejected.append((field, v))
                result[field] = None
        except TypeError:
            continue
    if rejected:
        logger.warning(
            "QC rechazó %d valor(es) fuera de rango: %s",
            len(rejected), ", ".join(f"{k}={v}" for k, v in rejected)
        )
    return result, rejected
