"""
Resumen en español de la discusión técnica del NHC (Tropical Cyclone Discussion,
en inglés) con la misma IA del análisis del cielo (Gemini).

Sólo para tormentas cerca de México (nivel media/alta) y una sola llamada por
discusión: el NHC publica una nueva cada 6 h (a veces 3 h), así que el costo es
de unas pocas llamadas al día. La genera cyclone_watch_task (routers/external.py);
/api/ciclones sólo la lee, nunca llama a la IA en el camino de una petición.

Los resúmenes se guardan en disco (`resumenes.json` en cyclone_dir) para que un
deploy no vuelva a gastar llamadas ni deje la página sin resumen.
"""
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_PROMPT = """Eres meteorólogo y explicas a público general en México. Abajo va la discusión \
técnica del Centro Nacional de Huracanes (NHC) de Estados Unidos, en inglés.

Escribe un resumen en español de México de 3 a 5 frases (máximo 110 palabras), en texto \
plano, sin viñetas, títulos ni markdown, que diga:
- qué está haciendo el ciclón ahora (intensidad y por qué cambió, si el texto lo dice);
- qué esperan los pronosticadores de su intensidad y de su trayectoria en los próximos días, \
y cuánta confianza o incertidumbre expresan;
- lo que implica para México, si el texto lo menciona.

Reglas:
- Usa sólo lo que dice el texto: no inventes datos ni agregues consejos.
- Convierte nudos a km/h (1 nudo = 1.852 km/h) y redondea a la decena.
- No uses horas UTC/MST ni coordenadas: di días ("el lunes") o plazos ("en dos días").
- No nombres modelos numéricos (GFS, HCCA, ECMWF…): di "algunos modelos".
- Categoría 3 o más es "huracán mayor".

Discusión del NHC:
"""

_TTL_FALLO = 1800          # tras un fallo, esperar 30 min antes de reintentar esa tormenta
_fallos: Dict[str, float] = {}
_cache: Optional[Dict[str, Any]] = None   # contenido de resumenes.json en memoria


def _ruta(directorio: str) -> str:
    return os.path.join(directorio, "resumenes.json")


def leer_todos(directorio: str) -> Dict[str, Any]:
    global _cache
    if _cache is None:
        try:
            with open(_ruta(directorio), encoding="utf-8") as f:
                _cache = json.load(f)
        except FileNotFoundError:
            _cache = {}
        except Exception as e:
            logger.warning("resumenes.json ilegible (%s); se empieza de cero", e)
            _cache = {}
    return _cache


def leer(directorio: str, atcf: str) -> Optional[Dict[str, Any]]:
    return leer_todos(directorio).get(atcf)


def _guardar(directorio: str, datos: Dict[str, Any]) -> None:
    os.makedirs(directorio, exist_ok=True)
    tmp = _ruta(directorio) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False)
    os.replace(tmp, _ruta(directorio))


def numero_discusion(texto: str) -> Optional[int]:
    """'Hurricane Polo Discussion Number  22' -> 22."""
    m = re.search(r"Discussion Number\s+(\d+)", texto, re.I)
    return int(m.group(1)) if m else None


def limpiar(texto: str) -> str:
    """Quita la firma del pronosticador (lo que sigue a '$$'): sólo ruido para el modelo."""
    t = texto.split("$$")[0]
    return t.strip()


async def _gemini(texto: str, api_key: str, model: str, timeout: float = 45) -> str:
    """Texto del resumen, o excepción (httpx / ValueError) si no hay uno válido."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": _PROMPT + limpiar(texto)}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024},
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(url, params={"key": api_key}, json=payload)
    r.raise_for_status()
    partes = ((r.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    out = " ".join(p.get("text", "") for p in partes).strip()
    out = re.sub(r"[*#_`]+", "", out)          # por si se cuela markdown
    out = re.sub(r"\s*\n\s*", " ", out).strip()
    if not out or len(out) > 1500:
        raise ValueError(f"respuesta inválida ({len(out)} caracteres)")
    return out


async def generar(texto: str, api_key: str, model: str, reintentos: int = 2) -> str:
    """Como _gemini pero reintenta errores transitorios (timeout o 5xx)."""
    for intento in range(reintentos + 1):
        try:
            return await _gemini(texto, api_key, model)
        except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
            transitorio = isinstance(e, httpx.TimeoutException) or e.response.status_code >= 500
            if not transitorio or intento == reintentos:
                raise
            await asyncio.sleep(2 ** (intento + 2))
    raise RuntimeError("inalcanzable")


async def actualizar(directorio: str, tormentas: list, obtener_texto, api_key: str, model: str) -> int:
    """Genera el resumen de cada tormenta cercana cuya discusión sea nueva.

    `obtener_texto(url)` devuelve el texto del producto (nhc._texto). Regresa
    cuántos resúmenes se generaron."""
    datos = leer_todos(directorio)
    nuevos = 0
    for t in tormentas:
        sid, url, num = t["id"], t.get("discusion_url"), t.get("discusion_num")
        if t.get("nivel") == "baja" or not url or not num:
            continue
        try:
            num = int(num)
        except (TypeError, ValueError):
            continue
        if (datos.get(sid) or {}).get("discusion_num") == num:
            continue
        if time.time() - _fallos.get(sid, 0) < _TTL_FALLO:
            continue
        texto = await obtener_texto(url)
        # La página del NHC a veces tarda unos minutos más que CurrentStorms.json:
        # si todavía trae la discusión anterior, se intenta en la siguiente vuelta.
        if not texto or numero_discusion(texto) != num:
            continue
        try:
            resumen = await generar(texto, api_key, model)
        except Exception as e:
            _fallos[sid] = time.time()
            logger.warning("Resumen IA de %s (discusión %d) falló: %s", sid, num, str(e)[:200])
            continue
        datos[sid] = {
            "discusion_num": num,
            "resumen": resumen,
            "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "modelo": model,
        }
        nuevos += 1
        logger.info("Resumen IA de %s (discusión %d) generado con %s", sid, num, model)
    if nuevos:
        # Sólo se conservan las tormentas activas: el archivo no crece sin fin.
        activos = {t["id"] for t in tormentas}
        for sid in [s for s in datos if s not in activos]:
            del datos[sid]
        _guardar(directorio, datos)
    return nuevos
