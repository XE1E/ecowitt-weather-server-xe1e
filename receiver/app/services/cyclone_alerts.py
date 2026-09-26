"""
Notificaciones de ciclones tropicales (Telegram/correo, categoría "cyclone").

Se avisa de CAMBIOS, no del estado: la tarea corre cada 10 min y sólo manda
mensaje cuando, para una tormenta cerca de México (nivel media/alta):
  - empieza a acercarse o pasa a amenaza;
  - se intensifica (se vuelve huracán o sube de categoría);
  - el pronóstico empieza a llevarla a tocar tierra;
  - se emiten vigilancias/avisos nuevos en costa mexicana;
  - deja de amenazar (o se disipa).

El estado de lo ya avisado se guarda en disco: sin eso, cada deploy (que reinicia
el receiver) volvería a mandar "Polo amenaza a México".
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
    _MX = ZoneInfo("America/Mexico_City")
except Exception:  # pragma: no cover
    _MX = None

logger = logging.getLogger(__name__)

_ORDEN = {"baja": 0, "media": 1, "alta": 2}


def _hora(iso: Optional[str]) -> str:
    if not iso:
        return ""
    try:
        dt = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if _MX:
            dt = dt.astimezone(_MX)
    except ValueError:
        return ""
    dias = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
    return f"{dias[dt.weekday()]} {dt.day} a las {dt:%H:%M}"


def etiqueta(t: Dict[str, Any]) -> str:
    return f"{t['tipo']} cat. {t['categoria']} {t['nombre']}" if t.get("categoria") else f"{t['tipo']} {t['nombre']}"


def frase(t: Dict[str, Any]) -> str:
    """Misma frase que la página (cyclones.ts: fraseAmenaza), en corto."""
    if t["ahora"].get("sobre_tierra"):
        return f"está sobre territorio mexicano, cerca de {t['ahora']['lugar']}"
    tt = t.get("toca_tierra")
    if tt:
        cuando = f" el {_hora(tt.get('hora'))}" if tt.get("hora") else ""
        return f"el pronóstico lo lleva a tocar tierra cerca de {tt['lugar']}{cuando}"
    a = t["acercamiento"]
    cuando = f" el {_hora(a.get('hora'))}" if a.get("hora") else ""
    return f"se pronostica que pase a unos {a['km_costa']:,} km de {a['lugar']}{cuando}"


def _intensidad(t: Dict[str, Any]) -> int:
    """Escalón comparable: 0 depresión, 1 tormenta, 2..6 huracán cat. 1..5."""
    if t.get("categoria"):
        return 1 + int(t["categoria"])
    return 1 if t.get("clase") in ("TS", "STS", "SS") else 0


def _zonas_mx(t: Dict[str, Any]) -> List[Tuple[str, str]]:
    out = []
    for v in (t.get("avisos") or {}).get("vigentes", []):
        for z in v.get("zonas", []):
            if z.get("mexico"):
                out.append((v["tipo"], z["zona"]))
    return sorted(set(out))


def eventos(previo: Dict[str, Any], tormentas: List[Dict[str, Any]]) -> Tuple[List[str], Dict[str, Any]]:
    """(mensajes a enviar, estado nuevo). Pura: sin red ni disco, para probarla."""
    msgs: List[str] = []
    nuevo: Dict[str, Any] = {}
    for t in tormentas:
        sid = t["id"]
        p = previo.get(sid, {})
        nivel = t["nivel"]
        n_prev = p.get("nivel", "baja")
        inten = _intensidad(t)
        zonas = _zonas_mx(t)
        toca = bool(t.get("toca_tierra") or t["ahora"].get("sobre_tierra"))
        viento = f" · {t['viento_kmh']} km/h" if t.get("viento_kmh") else ""

        if _ORDEN[nivel] > _ORDEN[n_prev]:
            titulo = "AMENAZA A MÉXICO" if nivel == "alta" else "se acerca a México"
            msgs.append(f"🌀 {etiqueta(t)} {titulo}{viento}: {frase(t)}.")
        elif nivel != "baja":
            if p and inten > p.get("intensidad", inten):
                ahora = f"{t['tipo'].lower()} cat. {t['categoria']}" if t.get("categoria") else t["tipo"].lower()
                msgs.append(f"🌀 {t['nombre']} se intensificó: ahora es {ahora}{viento}. {frase(t)[0].upper()}{frase(t)[1:]}.")
            if toca and not p.get("toca", False):
                msgs.append(f"🌀 {etiqueta(t)}: {frase(t)}.")
        elif _ORDEN[nivel] < _ORDEN[n_prev]:
            msgs.append(f"✅ {etiqueta(t)} ya no amenaza a México: {frase(t)}.")

        nuevas = [z for z in zonas if z not in [tuple(x) for x in p.get("zonas", [])]]
        if nuevas:
            por_tipo: Dict[str, List[str]] = {}
            for tipo, zona in nuevas:
                por_tipo.setdefault(tipo, []).append(zona)
            partes = "; ".join(f"{tipo}: {', '.join(zs)}" for tipo, zs in por_tipo.items())
            msgs.append(f"⚠️ {t['nombre']} — nuevas vigilancias/avisos en México. {partes}. Sigue el aviso oficial del SMN.")

        nuevo[sid] = {"nivel": nivel, "intensidad": inten, "toca": toca, "zonas": zonas, "nombre": t["nombre"]}

    # Tormentas que estaban cerca y ya no aparecen (se disiparon o salieron).
    for sid, p in previo.items():
        if sid not in nuevo and p.get("nivel", "baja") != "baja":
            msgs.append(f"✅ {p.get('nombre', sid)} ya no está activo (se disipó o dejó de ser ciclón tropical).")
    return msgs, nuevo


def cargar(path: str) -> Dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        logger.warning("Estado de alertas de ciclones ilegible (%s); se empieza de cero", e)
        return {}


def guardar(path: str, estado: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(estado, f, ensure_ascii=False)
    os.replace(tmp, path)
