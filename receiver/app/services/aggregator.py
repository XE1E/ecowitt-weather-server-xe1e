"""
Acumuladores / resumen diario ("Dayfile", idea de WeeWX y CumulusMX).

Mantiene un registro por día en el measurement 'weather_daily' con los
extremos y promedios de la jornada (más la hora del extremo). Esto:
  - hace rápidas las consultas de récords y climatología (no re-escanear el crudo),
  - habilita "récords de siempre", reportes mensuales/anuales y "en este día".

El día se define en HORA LOCAL (America/Mexico_City), coherente con el
contador rain_daily de la consola Ecowitt, que se reinicia a medianoche local.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
import logging

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo("America/Mexico_City")
except Exception:  # pragma: no cover
    _TZ = timezone(timedelta(hours=-6))

logger = logging.getLogger(__name__)


def local_day_bounds_utc(day: "datetime") -> Tuple[str, str, datetime]:
    """
    Dado un date/datetime (se usa solo la fecha), devuelve:
      (inicio_utc_iso, fin_utc_iso, inicio_utc_datetime)
    para el día LOCAL correspondiente. Los ISO llevan sufijo 'Z' para Flux.
    """
    start_local = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=_TZ)
    end_local = start_local + timedelta(days=1)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return start_utc.strftime(fmt), end_utc.strftime(fmt), start_utc


def flatten_stats(stats: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convierte la estructura de get_daily_stats() en campos planos del resumen.
    Solo incluye lo que tenga valor.
    """
    s = stats.get("stats", stats) if stats else {}

    def g(field, key):
        return (s.get(field) or {}).get(key)

    out: Dict[str, Any] = {
        "temp_min": g("temperature_outdoor", "min"),
        "temp_max": g("temperature_outdoor", "max"),
        "temp_avg": g("temperature_outdoor", "avg"),
        "temp_min_time": g("temperature_outdoor", "min_time"),
        "temp_max_time": g("temperature_outdoor", "max_time"),
        "hum_min": g("humidity_outdoor", "min"),
        "hum_max": g("humidity_outdoor", "max"),
        "hum_avg": g("humidity_outdoor", "avg"),
        "wind_avg": g("wind_speed", "avg"),
        "wind_max": g("wind_speed", "max"),
        "gust_max": g("wind_gust", "max"),
        "gust_max_time": g("wind_gust", "max_time"),
        "rain_total": g("rain_daily", "max"),
        "press_min": g("pressure_relative", "min"),
        "press_max": g("pressure_relative", "max"),
        "press_avg": g("pressure_relative", "avg"),
    }
    return {k: v for k, v in out.items() if v is not None}


def all_time_records(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calcula récords de siempre a partir de los resúmenes diarios.
    Cada récord incluye valor y fecha (YYYY-MM-DD) en que ocurrió.
    """
    def best(field, pick_max=True):
        cand = [(r.get(field), r.get("date")) for r in rows if r.get(field) is not None]
        if not cand:
            return None
        val, date = (max if pick_max else min)(cand, key=lambda x: x[0])
        return {"value": round(val, 1), "date": date}

    return {
        "temp_max": best("temp_max", True),
        "temp_min": best("temp_min", False),
        "gust_max": best("gust_max", True),
        "wind_max": best("wind_max", True),
        "rain_max_day": best("rain_total", True),
        "press_max": best("press_max", True),
        "press_min": best("press_min", False),
        "hum_max": best("hum_max", True),
        "hum_min": best("hum_min", False),
        "days": len(rows),
    }


# Base para grados-día (°C). Estándar NOAA: 65 °F = 18.3 °C.
BASE_DD = 18.3
# Umbral para contar un "día con lluvia" (mm). NOAA usa 0.01 in ≈ 0.254 mm.
RAIN_DAY_MM = 0.2


def _month_of(date_str: str) -> Optional[int]:
    try:
        return int(date_str[5:7])
    except (ValueError, IndexError):
        return None


def _best(rows, field, pick_max=True):
    cand = [(r.get(field), r.get("date")) for r in rows if r.get(field) is not None]
    if not cand:
        return None
    val, date = (max if pick_max else min)(cand, key=lambda x: x[0])
    return {"value": round(val, 1), "date": date}


def period_summary(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Resumen agregado de un conjunto de días (mes, año, etc.)."""
    if not rows:
        return {"days": 0}
    means = [r["temp_avg"] for r in rows if r.get("temp_avg") is not None]
    rain_vals = [r.get("rain_total") or 0.0 for r in rows]
    wind_avgs = [r["wind_avg"] for r in rows if r.get("wind_avg") is not None]
    hdd = sum(max(0.0, BASE_DD - r["temp_avg"]) for r in rows if r.get("temp_avg") is not None)
    cdd = sum(max(0.0, r["temp_avg"] - BASE_DD) for r in rows if r.get("temp_avg") is not None)
    return {
        "days": len(rows),
        "mean_temp": round(sum(means) / len(means), 1) if means else None,
        "high": _best(rows, "temp_max", True),
        "low": _best(rows, "temp_min", False),
        "rain_total": round(sum(rain_vals), 1),
        "rain_max_day": _best(rows, "rain_total", True),
        "rain_days": sum(1 for v in rain_vals if v >= RAIN_DAY_MM),
        "wind_avg": round(sum(wind_avgs) / len(wind_avgs), 1) if wind_avgs else None,
        "wind_max": _best(rows, "wind_max", True),
        "gust_max": _best(rows, "gust_max", True),
        "hdd": round(hdd, 1),
        "cdd": round(cdd, 1),
    }


def monthly_records(rows: List[Dict[str, Any]]) -> Dict[int, Any]:
    """Récords por mes calendario (p. ej. 'el julio más caluroso de siempre')."""
    out: Dict[int, Any] = {}
    for m in range(1, 13):
        mrows = [r for r in rows if _month_of(str(r.get("date", ""))) == m]
        if not mrows:
            continue
        out[m] = {
            "temp_max": _best(mrows, "temp_max", True),
            "temp_min": _best(mrows, "temp_min", False),
            "rain_max_day": _best(mrows, "rain_total", True),
            "gust_max": _best(mrows, "gust_max", True),
        }
    return out


def noaa_month(rows: List[Dict[str, Any]], year: int, month: int) -> Dict[str, Any]:
    """Reporte climatológico mensual estilo NOAA: una fila por día + resumen."""
    prefix = f"{year:04d}-{month:02d}"
    days = sorted((r for r in rows if str(r.get("date", "")).startswith(prefix)),
                  key=lambda r: r.get("date", ""))
    per_day = []
    for r in days:
        ta = r.get("temp_avg")
        per_day.append({
            "date": r.get("date"),
            "mean_temp": ta,
            "high": r.get("temp_max"), "high_time": r.get("temp_max_time"),
            "low": r.get("temp_min"), "low_time": r.get("temp_min_time"),
            "hdd": round(max(0.0, BASE_DD - ta), 1) if ta is not None else None,
            "cdd": round(max(0.0, ta - BASE_DD), 1) if ta is not None else None,
            "rain": r.get("rain_total"),
            "wind_avg": r.get("wind_avg"),
            "gust_max": r.get("gust_max"), "gust_time": r.get("gust_max_time"),
        })
    return {"scope": "month", "year": year, "month": month,
            "days": per_day, "summary": period_summary(days)}


def noaa_year(rows: List[Dict[str, Any]], year: int) -> Dict[str, Any]:
    """Reporte climatológico anual estilo NOAA: una fila por mes + resumen."""
    prefix = f"{year:04d}-"
    year_rows = [r for r in rows if str(r.get("date", "")).startswith(prefix)]
    months = []
    for m in range(1, 13):
        mrows = [r for r in year_rows if _month_of(str(r.get("date", ""))) == m]
        if mrows:
            months.append({"month": m, **period_summary(mrows)})
    return {"scope": "year", "year": year,
            "months": months, "summary": period_summary(year_rows)}


def on_this_day(rows: List[Dict[str, Any]], today: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Efeméride: qué pasó el mismo día calendario (MM-DD) en AÑOS PREVIOS.
    Devuelve los días coincidentes (más reciente primero) y los extremos entre ellos.
    """
    today = today or datetime.now(_TZ)
    md = today.strftime("%m-%d")
    this_year = today.strftime("%Y")
    matches = [
        r for r in rows
        if str(r.get("date", ""))[5:] == md and str(r.get("date", ""))[:4] != this_year
    ]
    matches.sort(key=lambda r: r.get("date", ""), reverse=True)
    return {
        "month_day": md,
        "years": matches,
        "count": len(matches),
        "warmest": _best(matches, "temp_max", True),
        "coldest": _best(matches, "temp_min", False),
        "wettest": _best(matches, "rain_total", True),
    }


def build_records(rows: List[Dict[str, Any]], today: Optional[datetime] = None) -> Dict[str, Any]:
    """Paquete de récords: de siempre, por mes, este mes, este año y ayer."""
    today = today or datetime.now(_TZ)
    ym = today.strftime("%Y-%m")
    y = today.strftime("%Y")
    yest = (today - timedelta(days=1)).strftime("%Y-%m-%d")
    this_month = [r for r in rows if str(r.get("date", "")).startswith(ym)]
    this_year = [r for r in rows if str(r.get("date", "")).startswith(y)]
    yesterday = next((r for r in rows if r.get("date") == yest), None)
    return {
        "all_time": all_time_records(rows),
        "monthly": monthly_records(rows),
        "this_month": period_summary(this_month),
        "this_year": period_summary(this_year),
        "yesterday": yesterday,
    }


async def compute_and_store_day(storage, day: datetime) -> Optional[Dict[str, Any]]:
    """Calcula el resumen de un día local y lo guarda en weather_daily."""
    start_iso, stop_iso, ts_utc = local_day_bounds_utc(day)
    stats = await storage.get_daily_stats(start=start_iso, stop=stop_iso)
    fields = flatten_stats(stats)
    if not fields:
        return None
    date_str = day.strftime("%Y-%m-%d")
    await storage.write_daily_summary(date_str, fields, ts_utc)
    return {"date": date_str, **fields}


async def backfill(storage, days: int = 90) -> int:
    """
    Rellena los resúmenes de los últimos `days` días locales que falten.
    Hoy y ayer se recalculan siempre (pueden estar incompletos).
    Devuelve cuántos días se (re)escribieron.
    """
    today = datetime.now(_TZ)
    existing = {r.get("date") for r in await storage.query_daily_summaries(start=f"-{days + 2}d")}
    written = 0
    for i in range(days):
        day = today - timedelta(days=i)
        date_str = day.strftime("%Y-%m-%d")
        if date_str in existing and i > 1:
            continue  # ya existe y no es hoy/ayer
        try:
            if await compute_and_store_day(storage, day):
                written += 1
        except Exception as e:
            logger.error(f"Backfill {date_str} falló: {e}")
    if written:
        logger.info(f"Resumen diario: {written} día(s) (re)calculados")
    return written
