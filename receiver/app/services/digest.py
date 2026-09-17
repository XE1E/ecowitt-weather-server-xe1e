"""
Resumen semanal por correo: récords de la semana, comparación con la semana
anterior y la mejor foto. Reutiliza el mismo canal SMTP que las alertas
(`AlertService._send_email`, ver `send_digest` ahí) -- opt-in propio
(`email_digest_enabled`), independiente de `email_enabled`: alguien puede
querer alertas sin el resumen semanal, o viceversa, aunque comparten
servidor/destinatarios/remitente.

Todo lo de aquí es PURO (recibe filas ya obtenidas, no toca InfluxDB/red):
quien orquesta (main.py) decide qué semana pedir y qué foto adjuntar, esto
solo arma el texto y decide si toca enviar. Así se puede probar sin
depender de InfluxDB ni de un reloj real.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional


def _num(row: Dict[str, Any], field: str) -> Optional[float]:
    v = row.get(field)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _extreme(rows: List[Dict[str, Any]], field: str, pick_max: bool) -> tuple:
    """(valor, fecha) del extremo de `field` entre las filas, o (None, None)."""
    best_v, best_d = None, None
    for r in rows:
        v = _num(r, field)
        if v is None:
            continue
        if best_v is None or (v > best_v if pick_max else v < best_v):
            best_v, best_d = v, r.get("date")
    return best_v, best_d


def _sum(rows: List[Dict[str, Any]], field: str) -> Optional[float]:
    vals = [_num(r, field) for r in rows]
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else None


def _avg(rows: List[Dict[str, Any]], field: str) -> Optional[float]:
    vals = [_num(r, field) for r in rows]
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def week_id(d: date) -> str:
    """Identificador ISO de semana ("2026-W38"), para no mandar el mismo resumen
    dos veces (p. ej. si el receiver se reinicia el mismo día programado)."""
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def is_due(now: datetime, weekday: int, hour: int, last_sent_week: Optional[str]) -> bool:
    """
    ¿Toca mandar el resumen? `now` en hora LOCAL (la resuelve quien llama).
    `weekday`: 0=lunes...6=domingo (como `date.weekday()`). `hour`: hora local
    a partir de la cual se considera "ya es hora" (se revisa cada hora desde
    main.py, así que basta con `>=`, no hace falta exactitud al minuto).
    """
    if now.weekday() != weekday or now.hour < hour:
        return False
    return week_id(now.date()) != last_sent_week


def build_weekly_digest(
    week_rows: List[Dict[str, Any]],
    prev_week_rows: List[Dict[str, Any]],
    week_start: str,
    week_end: str,
    best_photo_date: Optional[str] = None,
    site_url: str = "https://clima.xe1e.net",
) -> Dict[str, str]:
    """Arma `{"subject": ..., "body": ...}` en texto plano, en métrico (mismo
    criterio que los mensajes de alertas: sin preferencia de unidad por
    destinatario, no hay perfil de usuario en un correo)."""
    subject = f"Resumen semanal — Estación Clima XE1E ({week_start} al {week_end})"

    if not week_rows:
        body = (
            f"Semana del {week_start} al {week_end}: sin datos registrados "
            "(estación nueva o caída toda la semana).\n\n"
            f"Ver el detalle en {site_url}/pro/historia\n"
        )
        return {"subject": subject, "body": body}

    tmax_v, tmax_d = _extreme(week_rows, "temp_max", True)
    tmin_v, tmin_d = _extreme(week_rows, "temp_min", False)
    gust_v, gust_d = _extreme(week_rows, "gust_max", True)
    rain_total = _sum(week_rows, "rain_total") or 0.0
    temp_avg = _avg(week_rows, "temp_avg")

    prev_rain_total = _sum(prev_week_rows, "rain_total")
    prev_temp_avg = _avg(prev_week_rows, "temp_avg")

    def fmt(v: Optional[float], d: Optional[str], unit: str) -> str:
        if v is None:
            return "sin dato"
        return f"{v:.1f} {unit}" + (f" (el {d})" if d else "")

    lines = [
        f"Resumen semanal de la Estación Clima XE1E — {week_start} al {week_end}",
        "",
        f"Máxima: {fmt(tmax_v, tmax_d, '°C')}",
        f"Mínima: {fmt(tmin_v, tmin_d, '°C')}",
        f"Racha máxima de viento: {fmt(gust_v, gust_d, 'km/h')}",
        f"Lluvia acumulada: {rain_total:.1f} mm",
    ]

    if temp_avg is not None:
        extra = ""
        if prev_temp_avg is not None:
            delta = temp_avg - prev_temp_avg
            extra = f" ({'+' if delta >= 0 else ''}{delta:.1f} °C vs la semana anterior)"
        lines.append(f"Temperatura promedio: {temp_avg:.1f} °C{extra}")

    if prev_rain_total is not None:
        delta_r = rain_total - prev_rain_total
        lines.append(f"Lluvia vs semana anterior: {'+' if delta_r >= 0 else ''}{delta_r:.1f} mm")

    lines.append("")
    if best_photo_date:
        lines.append(f"Mejor foto de la semana ({best_photo_date}): {site_url}/api/camera/best/{best_photo_date}.jpg")
        lines.append("")
    lines.append(f"Ver el detalle completo en {site_url}/pro/historia")

    return {"subject": subject, "body": "\n".join(lines) + "\n"}


def week_range(today: date) -> tuple:
    """
    Últimas 7 fechas LOCALES completas antes de HOY (nunca hoy: su resumen diario
    todavía no existe, lo escribe el rollup al cerrar el día -- mismo criterio que
    `/api/summaries/daily`), de más antigua a más reciente.
    """
    days = [(today - timedelta(days=i)).isoformat() for i in range(7, 0, -1)]
    return days[0], days[-1], days
