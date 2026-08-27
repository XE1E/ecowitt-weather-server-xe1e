"""
Análisis del cielo usando modelos de visión (Claude o Gemini).

Recibe una imagen de la cámara exterior y genera una descripción estructurada
del estado del cielo: tipo de nubes, cobertura, visibilidad, y una sugerencia
de pronóstico a corto plazo basada en lo observado.

Soporta dos proveedores:
- **Anthropic (Claude)**: Mejor calidad, de pago (~$0.50-1/día con Sonnet)
- **Google Gemini**: Tier gratuito generoso (15 RPM, 1M tokens/día)

El proveedor se selecciona automáticamente según qué API key esté configurada,
o se puede forzar con `CAMERA_ANALYSIS_PROVIDER`.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional, Literal

import httpx

logger = logging.getLogger(__name__)

Provider = Literal["anthropic", "gemini", "auto"]

# Prompt compartido para ambos proveedores
_SYSTEM_PROMPT = """\
Eres un observador meteorológico experto analizando imágenes de una cámara de
estación de clima. La cámara apunta al horizonte con 127° de campo de visión,
mostrando cielo y paisaje.

Tu trabajo es describir lo que VES en la imagen para complementar los datos de
sensores. Sé específico y conciso. Responde SOLO en el formato JSON indicado.
"""

_USER_PROMPT_BASE = """\
Analiza esta imagen del cielo y responde en JSON con esta estructura exacta:

{
  "cloud_type": "tipo de nube predominante (cirrus/cumulus/stratus/cumulonimbus/altocumulus/stratocumulus/nimbostratus/clear/mixed)",
  "cloud_coverage_pct": número 0-100 estimando porcentaje del cielo cubierto,
  "sky_condition": "clear|partly_cloudy|mostly_cloudy|overcast|foggy|rainy|stormy|night",
  "visibility": "excellent|good|moderate|poor|very_poor",
  "precipitation_visible": true/false si se ve lluvia/cortinas en el horizonte,
  "development": "stable|building|dissipating|unknown" para nubes convectivas,
  "description": "Una oración en español describiendo el cielo actual",
  "forecast_hint": "Sugerencia de pronóstico a 1-2 horas basada en lo que se ve"
}

CÓMO ESTIMAR LA COBERTURA (cloud_coverage_pct), que es lo que más se equivoca: fíjate en
cuánto CIELO DESPEJADO queda visible (azul de día; oscuro limpio o estrellas de noche) y
resta.
- Capa gris o blanca continua que tapa casi todo, apenas se ve azul  -> 90-100, "overcast".
- Nubes dominan pero quedan claros de azul                            -> 60-90, "mostly_cloudy".
- Mitad nubes, mitad azul                                             -> 30-60, "partly_cloudy".
- Mayormente azul con nubes sueltas                                   -> 10-30, "partly_cloudy".
- Azul casi total                                                     ->  0-10, "clear".
El % y sky_condition DEBEN concordar. No tiendas por defecto a "partly_cloudy": ante una
capa continua sin huecos de azul, es "overcast", no parcial.

OJO CON EL ANOCHECER Y LA NOCHE: al atardecer una capa de nubes se ve GRIS OSCURA, AZUL
PLOMO o casi negra --eso es cielo CUBIERTO, no despejado; no confundas oscuridad con
cielo limpio--. Si de verdad es de noche y no distingues nubes, usa "night" e indica lo
que veas (luces, luna, estrellas).
"""

_USER_PROMPT_STATION_HEADER = """\

DATOS EN VIVO DE LA ESTACIÓN (medidos por sensores, no por la cámara):
{station_block}
Estos datos son la VERDAD MEDIDA y pesan más que tu impresión visual, sobre todo para
precipitación: la cámara puede no distinguir llovizna, un frente fuera de encuadre, o luz
que hace ver un cielo más despejado de lo que está. Reglas:
- Si `lluvia ahora` es mayor que 0 mm/h, está lloviendo YA, aunque no se vea con claridad
  en la imagen: pon `precipitation_visible: true`, `sky_condition` acorde ("rainy" o
  "stormy") y el `forecast_hint` NO puede decir algo como "sin cambios significativos" o
  "sin riesgo de lluvia" -- contradiría un hecho medido.
- Si en cambio la estación no reporta lluvia, básate normalmente en lo que ves.
- Usa el resto de los datos (viento, humedad, base de nubes) como contexto para el
  `forecast_hint`, no los repitas tal cual en la `description` -- la `description` es de
  lo que SE VE, el `forecast_hint` puede apoyarse en los sensores.
"""

_USER_PROMPT_FOOTER = """
Responde SOLO el JSON, sin explicaciones adicionales.
"""


def _build_station_block(station_data: Optional[dict]) -> str:
    """Formatea las lecturas en vivo relevantes para el prompt, en español y con
    unidades. Sólo incluye lo que llegó y aporta -- viento en calma o sin ráfaga no
    suma nada al análisis visual."""
    if not station_data:
        return ""
    partes = []
    rain_rate = station_data.get("rain_rate")
    if rain_rate is not None:
        partes.append(f"- lluvia ahora: {rain_rate:.1f} mm/h")
    rain_daily = station_data.get("rain_daily")
    if rain_daily is not None:
        partes.append(f"- lluvia acumulada hoy: {rain_daily:.1f} mm")
    temp = station_data.get("temperature_outdoor")
    humidity = station_data.get("humidity_outdoor")
    if temp is not None and humidity is not None:
        partes.append(f"- temperatura/humedad exterior: {temp:.1f} °C, {humidity:.0f} %")
    wind = station_data.get("wind_speed")
    gust = station_data.get("wind_gust")
    if wind is not None:
        extra = f" (ráfaga {gust:.1f} km/h)" if gust and gust > (wind or 0) else ""
        partes.append(f"- viento: {wind:.1f} km/h{extra}")
    cloud_base = station_data.get("cloud_base")
    if cloud_base is not None:
        partes.append(f"- base de nubes estimada: {cloud_base:.0f} m")
    if not partes:
        return ""
    return "\n".join(partes) + "\n"


def _build_user_prompt(station_data: Optional[dict] = None) -> str:
    bloque = _build_station_block(station_data)
    if not bloque:
        return _USER_PROMPT_BASE + _USER_PROMPT_FOOTER
    return (
        _USER_PROMPT_BASE
        + _USER_PROMPT_STATION_HEADER.format(station_block=bloque)
        + _USER_PROMPT_FOOTER
    )


@dataclass
class SkyAnalysis:
    """Resultado del análisis de una imagen del cielo."""
    cloud_type: str = "unknown"
    cloud_coverage_pct: int = 0
    sky_condition: str = "unknown"
    visibility: str = "unknown"
    precipitation_visible: bool = False
    development: str = "unknown"
    description: str = ""
    forecast_hint: str = ""
    analyzed_at: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


def _parse_json_response(text: str) -> dict:
    """Extrae JSON de la respuesta, manejando bloques de código y errores comunes."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        start = 1 if lines[0].strip() in ("```", "```json") else 1
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end]).strip()

    # Intentar parsear tal cual primero
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Limpiar problemas comunes de LLMs:
    # 1. Comentarios estilo // (Gemini a veces los agrega)
    import re
    cleaned = re.sub(r'//[^\n]*', '', text)
    # 2. Trailing commas antes de } o ]
    cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
    # 3. Comillas simples -> dobles (solo fuera de strings, aproximación)
    # Esto es imperfecto pero ayuda en casos simples
    if "'" in cleaned and '"' not in cleaned:
        cleaned = cleaned.replace("'", '"')

    return json.loads(cleaned)


# ─────────────────────────────────────────────────────────────────────────────
# Anthropic (Claude)
# ─────────────────────────────────────────────────────────────────────────────

async def _analyze_anthropic(
    image_data: bytes,
    api_key: str,
    model: str,
    timeout: float,
    station_data: Optional[dict] = None,
) -> SkyAnalysis:
    """Analiza usando Claude Vision (Anthropic)."""
    image_b64 = base64.standard_b64encode(image_data).decode("ascii")

    payload = {
        "model": model,
        "max_tokens": 1024,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": _build_user_prompt(station_data)},
                ],
            }
        ],
        "system": _SYSTEM_PROMPT,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=payload,
        )

    if resp.status_code != 200:
        logger.warning("Anthropic API error %d: %s", resp.status_code, resp.text[:200])
        return SkyAnalysis(error=f"API error: {resp.status_code}", provider="anthropic")

    data = resp.json()
    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text = block.get("text", "")
            break

    try:
        result = _parse_json_response(text)
    except json.JSONDecodeError as e:
        logger.warning("No se pudo parsear respuesta de Claude: %s", e)
        return SkyAnalysis(
            description=text[:500] if text else "Sin respuesta",
            error="Respuesta no es JSON válido",
            provider="anthropic",
            model=model,
        )

    return SkyAnalysis(
        cloud_type=result.get("cloud_type", "unknown"),
        cloud_coverage_pct=int(result.get("cloud_coverage_pct", 0)),
        sky_condition=result.get("sky_condition", "unknown"),
        visibility=result.get("visibility", "unknown"),
        precipitation_visible=bool(result.get("precipitation_visible", False)),
        development=result.get("development", "unknown"),
        description=result.get("description", ""),
        forecast_hint=result.get("forecast_hint", ""),
        analyzed_at=datetime.now(timezone.utc).isoformat(),
        provider="anthropic",
        model=model,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Google Gemini
# ─────────────────────────────────────────────────────────────────────────────

async def _analyze_gemini(
    image_data: bytes,
    api_key: str,
    model: str,
    timeout: float,
    station_data: Optional[dict] = None,
) -> SkyAnalysis:
    """Analiza usando Gemini Vision (Google)."""
    image_b64 = base64.standard_b64encode(image_data).decode("ascii")

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": f"{_SYSTEM_PROMPT}\n\n{_build_user_prompt(station_data)}"},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": image_b64,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1024,
        },
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            url,
            headers={"content-type": "application/json"},
            json=payload,
        )

    if resp.status_code != 200:
        logger.warning("Gemini API error %d: %s", resp.status_code, resp.text[:200])
        return SkyAnalysis(error=f"API error: {resp.status_code}", provider="gemini")

    data = resp.json()

    # Extraer texto de la respuesta de Gemini
    text = ""
    try:
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                if "text" in part:
                    text = part["text"]
                    break
    except (KeyError, IndexError) as e:
        logger.warning("Error extrayendo respuesta de Gemini: %s", e)
        return SkyAnalysis(error="Respuesta mal formada", provider="gemini", model=model)

    try:
        result = _parse_json_response(text)
    except json.JSONDecodeError as e:
        logger.warning("No se pudo parsear respuesta de Gemini: %s\nTexto raw: %s", e, text[:300])
        return SkyAnalysis(
            description=text[:500] if text else "Sin respuesta",
            error="Respuesta no es JSON válido",
            provider="gemini",
            model=model,
        )

    return SkyAnalysis(
        cloud_type=result.get("cloud_type", "unknown"),
        cloud_coverage_pct=int(result.get("cloud_coverage_pct", 0)),
        sky_condition=result.get("sky_condition", "unknown"),
        visibility=result.get("visibility", "unknown"),
        precipitation_visible=bool(result.get("precipitation_visible", False)),
        development=result.get("development", "unknown"),
        description=result.get("description", ""),
        forecast_hint=result.get("forecast_hint", ""),
        analyzed_at=datetime.now(timezone.utc).isoformat(),
        provider="gemini",
        model=model,
    )


# ─────────────────────────────────────────────────────────────────────────────
# API pública
# ─────────────────────────────────────────────────────────────────────────────

# Modelos por defecto para cada proveedor
DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "gemini": "gemini-flash-latest",
}


def _es_transitorio(error: str) -> bool:
    """Errores que vale la pena reintentar de inmediato: timeout, o el proveedor
    respondiendo que está saturado (5xx). Un 429 (cuota agotada) o un 4xx de
    verdad -- API key mala, request rechazada -- no se arreglan reintentando en
    el acto, así que se dejan pasar para el siguiente ciclo programado.
    """
    if error == "Timeout":
        return True
    if error.startswith("API error: "):
        try:
            code = int(error.rsplit(": ", 1)[1])
        except ValueError:
            return False
        return 500 <= code < 600
    return False


def resolve_provider(
    provider: Provider,
    anthropic_key: Optional[str],
    gemini_key: Optional[str],
) -> Optional[str]:
    """
    Determina qué proveedor usar.

    - "anthropic" o "gemini": usa ese si tiene key, None si no
    - "auto": prefiere Gemini (gratis), fallback a Anthropic
    """
    if provider == "anthropic":
        return "anthropic" if anthropic_key else None
    if provider == "gemini":
        return "gemini" if gemini_key else None
    # auto: prefiere Gemini (gratis)
    if gemini_key:
        return "gemini"
    if anthropic_key:
        return "anthropic"
    return None


async def analyze_sky(
    image_data: bytes,
    anthropic_api_key: Optional[str] = None,
    gemini_api_key: Optional[str] = None,
    provider: Provider = "auto",
    anthropic_model: Optional[str] = None,
    gemini_model: Optional[str] = None,
    timeout: float = 75.0,
    station_data: Optional[dict] = None,
    max_retries: int = 1,
) -> SkyAnalysis:
    """
    Analiza una imagen del cielo usando el proveedor configurado.

    Args:
        image_data: Bytes de la imagen JPEG
        anthropic_api_key: API key de Anthropic (opcional)
        gemini_api_key: API key de Google Gemini (opcional)
        provider: "auto" (default), "anthropic", o "gemini"
        anthropic_model: Modelo de Anthropic (default: claude-sonnet-4-20250514)
        gemini_model: Modelo de Gemini (default: gemini-2.0-flash)
        timeout: Timeout en segundos. Subido de 45 a 75 el 2026-08-26: con
            `gemini-flash-lite-latest` (nivel gratuito más ligero) el 82% de los
            fallos observados en 72h eran timeout, no error del proveedor -- la
            respuesta llegaba, sólo que tarde.
        station_data: lecturas en vivo de la estación (rain_rate, temperature_outdoor,
            etc. -- ver `_build_station_block`) para que el modelo no contradiga con el
            texto un dato ya medido, como lluvia cayendo que la imagen no deja ver clara.
        max_retries: reintentos ante error TRANSITORIO (timeout o 5xx del proveedor),
            con una pausa corta entre uno y otro. Un 429 (cuota agotada) o un 4xx real
            no se reintentan -- no se arreglan solos y sólo gastarían cuota de más.

    Returns:
        SkyAnalysis con los resultados del análisis
    """
    resolved = resolve_provider(provider, anthropic_api_key, gemini_api_key)

    if resolved is None:
        return SkyAnalysis(error="No hay API key configurada para el análisis")

    model = (anthropic_model or DEFAULT_MODELS["anthropic"]) if resolved == "anthropic" \
        else (gemini_model or DEFAULT_MODELS["gemini"])

    intentos = max(1, max_retries + 1)
    resultado: Optional[SkyAnalysis] = None
    for intento in range(intentos):
        try:
            if resolved == "anthropic":
                resultado = await _analyze_anthropic(image_data, anthropic_api_key, model, timeout, station_data)
            else:
                resultado = await _analyze_gemini(image_data, gemini_api_key, model, timeout, station_data)
        except httpx.TimeoutException:
            logger.warning("Timeout analizando imagen del cielo (%s), intento %d/%d", resolved, intento + 1, intentos)
            resultado = SkyAnalysis(error="Timeout", provider=resolved, model=model)
        except Exception as e:
            logger.error("Error analizando imagen del cielo (%s): %s", resolved, e)
            return SkyAnalysis(error=str(e)[:200], provider=resolved, model=model)

        if resultado.error is None or not _es_transitorio(resultado.error):
            return resultado
        if intento < intentos - 1:
            logger.info("Reintentando análisis del cielo (%s) tras: %s", resolved, resultado.error)
            await asyncio.sleep(3)

    return resultado


# ─────────────────────────────────────────────────────────────────────────────
# Utilidades para la UI
# ─────────────────────────────────────────────────────────────────────────────

SKY_CONDITION_ICONS = {
    "clear": "sun",
    "partly_cloudy": "cloud-sun",
    "mostly_cloudy": "cloud",
    "overcast": "clouds",
    "foggy": "smog",
    "rainy": "cloud-rain",
    "stormy": "cloud-bolt",
    "night": "moon",
    "unknown": "question",
}

SKY_CONDITION_ES = {
    "clear": "Despejado",
    "partly_cloudy": "Parcialmente nublado",
    "mostly_cloudy": "Mayormente nublado",
    "overcast": "Cubierto",
    "foggy": "Neblina",
    "rainy": "Lluvia",
    "stormy": "Tormenta",
    "night": "Noche",
    "unknown": "Desconocido",
}

CLOUD_TYPE_ES = {
    "cirrus": "Cirros",
    "cumulus": "Cúmulos",
    "stratus": "Estratos",
    "cumulonimbus": "Cumulonimbos",
    "altocumulus": "Altocúmulos",
    "stratocumulus": "Estratocúmulos",
    "nimbostratus": "Nimboestratos",
    "clear": "Despejado",
    "mixed": "Mixto",
    "unknown": "Desconocido",
}

VISIBILITY_ES = {
    "excellent": "Excelente",
    "good": "Buena",
    "moderate": "Moderada",
    "poor": "Pobre",
    "very_poor": "Muy pobre",
    "unknown": "Desconocida",
}

PROVIDER_INFO = {
    "anthropic": {
        "name": "Anthropic (Claude)",
        "models": [
            {"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4 (recomendado)"},
            {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5 (más económico)"},
        ],
        "free_tier": False,
        "pricing": "~$0.50-1.00/día con Sonnet",
    },
    "gemini": {
        "name": "Google Gemini",
        "models": [
            {"id": "gemini-flash-latest", "name": "Gemini Flash (recomendado)"},
            {"id": "gemini-pro-latest", "name": "Gemini Pro (mejor calidad)"},
            {"id": "gemini-flash-lite-latest", "name": "Gemini Flash Lite (más rápido)"},
        ],
        "free_tier": True,
        "pricing": "Gratis hasta 15 req/min, 1M tokens/día",
    },
}
