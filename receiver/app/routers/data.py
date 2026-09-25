"""Datos de la estación: lectura actual, historial, estadísticas, climatología, viento, lluvia, resúmenes diarios y alertas públicas."""
import asyncio
import logging
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Response

from .. import state
from ..config import settings
from ..services import aggregator, csv_export
from ..services import security as secsvc
from ..services.windrose import compute_wind_rose

logger = logging.getLogger(__name__)
router = APIRouter()


# Lo que /api/current calcula consultando Influx (7 consultas). Se guarda _CURRENT_TTL
# por estación: la página de inicio, la consola, el kiosco y el widget lo piden cada
# minuto por pestaña, y estos valores (acumulados, ventanas de 2/24 h, medias de 10
# min) apenas cambian en 30 s. La lectura en sí sale de memoria y siempre está al día.
_CURRENT_TTL = 30


_current_extras_cache: Dict[Optional[str], tuple] = {}


async def _current_extras(station: Optional[str]) -> Dict[str, Any]:
    hit = _current_extras_cache.get(station)
    if hit and time.time() - hit[0] < _CURRENT_TTL:
        return hit[1]

    async def safe(name, coro):
        try:
            return await coro
        except Exception as e:
            logger.error(f"/api/current: {name} falló: {e}")
            return None

    accum, r2, r24, w, wd = await asyncio.gather(
        safe("acumulados de lluvia", state.storage.get_rain_accumulations(station=station)),
        safe("lluvia 2 h", state.storage.get_rain_hours(hours=2, station=station)),
        safe("lluvia 24 h", state.storage.get_rain_hours(hours=24, station=station)),
        safe("viento 10 min", state.storage.get_wind_avg10m(station=station)),
        safe("rumbo 10 min", state.storage.get_wind_dir_avg10m(station=station)),
    )
    extras = {**(accum or {}), "rain_2h": r2, "rain_24h": r24,
              "wind_speed_avg10m": w, "wind_direction_avg10m": wd}
    _current_extras_cache[station] = (time.time(), extras)
    return extras


@router.get("/api/current")
async def get_current_data(station: Optional[str] = None):
    """
    Get the most recent weather data.

    station: None/omitido = estación principal; nombre = estación secundaria.
    """
    data = state.latest_by_station.get(station)
    if not data:
        raise HTTPException(status_code=404, detail="No data available yet")

    result = dict(data)
    extras = await _current_extras(station)
    # Acumulados semanal/mensual/anual: sólo si la estación no los manda.
    for k in ("rain_weekly", "rain_monthly", "rain_yearly"):
        if result.get(k) is None and extras.get(k) is not None:
            result[k] = extras[k]
    # Lluvia acumulada en ventana móvil, desde el contador exacto: la tarjeta del
    # tablero usa 2 h y la consola 24 h (24 h móviles NO es `rain_daily`, que se
    # reinicia a medianoche).
    for k in ("rain_2h", "rain_24h"):
        if extras.get(k) is not None:
            result[k] = extras[k]
    # Promedios de viento de 10 min: la estación no manda ninguno (ver
    # state.storage.get_wind_avg10m). Si algún día un dispositivo SÍ reporta
    # `windspdmph_avg10m`, ese valor ya viene en `data` y manda sobre el calculado.
    if result.get("wind_speed_avg10m") is None and extras.get("wind_speed_avg10m") is not None:
        result["wind_speed_avg10m"] = extras["wind_speed_avg10m"]
    if extras.get("wind_direction_avg10m") is not None:
        result["wind_direction_avg10m"] = extras["wind_direction_avg10m"]
    return result


_HISTORY_MAX_DAYS = 31


@router.get("/api/history")
async def get_history(
    start: str = "-24h",
    stop: str = "now()",
    measurement: str = "weather",
    station: Optional[str] = None,
    format: str = "json",
    fields: Optional[str] = None,
    every: Optional[str] = None,
):
    """
    Get historical weather data.

    Args:
        start: Start time (e.g., "-24h", "-7d", "2024-01-01T00:00:00Z")
        stop: End time (e.g., "now()", "2024-01-02T00:00:00Z")
        measurement: Measurement name
        station: None/omitido = principal; nombre = estación secundaria
        format: "json" (default) o "csv" para descargar el mismo rango como archivo
        fields: campos separados por coma (opcional; por omisión, todos)
        every: "10m", "1h"…: promedio por ventana (requiere fields). Para gráficas de
            7-30 días; sin él llega cada lectura cruda.
    """
    if format not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="format debe ser 'json' o 'csv'")
    try:
        secsvc.validate_flux_time(start, "start")
        secsvc.validate_flux_time(stop, "stop")
        secsvc.validate_measurement(measurement)
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Datos CRUDOS pivotados (una fila por lectura, ~16 s): antes no había tope y un
    # `start=-3650d` cargaba años en memoria. Lo más largo que pide el sitio son 30 d.
    span = secsvc.flux_span_days(start, stop)
    if span is not None and span > _HISTORY_MAX_DAYS:
        raise HTTPException(status_code=400,
                            detail=f"Rango máximo de {_HISTORY_MAX_DAYS} días; para más, usa /api/summaries/daily")
    try:
        field_list = [f.strip() for f in fields.split(",") if f.strip()] if fields else None
        data = await state.storage.query(
            start=start, stop=stop, measurement=measurement, station=station,
            fields=field_list, every=every,
        )
        if format == "csv":
            fname = "_".join([
                measurement,
                station or "principal",
                csv_export.safe_filename_part(start),
                csv_export.safe_filename_part(stop),
            ])
            return Response(
                content=csv_export.rows_to_csv(data),
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'},
            )
        return {"data": data}
    except ValueError as e:  # every/fields inválidos (los valida state.storage.query)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying history: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@router.get("/api/stats/daily")
async def get_daily_stats(station: Optional[str] = None, start: Optional[str] = None):
    """
    Get statistics (min, max, avg) for today (local calendar day).

    station: None/omitido = principal; nombre = estación secundaria.
    start: si se omite, usa inicio del día local (medianoche); si se pasa,
           puede ser ventana Flux ("-24h") o timestamp ISO.
    """
    if start is None:
        start_iso, _, _ = aggregator.local_day_bounds_utc()
        start = start_iso
    try:
        secsvc.validate_flux_time(start, "start")
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        stats = await state.storage.get_daily_stats(start=start, station=station)
        return stats
    except Exception as e:
        logger.error(f"Error getting daily stats: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@router.get("/api/stats/records")
async def get_records(start: str = "-30d"):
    """Statistics (min/max/avg) over a range (e.g. -7d, -30d, -365d, -3650d)."""
    try:
        secsvc.validate_flux_time(start, "start")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await state.storage.get_daily_stats(start=start)
    except Exception as e:
        logger.error(f"Error getting records: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@router.get("/api/compare")
async def get_compare():
    """Comparación 24h vs 24h previas (aprox. 'vs ayer')."""
    try:
        return await state.storage.get_comparison()
    except Exception as e:
        logger.error(f"Error getting comparison: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


@router.get("/api/climate/records")
async def get_climate_records(start: str = "-3650d"):
    """Récords ampliados: de siempre, por mes calendario, este mes/año y ayer."""
    try:
        rows = await state.storage.query_daily_summaries(start=start)
        return aggregator.build_records(rows, lat=settings.cwop_latitude)
    except Exception as e:
        logger.error(f"Error getting climate records: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


@router.get("/api/climate/onthisday")
async def get_on_this_day():
    """Efeméride: qué pasó el mismo día calendario en años previos."""
    try:
        rows = await state.storage.query_daily_summaries(start="-3650d")
        return aggregator.on_this_day(rows)
    except Exception as e:
        logger.error(f"Error building on-this-day: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


@router.get("/api/climate/noaa")
async def get_climate_noaa(year: int, month: Optional[int] = None):
    """Reporte climatológico estilo NOAA: mensual (con month) o anual (sin month)."""
    try:
        rows = await state.storage.query_daily_summaries(start="-3650d")
        lat = settings.cwop_latitude
        if month:
            return aggregator.noaa_month(rows, year, month, lat)
        return aggregator.noaa_year(rows, year, lat)
    except Exception as e:
        logger.error(f"Error building NOAA report: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


@router.get("/api/wind/rose")
async def get_wind_rose(start: str = "-7d"):
    """Rosa de vientos: distribución por sectores en el periodo (desde histórico)."""
    try:
        records = await state.storage.query(start=start, fields=["wind_direction", "wind_speed"])
        return compute_wind_rose(records)
    except Exception as e:
        logger.error(f"Error building wind rose: {e}")
        raise HTTPException(status_code=500, detail="Error interno")  # el detalle, sólo al log


@router.get("/api/rain/last")
async def get_last_rain(station: Optional[str] = None):
    """Fecha/hora de la última lluvia registrada (rain_rate > 0)."""
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"date": await state.storage.get_last_rain(station=station)}


@router.get("/api/rain/hours")
async def get_rain_hours(hours: int = 2, station: Optional[str] = None):
    """Lluvia acumulada en las últimas N horas (máx 24)."""
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    hours = max(1, min(hours, 24))
    rain = await state.storage.get_rain_hours(hours=hours, station=station)
    return {"hours": hours, "rain_mm": rain}


@router.get("/api/rain/daily")
async def get_daily_rain(days: int = 7, station: Optional[str] = None):
    """
    Lluvia por día LOCAL de los últimos `days` días. Alimenta el histograma de la
    celda LLUVIA de la consola.

    Existe en vez de reutilizar /api/climate/noaa --el único que ya daba lluvia por
    día-- porque aquél devuelve un mes entero con veinte campos por jornada, y una
    ventana de 7 días a caballo entre dos meses obligaría a pedir dos.

    Un día sin resumen devuelve `rain: null`, no 0: "no se guardó el día" y "no
    llovió" son cosas distintas y el histograma las dibuja distinto.
    """
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    days = max(1, min(days, 31))
    # Se pide una ventana MAYOR que los días pedidos y luego se recorta por fecha
    # local: los resúmenes llevan la fecha local como tag, pero el rango de Flux va en
    # UTC, así que con "-7d" justos el día más antiguo entra a medias o se cae.
    rows = await state.storage.query_daily_summaries(start=f"-{days + 2}d", station=station)
    by_date = {str(r.get("date")): r.get("rain_total") for r in rows if r.get("date")}

    wanted = aggregator.local_recent_dates(days)
    # El día EN CURSO no tiene resumen cerrado --el rollup lo escribe al terminar el
    # día-- así que su barra saldría vacía justo cuando más interesa. Para hoy se toma
    # el acumulado vivo de la última lectura, y se queda el mayor de los dos por si el
    # rollup ya corrió.
    live = (state.latest_by_station.get(station) or {}).get("rain_daily")

    out = []
    for i, d in enumerate(wanted):
        mm = by_date.get(d)
        es_hoy = i == len(wanted) - 1
        if es_hoy and isinstance(live, (int, float)):
            if not isinstance(mm, (int, float)) or live > mm:
                mm = live
        out.append({"date": d,
                    "rain": round(float(mm), 1) if isinstance(mm, (int, float)) else None})
    return {"days": days, "data": out}


@router.get("/api/summaries/daily")
async def get_daily_summaries(days: int = 30, station: Optional[str] = None, format: str = "json"):
    """
    Resúmenes diarios crudos de los últimos `days` días LOCALES, una fila por día.

    Es la fuente de las páginas de detalle del kiosco en 7 y 30 días. Lo que ya había
    no servía: `/api/climate/noaa` da la serie diaria pero SÓLO por mes calendario, y
    "los últimos 30 días" casi siempre cae a caballo entre dos meses --habría que
    pedir dos y pegarlos en el cliente--; `/api/stats/records` sí acepta una ventana
    libre pero devuelve el agregado del periodo, no la serie. Y `/api/rain/daily`
    resuelve exactamente esto, pero sólo para la lluvia.

    Devuelve las filas TAL CUAL las guarda el rollup (temp_max/min/avg, rain_total,
    wind_avg, gust_max, hum_*, press_*, uv_max, solar_max…), sin recortar campos: cada
    página del kiosco usa los suyos y filtrarlos aquí obligaría a tocar el backend
    cada vez que una pantalla quiera un dato más.

    Un día sin resumen NO aparece en la lista. El día EN CURSO tampoco: su resumen lo
    escribe el rollup al cerrarlo, y media jornada mezclada con días completos
    falsearía cualquier mínima o promedio de la serie.
    """
    if format not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="format debe ser 'json' o 'csv'")
    try:
        secsvc.validate_station(station)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    days = max(1, min(days, 400))
    # Ventana MAYOR que la pedida y recorte por fecha local después, por lo mismo que
    # en /api/rain/daily: los resúmenes llevan la fecha local como tag pero el rango
    # de Flux va en UTC, así que con los días justos el más antiguo entra a medias.
    rows = await state.storage.query_daily_summaries(start=f"-{days + 2}d", station=station)
    wanted = set(aggregator.local_recent_dates(days))
    out = sorted((r for r in rows if str(r.get("date")) in wanted),
                 key=lambda r: str(r.get("date")))
    if format == "csv":
        fname = f"resumenes_diarios_{station or 'principal'}_{days}d"
        return Response(
            content=csv_export.rows_to_csv(out),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'},
        )
    return {"days": days, "data": out}


@router.get("/api/alerts")
async def get_alerts():
    """Current active weather alerts (from the alert service)."""
    return {
        "enabled": state.alert_service.enabled,
        "active": [{"key": k, "message": m} for k, m in state.alert_service.active.items()],
    }


@router.get("/api/alerts/history")
async def get_alerts_history(hours: int = 24, limit: int = 50):
    """
    Historial reciente de alertas (activadas y, si ya se normalizaron, con
    `resolved_at`). Vive en memoria del proceso (`AlertService._history`, hasta
    100 entradas) -- no es un log persistente en InfluxDB, así que un reinicio
    del receiver lo vacía. Antes solo se veía dentro de /api/admin/status
    (requiere sesión); esto lo expone público, igual que /api/alerts.
    """
    hours = max(1, min(hours, 24 * 30))
    limit = max(1, min(limit, 100))
    return {"history": state.alert_service.get_history(limit=limit, hours=hours)}
