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
from typing import Any, Dict, List, Optional


_COMPASS_EN = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def _compass_en(deg: float) -> str:
    return _COMPASS_EN[round((deg % 360) / 45) % 8]


def _roughly_from(station_bearing: str, wind_from: str) -> bool:
    """Mismo rumbo, o uno de los dos adyacentes (+/-45°) -- da algo de margen
    al bucket de 8 puntos, que ya es la resolución más fina disponible (ver
    `bearing` en xweather.py/netatmo.py: compass point, no grados)."""
    if station_bearing not in _COMPASS_EN or wind_from not in _COMPASS_EN:
        return False
    ia, ib = _COMPASS_EN.index(station_bearing), _COMPASS_EN.index(wind_from)
    return min((ia - ib) % 8, (ib - ia) % 8) <= 1


def detect_incoming_rain(stations: List[Dict[str, Any]], wind_dir_deg: Optional[float],
                          wind_speed_kph: Optional[float], own_rain_rate: Optional[float],
                          min_wind_kph: float = 5.0) -> Optional[Dict[str, Any]]:
    """Señal puntual (NO interpolación, NO pronóstico) de lluvia acercándose:
    alguna vecina en la dirección de donde SOPLA el viento ahora mismo
    reporta precipitación, y aquí todavía no llueve. Devuelve la vecina más
    cercana que cumple, o None.

    Única fuente de verdad para esto -- la usan tanto `/api/nearby-stations`
    (expone el resultado para NearbyStationsCard.tsx, que ya NO lo calcula
    por su cuenta) como `get_own_forecast` en main.py. Con viento en calma no hay nada que "traiga" la lluvia, y el
    viento superficial no siempre coincide con el movimiento real de una
    célula convectiva -- por eso es una pista, no una certeza.
    """
    if wind_dir_deg is None or wind_speed_kph is None or wind_speed_kph < min_wind_kph:
        return None
    if (own_rain_rate or 0) > 0:
        return None
    wind_from = _compass_en(wind_dir_deg)
    candidates = [s for s in stations
                  if s.get("bearing") and (s.get("precip_mm") or 0) > 0
                  and _roughly_from(s["bearing"], wind_from)]
    if not candidates:
        return None
    return min(candidates, key=lambda s: s["distance_km"] if s.get("distance_km") is not None else float("inf"))


def own_forecast(rain_rate: Optional[float], camera_analysis: Optional[Dict[str, Any]],
                 incoming_rain: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    "Nuestro pronóstico": lo que la propia estación puede afirmar sobre
    lluvia AHORA o en las PRÓXIMAS HORAS, sin depender de ningún modelo
    externo (Open-Meteo/WeatherAPI) -- esos se muestran aparte y siempre
    atribuidos (ver PrecipitationCard.tsx), nunca mezclados aquí como si
    fueran nuestra propia conclusión.

    Motivo (2026-09-14): "Precipitaciones" mostraba el % crudo de Open-Meteo
    sin cruzarlo con nada, y ese día marcó 82% de lluvia inminente mientras
    la cámara veía despejando y sin precipitación visible -- justo el tipo
    de incongruencia que esto evita: la fuente propia manda, el modelo
    externo queda como referencia aparte.

    Orden de autoridad (gana la primera que tenga algo que decir):
    1. Pluviómetro (`rain_rate` > 0) -- dato real, ahora mismo.
    2. Cámara, precipitación YA visible en la foto -- dato real, visual, ahora.
    3. Cámara, tendencia de nubes de lluvia FORMÁNDOSE (`trend.precip_appearing`)
       -- todavía no se ve lluvia, pero la serie de fotos recientes lo sugiere.
    4. Vecinas + viento (`detect_incoming_rain`) -- observaciones reales de
       otras estaciones, no un pronóstico.
    Si ninguna tiene algo que decir, se reporta `source: "none"` -- el
    llamador decide si mostrar el modelo externo como respaldo.

    La presión propia YA NO dispara lluvia (2026-09-23): verificada contra el
    pluviómetro (`/api/forecast/verification`, 30 días), "presión bajando"
    acertaba 13% de las lluvias a 3 h con 83% de falsas alarmas -- la marea
    atmosférica la baja casi todas las tardes, llueva o no, y quitarle la
    marea empeoraba (5-10%). Avisar sólo por horario (14-20 h) acertaba el
    doble (26%). En las tormentas convectivas de CDMX la presión no anticipa
    la lluvia; su tendencia se sigue mostrando como dato en
    `/api/forecast/local`, sólo no como aviso de lluvia.
    """
    if (rain_rate or 0) > 0:
        return {"headline": "Lloviendo ahora (estación)", "source": "station",
                "rain_now": True, "storm_likely": False, "confidence": "high"}

    if camera_analysis and camera_analysis.get("precipitation_visible"):
        return {"headline": "La cámara ve precipitación en el horizonte", "source": "camera",
                "rain_now": False, "storm_likely": True, "confidence": "high"}

    trend = (camera_analysis or {}).get("trend") or {}
    if trend.get("precip_appearing"):
        return {"headline": "La cámara detecta nubes de lluvia formándose", "source": "camera_trend",
                "rain_now": False, "storm_likely": True, "confidence": "medium"}

    if incoming_rain:
        return {
            "headline": (f"{incoming_rain.get('source')} reporta lluvia al {incoming_rain.get('bearing')} "
                        "y el viento viene de esa dirección"),
            "source": "nearby", "rain_now": False, "storm_likely": True, "confidence": "medium",
        }

    return {"headline": "Sin señal propia de lluvia inminente", "source": "none",
            "rain_now": False, "storm_likely": False, "confidence": "low"}


def zone_trend(stations: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Tendencia de presión agregada de un grupo de estaciones vecinas (cada una
    con su propio `pressure_trend_mb` ya calculado, ver xweather.py/netatmo.py).

    Prefiere el METAR (calibración profesional, sin el ruido de las PWS
    baratas) si hay uno con historia suficiente; si no, cae a la MEDIANA del
    resto -- mismo criterio documentado en PLAN-ESTACIONES-VECINAS.md
    ("Residual esperado": las PWS dispersan 8-13 hPa entre sí sin ser error).
    Se usa tanto por red (Xweather o Netatmo solas) como sobre la lista ya
    fusionada de ambas (ver /api/nearby-stations en main.py).
    """
    metar = next((s for s in stations
                  if s.get("source") == "METAR_NOAA" and s.get("pressure_trend_mb") is not None), None)
    if metar:
        delta, reference = metar["pressure_trend_mb"], "metar"
    else:
        deltas = sorted(s["pressure_trend_mb"] for s in stations if s.get("pressure_trend_mb") is not None)
        if not deltas:
            return {"delta_mb": None, "trend": None, "reference": None}
        delta, reference = deltas[len(deltas) // 2], "median"
    return {"delta_mb": delta, "trend": classify_trend(delta), "reference": reference}


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
    """Nivel de presión a nivel del mar.

    Umbrales calibrados para CDMX (~2240 m) basados en histórico local de 90 días:
    - Promedio: 1027 hPa, Rango: 999-1036 hPa
    - P10: 1024 hPa, P90: 1030 hPa

    Los umbrales estándar (high=1022, normal=1009) no aplican aquí porque la
    presión local promedio (1027 hPa) ya supera el umbral "alto" estándar.
    """
    if pressure >= 1030:
        return "high"
    if pressure >= 1024:
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
