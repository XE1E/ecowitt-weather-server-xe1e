"""Datos para dispositivos y fuentes oficiales: SMN (CONAGUA), reloj Svitrix, e-paper, BIM32."""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .. import state
from ..config import settings
from ..services import aggregator, bim32, epaper, imeca, openmeteo, smn, svitrix
from ..services.air_quality import get_air_quality
from ..services.almanac import get_almanac
from .forecast import _apply_temperature_bias

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/smn")
async def get_smn_forecast(ides: str = "9", idmun: str = "14", hourly: int = 1):
    """Pronóstico oficial del SMN (CONAGUA) por municipio (por defecto Benito Juárez,
    CDMX). `hourly=0` omite el horario (evita descargar el archivo grande)."""
    try:
        return await smn.get_forecast(ides=ides, idmun=idmun, hourly=bool(hourly))
    except Exception as e:
        logger.error(f"Error SMN: {e}")
        raise HTTPException(status_code=502, detail="No se pudo obtener el pronóstico del SMN")


@router.get("/api/svitrix")
async def get_svitrix():
    """Dato real de la estación con forma WeatherAPI `current.json` (+ solar_radiation)
    para el firmware SVITRIX del reloj Ulanzi. Apunta la URL del reloj aquí."""
    data = state.latest_by_station.get(None)
    # Sin NINGUNA lectura (arranque en frío sin histórico que repoblar) no se puede
    # servir un `current`: con temp_c/humidity/pressure_mb en null, el firmware los
    # lee como 0.0 y pinta "0 °C / 0 % / 0 mb" como si fueran medidas reales.
    #
    # Se responde 503 SOLO en ese caso, que es transitorio. Si hay una lectura
    # aunque sea vieja se manda tal cual: el reloj reinicia el ESP32 tras
    # ~15 min sin un fetch con HTTP 200 (DataFetcher.cpp, staleLimit), así que
    # devolver error mientras la estación está caída lo dejaría en ciclo de
    # reinicios — peor que mostrar el último valor conocido.
    if not data or data.get("temperature_outdoor") is None:
        raise HTTPException(status_code=503, detail="Sin lectura de la estación todavía")
    lat = settings.cwop_latitude
    lon = settings.cwop_longitude
    aq = im = None
    try:
        aq = await get_air_quality(lat, lon, settings.waqi_token)
    except Exception as e:
        logger.error(f"svitrix aq: {e}")
    try:
        im = await imeca.get_imeca(lat, lon, pressure_hpa=data.get("pressure_absolute"))
    except Exception as e:
        logger.error(f"svitrix imeca: {e}")
    # Elevación del sol (pyephem, ya cacheada): la usa la condición del tiempo
    # para juzgar nubosidad por índice de claridad, y el is_day del ícono.
    sun_elev = None
    try:
        alm = get_almanac(lat, lon)
        if alm.get("available"):
            sun_elev = (alm.get("sun") or {}).get("altitude")
    except Exception as e:
        logger.error(f"svitrix almanac: {e}")
    # % de nubes de Open-Meteo (cacheado, ver openmeteo.get_forecast): respaldo
    # para cuando el sol está bajo o es de noche, donde la radiación medida ya
    # no distingue nubosidad (ver svitrix._condition).
    cloud_cover = None
    try:
        om = await openmeteo.get_forecast(lat, lon, days=1, epaper=True)
        cloud_cover = (om.get("hourly") or {}).get("cloud_cover", [None])[0]
    except Exception as e:
        logger.error(f"svitrix pronostico (nubes): {e}")
    return svitrix.build_weatherapi(data, aq, im, lat=lat, lon=lon, sun_elev=sun_elev,
                                    cloud_cover=cloud_cover)


@router.get("/api/epaper/forecast.json")
async def get_epaper_forecast():
    """
    Dato de la estación con forma WeatherAPI `forecast.json` para el display LilyGo
    e-paper 4.7". Apunta ahí la URL del firmware en vez de a api.weatherapi.com.

    A diferencia de `/api/svitrix`, este endpoint **no devuelve 503 nunca**: el e-paper
    despierta, pide una vez y se vuelve a dormir, así que un error lo deja con la
    pantalla vieja hasta el siguiente ciclo. Si falta el dato de la estación se cae al
    pronóstico de la hora en curso y se marca en `xe1e.source`.

    Por lo mismo, cada fuente externa se pide con tolerancia a fallos: que se caiga WAQI
    o el IMECA no puede costar la pantalla entera.
    """
    lat = settings.cwop_latitude
    lon = settings.cwop_longitude
    data = state.latest_by_station.get(None)

    async def _ok(coro, etiqueta):
        try:
            return await coro
        except Exception as e:
            logger.error(f"epaper {etiqueta}: {e}")
            return None

    start_iso, _, _ = aggregator.local_day_bounds_utc()
    aq, im, om, stats, p_3h = await asyncio.gather(
        _ok(get_air_quality(lat, lon, settings.waqi_token), "calidad del aire"),
        _ok(imeca.get_imeca(lat, lon, pressure_hpa=state.station_pressure_hpa()), "imeca"),
        _ok(openmeteo.get_forecast(lat, lon, days=3, epaper=True), "pronostico"),
        _ok(state.storage.get_daily_stats(start=start_iso), "estadisticas del dia"),
        _ok(state.storage.get_field_value_ago("pressure_relative", start="-3h"), "presion de hace 3h"),
    )

    alm = None
    try:
        alm = get_almanac(lat, lon)
        if not alm.get("available"):
            alm = None
    except Exception as e:
        logger.error(f"epaper almanaque: {e}")

    return epaper.build_forecast_json(
        data, aq, im, lat=lat, lon=lon,
        sun_elev=((alm or {}).get("sun") or {}).get("altitude"),
        almanac=alm, om=om, stats=stats, p_3h=p_3h,
        ahora=datetime.now(),
    )


@router.get("/api/bim32")
async def get_bim32():
    """
    JSON compacto para el firmware BIM32 (`weather.hpp`): combina el dato REAL de la
    estación (temperatura/humedad/presión/viento, igual que `/api/svitrix`) con el
    pronóstico diario y horario de Open-Meteo, ya recortado a 5 días / 40 puntos
    horarios y con los códigos de ícono que `Weather::_convertIcon()` ya sabe
    interpretar. Sustituye las 2-3 peticiones que el ESP32 hacía directo a
    Open-Meteo por esta única llamada.

    Sin lectura de la estación se cae al pronóstico de la hora en curso, igual que
    `/api/epaper/forecast.json` — no se devuelve 503, para no dejar al firmware sin
    dato con el que refrescar su pantalla.
    """
    lat = settings.cwop_latitude
    lon = settings.cwop_longitude
    data = state.latest_by_station.get(None)

    sun_elev = None
    try:
        alm = get_almanac(lat, lon)
        if alm.get("available"):
            sun_elev = (alm.get("sun") or {}).get("altitude")
    except Exception as e:
        logger.error(f"bim32 almanaque: {e}")

    try:
        om = await openmeteo.get_forecast(lat, lon, days=6, epaper=True)
        # Mismo ajuste que ya usa /api/forecast: corrige temperatura (con decay)
        # y presión (constante, calibración vs. el barómetro real) usando el
        # sesgo real de la estación -- antes BIM32 recibía ambas crudas de
        # Open-Meteo, cuya presión reducida a nivel del mar queda muy por
        # debajo de la relativa ya calibrada de la estación.
        om = _apply_temperature_bias(om, (data or {}).get("temperature_outdoor"), (data or {}).get("pressure_relative"))
    except Exception as e:
        logger.error(f"bim32 pronostico: {e}")
        om = {}

    # Análisis visual de la cámara (ver sky_analyzer.py): a diferencia del índice de
    # claridad solar, sí distingue nubes de noche. Se descarta si está viejo (cámara
    # caída, cuota de la API agotada) para no clavar una lectura obsoleta. Ojo: el
    # análisis corre en SU PROPIO intervalo (camera_analysis_interval_min), más lento
    # que las capturas de foto -- usar camera_stale_seconds (pensado para la foto)
    # lo descartaba casi siempre justo al borde del intervalo. Dos intervalos de
    # margen (mínimo 20 min) cubre esa cadencia más una reintento/latencia de la API.
    analysis_stale_seconds = max(settings.camera_analysis_interval_min * 60 * 2, 1200)
    sky_analysis = state.camera.get_analysis()
    if sky_analysis:
        try:
            analyzed_at = datetime.fromisoformat(sky_analysis.get("analyzed_at", ""))
            if analyzed_at.tzinfo is None:
                analyzed_at = analyzed_at.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - analyzed_at).total_seconds() > analysis_stale_seconds:
                sky_analysis = None
        except (ValueError, TypeError):
            sky_analysis = None

    return bim32.build_bim32(data, om, sun_elev=sun_elev, sky_analysis=sky_analysis)


@router.get("/api/bim32/history")
async def get_bim32_history(period: int = 30):
    """
    Historial exterior (temperatura/humedad/presión) para el firmware BIM32,
    en baldes de `period` minutos (hasta 24 puntos). Reemplaza el mecanismo de
    ThingSpeak (Thingspeak::sendHistory/receiveHistory en el firmware): ya no
    hace falta que el ESP32 mande su propia lectura a un canal externo, este
    servidor ya tiene el histórico real de la estación.
    """
    period = max(1, min(period, 999))
    try:
        records = await state.storage.query(
            start=f"-{period * 24}m",
            fields=["temperature_outdoor", "humidity_outdoor", "pressure_relative"],
        )
        return {"period_minutes": period, "history": bim32.build_bim32_history(records, period)}
    except Exception as e:
        logger.error(f"Error building bim32 history: {e}")
        raise HTTPException(status_code=500, detail="Error interno")


@router.get("/api/smn/municipios")
async def get_smn_municipios():
    """Lista de municipios del SMN (para búsqueda/autocompletar)."""
    try:
        return {"municipios": await smn.municipios()}
    except Exception as e:
        logger.error(f"Error SMN municipios: {e}")
        raise HTTPException(status_code=502, detail="No se pudo obtener la lista de municipios")
