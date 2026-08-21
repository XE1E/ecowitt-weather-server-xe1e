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


def local_day_bounds_utc(day: Optional["datetime"] = None) -> Tuple[str, str, datetime]:
    """
    Dado un date/datetime (se usa solo la fecha), devuelve:
      (inicio_utc_iso, fin_utc_iso, inicio_utc_datetime)
    para el día LOCAL correspondiente. Los ISO llevan sufijo 'Z' para Flux.

    Sin argumento usa el día local de HOY. Conviene llamarla así y NO pasarle
    `datetime.now()`: eso devuelve un naive en la zona del proceso (el contenedor
    usa TZ=UTC por defecto), y entre las 18:00 y medianoche locales la fecha UTC ya
    avanzó al día siguiente — el rango arrancaría en el futuro y las estadísticas
    del día saldrían vacías. La zona se resuelve aquí, con _TZ.
    """
    day = day or datetime.now(_TZ)
    start_local = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=_TZ)
    end_local = start_local + timedelta(days=1)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return start_utc.strftime(fmt), end_utc.strftime(fmt), start_utc


def local_recent_dates(days: int) -> List[str]:
    """
    Las últimas `days` fechas LOCALES en ISO (YYYY-MM-DD), de la más antigua a hoy.

    Vive aquí y no en quien la llama por lo mismo que `local_day_bounds_utc`: el
    contenedor corre con TZ=UTC, así que `datetime.now()` da un naive en UTC y entre
    las 18:00 y medianoche locales su fecha ya es la del día siguiente. La lista
    saldría corrida un día. La zona se resuelve con _TZ, en un solo sitio.
    """
    today = datetime.now(_TZ)
    return [(today - timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(days - 1, -1, -1)]


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
        # Del humidex se guarda el MÁXIMO y su hora, no la media: es un índice de bochorno y
        # lo que se recuerda de un día es cuánto llegó a apretar, no su promedio --que además
        # sale bajo, porque de noche el índice no existe (el converter no lo calcula por
        # debajo de 20 °C) y esas horas no cuentan--.
        "humidex_max": g("humidex", "max"),
        "humidex_max_time": g("humidex", "max_time"),
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
        # Récord de bochorno. Sale del `humidex_max` de cada día, así que existe para todo el
        # histórico desde que se recalcularon los resúmenes con `force`.
        "humidex_max": best("humidex_max", True),
        # Noche más cálida: el MÁXIMO de las mínimas diarias, no un mínimo. Es un récord
        # clásico y dice algo que "más calor" no dice: una noche que no baja es lo que hace
        # insoportable un día caluroso, y en clima urbano es el indicador que más se mueve.
        "warm_night": best("temp_min", True),
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


def mid_temp(row: Dict[str, Any]) -> Optional[float]:
    """
    Temperatura media del día al estilo NOAA: (Tmax + Tmin) / 2.

    NO es `temp_avg`, que es el promedio de TODAS las lecturas del día. Los
    grados-día y la ET0 de Hargreaves se definen sobre el punto medio de los
    extremos, y con muestreo por minuto las dos cifras difieren 0.3-1 °C, lo que
    bastaba para que nuestros grados-día no fueran comparables con los publicados
    por NOAA o CONAGUA aunque usáramos su misma base.

    Si falta algún extremo se cae a temp_avg, que es mejor que no dar nada.
    """
    hi, lo = row.get("temp_max"), row.get("temp_min")
    if hi is None or lo is None:
        return row.get("temp_avg")
    return (hi + lo) / 2.0


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
    if doy is None or row.get("temp_max") is None or row.get("temp_min") is None:
        return None
    # Hargreaves (FAO-56) define Tmean como el punto medio de los extremos.
    return round(et0_hargreaves(row["temp_min"], row["temp_max"], mid_temp(row), lat, doy), 2)


def rain_daily_total(rows: List[Dict[str, Any]], epsilon: float = 0.05) -> Optional[float]:
    """
    Total de lluvia del día a partir de la serie CRUDA de `rain_daily`, no de su
    máximo a secas.

    El contador de la consola Ecowitt se reinicia a medianoche LOCAL, pero el
    sondeo (cada ~60 s) no está sincronizado con ese instante: la primera lectura
    de la ventana de "hoy" puede llegar unos segundos después de medianoche
    mientras la consola AÚN no ha aplicado su reinicio, así que sigue cargando el
    acumulado de AYER (visto en vivo: 2026-08-20T06:00:01Z todavía marcaba el 7.3
    de la víspera; el reinicio a 0.0 no llegó hasta 06:01:01Z). Tomar `max()` de
    toda la ventana hereda ese acumulado viejo como si fuera de hoy, y se queda
    así hasta que la lluvia real del día lo supere -- por eso "hoy" podía salir
    idéntico a "ayer" en el histograma de la consola.

    La corrección: ubicar el ÚLTIMO reinicio (una caída del contador) dentro de la
    ventana y quedarse con el máximo sólo de ahí en adelante. De paso cubre
    reinicios de verdad a media jornada (p. ej. un apagón de la consola), que un
    `max()` simple también habría mezclado con el acumulado previo.
    """
    vals = [(r.get("_time"), r["rain_daily"]) for r in rows if r.get("rain_daily") is not None]
    if not vals:
        return None
    reset_at = 0
    for i in range(1, len(vals)):
        if vals[i][1] < vals[i - 1][1] - epsilon:
            reset_at = i
    return max(v for _, v in vals[reset_at:])


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
    # Para el TOTAL de lluvia un día sin dato aporta 0 mm, pero para CONTAR días
    # con lluvia no vale tratarlo como día seco: eso hacía que esta cifra y la de
    # season_tracker discreparan llevando la misma etiqueta en la misma página.
    rain_known = [r["rain_total"] for r in rows if r.get("rain_total") is not None]
    wind_avgs = [r["wind_avg"] for r in rows if r.get("wind_avg") is not None]
    # Grados-día sobre (Tmax+Tmin)/2, que es como los define NOAA (ver mid_temp).
    mids = [m for m in (mid_temp(r) for r in rows) if m is not None]
    hdd = sum(max(0.0, BASE_DD - m) for m in mids)
    cdd = sum(max(0.0, m - BASE_DD) for m in mids)
    out = {
        "days": len(rows),
        "mean_temp": round(sum(means) / len(means), 1) if means else None,
        "high": _best(rows, "temp_max", True),
        "low": _best(rows, "temp_min", False),
        "rain_total": round(sum(rain_known), 1),
        "rain_max_day": _best(rows, "rain_total", True),
        "rain_rate_max": _best(rows, "rain_rate_max", True),
        "rain_days": sum(1 for v in rain_known if v >= RAIN_DAY_MM),
        "wind_avg": round(sum(wind_avgs) / len(wind_avgs), 1) if wind_avgs else None,
        "wind_max": _best(rows, "wind_max", True),
        "gust_max": _best(rows, "gust_max", True),
        "wind_dir": vector_mean_dir(rows, "wind_dir", "wind_max"),
        "hum_avg": _avg(rows, "hum_avg"),
        "hum_max": (lambda v: max(v) if v else None)([r["hum_max"] for r in rows if r.get("hum_max") is not None]),
        "hum_min": (lambda v: min(v) if v else None)([r["hum_min"] for r in rows if r.get("hum_min") is not None]),
        "dew_avg": _avg(rows, "dew_avg"),
        "press_avg": _avg(rows, "press_avg"),
        # Extremos de presión del periodo, con la fecha (`_best`) y no pelados como
        # los de humedad: en un resumen mensual la presión mínima es el día de la
        # borrasca, y saber CUÁNDO fue es la mitad del dato. Los de humedad se quedan
        # como números sueltos porque ClimatePage ya los pinta así.
        "press_max": _best(rows, "press_max", True),
        "press_min": _best(rows, "press_min", False),
        # El humidex del periodo va con FECHA (`_best`) y no pelado como el UV y el solar: en
        # un resumen mensual lo que se quiere saber es qué día apretó, igual que con la
        # presión mínima. Y se cuentan los días BOCHORNOSOS, que es el equivalente de "días
        # con lluvia" para este índice: un mes con tres días a 32 no es el mismo mes que uno
        # con quince. El corte son 30, el primer tramo de incomodidad de Environment Canada.
        "humidex_max": _best(rows, "humidex_max", True),
        "humidex_days": sum(1 for r in rows if (r.get("humidex_max") or 0) >= 30),
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
        # Los grados-día van sobre el punto medio de los extremos (criterio NOAA),
        # no sobre el promedio integrado que se muestra como "media" del día.
        mid = mid_temp(r)
        per_day.append({
            "date": r.get("date"),
            "mean_temp": ta,
            "high": r.get("temp_max"), "high_time": r.get("temp_max_time"),
            "low": r.get("temp_min"), "low_time": r.get("temp_min_time"),
            "hdd": round(max(0.0, BASE_DD - mid), 1) if mid is not None else None,
            "cdd": round(max(0.0, mid - BASE_DD), 1) if mid is not None else None,
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
    """
    Contadores de días característicos del periodo (adaptado a CDMX).

    Cada contador va sobre los días que tienen ESE dato, no sobre todos: un día
    sin medición no es un día seco ni una noche templada. La consecuencia es que
    `rain_days + dry_days` puede ser menor que el total del periodo, así que se
    devuelve también cuántos días se midieron de cada cosa — sin eso, las cuatro
    tarjetas no cuadran con los días del periodo y nada lo explica.
    """
    with_max = [r for r in rows if r.get("temp_max") is not None]
    with_min = [r for r in rows if r.get("temp_min") is not None]
    with_rain = [r for r in rows if r.get("rain_total") is not None]
    warm = sum(1 for r in with_max if r["temp_max"] >= WARM_DAY_C)
    cool = sum(1 for r in with_min if r["temp_min"] <= COOL_NIGHT_C)
    rain = sum(1 for r in with_rain if r["rain_total"] >= RAIN_DAY_MM)
    dry = sum(1 for r in with_rain if r["rain_total"] < RAIN_DAY_MM)
    return {
        "warm_days": warm, "cool_nights": cool, "rain_days": rain, "dry_days": dry,
        "warm_threshold": WARM_DAY_C, "cool_threshold": COOL_NIGHT_C,
        # Denominador de cada par de contadores, para poder rotularlo.
        "days": len(rows),
        "temp_measured_days": len(with_max),
        "rain_measured_days": len(with_rain),
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
    # Total de lluvia del día, con el reinicio de medianoche ya filtrado (ver
    # `rain_daily_total`): el `max()` que hace `flatten_stats` a partir de
    # `get_daily_stats` no distingue el acumulado de ayer colado en el primer
    # sondeo de hoy, así que se recalcula aquí con la serie cruda.
    try:
        rrows = await storage.query(
            start=start_iso, stop=stop_iso,
            fields=["rain_daily"],
            station=station
        )
        rt = rain_daily_total(rrows)
        if rt is not None:
            fields["rain_total"] = round(rt, 1)
    except Exception:
        pass
    date_str = day.strftime("%Y-%m-%d")
    await storage.write_daily_summary(date_str, fields, ts_utc, station=station)
    return {"date": date_str, **fields}


async def backfill(storage, days: int = 90, station: Optional[str] = None,
                   force: bool = False) -> int:
    """
    Rellena los resúmenes de los últimos `days` días locales que falten.
    Hoy y ayer se recalculan siempre (pueden estar incompletos).
    Devuelve cuántos días se (re)escribieron.

    station: None para principal, nombre para secundarias.

    `force` recalcula TAMBIÉN los días que ya tienen resumen. Hace falta cuando se añade un
    campo nuevo al resumen --pasó con `humidex_max`--: sin él, los días ya escritos se saltan
    y el campo nuevo sólo aparece de hoy en adelante. El dato crudo tiene retención infinita,
    así que recalcular un día viejo da el mismo resultado que darlo el día que ocurrió.
    No se pone en el arranque a propósito: son ~90 consultas a InfluxDB y no hay motivo para
    pagarlas en cada reinicio.
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
        if not force and date_str in existing and i > 1:
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
