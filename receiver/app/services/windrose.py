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


def compute_wind_rose(records: List[Dict[str, Any]], calm_threshold: float = 1.0) -> Dict[str, Any]:
    """
    records: lista con al menos wind_direction (grados) y wind_speed (km/h).
    calm_threshold: por debajo de esta velocidad la lectura cuenta como calma.
    """
    bins = [{"count": 0, "speed_sum": 0.0, "max": 0.0} for _ in range(16)]
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
        })

    dominant = None
    if total - calm > 0:
        top = max(sectors, key=lambda x: x["count"])
        if top["count"] > 0:
            dominant = top["label"]

    return {
        "sectors": sectors,
        "calm_pct": round(100.0 * calm / total, 1) if total else 0.0,
        "total": total,
        "dominant": dominant,
    }
