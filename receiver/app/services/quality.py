"""
Control de calidad de datos (idea tomada de StdQC de WeeWX).

Descarta valores físicamente imposibles antes de guardarlos, para que un dato
basura (interferencia, sensor sin batería, glitch de firmware) no ensucie las
gráficas ni dispare alertas falsas. Los valores fuera de rango se ponen a None
(se omiten) y se registra un aviso; el resto del dato se conserva.

Los límites están en unidades métricas. Ojo con la presión en la CDMX (~2240 m):
la presión RELATIVA viene ya reducida a nivel del mar (~1013 hPa), mientras que
la ABSOLUTA local es mucho menor (~770 hPa).
"""
from typing import Any, Dict, Tuple
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
    "uv": (0.0, 20.0),
    "solar_radiation": (0.0, 1500.0),
}


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
