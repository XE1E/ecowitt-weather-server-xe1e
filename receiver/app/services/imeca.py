"""
IMECA estimado (Índice Metropolitano de la Calidad del Aire).

Calcula el índice con las tablas oficiales de puntos de corte de la norma
NADF-009-AIRE-2017 (Ciudad de México) a partir de concentraciones de
contaminantes obtenidas de Open-Meteo Air Quality (modelo CAMS).

Importante: es un valor ESTIMADO a partir de concentraciones modeladas, no la
lectura oficial medida por las estaciones del SIMAT/SEDEMA. Se etiqueta como tal.

Puntos de corte (Cinf, Csup, Iinf, Isup) por contaminante, en las unidades de la
norma: ppm para O3/NO2/SO2/CO y µg/m³ para PM10/PM2.5. Índice = interpolación
lineal por tramos entre esos puntos.
"""
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {}
_TTL = 1800  # 30 min

BP = Tuple[float, float, float, float]  # (Cinf, Csup, Iinf, Isup)

TABLE_O3: List[BP] = [
    (0.000, 0.070, 0, 50), (0.071, 0.095, 51, 100), (0.096, 0.154, 101, 150),
    (0.155, 0.204, 151, 200), (0.205, 0.404, 201, 300), (0.405, 0.604, 301, 500),
]
TABLE_NO2: List[BP] = [
    (0.000, 0.105, 0, 50), (0.106, 0.210, 51, 100), (0.211, 0.430, 101, 150),
    (0.431, 0.649, 151, 200), (0.650, 1.249, 201, 300), (1.250, 2.049, 301, 500),
]
TABLE_SO2: List[BP] = [
    (0.000, 0.025, 0, 50), (0.026, 0.110, 51, 100), (0.111, 0.207, 101, 150),
    (0.208, 0.304, 151, 200), (0.305, 0.604, 201, 300), (0.605, 1.004, 301, 500),
]
TABLE_CO: List[BP] = [
    (0.0, 5.5, 0, 50), (5.6, 11.0, 51, 100), (11.1, 13.0, 101, 150),
    (13.1, 15.4, 151, 200), (15.5, 30.4, 201, 300), (30.5, 50.4, 301, 500),
]
TABLE_PM10: List[BP] = [
    (0, 40, 0, 50), (41, 75, 51, 100), (76, 214, 101, 150),
    (215, 354, 151, 200), (355, 424, 201, 300), (425, 604, 301, 500),
]
TABLE_PM25: List[BP] = [
    (0.0, 12.0, 0, 50), (12.1, 45.0, 51, 100), (45.1, 97.4, 101, 150),
    (97.5, 150.4, 151, 200), (150.5, 250.4, 201, 300), (250.5, 500.4, 301, 500),
]

# (etiqueta, clave Open-Meteo, peso molecular g/mol o None si ya es µg/m³, tabla)
POLLUTANTS: List[Tuple[str, str, Optional[float], List[BP]]] = [
    ("O₃", "ozone", 48.00, TABLE_O3),
    ("PM10", "pm10", None, TABLE_PM10),
    ("PM2.5", "pm2_5", None, TABLE_PM25),
    ("NO₂", "nitrogen_dioxide", 46.01, TABLE_NO2),
    ("SO₂", "sulphur_dioxide", 64.07, TABLE_SO2),
    ("CO", "carbon_monoxide", 28.01, TABLE_CO),
]

RECS = {
    "Buena": "Disfruta las actividades al aire libre.",
    "Regular": "Puedes realizar actividades al aire libre. Las personas muy sensibles pueden considerar reducir el esfuerzo prolongado.",
    "Mala": "Grupos sensibles (niñez, adultos mayores y personas con enfermedades respiratorias o del corazón): reduzcan la actividad física al aire libre. La población general puede continuar con sus actividades.",
    "Muy mala": "Grupos sensibles: eviten salir y el esfuerzo físico al aire libre. Población general: reduzca las actividades al aire libre.",
    "Extremadamente mala": "Toda la población: permanece en interiores con ventanas cerradas y evita el esfuerzo físico al aire libre.",
}


def _ugm3_to_ppm(v: float, mw: float) -> float:
    """µg/m³ → ppm a 25 °C y 1 atm (volumen molar 24.45 L/mol)."""
    return v * 24.45 / (mw * 1000.0)


def _sub_index(conc: Optional[float], table: List[BP]) -> Optional[int]:
    if conc is None:
        return None
    if conc <= 0:
        return 0
    for clo, chi, ilo, ihi in table:
        if conc <= chi:
            return round((ihi - ilo) / (chi - clo) * (conc - clo) + ilo)
    clo, chi, ilo, ihi = table[-1]
    return min(500, round((ihi - ilo) / (chi - clo) * (conc - clo) + ilo))


def category(idx: int) -> Tuple[str, str]:
    if idx <= 50:
        return "Buena", "#22c55e"
    if idx <= 100:
        return "Regular", "#eab308"
    if idx <= 150:
        return "Mala", "#f97316"
    if idx <= 200:
        return "Muy mala", "#ef4444"
    return "Extremadamente mala", "#a21caf"


def compute_imeca(conc_ugm3: Dict[str, Optional[float]]) -> Dict[str, Any]:
    """Recibe concentraciones en µg/m³ (claves Open-Meteo) y devuelve el IMECA."""
    subs = []
    for label, key, mw, table in POLLUTANTS:
        c = conc_ugm3.get(key)
        if c is None:
            continue
        native = c if mw is None else _ugm3_to_ppm(c, mw)
        idx = _sub_index(native, table)
        if idx is not None:
            subs.append({"pollutant": label, "conc": round(c, 1), "index": idx})
    if not subs:
        return {"available": False}
    subs.sort(key=lambda s: s["index"], reverse=True)
    top = subs[0]
    cat, color = category(top["index"])
    return {
        "available": True,
        "imeca": top["index"],
        "dominant": top["pollutant"],
        "category": cat,
        "color": color,
        "recommendation": RECS.get(cat, ""),
        "pollutants": subs,
    }


async def get_imeca(lat: float, lon: float) -> Dict[str, Any]:
    key = f"{lat:.3f},{lon:.3f}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return cached["data"]

    vars_ = "ozone,pm10,pm2_5,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide"
    url = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={lat}&longitude={lon}&current={vars_}&hourly={vars_}"
        "&timezone=auto&forecast_days=2"
    )
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            j = resp.json()
    except Exception as e:
        logger.error(f"Open-Meteo AQ fetch failed: {e}")
        return cached["data"] if cached else {"available": False, "error": "fetch_failed"}

    cur = j.get("current", {})
    data = compute_imeca(cur)
    if data.get("available"):
        data["time"] = cur.get("time")
        data["source"] = "Open-Meteo (modelo CAMS)"

    # Pronóstico por horas (IMECA calculado hora por hora, próximas ~24 h)
    hourly = j.get("hourly", {})
    times = hourly.get("time", []) or []
    forecast = []
    now_iso = cur.get("time", "")
    started = False
    for i, t in enumerate(times):
        if not started:
            if t < now_iso:
                continue
            started = True
        row = {k: (hourly.get(k, [None] * len(times))[i]) for _, k, _, _ in POLLUTANTS}
        r = compute_imeca(row)
        if r.get("available"):
            forecast.append({"t": t, "imeca": r["imeca"], "category": r["category"]})
        if len(forecast) >= 24:
            break
    data["forecast"] = forecast

    _CACHE[key] = {"ts": now, "data": data}
    return data
