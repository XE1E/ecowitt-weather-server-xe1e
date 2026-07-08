"""
Pronóstico local por tendencia barométrica.

Es el principio clásico del barómetro (la misma base que el método Zambretti):
la presión a nivel del mar y, sobre todo, su TENDENCIA en las últimas ~3 horas
anticipan el tiempo a corto plazo:
  - presión que cae rápido  -> se acerca mal tiempo / lluvia
  - presión que sube         -> mejora, tiempo más estable
  - presión alta y estable   -> buen tiempo

No depende de Open-Meteo: es un pronóstico propio calculado con los datos de
NUESTRA estación. Devuelve un texto corto + la tendencia para mostrar en un
recuadro tipo "estado del barómetro".
"""
from typing import Any, Dict, Optional


def classify_trend(delta_3h: Optional[float]) -> Dict[str, Any]:
    """Clasifica el cambio de presión (hPa en 3 h) en una tendencia con nombre."""
    if delta_3h is None:
        return {"code": "unknown", "label": "sin datos", "arrow": "→"}
    d = delta_3h
    if d <= -3.5:
        return {"code": "falling_fast", "label": "cayendo rápido", "arrow": "↓↓"}
    if d <= -1.0:
        return {"code": "falling", "label": "bajando", "arrow": "↓"}
    if d < 1.0:
        return {"code": "steady", "label": "estable", "arrow": "→"}
    if d < 3.5:
        return {"code": "rising", "label": "subiendo", "arrow": "↑"}
    return {"code": "rising_fast", "label": "subiendo rápido", "arrow": "↑↑"}


def _level(pressure: float) -> str:
    """Nivel de presión a nivel del mar."""
    if pressure >= 1022:
        return "high"
    if pressure >= 1009:
        return "normal"
    return "low"


# Texto según (nivel de presión, tendencia). Pensado para clima subtropical de altura (CDMX).
def _forecast_text(level: str, trend_code: str) -> str:
    if trend_code in ("falling_fast",):
        return "Cambio de tiempo: probable lluvia o tormenta en unas horas."
    if trend_code == "falling":
        if level == "low":
            return "Inestable; posibilidad de lluvia."
        return "Tendencia a nublado; puede llegar lluvia ligera."
    if trend_code in ("rising", "rising_fast"):
        if level == "high":
            return "Mejorando; buen tiempo y cielos más despejados."
        return "Mejorando gradualmente."
    # estable
    if level == "high":
        return "Buen tiempo, estable."
    if level == "low":
        return "Tiempo variable, con nubosidad."
    return "Sin cambios notables; tiempo estable."


def local_forecast(pressure_now: Optional[float], pressure_3h_ago: Optional[float]) -> Dict[str, Any]:
    """
    Calcula el pronóstico local. `pressure_*` son presión RELATIVA (nivel del
    mar) en hPa. Devuelve tendencia + texto + datos crudos.
    """
    if pressure_now is None:
        return {"available": False, "reason": "sin presión actual"}
    delta = None
    if pressure_3h_ago is not None:
        delta = round(pressure_now - pressure_3h_ago, 1)
    trend = classify_trend(delta)
    level = _level(pressure_now)
    return {
        "available": True,
        "pressure": round(pressure_now, 1),
        "delta_3h": delta,
        "trend": trend,
        "level": level,
        "forecast": _forecast_text(level, trend["code"]),
    }
