"""
Caché en memoria de medias/desviaciones estándar por campo y estación, para
el QC estadístico (ver quality.py::stats_check).

Se refresca en segundo plano (ver main.py::stats_refresh_task) y JAMÁS desde
el camino de ingesta: una consulta a InfluxDB con stddev()/mean() en cada
/data/report volvería a bloquear el endpoint que el punto A1 del plan de
optimización dejó rápido (ver docs/internal/PLAN-OPTIMIZACION-SERVIDOR.md).
El QC en caliente solo LEE este diccionario en memoria (get()).
"""
from typing import Dict, List, Optional
import logging

logger = logging.getLogger(__name__)

# Mismo conjunto de campos "suaves" que vigila el filtro de picos (quality.py
# SPIKE_LIMITS): temperatura/humedad/presión varían de forma continua, así
# que tiene sentido compararlas contra su propia media/desviación histórica.
# Viento y lluvia varían a saltos de forma legítima y no se vigilan aquí.
STATS_FIELDS: List[str] = [
    "temperature_outdoor", "temperature_indoor",
    "temperature_ch1", "temperature_ch2", "temperature_ch3", "temperature_ch4",
    "temperature_ch5", "temperature_ch6", "temperature_ch7", "temperature_ch8",
    "humidity_outdoor", "humidity_indoor",
    "pressure_relative", "pressure_absolute",
]

# {estación: {campo: {"mean": float, "stddev": float}}}. None = principal.
_cache: Dict[Optional[str], Dict[str, Dict[str, float]]] = {}


def get(station: Optional[str]) -> Dict[str, Dict[str, float]]:
    """Lectura rápida (sin I/O) para el QC en caliente. {} si aún no hay caché."""
    return _cache.get(station, {})


async def refresh(storage, stations: List[str], window: str = "-30d") -> None:
    """
    Recalcula medias/desviaciones para la principal (None) y cada estación
    secundaria en `stations`. Estaciones sin historia suficiente simplemente
    no aportan campos (get_field_stddev los omite), así que un despliegue
    nuevo no revienta -- stats_check tampoco marca nada hasta que haya caché.
    """
    for station in [None, *stations]:
        try:
            stats = await storage.get_field_stddev(STATS_FIELDS, window=window, station=station)
            if stats:
                _cache[station] = stats
        except Exception as e:
            logger.warning(
                "Refresco de stats QC falló para estación %s: %s",
                station or "principal", e
            )
