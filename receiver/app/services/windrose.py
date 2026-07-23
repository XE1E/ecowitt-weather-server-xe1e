"""
Rosa de vientos: distribución de la dirección y velocidad del viento en un
periodo, calculada desde el histórico crudo (dirección + velocidad por lectura).

Reparte las lecturas en 16 sectores (N, NNE, NE, …) y, por sector, calcula
frecuencia (%), velocidad media y máxima. Las lecturas por debajo de un umbral
se cuentan como "calma".
"""
from typing import Any, Dict, List

DIRS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
          "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"]

# Bordes inferiores (km/h) de las 5 bandas de velocidad. La banda i cubre
# [SPEED_EDGES[i], SPEED_EDGES[i+1]); la última es abierta (40+). Por debajo del
# primer borde (= calm_threshold) la lectura cuenta como CALMA.
SPEED_EDGES = [1.0, 5.0, 15.0, 25.0, 40.0]
NBANDS = len(SPEED_EDGES)  # 5


def _band_index(s: float) -> int:
    """Índice de banda [0..NBANDS-1] para una velocidad ya >= calm_threshold."""
    for i in range(NBANDS - 1, 0, -1):
        if s >= SPEED_EDGES[i]:
            return i
    return 0


def compute_wind_rose(records: List[Dict[str, Any]], calm_threshold: float = 1.0) -> Dict[str, Any]:
    """
    records: lista con al menos wind_direction (grados) y wind_speed (km/h).
    calm_threshold: por debajo de esta velocidad la lectura cuenta como calma.

    Devuelve, por cada uno de los 16 sectores, la frecuencia total y el desglose
    por banda de velocidad (para dibujar una rosa apilada). Los porcentajes están
    sobre el total de lecturas (calma incluida), de modo que la suma de las bandas
    de un sector = su porcentaje total.
    """
    bins = [{"count": 0, "speed_sum": 0.0, "max": 0.0,
             "bands": [0] * NBANDS} for _ in range(16)]
    calm = 0
    total = 0

    for r in records:
        d = r.get("wind_direction")
        s = r.get("wind_speed")
        if d is None or s is None:
            continue
        total += 1
        if s < calm_threshold:
            calm += 1
            continue
        idx = int(((d % 360) + 11.25) % 360 / 22.5)
        b = bins[idx]
        b["count"] += 1
        b["speed_sum"] += s
        b["bands"][_band_index(s)] += 1
        if s > b["max"]:
            b["max"] = s

    sectors = []
    for i, b in enumerate(bins):
        sectors.append({
            "dir": round(i * 22.5, 1),
            "label": DIRS16[i],
            "count": b["count"],
            "pct": round(100.0 * b["count"] / total, 1) if total else 0.0,
            "avg_speed": round(b["speed_sum"] / b["count"], 1) if b["count"] else 0.0,
            "max_speed": round(b["max"], 1),
            # % del total por banda (suman ≈ pct del sector).
            "bands": [round(100.0 * c / total, 2) if total else 0.0 for c in b["bands"]],
        })

    dominant = None
    if total - calm > 0:
        top = max(sectors, key=lambda x: x["count"])
        if top["count"] > 0:
            dominant = top["label"]

    return {
        "sectors": sectors,
        "band_edges": SPEED_EDGES,   # bordes inferiores (km/h); última banda abierta
        "calm_pct": round(100.0 * calm / total, 1) if total else 0.0,
        "total": total,
        "dominant": dominant,
    }
