"""
Validación del análisis del cielo contra pronósticos de modelos.

Compara lo que VE la cámara con lo que PREDICEN los modelos numéricos
(Open-Meteo, WeatherAPI) para detectar discrepancias y ajustar confianza.
"""
from typing import Any, Dict, Optional, Tuple

# Mapeo de sky_condition (cámara) a códigos WMO aproximados
# WMO codes: https://open-meteo.com/en/docs (weathercode)
SKY_TO_WMO = {
    "clear": [0, 1],           # Clear sky, Mainly clear
    "partly_cloudy": [2, 3],   # Partly cloudy, Overcast
    "mostly_cloudy": [3],      # Overcast
    "overcast": [3],           # Overcast
    "foggy": [45, 48],         # Fog, Depositing rime fog
    "rainy": [51, 53, 55, 61, 63, 65, 80, 81, 82],  # Drizzle, Rain, Showers
    "stormy": [95, 96, 99],    # Thunderstorm
    "night": [0, 1, 2, 3],     # Cualquiera (de noche no sabemos)
}

# Mapeo inverso: WMO code -> condición aproximada
WMO_TO_CONDITION = {
    0: "clear",
    1: "clear",
    2: "partly_cloudy",
    3: "overcast",
    45: "foggy",
    48: "foggy",
    51: "rainy", 53: "rainy", 55: "rainy",
    56: "rainy", 57: "rainy",
    61: "rainy", 63: "rainy", 65: "rainy",
    66: "rainy", 67: "rainy",
    71: "rainy", 73: "rainy", 75: "rainy",  # Snow -> tratamos como precip
    77: "rainy",
    80: "rainy", 81: "rainy", 82: "rainy",
    85: "rainy", 86: "rainy",
    95: "stormy",
    96: "stormy",
    99: "stormy",
}

# Niveles de discrepancia
MATCH_EXACT = "exact"      # Coincidencia exacta
MATCH_CLOSE = "close"      # Similar (ej: partly_cloudy vs mostly_cloudy)
MATCH_DIFFER = "differ"    # Diferente pero no crítico
MATCH_CONFLICT = "conflict"  # Conflicto importante (ej: clear vs stormy)

# Pares que se consideran "cercanos" aunque no sean iguales
CLOSE_PAIRS = {
    ("clear", "partly_cloudy"),
    ("partly_cloudy", "mostly_cloudy"),
    ("mostly_cloudy", "overcast"),
    ("rainy", "stormy"),
}

# Pares que son conflictos importantes
CONFLICT_PAIRS = {
    ("clear", "stormy"),
    ("clear", "rainy"),
    ("partly_cloudy", "stormy"),
}

# Nombres en español para armar explicaciones legibles en la UI
CONDITION_ES = {
    "clear": "despejado",
    "partly_cloudy": "parcialmente nublado",
    "mostly_cloudy": "mayormente nublado",
    "overcast": "cubierto",
    "foggy": "neblina",
    "rainy": "lluvia",
    "stormy": "tormenta",
    "night": "de noche",
    "unknown": "desconocido",
}


def _normalize_condition(cond: str) -> str:
    """Normaliza condición a un conjunto reducido."""
    if cond in ("clear", "night"):
        return "clear"
    if cond in ("partly_cloudy", "mostly_cloudy"):
        return "cloudy"
    if cond == "overcast":
        return "overcast"
    if cond in ("rainy", "stormy"):
        return "precip"
    if cond == "foggy":
        return "foggy"
    return "unknown"


def compare_conditions(camera_cond: str, forecast_wmo: int) -> Tuple[str, str]:
    """
    Compara condición de cámara con código WMO del pronóstico.

    Returns:
        (match_level, explanation)
    """
    forecast_cond = WMO_TO_CONDITION.get(forecast_wmo, "unknown")

    # Coincidencia exacta
    if camera_cond == forecast_cond:
        return MATCH_EXACT, f"Coincide: {camera_cond}"

    # Noche: no podemos validar bien
    if camera_cond == "night":
        return MATCH_CLOSE, "Noche: validación limitada"

    # Verificar si es par cercano
    pair = tuple(sorted([camera_cond, forecast_cond]))
    if pair in CLOSE_PAIRS or (pair[0], pair[1]) in CLOSE_PAIRS or (pair[1], pair[0]) in CLOSE_PAIRS:
        return MATCH_CLOSE, f"Similar: cámara={camera_cond}, modelo={forecast_cond}"

    # Verificar conflicto
    if pair in CONFLICT_PAIRS or (pair[0], pair[1]) in CONFLICT_PAIRS or (pair[1], pair[0]) in CONFLICT_PAIRS:
        return MATCH_CONFLICT, f"Discrepancia: cámara={camera_cond}, modelo={forecast_cond}"

    # Diferencia normal
    return MATCH_DIFFER, f"Difiere: cámara={camera_cond}, modelo={forecast_cond}"


def validate_analysis(
    analysis: Dict[str, Any],
    forecast: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Valida el análisis del cielo contra el pronóstico actual.

    Args:
        analysis: Resultado de sky_analyzer (con sky_condition, cloud_coverage_pct, etc.)
        forecast: Pronóstico actual (debe tener weather_code WMO y cloud_cover)

    Returns:
        Dict con:
        - validated: bool (si se pudo validar)
        - match: str (exact/close/differ/conflict)
        - confidence: float (0-1, confianza ajustada)
        - summary: str (frase corta para la UI)
        - explanation: str (frase legible con lo que ve la cámara vs. el modelo)
        - camera_condition: str
        - forecast_condition: str
        - details: dict con más info
    """
    if not analysis or analysis.get("error"):
        return {"validated": False, "reason": "Sin análisis disponible"}

    if not forecast:
        return {"validated": False, "reason": "Sin pronóstico disponible"}

    camera_cond = analysis.get("sky_condition", "unknown")
    camera_coverage = analysis.get("cloud_coverage_pct", 0)

    # Obtener código WMO del pronóstico
    forecast_wmo = forecast.get("weather_code") or forecast.get("weathercode")
    forecast_clouds = forecast.get("cloud_cover") or forecast.get("cloudcover", 0)

    if forecast_wmo is None:
        return {"validated": False, "reason": "Pronóstico sin código WMO"}

    # Comparar condiciones
    match_level, _detail = compare_conditions(camera_cond, forecast_wmo)
    forecast_cond = WMO_TO_CONDITION.get(forecast_wmo, "unknown")

    # Calcular confianza base
    if match_level == MATCH_EXACT:
        confidence = 0.95
    elif match_level == MATCH_CLOSE:
        confidence = 0.80
    elif match_level == MATCH_DIFFER:
        confidence = 0.60
    else:  # CONFLICT
        confidence = 0.30

    # Ajustar por diferencia de cobertura
    coverage_diff = abs(camera_coverage - forecast_clouds)
    if coverage_diff > 40:
        confidence *= 0.8
    elif coverage_diff > 20:
        confidence *= 0.9

    # Explicación legible en español: qué ve la cámara vs. qué predice el
    # modelo, en frases completas -- nada de símbolos que haya que descifrar.
    camera_es = CONDITION_ES.get(camera_cond, camera_cond)
    forecast_es = CONDITION_ES.get(forecast_cond, forecast_cond)

    if match_level == MATCH_EXACT:
        summary = "Coincide con el pronóstico"
        explanation = f"La cámara y el modelo coinciden: {camera_es}"
    elif camera_cond == "night":
        summary = "De noche no se puede comparar bien con el pronóstico"
        explanation = f"El modelo predice {forecast_es}, pero de noche la cámara no distingue bien las nubes"
    elif match_level == MATCH_CLOSE:
        summary = "Parecido al pronóstico"
        explanation = f"La cámara ve {camera_es}, el modelo predice {forecast_es} -- son condiciones cercanas"
    elif match_level == MATCH_DIFFER:
        summary = "La cámara ve algo distinto al modelo"
        explanation = f"La cámara ve {camera_es}, el modelo predice {forecast_es}"
    else:
        summary = "Contradice al pronóstico"
        explanation = f"La cámara ve {camera_es}, el modelo predice {forecast_es} -- son condiciones opuestas"

    if coverage_diff > 40:
        explanation += f" (cobertura de nubes: cámara {camera_coverage}% vs. modelo {forecast_clouds}%)"

    return {
        "validated": True,
        "match": match_level,
        "confidence": round(confidence, 2),
        "summary": summary,
        "explanation": explanation,
        "camera_condition": camera_cond,
        "forecast_condition": forecast_cond,
        "details": {
            "camera_coverage": camera_coverage,
            "forecast_coverage": forecast_clouds,
            "forecast_wmo": forecast_wmo,
            "coverage_diff": coverage_diff,
        },
    }
