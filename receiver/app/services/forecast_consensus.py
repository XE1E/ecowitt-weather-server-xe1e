"""
Sistema de pronóstico por consenso: combina múltiples fuentes para mayor precisión.

Fuentes:
1. Estación local — condición REAL ahora (lluvia, temp, humedad)
2. Tendencia de presión — alerta de tormenta inminente (0-3h)
3. Open-Meteo — pronóstico horario gratuito (1-7 días)
4. WeatherAPI — más preciso para ciudades (1-3 días)
5. SMN — alertas oficiales (cuando las haya)

Principios:
- La estación local tiene prioridad si está lloviendo (dato real > pronóstico)
- La presión detecta tormentas ANTES de que lleguen
- Cuando Open-Meteo y WeatherAPI difieren, se muestra el más conservador
- Las alertas del SMN se muestran siempre que existan
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from . import openmeteo, weatherapi

logger = logging.getLogger(__name__)

# Códigos WMO por severidad (mayor = peor tiempo)
_WMO_SEVERITY = {
    0: 0,   # Clear
    1: 1,   # Mainly clear
    2: 2,   # Partly cloudy
    3: 3,   # Overcast
    45: 4,  # Fog
    48: 4,  # Depositing rime fog
    51: 5,  # Drizzle light
    53: 6,  # Drizzle moderate
    55: 7,  # Drizzle dense
    56: 6,  # Freezing drizzle light
    57: 7,  # Freezing drizzle dense
    61: 8,  # Rain slight
    63: 9,  # Rain moderate
    65: 10, # Rain heavy
    66: 9,  # Freezing rain light
    67: 10, # Freezing rain heavy
    71: 7,  # Snow slight
    73: 8,  # Snow moderate
    75: 9,  # Snow heavy
    77: 6,  # Snow grains
    80: 8,  # Rain showers slight
    81: 9,  # Rain showers moderate
    82: 10, # Rain showers violent
    85: 8,  # Snow showers slight
    86: 9,  # Snow showers heavy
    95: 11, # Thunderstorm
    96: 12, # Thunderstorm with slight hail
    99: 13, # Thunderstorm with heavy hail
}


def _severity(code: int) -> int:
    """Severidad de un código WMO (mayor = peor tiempo)."""
    return _WMO_SEVERITY.get(code, 3)


def _worst_code(codes: List[int]) -> int:
    """El código más severo de una lista."""
    if not codes:
        return 0
    return max(codes, key=_severity)


def _precip_likely(code: int) -> bool:
    """¿El código indica precipitación probable?"""
    return _severity(code) >= 5


def pressure_forecast(
    current_pressure: float,
    pressure_3h_ago: Optional[float],
    pressure_1h_ago: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Pronóstico de corto plazo basado en tendencia de presión.

    Una caída rápida de presión casi siempre indica lluvia inminente.
    Esto lo detecta ANTES que cualquier modelo externo.

    Retorna:
    - trend: 'falling_fast', 'falling', 'stable', 'rising', 'rising_fast'
    - delta_3h: cambio en hPa en las últimas 3 horas
    - delta_1h: cambio en hPa en la última hora (si disponible)
    - storm_likely: True si la caída sugiere tormenta inminente
    - hours_to_rain: estimación de horas hasta la lluvia (0-3, None si no aplica)
    - confidence: 'high', 'medium', 'low'
    - message: descripción en español
    """
    result: Dict[str, Any] = {
        "trend": "unknown",
        "delta_3h": None,
        "delta_1h": None,
        "storm_likely": False,
        "hours_to_rain": None,
        "confidence": "low",
        "message": "Sin datos suficientes de presión.",
    }

    if pressure_3h_ago is None:
        return result

    delta_3h = current_pressure - pressure_3h_ago
    result["delta_3h"] = round(delta_3h, 1)

    if pressure_1h_ago is not None:
        delta_1h = current_pressure - pressure_1h_ago
        result["delta_1h"] = round(delta_1h, 1)

    # Clasificar tendencia (umbrales calibrados: -3 hPa/3h es caída significativa)
    if delta_3h <= -7:
        result["trend"] = "falling_fast"
        result["storm_likely"] = True
        result["hours_to_rain"] = 0.5
        result["confidence"] = "high"
        result["message"] = "Caída muy rápida de presión. Tormenta inminente (0-1h)."
    elif delta_3h <= -5:
        result["trend"] = "falling_fast"
        result["storm_likely"] = True
        result["hours_to_rain"] = 1.5
        result["confidence"] = "high"
        result["message"] = "Caída rápida de presión. Lluvia probable en 1-2 horas."
    elif delta_3h <= -3:
        result["trend"] = "falling"
        result["storm_likely"] = True
        result["hours_to_rain"] = 3
        result["confidence"] = "medium"
        result["message"] = "Presión bajando. Posible lluvia en 2-4 horas."
    elif delta_3h < 3:
        result["trend"] = "stable"
        result["confidence"] = "medium"
        result["message"] = "Presión estable. Sin cambios significativos esperados."
    elif delta_3h < 5:
        result["trend"] = "rising"
        result["confidence"] = "medium"
        result["message"] = "Presión subiendo. Tiempo mejorando."
    else:
        result["trend"] = "rising_fast"
        result["confidence"] = "high"
        result["message"] = "Presión subiendo rápido. Cielos despejando."

    # Si además la presión de 1h muestra aceleración, aumentar confianza
    if pressure_1h_ago is not None:
        delta_1h = current_pressure - pressure_1h_ago
        if delta_3h < -3 and delta_1h < -1.5:
            result["confidence"] = "high"
            if result["hours_to_rain"]:
                result["hours_to_rain"] = max(0.5, result["hours_to_rain"] - 0.5)
            result["message"] += " La caída se acelera."

    return result


async def get_consensus_forecast(
    lat: float,
    lon: float,
    current_data: Optional[Dict[str, Any]] = None,
    pressure_history: Optional[List[Tuple[datetime, float]]] = None,
) -> Dict[str, Any]:
    """
    Obtiene pronóstico combinado de todas las fuentes disponibles.

    Args:
        lat, lon: coordenadas
        current_data: datos actuales de la estación (si disponibles)
        pressure_history: lista de (timestamp, pressure_hPa) de las últimas horas

    Returns:
        Pronóstico combinado con:
        - current: condición actual (de la estación si hay lluvia, si no del consenso)
        - pressure: pronóstico por tendencia de presión
        - hourly: pronóstico horario combinado
        - daily: pronóstico diario combinado
        - alerts: alertas activas
        - sources: qué fuentes se usaron
    """
    result: Dict[str, Any] = {
        "current": None,
        "pressure": None,
        "hourly": [],
        "daily": [],
        "alerts": [],
        "sources": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    # 1. Pronóstico por presión (si hay histórico)
    if pressure_history and len(pressure_history) >= 2:
        now = datetime.now(timezone.utc)
        current_p = pressure_history[-1][1] if pressure_history else None

        # Buscar presión de hace ~3h y ~1h
        p_3h = None
        p_1h = None
        for ts, p in pressure_history:
            age_h = (now - ts).total_seconds() / 3600
            if 2.5 < age_h < 3.5 and p_3h is None:
                p_3h = p
            if 0.5 < age_h < 1.5 and p_1h is None:
                p_1h = p

        if current_p and p_3h:
            result["pressure"] = pressure_forecast(current_p, p_3h, p_1h)
            result["sources"].append("pressure")

    # 2. Obtener pronósticos externos
    om_data = None
    wa_data = None

    try:
        om_data = await openmeteo.get_forecast(lat, lon, days=7)
        if om_data:
            result["sources"].append("open-meteo")
    except Exception as e:
        logger.warning(f"Open-Meteo error: {e}")

    try:
        wa_data = await weatherapi.get_forecast(lat, lon, days=3)
        if wa_data:
            result["sources"].append("weatherapi")
    except Exception as e:
        logger.warning(f"WeatherAPI error: {e}")

    # 3. Combinar pronósticos horarios
    result["hourly"] = _merge_hourly(om_data, wa_data)

    # 4. Combinar pronósticos diarios
    result["daily"] = _merge_daily(om_data, wa_data)

    # 5. Condición actual
    result["current"] = _determine_current(
        current_data,
        result.get("pressure"),
        result["hourly"][:1] if result["hourly"] else None,
        lat=lat,
        lon=lon,
    )

    # 6. Generar alertas de corto plazo
    result["alerts"] = _generate_alerts(result)

    return result


def _merge_hourly(
    om: Optional[Dict[str, Any]],
    wa: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Combina pronósticos horarios de Open-Meteo y WeatherAPI.
    Cuando difieren, usa el más conservador (peor tiempo).
    """
    hours: List[Dict[str, Any]] = []

    # Indexar WeatherAPI por hora
    wa_by_time: Dict[str, Dict[str, Any]] = {}
    if wa and "hourly" in wa:
        h = wa["hourly"]
        for i, t in enumerate(h.get("time", [])):
            wa_by_time[t[:13]] = {  # "2026-08-10T14"
                "code": h["weather_code"][i] if i < len(h.get("weather_code", [])) else None,
                "temp": h["temperature_2m"][i] if i < len(h.get("temperature_2m", [])) else None,
                "precip_prob": h["precipitation_probability"][i] if i < len(h.get("precipitation_probability", [])) else None,
            }

    # Usar Open-Meteo como base y enriquecer con WeatherAPI
    if om and "hourly" in om:
        h = om["hourly"]
        for i, t in enumerate(h.get("time", [])):
            if i >= 48:  # Limitar a 48 horas
                break

            om_code = h["weather_code"][i] if i < len(h.get("weather_code", [])) else 0
            om_temp = h["temperature_2m"][i] if i < len(h.get("temperature_2m", [])) else None
            om_prob = h["precipitation_probability"][i] if i < len(h.get("precipitation_probability", [])) else 0

            # Buscar datos de WeatherAPI para esta hora
            wa_hour = wa_by_time.get(t[:13], {})
            wa_code = wa_hour.get("code")
            wa_temp = wa_hour.get("temp")
            wa_prob = wa_hour.get("precip_prob")

            # Consenso: promediar severidad (evita sesgo pesimista)
            if wa_code is not None:
                om_sev = _severity(om_code)
                wa_sev = _severity(wa_code)
                if om_sev == wa_sev:
                    code = om_code
                    consensus = "both"
                else:
                    # Usar el código cuya severidad esté más cerca del promedio
                    avg_sev = (om_sev + wa_sev) / 2
                    code = om_code if abs(om_sev - avg_sev) <= abs(wa_sev - avg_sev) else wa_code
                    consensus = "averaged"
            else:
                code = om_code
                consensus = "open-meteo"

            # Probabilidad: promedio (no el máximo)
            prob = round((om_prob or 0) + (wa_prob or 0)) // 2 if wa_prob is not None else (om_prob or 0)

            # Temperatura: promedio si ambas disponibles
            if om_temp is not None and wa_temp is not None:
                temp = round((om_temp + wa_temp) / 2, 1)
            else:
                temp = om_temp if om_temp is not None else wa_temp

            hours.append({
                "time": t,
                "code": code,
                "temperature": temp,
                "precip_prob": prob,
                "consensus": consensus,
                "om_code": om_code,
                "wa_code": wa_code,
            })

    return hours


def _merge_daily(
    om: Optional[Dict[str, Any]],
    wa: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Combina pronósticos diarios."""
    days: List[Dict[str, Any]] = []

    # Similar a hourly, pero con menos detalle
    if om and "daily" in om:
        d = om["daily"]
        for i, date in enumerate(d.get("time", [])):
            if i >= 7:
                break
            days.append({
                "date": date,
                "code": d["weather_code"][i] if i < len(d.get("weather_code", [])) else 0,
                "temp_max": d["temperature_2m_max"][i] if i < len(d.get("temperature_2m_max", [])) else None,
                "temp_min": d["temperature_2m_min"][i] if i < len(d.get("temperature_2m_min", [])) else None,
                "precip_prob": d["precipitation_probability_max"][i] if i < len(d.get("precipitation_probability_max", [])) else 0,
                "precip_sum": d["precipitation_sum"][i] if i < len(d.get("precipitation_sum", [])) else 0,
                "sunrise": d["sunrise"][i] if i < len(d.get("sunrise", [])) else None,
                "sunset": d["sunset"][i] if i < len(d.get("sunset", [])) else None,
            })

    return days


def _solar_elevation(lat: float, lon: float) -> float:
    """
    Elevación del sol en grados (aproximación sin ecuación del tiempo).
    Suficiente para clasificar nubosidad por índice de claridad.
    """
    import math
    now = datetime.now(timezone.utc)
    doy = now.timetuple().tm_yday
    decl = 23.45 * math.sin(math.radians(360 * (284 + doy) / 365))
    solar_hour = now.hour + now.minute / 60 + lon / 15
    H = 15 * (solar_hour - 12)
    s = (math.sin(math.radians(lat)) * math.sin(math.radians(decl)) +
         math.cos(math.radians(lat)) * math.cos(math.radians(decl)) * math.cos(math.radians(H)))
    return math.degrees(math.asin(max(-1, min(1, s))))


def _clearness_index(solar_wm2: float, elevation_deg: float) -> Optional[float]:
    """
    Índice de claridad: radiación medida ÷ la que habría con cielo despejado.
    Permite juzgar nubosidad sin depender de la hora del día.
    Devuelve None si el sol está muy bajo (< 5°).
    """
    import math
    if elevation_deg < 5:
        return None
    clear_sky = 1361 * math.sin(math.radians(elevation_deg))
    return solar_wm2 / clear_sky if clear_sky > 0 else None


def _determine_current(
    station: Optional[Dict[str, Any]],
    pressure: Optional[Dict[str, Any]],
    forecast_now: Optional[List[Dict[str, Any]]],
    lat: float = 19.38,
    lon: float = -99.17,
) -> Dict[str, Any]:
    """
    Determina la condición actual combinando fuentes.

    Prioridad:
    1. Si la estación detecta lluvia -> "Lloviendo" (dato real)
    2. Radiación solar de día -> nubosidad real (índice de claridad)
    3. Si la presión indica tormenta inminente -> "Tormenta cercana"
    4. Si no, usar el pronóstico de la hora actual
    """
    result: Dict[str, Any] = {
        "code": 0,
        "label": "Despejado",
        "source": "default",
        "rain_now": False,
        "storm_approaching": False,
    }

    # 1. ¿Está lloviendo según la estación?
    if station:
        rain_rate = station.get("rain_rate", 0) or 0
        if rain_rate > 0:
            result["rain_now"] = True
            result["source"] = "station"
            if rain_rate >= 7.6:
                result["code"] = 95 if station.get("rain_event") else 65
                result["label"] = "Tormenta" if station.get("rain_event") else "Lluvia fuerte"
            elif rain_rate >= 2.5:
                result["code"] = 63
                result["label"] = "Lluvia"
            else:
                result["code"] = 61
                result["label"] = "Llovizna"
            return result

    # 2. De día: usar radiación solar para determinar nubosidad REAL
    station_has_cloudiness = False
    if station:
        solar = station.get("solar_radiation")
        if solar is not None:
            elev = _solar_elevation(lat, lon)
            kt = _clearness_index(solar, elev)
            if kt is not None:
                # Índice de claridad disponible: clasificar nubosidad
                station_has_cloudiness = True
                if kt > 0.65:
                    result["code"] = 0
                    result["label"] = "Despejado"
                elif kt > 0.35:
                    result["code"] = 2
                    result["label"] = "Parcialmente nublado"
                else:
                    result["code"] = 3
                    result["label"] = "Nublado"
                result["source"] = "station"
                result["clearness_index"] = round(kt, 2)

    # 3. ¿La presión indica tormenta inminente?
    if pressure and pressure.get("storm_likely"):
        result["storm_approaching"] = True
        hours = pressure.get("hours_to_rain", 3)
        # Solo actualizar label con alerta, no sobrescribir la nubosidad real
        if not station_has_cloudiness:
            if hours <= 1:
                result["label"] = f"Tormenta inminente (~{int(hours*60)} min)"
            else:
                result["label"] = f"Lluvia probable en {hours:.0f}h"
            result["source"] = "pressure"
            result["code"] = 80

    # 4. Usar pronóstico SOLO si no tenemos dato real de la estación
    if not station_has_cloudiness and forecast_now and len(forecast_now) > 0:
        fc = forecast_now[0]
        if not result["storm_approaching"]:
            fc_code = fc["code"]
            # Si la estación dice rain_rate=0, no mostrar precipitación del pronóstico
            # El pluviómetro es dato real; el pronóstico puede equivocarse
            station_says_no_rain = station and station.get("rain_rate", 0) == 0
            if station_says_no_rain and _precip_likely(fc_code):
                # Degradar a "Nublado" - el pronóstico esperaba lluvia pero no hay
                fc_code = 3
            result["code"] = fc_code
            result["source"] = "forecast" if fc_code == fc["code"] else "station+forecast"
            result["label"] = _code_to_label(fc_code)

    return result


def _code_to_label(code: int) -> str:
    """Traduce código WMO a español."""
    labels = {
        0: "Despejado",
        1: "Mayormente despejado",
        2: "Parcialmente nublado",
        3: "Nublado",
        45: "Niebla",
        48: "Niebla helada",
        51: "Llovizna ligera",
        53: "Llovizna",
        55: "Llovizna densa",
        56: "Llovizna helada",
        57: "Llovizna helada densa",
        61: "Lluvia ligera",
        63: "Lluvia",
        65: "Lluvia fuerte",
        66: "Lluvia helada",
        67: "Lluvia helada fuerte",
        71: "Nevada ligera",
        73: "Nevada",
        75: "Nevada fuerte",
        77: "Granizo",
        80: "Chubascos",
        81: "Chubascos moderados",
        82: "Chubascos fuertes",
        85: "Nevada ligera",
        86: "Nevada fuerte",
        95: "Tormenta",
        96: "Tormenta con granizo",
        99: "Tormenta severa",
    }
    return labels.get(code, "Variable")


def _generate_alerts(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Genera alertas basadas en el pronóstico combinado."""
    alerts: List[Dict[str, Any]] = []

    # Alerta por presión
    pressure = result.get("pressure")
    if pressure and pressure.get("storm_likely"):
        alerts.append({
            "type": "pressure",
            "severity": "warning" if pressure.get("confidence") == "high" else "info",
            "title": "Tormenta acercándose",
            "message": pressure.get("message", ""),
            "hours": pressure.get("hours_to_rain"),
        })

    # Alerta por pronóstico de lluvia fuerte en las próximas horas
    for h in result.get("hourly", [])[:6]:
        if _severity(h.get("code", 0)) >= 10:  # Lluvia fuerte o peor
            alerts.append({
                "type": "forecast",
                "severity": "warning",
                "title": "Lluvia fuerte esperada",
                "message": f"Se esperan {_code_to_label(h['code'])} alrededor de las {h['time'][11:16]}.",
                "time": h["time"],
            })
            break  # Solo la primera

    return alerts
