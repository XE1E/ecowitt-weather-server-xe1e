"""Rumbo en puntos cardinales a partir de grados.

Antes cada servicio tenía su tabla y su redondeo. Los alfabetos distintos son a
propósito: WeatherAPI (y los rumbos de las estaciones vecinas) usan inglés; lo que
se muestra en el sitio o sobre la foto usa español, igual que weather.ts::cardinal().
"""
from typing import Optional, Sequence

EN8 = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
ES8 = ("N", "NE", "E", "SE", "S", "SO", "O", "NO")
EN16 = ("N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW")


def point(deg: Optional[float], table: Sequence[str] = EN8) -> Optional[str]:
    """Punto de `table` más cercano a `deg` (0 = norte, sentido horario); None si no hay grados."""
    if deg is None:
        return None
    n = len(table)
    return table[round((deg % 360) / (360 / n)) % n]
