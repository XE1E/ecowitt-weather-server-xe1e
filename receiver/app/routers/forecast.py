"""Pronóstico: Open-Meteo con sesgo corregido, pronóstico local y propio, consenso, verificación contra lo observado, estaciones vecinas (Xweather/Netatmo, con su OAuth) y almanaque."""
import asyncio
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import RedirectResponse

from .. import state
from ..config import settings
from ..deps import require_admin
from ..services import admin as adminsvc
from ..services import forecast_consensus, forecaster, netatmo, openmeteo, settings_store, smn, weatherapi, xweather
from ..services import forecast_verification as fverif
from ..services.almanac import get_almanac

logger = logging.getLogger(__name__)
router = APIRouter()
_MX_TZ = ZoneInfo("America/Mexico_City")


@router.get("/api/almanac")
async def get_almanac_data():
    """Almanaque astronómico ampliado (sol, crepúsculos, luna y planetas)."""
    try:
        lat = settings.cwop_latitude
        lon = settings.cwop_longitude
        return get_almanac(lat, lon)
    except Exception as e:
        logger.error(f"Error getting almanac: {e}")
        return {"available": False, "reason": "error"}


def _apply_temperature_bias(forecast: dict, current_temp: Optional[float],
                            current_pressure: Optional[float] = None) -> dict:
    """
    Corrige temperatura y presión del pronóstico de Open-Meteo con el bias real
    de la estación (nombre de la función sin cambiar para no tocar el otro
    llamador -- ver `/api/forecast` y `/api/bim32`, que la invocan igual).

    Temperatura: el pronóstico puede estar varios grados desfasado del
    microclima local. Se calcula la diferencia entre la temperatura medida y
    la del pronóstico para "ahora", y se aplica esa corrección con DECAY a
    las próximas horas (disminuye 10%/hora, se apaga a las 10h) porque el
    desfase actual puede no aplicar a horas lejanas -- cambia con la
    condición del momento.

    Presión: a diferencia de la temperatura, el desfase suele ser un problema
    de CALIBRACIÓN, no meteorológico -- Open-Meteo reduce a nivel del mar con
    una fórmula estándar (usa la elevación del punto pedido), mientras que la
    estación reporta su presión relativa ya calibrada contra el barómetro
    real del aeropuerto local (`pressure_relative`). Ese desfase no se
    "resuelve" con las horas, así que se aplica CONSTANTE a todo el
    horario (sin decay), incluidas horas pasadas.
    """
    hourly = forecast.get("hourly")
    if not hourly or "time" not in hourly:
        return forecast

    times = hourly["time"]
    if not times:
        return forecast

    # `hourly.time` viene en hora LOCAL sin sufijo (`timezone=auto`), así que
    # `.replace("Z", "+00:00")` no encuentra nada que reemplazar y
    # `datetime.fromisoformat(...).timestamp()` interpretaba ese naive datetime
    # con la zona del PROCESO -- correcto sólo porque el .env de este despliegue
    # fija `TZ=America/Mexico_City` igual que la lat/lon pedida; con el
    # `TZ=UTC` por defecto de docker-compose.yml la resta quedaría desfasada
    # exactamente el offset del sitio. Se ancla explícitamente al
    # `utc_offset_seconds` que la propia respuesta declara, sin depender de la
    # zona del contenedor.
    offset_s = forecast.get("utc_offset_seconds") or 0
    now_ts = datetime.now(timezone.utc).timestamp()

    closest_idx = 0
    closest_diff = float("inf")
    for i, t in enumerate(times):
        try:
            t_local_naive_ts = datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp()
            t_ts = t_local_naive_ts - offset_s
            diff = abs(t_ts - now_ts)
            if diff < closest_diff:
                closest_diff = diff
                closest_idx = i
        except (ValueError, AttributeError):
            continue

    if closest_diff > 7200:
        return forecast

    result = dict(forecast)
    result["hourly"] = dict(hourly)
    bias_info: Dict[str, Any] = {}

    temps = hourly.get("temperature_2m")
    if current_temp is not None and temps:
        forecast_now_temp = temps[closest_idx]
        if forecast_now_temp is not None:
            bias = current_temp - forecast_now_temp
            if abs(bias) >= 0.5:
                corrected_temps = list(temps)
                for i in range(len(corrected_temps)):
                    if corrected_temps[i] is None or i < closest_idx:
                        continue
                    decay = max(0.0, 1.0 - (i - closest_idx) * 0.10)
                    corrected_temps[i] = round(corrected_temps[i] + bias * decay, 1)
                result["hourly"]["temperature_2m"] = corrected_temps
                bias_info["temperature"] = {
                    "applied": True,
                    "measured": round(current_temp, 1),
                    "forecast": round(forecast_now_temp, 1),
                    "bias": round(bias, 1),
                }

    pres = hourly.get("pressure_msl")
    if current_pressure is not None and pres:
        forecast_now_pres = pres[closest_idx]
        if forecast_now_pres is not None:
            bias = current_pressure - forecast_now_pres
            if abs(bias) >= 1.0:
                result["hourly"]["pressure_msl"] = [
                    round(p + bias, 1) if p is not None else None for p in pres
                ]
                bias_info["pressure"] = {
                    "applied": True,
                    "measured": round(current_pressure, 1),
                    "forecast": round(forecast_now_pres, 1),
                    "bias": round(bias, 1),
                }

    if bias_info:
        result["bias_correction"] = bias_info
    return result


@router.get("/api/forecast")
async def get_forecast(lat: Optional[float] = None, lon: Optional[float] = None):
    """
    Pronóstico de Open-Meteo con caché en el servidor y corrección por bias.

    Lo pedía el navegador directamente al origen, así que una caída dejaba la
    página sin pronóstico y cada visitante gastaba cuota por su cuenta. Aquí se
    cachea y, si el origen no responde, se sirve la última copia buena marcada
    como `stale` (mismo criterio que /api/smn).

    Además, corrige las temperaturas horarias usando la diferencia entre la
    lectura actual de la estación y el pronóstico para "ahora". La corrección
    se aplica con decay (disminuye conforme se aleja en el tiempo). Este
    endpoint no pide `pressure_msl` a Open-Meteo (ver `openmeteo._HOURLY`), así
    que la corrección de presión no aplica aquí -- sí en `/api/bim32`, que
    usa el conjunto ampliado.
    """
    try:
        forecast = await openmeteo.get_forecast(
            lat if lat is not None else settings.cwop_latitude,
            lon if lon is not None else settings.cwop_longitude,
        )
        current = state.latest_by_station.get(None, {})
        return _apply_temperature_bias(forecast, current.get("temperature_outdoor"), current.get("pressure_relative"))
    except Exception as e:
        logger.error(f"Error obteniendo pronóstico Open-Meteo: {e}")
        raise HTTPException(status_code=502, detail="No se pudo obtener el pronóstico")


async def _compute_local_forecast() -> Dict[str, Any]:
    try:
        p_now = state.latest_by_station.get(None, {}).get("pressure_relative")
        p_3h = await state.storage.get_field_value_ago("pressure_relative", start="-3h")
        return forecaster.local_forecast(p_now, p_3h)
    except Exception as e:
        logger.error(f"Error building local forecast: {e}")
        return {"available": False, "reason": "error"}


@router.get("/api/forecast/local")
async def get_local_forecast():
    """Pronóstico local por tendencia barométrica (datos de nuestra estación)."""
    return await _compute_local_forecast()


@router.get("/api/forecast/own")
async def get_own_forecast(lat: Optional[float] = None, lon: Optional[float] = None):
    """
    "Nuestro pronóstico": estación + cámara + vecinas, en
    ese orden de autoridad (ver forecaster.own_forecast) -- NO depende de
    Open-Meteo/WeatherAPI. Esos modelos externos se muestran aparte y
    siempre atribuidos (ver PrecipitationCard.tsx): este endpoint es la voz
    PROPIA de la estación, la que manda cuando hay desacuerdo.
    """
    own = state.latest_by_station.get(None) or {}
    camera_analysis = state.camera.get_analysis()
    lat_ = lat if lat is not None else settings.cwop_latitude
    lon_ = lon if lon is not None else settings.cwop_longitude
    merged = await _fetch_nearby_stations_merged(lat_, lon_)
    incoming_rain = forecaster.detect_incoming_rain(
        merged["stations"], own.get("wind_direction"), own.get("wind_speed"), own.get("rain_rate"),
    )
    return forecaster.own_forecast(own.get("rain_rate"), camera_analysis, incoming_rain)


_forecast_log = fverif.ForecastLog(settings.forecast_log_dir, _MX_TZ)


# Un análisis del cielo más viejo que esto ya no describe "ahora" (de noche o si
# se cae la cámara no llegan capturas) -- no se registra su tendencia.
_SNAPSHOT_CAMERA_MAX_AGE_MIN = 20


async def _forecast_snapshot() -> Dict[str, Any]:
    """Lo que dice AHORA cada fuente sobre lluvia en las próximas 3 h. Cada
    fuente va en su propio try: si una no responde se omite de esta foto en
    vez de perder las demás."""
    lat, lon = settings.cwop_latitude, settings.cwop_longitude
    now_utc = datetime.now(timezone.utc)
    now_mx = now_utc.astimezone(_MX_TZ)
    preds: Dict[str, Any] = {}
    try:
        om = await openmeteo.get_forecast(lat, lon, days=2)
        h = om.get("hourly", {})
        om_now = now_utc + timedelta(seconds=om.get("utc_offset_seconds") or 0)
        preds["openmeteo"] = fverif.prob_prediction(fverif.max_prob_next_hours(
            h.get("time", []), h.get("precipitation_probability", []), om_now))
    except Exception as e:
        logger.warning(f"Bitácora de pronósticos: Open-Meteo no disponible ({e})")
    try:
        wa = await weatherapi.get_forecast(lat, lon, days=1)
        if wa:
            h = wa.get("hourly", {})
            preds["weatherapi"] = fverif.prob_prediction(fverif.max_prob_next_hours(
                h.get("time", []), h.get("precipitation_probability", []), now_mx))
    except Exception as e:
        logger.warning(f"Bitácora de pronósticos: WeatherAPI no disponible ({e})")
    try:
        hours = (await smn.get_forecast()).get("hours") or []
        preds["smn"] = fverif.prob_prediction(fverif.max_prob_next_hours(
            [x.get("time") for x in hours], [x.get("prob_precip") for x in hours], now_mx))
    except Exception as e:
        logger.warning(f"Bitácora de pronósticos: SMN no disponible ({e})")
    try:
        own = await get_own_forecast()
        preds["own"] = {"rain": bool(own.get("storm_likely") or own.get("rain_now")),
                        "source": own.get("source"), "confidence": own.get("confidence")}
    except Exception as e:
        logger.warning(f"Bitácora de pronósticos: pronóstico propio no disponible ({e})")
    analysis = state.camera.get_analysis() or {}
    analyzed = fverif._parse_ts(analysis.get("analyzed_at", ""))
    if analyzed and (now_utc - analyzed) <= timedelta(minutes=_SNAPSHOT_CAMERA_MAX_AGE_MIN):
        preds["camera_trend"] = {"rain": bool((analysis.get("trend") or {}).get("precip_appearing"))}
    return {"ts": now_utc.isoformat(), "p": preds}


async def forecast_snapshot_task():
    """Una foto de los pronósticos cada 30 min (en :00 y :30, para que cuadre con
    los instantes en que se reconstruye la presión en forecast_verification)."""
    await asyncio.sleep(90)  # gracia inicial: que los cachés de pronóstico se llenen
    while True:
        now = datetime.now(timezone.utc)
        wait = (30 - now.minute % 30) * 60 - now.second
        await asyncio.sleep(max(5, wait))
        try:
            _forecast_log.append(await _forecast_snapshot())
        except Exception as e:
            logger.error(f"Bitácora de pronósticos falló: {e}")


_verification_cache: Dict[int, Dict[str, Any]] = {}


_VERIFICATION_TTL = 600


@router.get("/api/forecast/verification")
async def get_forecast_verification(days: int = 30):
    """
    ¿Qué fuente ACIERTA más? Cada pronóstico se califica contra lo observado
    (pluviómetro para lluvia, cámara para nubosidad) -- ver
    services/forecast_verification.py. Caché de 10 min: son 2 consultas de 30
    días a InfluxDB y la respuesta cambia despacio.
    """
    days = max(1, min(int(days), 60))
    cached = _verification_cache.get(days)
    if cached and time.time() - cached["ts"] < _VERIFICATION_TTL:
        return cached["data"]
    now_utc = datetime.now(timezone.utc)
    today = now_utc.astimezone(_MX_TZ).date()
    entries: List[Dict[str, Any]] = []
    for i in range(days - 1, -1, -1):
        entries.extend(state.camera.get_daily_analysis((today - timedelta(days=i)).isoformat()) or [])
    start = f"-{days + 1}d"
    rain = await state.storage.get_field_series("rain_total", start=start, every="10m", fn="max")
    pressure = await state.storage.get_field_series("pressure_relative", start=start, every="10m", fn="mean")
    report = fverif.build_report(
        entries, rain, pressure, _forecast_log.read_range(days + 1), _MX_TZ, days,
        _forecast_log.first_day(), since=now_utc - timedelta(days=days),
    )
    report["generated_at"] = now_utc.isoformat()
    _verification_cache[days] = {"ts": time.time(), "data": report}
    return report


async def _fetch_nearby_stations_merged(lat: float, lon: float) -> Dict[str, Any]:
    """Fusiona Xweather + Netatmo -- toda la lógica de fetch/merge vive aquí
    para que la usen tanto el endpoint público como `get_own_forecast`, sin
    duplicar nada entre los dos. Cada red se consulta por separado y si
    UNA falla se ignora (con log) en vez de tumbar el resultado completo --
    así una Netatmo mal configurada no le quita el dato a quien solo usa
    Xweather, y viceversa."""
    results = []
    if settings.xweather_enabled and settings.xweather_client_id and settings.xweather_client_secret:
        try:
            results.append(await xweather.get_nearby_stations(
                lat, lon, settings.xweather_client_id, settings.xweather_client_secret,
            ))
        except Exception as e:
            logger.error(f"Error obteniendo estaciones vecinas (Xweather): {e}")
    if (settings.netatmo_enabled and settings.netatmo_client_id and settings.netatmo_client_secret
            and settings.netatmo_refresh_token):
        try:
            results.append(await netatmo.get_nearby_stations(
                lat, lon, settings.netatmo_client_id, settings.netatmo_client_secret,
                settings.netatmo_refresh_token, _persist_netatmo_refresh_token,
            ))
        except Exception as e:
            logger.error(f"Error obteniendo estaciones vecinas (Netatmo): {e}")

    if not results:
        return {"stations": [], "fetched_at": None, "age_minutes": None, "stale": False,
                "zone_trend_mb": None, "zone_trend": None, "zone_trend_reference": None}

    stations = [s for r in results for s in r["stations"]]
    # La propia estación puede aparecer en la lista de Xweather: publicamos a
    # PWSWeather (su propia red) y Xweather la devuelve como una PWS más, a
    # distancia ~0 -- se descarta por id para que la tarjeta sea de vecinas
    # de verdad y no se cuente a sí misma en la mediana/tendencia de la zona.
    if settings.pws_station_id:
        own_id = f"PWS_{settings.pws_station_id}".upper()
        stations = [s for s in stations if (s.get("id") or "").upper() != own_id]
    fetched_ats = [r["fetched_at"] for r in results if r["fetched_at"]]
    ages = [r["age_minutes"] for r in results if r["age_minutes"] is not None]
    zone = forecaster.zone_trend(stations)
    return {
        "stations": stations,
        # El más viejo de los dos (conservador): si una red no responde hace
        # rato, la tarjeta lo refleja aunque la otra esté fresca.
        "fetched_at": min(fetched_ats) if fetched_ats else None,
        "age_minutes": max(ages) if ages else None,
        "stale": any(r["stale"] for r in results),
        "zone_trend_mb": zone["delta_mb"],
        "zone_trend": zone["trend"],
        "zone_trend_reference": zone["reference"],
    }


@router.get("/api/nearby-stations")
async def get_nearby_stations_endpoint(lat: Optional[float] = None, lon: Optional[float] = None):
    """
    Estaciones vecinas (PWS/METAR/mesonet vía Xweather + Netatmo), para
    comparar contra la lectura propia. Ver docs/internal/PLAN-ESTACIONES-VECINAS.md.

    Sin ninguna red configurada (Admin → Integraciones), devuelve la lista
    vacía en vez de error -- es una tarjeta opcional, no debe romper la
    página. Incluye `incoming_rain` (ver forecaster.detect_incoming_rain):
    la vecina más cercana que reporta lluvia en la dirección de donde sopla
    el viento propio ahora mismo, o None -- NearbyStationsCard.tsx solo la
    pinta, no la calcula (única fuente de verdad, la comparte con
    `get_own_forecast`).
    """
    lat_ = lat if lat is not None else settings.cwop_latitude
    lon_ = lon if lon is not None else settings.cwop_longitude
    merged = await _fetch_nearby_stations_merged(lat_, lon_)
    own = state.latest_by_station.get(None) or {}
    merged["incoming_rain"] = forecaster.detect_incoming_rain(
        merged["stations"], own.get("wind_direction"), own.get("wind_speed"), own.get("rain_rate"),
    )
    return merged


_NETATMO_REDIRECT_URI = "https://clima.xe1e.net/api/admin/netatmo/oauth/callback"


_NETATMO_OAUTH_STATE_TTL = 600  # 10 min


_netatmo_oauth_states: Dict[str, float] = {}


def _netatmo_gen_state() -> str:
    """`state` de un solo uso para el flujo OAuth -- se emite solo con sesión
    admin válida (endpoint /oauth/start) y se consume una vez en el callback,
    que en sí no puede llevar el Bearer del panel (es un redirect de
    navegador). Es la protección real del callback público."""
    now = time.time()
    for s, ts in list(_netatmo_oauth_states.items()):
        if now - ts > _NETATMO_OAUTH_STATE_TTL:
            _netatmo_oauth_states.pop(s, None)
    state = secrets.token_urlsafe(24)
    _netatmo_oauth_states[state] = now
    return state


def _netatmo_check_state(oauth_state: Optional[str]) -> bool:
    # `oauth_state`, no `state`: en este módulo `state` es el estado compartido.
    ts = _netatmo_oauth_states.pop(oauth_state, None) if oauth_state else None
    return ts is not None and (time.time() - ts) <= _NETATMO_OAUTH_STATE_TTL


def _persist_netatmo_refresh_token(new_token: str) -> None:
    """Persiste (settings.json) y aplica EN VIVO un refresh_token nuevo --
    mismo patrón que _persist_registry. Netatmo lo rota en cada uso, así que
    esto se llama tanto desde el callback (primer login) como desde
    netatmo.py cada vez que se pide un access_token nuevo con el anterior."""
    current = settings_store.load_overrides(settings.settings_file)
    current["netatmo_refresh_token"] = new_token
    settings_store.save_overrides(settings.settings_file, current)
    adminsvc.apply_overrides(settings, state.alert_service, current)


@router.get("/api/admin/netatmo/oauth/start")
async def netatmo_oauth_start(authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    if not (settings.netatmo_client_id and settings.netatmo_client_secret):
        raise HTTPException(status_code=400, detail="Configura client_id/client_secret de Netatmo primero")
    state = _netatmo_gen_state()
    return {"url": netatmo.authorize_url(settings.netatmo_client_id, _NETATMO_REDIRECT_URI, state)}


@router.get("/api/admin/netatmo/oauth/callback")
async def netatmo_oauth_callback(code: Optional[str] = None, state: Optional[str] = None,
                                  error: Optional[str] = None):
    """Netatmo redirige aquí tras el login. Sin Authorization header a
    propósito -- ver _netatmo_gen_state para la protección real (el `state`)."""
    if error or not code or not _netatmo_check_state(state):
        return RedirectResponse(url="/admin/integraciones?netatmo=error")
    try:
        token_body = await netatmo.exchange_code(
            settings.netatmo_client_id, settings.netatmo_client_secret, code, _NETATMO_REDIRECT_URI,
        )
        refresh_token = token_body.get("refresh_token")
        if not refresh_token:
            raise RuntimeError("Netatmo no devolvió refresh_token")
        _persist_netatmo_refresh_token(refresh_token)
    except Exception as e:
        logger.error(f"Netatmo OAuth callback falló: {e}")
        return RedirectResponse(url="/admin/integraciones?netatmo=error")
    return RedirectResponse(url="/admin/integraciones?netatmo=ok")


@router.get("/api/forecast/consensus")
async def get_consensus_forecast_endpoint():
    """
    Pronóstico combinado: estación local + Open-Meteo + WeatherAPI.

    Combina múltiples fuentes para mayor precisión:
    - Prioriza datos reales de la estación si está lloviendo
    - Tendencia de presión sólo como dato (`pressure`); ya no genera avisos de
      lluvia -- ver forecast_consensus.pressure_forecast
    - Compara Open-Meteo vs WeatherAPI y muestra el más conservador
    """
    try:
        lat = settings.cwop_latitude
        lon = settings.cwop_longitude

        # Datos actuales de la estación
        current_data = state.latest_by_station.get(None)

        # Histórico de presión (últimas 4 horas)
        pressure_history = []
        try:
            rows = await state.storage.query(start="-4h", fields=["pressure_relative"])
            for r in rows:
                ts = r.get("_time")
                p = r.get("pressure_relative")
                if ts and p:
                    if isinstance(ts, str):
                        ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    pressure_history.append((ts, p))
        except Exception as e:
            logger.warning(f"No se pudo obtener histórico de presión: {e}")

        return await forecast_consensus.get_consensus_forecast(
            lat, lon,
            current_data=current_data,
            pressure_history=pressure_history,
        )
    except Exception as e:
        logger.error(f"Error en pronóstico de consenso: {e}")
        raise HTTPException(status_code=500, detail="Error generando pronóstico combinado")
