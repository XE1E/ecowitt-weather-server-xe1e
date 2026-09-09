"""
Índice de Calidad del Aire de la CDMX (lo que mucha gente sigue llamando
"IMECA" por costumbre) -- estimado.

La norma NADF-009-AIRE-2017 (Ciudad de México) ya NO llama "IMECA" a este
índice: ese nombre es el del índice ANTERIOR (1986-2018), que esta norma
deroga explícitamente en su transitorio SEGUNDO. El texto oficial (Gaceta
Oficial CDMX, 14-nov-2018) lo llama simplemente "Índice de Calidad del
Aire". Se conserva "IMECA" en la UI como término de búsqueda/costumbre,
pero el cálculo real y las tablas de puntos de corte son las de esta norma
vigente, a partir de concentraciones de contaminantes obtenidas de
Open-Meteo Air Quality (modelo CAMS).

Importante: es un valor ESTIMADO a partir de concentraciones modeladas, no la
lectura oficial medida por las estaciones del SIMAT/SEDEMA. Se etiqueta como tal.

Puntos de corte (Cinf, Csup, Iinf, Isup) por contaminante, en las unidades de la
norma: ppm para O3/NO2/SO2/CO y µg/m³ para PM10/PM2.5. Índice = interpolación
lineal por tramos entre esos puntos.

Promedios móviles (norma §6.2, verificada contra el texto oficial): O3 y NO2
usan la concentración de LA HORA; SO2 y las partículas (PM10/PM2.5) exigen el
promedio móvil de las últimas 24 h; CO, el de las últimas 8 h. Antes de este
fix se usaba en los cuatro casos el valor instantáneo de Open-Meteo (bug real:
un pico de una sola hora se reflejaba de inmediato, cuando la norma pide
suavizarlo). "Suficiencia de información" (§5): al menos 75% de horas válidas
en la ventana (6/8 para CO, 18/24 para SO2/PM10/PM2.5) o el contaminante se
omite ese ciclo, igual que si no hubiera dato.
"""
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {}
_TTL = 1800  # 30 min
# Cota del caché: la clave lleva lat/lon (y la presión redondeada), y el endpoint
# es público y sin rate-limit, así que sin límite el dict crece sin fin.
_MAX_ENTRIES = 32

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
    (215, 354, 151, 200), (355, 424, 201, 300),
    # El tramo "Peligrosa" (301-500) NO es una sola recta: la norma le da
    # pendientes (k) distintas a 425-504 (k=1.2532) y 505-604 (k=1.0000) --
    # colapsarlo en un solo tramo (como antes) da un índice ~6 puntos distinto
    # ahí. Solo importa en concentraciones extremas, pero es lo que dice el
    # Anexo C (Tabla C.5) de la norma.
    (425, 504, 301, 400), (505, 604, 401, 500),
]
TABLE_PM25: List[BP] = [
    (0.0, 12.0, 0, 50), (12.1, 45.0, 51, 100), (45.1, 97.4, 101, 150),
    (97.5, 150.4, 151, 200), (150.5, 250.4, 201, 300),
    # Mismo caso que PM10 (Anexo C, Tabla C.6): 250.5-350.4 (k=0.9910) y
    # 350.5-500.4 (k=0.6604) tienen pendientes distintas.
    (250.5, 350.4, 301, 400), (350.5, 500.4, 401, 500),
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

# Ventana de promediación por contaminante (norma §6.2, en HORAS). O3/NO2 no
# se promedian más allá de la propia hora; SO2/PM10/PM2.5 exigen 24h móvil;
# CO exige 8h móvil. Ver _moving_avg().
AVG_WINDOW_H: Dict[str, int] = {
    "ozone": 1, "nitrogen_dioxide": 1,
    "sulphur_dioxide": 24, "carbon_monoxide": 8,
    "pm10": 24, "pm2_5": 24,
}

RECS = {
    "Buena": "Disfruta las actividades al aire libre.",
    "Regular": "Puedes realizar actividades al aire libre. Las personas muy sensibles pueden considerar reducir el esfuerzo prolongado.",
    "Mala": "Grupos sensibles (niñez, adultos mayores y personas con enfermedades respiratorias o del corazón): reduzcan la actividad física al aire libre. La población general puede continuar con sus actividades.",
    "Muy mala": "Grupos sensibles: eviten salir y el esfuerzo físico al aire libre. Población general: reduzca las actividades al aire libre.",
    "Extremadamente mala": "Toda la población: permanece en interiores con ventanas cerradas y evita el esfuerzo físico al aire libre.",
}


def _moving_avg(values: List[Optional[float]], idx: int, window_h: int) -> Optional[float]:
    """
    Promedio móvil de `window_h` horas terminando en `idx` (inclusive), con la
    "suficiencia de información" que exige la norma (§5): al menos 75% de
    horas válidas en la ventana (6/8 para 8h, 18/24 para 24h). Sin eso
    suficiente, devuelve None -- el contaminante se omite ese ciclo en vez de
    reportar un promedio armado con muy pocos datos.
    """
    if idx < 0 or idx >= len(values):
        return None
    start = max(0, idx - window_h + 1)
    span = values[start:idx + 1]
    valid = [v for v in span if isinstance(v, (int, float))]
    if len(valid) < max(1, round(0.75 * window_h)):
        return None
    return sum(valid) / len(valid)


# Constante de los gases en L·hPa/(mol·K), para calcular el volumen molar a la
# presión REAL de la estación.
R_L_HPA = 83.14472
T_REF_C = 25.0        # temperatura de referencia de la norma
P_STD_HPA = 1013.25   # 1 atm, la presión a la que 24.45 L/mol sería correcto


def molar_volume(pressure_hpa: Optional[float] = None, temp_c: float = T_REF_C) -> float:
    """
    Volumen molar del gas ideal (L/mol) a la presión dada (hPa) y `temp_c`.

    Importa mucho en la CDMX: la norma expresa O3/NO2/SO2/CO en **ppm**, y las ppm
    son una fracción de VOLUMEN, así que convertir µg/m³ → ppm depende de la
    presión del sitio. A 1 atm el volumen molar es 24.45 L/mol, pero a los ~780 hPa
    de la CDMX es ~31.8 L/mol. Usar 24.45 aquí subestima las ppm ~28 %, y con ellas
    el índice: 150 µg/m³ de ozono daban IMECA 62 ("Regular") en vez de 103 ("Mala").

    Si no se conoce la presión se cae a 1 atm, que es lo correcto a nivel del mar.
    """
    p = pressure_hpa if (pressure_hpa and pressure_hpa > 0) else P_STD_HPA
    return R_L_HPA * (273.15 + temp_c) / p


def _ugm3_to_ppm(v: float, mw: float, vm: float) -> float:
    """µg/m³ → ppm con el volumen molar `vm` (L/mol) del sitio."""
    return v * vm / (mw * 1000.0)


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


def compute_imeca(conc_ugm3: Dict[str, Optional[float]],
                  pressure_hpa: Optional[float] = None) -> Dict[str, Any]:
    """
    Recibe concentraciones en µg/m³ (claves Open-Meteo) y devuelve el IMECA.

    `pressure_hpa`: presión ABSOLUTA del sitio, para convertir a ppm con el volumen
    molar real (ver `molar_volume`). Omitirla equivale a suponer nivel del mar.
    """
    vm = molar_volume(pressure_hpa)
    subs = []
    for label, key, mw, table in POLLUTANTS:
        c = conc_ugm3.get(key)
        if c is None:
            continue
        native = c if mw is None else _ugm3_to_ppm(c, mw, vm)
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


async def get_imeca(lat: float, lon: float,
                    pressure_hpa: Optional[float] = None) -> Dict[str, Any]:
    """
    IMECA estimado para la ubicación. `pressure_hpa` es la presión ABSOLUTA de la
    estación; se usa para el volumen molar (ver `molar_volume`) y se redondea a la
    decena en la clave de caché, porque una variación de pocos hPa no mueve el
    índice y no vale la pena invalidar la entrada por ella.
    """
    p_key = round(pressure_hpa / 10.0) * 10 if pressure_hpa else 0
    key = f"{lat:.3f},{lon:.3f},{p_key}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached["ts"]) < _TTL:
        return cached["data"]

    vars_ = "ozone,pm10,pm2_5,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide"
    url = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={lat}&longitude={lon}&current={vars_}&hourly={vars_}"
        # past_days=2: los promedios móviles de la norma (hasta 24h, ver
        # AVG_WINDOW_H) necesitan horas YA OBSERVADAS antes de "ahora", no
        # solo el pronóstico -- sin esto no hay de dónde mirar hacia atrás.
        "&timezone=auto&forecast_days=2&past_days=2"
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
    hourly = j.get("hourly", {}) or {}
    times = hourly.get("time", []) or []
    now_iso = cur.get("time", "")

    # Índice de "ahora" en el arreglo horario (incluye el pasado, por
    # past_days): primer tiempo >= now_iso.
    idx_now = next((i for i, t in enumerate(times) if t >= now_iso), None) if now_iso else None

    def _conc_en(idx: int) -> Dict[str, Optional[float]]:
        """Concentraciones a la hora `idx`, cada una con la ventana de
        promedio móvil que exige la norma para ESE contaminante."""
        return {
            key: _moving_avg(hourly.get(key) or [], idx, AVG_WINDOW_H.get(key, 1))
            for _, key, _, _ in POLLUTANTS
        }

    # Si por lo que sea no se encuentra el índice de "ahora" (respuesta
    # inesperada de Open-Meteo), se cae al valor instantáneo de `current`
    # antes que no reportar nada -- nunca debe tumbar la página.
    data = compute_imeca(_conc_en(idx_now) if idx_now is not None else cur, pressure_hpa)
    if data.get("available"):
        data["time"] = cur.get("time")
        data["source"] = "Open-Meteo (modelo CAMS)"
        # Presión usada para el volumen molar: hace auditable el cálculo de ppm.
        data["pressure_hpa"] = round(pressure_hpa, 1) if pressure_hpa else None

    # Pronóstico por horas (próximas ~24 h), mismo criterio de promedio móvil.
    forecast = []
    if idx_now is not None:
        for i in range(idx_now, len(times)):
            r = compute_imeca(_conc_en(i), pressure_hpa)
            if r.get("available"):
                forecast.append({"t": times[i], "imeca": r["imeca"], "category": r["category"]})
            if len(forecast) >= 24:
                break
    data["forecast"] = forecast

    if len(_CACHE) >= _MAX_ENTRIES and key not in _CACHE:
        _CACHE.pop(min(_CACHE, key=lambda k: _CACHE[k]["ts"]), None)
    _CACHE[key] = {"ts": now, "data": data}
    return data
