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
import math

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
        "rain_rate_max": g("rain_rate", "max"),
        "press_min": g("pressure_relative", "min"),
        "press_max": g("pressure_relative", "max"),
        "press_avg": g("pressure_relative", "avg"),
        "dew_avg": g("dew_point", "avg"),
        "uv_max": g("uv_index", "max"),
        "solar_max": g("solar_radiation", "max"),
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
# Umbrales del "season tracker" adaptados a CDMX (Benito Juárez, altiplano
# subtropical): rara vez hiela y casi nunca ≥30 °C, así que en vez de días
# tropicales/de helada usamos días cálidos y noches frescas.
WARM_DAY_C = 25.0    # día cálido: temperatura máxima ≥ 25 °C
COOL_NIGHT_C = 10.0  # noche fresca: temperatura mínima ≤ 10 °C


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


def _day_of_year(date_str: str) -> Optional[int]:
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d").timetuple().tm_yday
    except (ValueError, TypeError):
        return None


def et0_hargreaves(tmin: float, tmax: float, tmean: float, lat_deg: float, doy: int) -> float:
    """
    Evapotranspiración de referencia (ET0) diaria en mm, método Hargreaves.
    Usa solo temperaturas + radiación extraterrestre (calculada por latitud y día
    del año), así que no necesita medir radiación solar.
    """
    if tmax is None or tmin is None or tmean is None or doy is None:
        return 0.0
    dt = max(0.0, tmax - tmin)
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365)
    dec = 0.409 * math.sin(2 * math.pi * doy / 365 - 1.39)
    x = -math.tan(phi) * math.tan(dec)
    x = max(-1.0, min(1.0, x))
    ws = math.acos(x)
    # Radiación extraterrestre Ra (MJ/m²/día); Gsc = 0.0820 MJ/m²/min
    ra = (24 * 60 / math.pi) * 0.0820 * dr * (
        ws * math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.sin(ws)
    )
    ra_mm = 0.408 * ra  # equivalente de evaporación en mm/día
    return max(0.0, 0.0023 * (tmean + 17.8) * math.sqrt(dt) * ra_mm)


def daily_et0(row: Dict[str, Any], lat: float) -> Optional[float]:
    doy = _day_of_year(str(row.get("date", "")))
    if doy is None or row.get("temp_avg") is None or row.get("temp_max") is None or row.get("temp_min") is None:
        return None
    return round(et0_hargreaves(row["temp_min"], row["temp_max"], row["temp_avg"], lat, doy), 2)


def vector_mean_dir(rows: List[Dict[str, Any]], dir_key: str = "wind_direction",
                    weight_key: Optional[str] = "wind_speed") -> Optional[float]:
    """Dirección dominante (media vectorial de rumbos, opcionalmente ponderada)."""
    sx = sy = 0.0
    n = 0
    for r in rows:
        d = r.get(dir_key)
        if d is None:
            continue
        w = (r.get(weight_key) if weight_key else None) or 1.0
        rad = math.radians(d)
        sx += w * math.sin(rad)
        sy += w * math.cos(rad)
        n += 1
    if n == 0 or (sx == 0 and sy == 0):
        return None
    return round((math.degrees(math.atan2(sx, sy)) + 360) % 360, 0)


def _avg(rows, key):
    vals = [r[key] for r in rows if r.get(key) is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def period_summary(rows: List[Dict[str, Any]], lat: Optional[float] = None) -> Dict[str, Any]:
    """Resumen agregado de un conjunto de días (mes, año, etc.)."""
    if not rows:
        return {"days": 0}
    means = [r["temp_avg"] for r in rows if r.get("temp_avg") is not None]
    rain_vals = [r.get("rain_total") or 0.0 for r in rows]
    wind_avgs = [r["wind_avg"] for r in rows if r.get("wind_avg") is not None]
    hdd = sum(max(0.0, BASE_DD - r["temp_avg"]) for r in rows if r.get("temp_avg") is not None)
    cdd = sum(max(0.0, r["temp_avg"] - BASE_DD) for r in rows if r.get("temp_avg") is not None)
    out = {
        "days": len(rows),
        "mean_temp": round(sum(means) / len(means), 1) if means else None,
        "high": _best(rows, "temp_max", True),
        "low": _best(rows, "temp_min", False),
        "rain_total": round(sum(rain_vals), 1),
        "rain_max_day": _best(rows, "rain_total", True),
        "rain_rate_max": _best(rows, "rain_rate_max", True),
        "rain_days": sum(1 for v in rain_vals if v >= RAIN_DAY_MM),
        "wind_avg": round(sum(wind_avgs) / len(wind_avgs), 1) if wind_avgs else None,
        "wind_max": _best(rows, "wind_max", True),
        "gust_max": _best(rows, "gust_max", True),
        "wind_dir": vector_mean_dir(rows, "wind_dir", "wind_max"),
        "hum_avg": _avg(rows, "hum_avg"),
        "hum_max": (lambda v: max(v) if v else None)([r["hum_max"] for r in rows if r.get("hum_max") is not None]),
        "hum_min": (lambda v: min(v) if v else None)([r["hum_min"] for r in rows if r.get("hum_min") is not None]),
        "dew_avg": _avg(rows, "dew_avg"),
        "press_avg": _avg(rows, "press_avg"),
        "uv_max": (lambda v: max(v) if v else None)([r["uv_max"] for r in rows if r.get("uv_max") is not None]),
        "solar_max": (lambda v: max(v) if v else None)([r["solar_max"] for r in rows if r.get("solar_max") is not None]),
        "hdd": round(hdd, 1),
        "cdd": round(cdd, 1),
    }
    if lat is not None:
        ets = [daily_et0(r, lat) for r in rows]
        ets = [e for e in ets if e is not None]
        out["et_total"] = round(sum(ets), 1) if ets else None
    return out


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


def noaa_month(rows: List[Dict[str, Any]], year: int, month: int, lat: Optional[float] = None) -> Dict[str, Any]:
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
            "rain_rate_max": r.get("rain_rate_max"),
            "wind_avg": r.get("wind_avg"),
            "gust_max": r.get("gust_max"), "gust_time": r.get("gust_max_time"),
            "wind_dir": r.get("wind_dir"),
            "hum_min": r.get("hum_min"), "hum_max": r.get("hum_max"), "hum_avg": r.get("hum_avg"),
            "press_min": r.get("press_min"), "press_max": r.get("press_max"), "press_avg": r.get("press_avg"),
            "dew_avg": r.get("dew_avg"), "uv_max": r.get("uv_max"), "solar_max": r.get("solar_max"),
            "et": daily_et0(r, lat) if lat is not None else None,
        })
    return {"scope": "month", "year": year, "month": month,
            "days": per_day, "summary": period_summary(days, lat)}


def noaa_year(rows: List[Dict[str, Any]], year: int, lat: Optional[float] = None) -> Dict[str, Any]:
    """Reporte climatológico anual estilo NOAA: una fila por mes + resumen."""
    prefix = f"{year:04d}-"
    year_rows = [r for r in rows if str(r.get("date", "")).startswith(prefix)]
    months = []
    for m in range(1, 13):
        mrows = [r for r in year_rows if _month_of(str(r.get("date", ""))) == m]
        if mrows:
            months.append({"month": m, **period_summary(mrows, lat)})
    return {"scope": "year", "year": year, "months": months,
            "summary": period_summary(year_rows, lat),
            "season": season_tracker(year_rows)}


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


def _topn(rows: List[Dict[str, Any]], field: Optional[str], pick_max: bool = True,
          n: int = 5, derive=None) -> List[Dict[str, Any]]:
    """Top-N valores de un campo (o derivado), con su fecha, ordenados."""
    cand = []
    for r in rows:
        v = derive(r) if derive else r.get(field)
        d = r.get("date")
        if v is not None and d:
            cand.append((v, d))
    cand.sort(key=lambda x: x[0], reverse=pick_max)
    return [{"value": round(v, 1), "date": d} for v, d in cand[:n]]


def records_top(rows: List[Dict[str, Any]], n: int = 5) -> Dict[str, Any]:
    """Récords de siempre con el top-N de cada categoría (valor + fecha)."""
    def rng(r):
        a, b = r.get("temp_max"), r.get("temp_min")
        return (a - b) if a is not None and b is not None else None
    return {
        "temp_max": _topn(rows, "temp_max", True, n),
        "temp_min": _topn(rows, "temp_min", False, n),
        "warm_day": _topn(rows, "temp_avg", True, n),
        "cold_day": _topn(rows, "temp_avg", False, n),
        "range_day": _topn(rows, None, True, n, derive=rng),
        "rain_day": _topn(rows, "rain_total", True, n),
        "gust_max": _topn(rows, "gust_max", True, n),
        "wind_max": _topn(rows, "wind_max", True, n),
        "press_max": _topn(rows, "press_max", True, n),
        "press_min": _topn(rows, "press_min", False, n),
        "hum_max": _topn(rows, "hum_max", True, n),
        "hum_min": _topn(rows, "hum_min", False, n),
        "uv_max": _topn(rows, "uv_max", True, n),
        "solar_max": _topn(rows, "solar_max", True, n),
    }


def season_tracker(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Contadores de días característicos del periodo (adaptado a CDMX)."""
    warm = sum(1 for r in rows if r.get("temp_max") is not None and r["temp_max"] >= WARM_DAY_C)
    cool = sum(1 for r in rows if r.get("temp_min") is not None and r["temp_min"] <= COOL_NIGHT_C)
    with_rain = [r for r in rows if r.get("rain_total") is not None]
    rain = sum(1 for r in with_rain if (r.get("rain_total") or 0.0) >= RAIN_DAY_MM)
    dry = sum(1 for r in with_rain if (r.get("rain_total") or 0.0) < RAIN_DAY_MM)
    return {
        "warm_days": warm, "cool_nights": cool, "rain_days": rain, "dry_days": dry,
        "warm_threshold": WARM_DAY_C, "cool_threshold": COOL_NIGHT_C,
    }


def build_records(rows: List[Dict[str, Any]], today: Optional[datetime] = None,
                  lat: Optional[float] = None) -> Dict[str, Any]:
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
        "all_time_top": records_top(rows),
        "monthly": monthly_records(rows),
        "this_month": period_summary(this_month, lat),
        "this_year": period_summary(this_year, lat),
        "yesterday": {**period_summary([yesterday], lat), "date": yesterday.get("date")} if yesterday else None,
    }


async def compute_and_store_day(
    storage, day: datetime, station: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Calcula el resumen de un día local y lo guarda en weather_daily.

    station: None para principal, nombre para secundarias.
    """
    start_iso, stop_iso, ts_utc = local_day_bounds_utc(day)
    stats = await storage.get_daily_stats(start=start_iso, stop=stop_iso, station=station)
    fields = flatten_stats(stats)
    if not fields:
        return None
    # Dirección dominante del viento (media vectorial ponderada por velocidad)
    try:
        wrows = await storage.query(
            start=start_iso, stop=stop_iso,
            fields=["wind_direction", "wind_speed"],
            station=station
        )
        wd = vector_mean_dir(wrows)
        if wd is not None:
            fields["wind_dir"] = wd
    except Exception:
        pass
    date_str = day.strftime("%Y-%m-%d")
    await storage.write_daily_summary(date_str, fields, ts_utc, station=station)
    return {"date": date_str, **fields}


async def backfill(storage, days: int = 90, station: Optional[str] = None) -> int:
    """
    Rellena los resúmenes de los últimos `days` días locales que falten.
    Hoy y ayer se recalculan siempre (pueden estar incompletos).
    Devuelve cuántos días se (re)escribieron.

    station: None para principal, nombre para secundarias.
    """
    today = datetime.now(_TZ)
    existing = {
        r.get("date")
        for r in await storage.query_daily_summaries(start=f"-{days + 2}d", station=station)
    }
    written = 0
    for i in range(days):
        day = today - timedelta(days=i)
        date_str = day.strftime("%Y-%m-%d")
        if date_str in existing and i > 1:
            continue  # ya existe y no es hoy/ayer
        try:
            if await compute_and_store_day(storage, day, station=station):
                written += 1
        except Exception as e:
            logger.error(f"Backfill {date_str} (station={station}) falló: {e}")
    station_label = station or "principal"
    if written:
        logger.info(f"Resumen diario [{station_label}]: {written} día(s) (re)calculados")
    return written


async def backfill_all_stations(
    storage, secondary_stations: Dict[str, str], days: int = 90
) -> Dict[Optional[str], int]:
    """
    Ejecuta backfill para la estación principal y todas las secundarias.

    secondary_stations: mapa {passkey: nombre} de estaciones secundarias.
    Devuelve {station_name: días_escritos}.
    """
    results: Dict[Optional[str], int] = {}

    # Principal
    results[None] = await backfill(storage, days=days, station=None)

    # Secundarias
    for name in set(secondary_stations.values()):
        results[name] = await backfill(storage, days=days, station=name)

    return results
