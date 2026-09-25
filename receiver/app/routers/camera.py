"""Cámara del exterior: subida de fotos, análisis del cielo con IA, foto para AWEKAS/Weathercloud y Windy, mejor foto del día y timelapse."""
import asyncio
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse

from .. import state
from ..config import settings
from ..deps import require_admin
from ..services import openmeteo, sky_analyzer, sky_validation, webcam_overlay
from ..services import security as secsvc
from ..services.almanac import sun_altitude
from ..services.timelapse import TimelapseError, TimelapseService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/camera/upload")
async def camera_upload(request: Request):
    """
    Recibe una captura del exterior. Acepta multipart (campo `file`) o el JPEG en
    crudo como cuerpo, que es lo que sale de un `curl --data-binary` desde un script.

    El cuerpo se lee A MANO en vez de declarar `file: UploadFile` en la firma: con el
    parámetro declarado, FastAPI intenta parsear como formulario CUALQUIER envío, así
    que un `--data-binary` sin `Content-Type` --lo más natural desde un script-- se
    caía con un 500 antes de llegar a la validación. Comprobado contra producción.

    Autenticación por token propio en `X-Camera-Token` (o `?token=`), NO el del panel
    de administración: esto lo va a llamar un script desatendido en una máquina de
    casa y, si ese token se filtra, lo único que permite es subir fotos.

    Sin `CAMERA_UPLOAD_TOKEN` configurado responde 503 y no guarda nada: es una ruta
    de ESCRITURA, y dejarla abierta "hasta que la configure" es como se acaban
    teniendo carpetas llenas de lo que suba cualquiera.
    """
    esperado = settings.camera_upload_token
    if not esperado:
        raise HTTPException(status_code=503, detail="Subida de cámara no configurada")

    recibido = request.headers.get("X-Camera-Token") or request.query_params.get("token") or ""
    # Comparación en tiempo constante: el token viaja por HTTP en la LAN, pero no
    # cuesta nada no filtrar su longitud ni su prefijo por el tiempo de respuesta.
    if not secrets.compare_digest(recibido, esperado):
        raise HTTPException(status_code=401, detail="Token inválido")

    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        subida = form.get("file")
        data = await subida.read() if hasattr(subida, "read") else b""
    else:
        data = await request.body()

    try:
        meta = state.camera.save(data)
    except ValueError as e:
        # 400 y no 500: el envío es el que está mal, y así el script de casa puede
        # distinguir "mi captura salió mal" de "el servidor está caído".
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        logger.error("Error guardando la captura de cámara: %s", e)
        raise HTTPException(status_code=500, detail="Error interno")
    logger.info("Cámara: captura de %d bytes recibida", meta["bytes"])

    # Análisis del cielo con visión (asíncrono, no bloquea la respuesta).
    # NO en cada captura: ver _debe_analizar (throttle por intervalo).
    has_any_key = settings.anthropic_api_key or settings.gemini_api_key
    if has_any_key and settings.camera_analysis_enabled and _debe_analizar():
        asyncio.create_task(_analyze_sky_background(data))

    return {"ok": True, **meta}


# Momento (monotónico) del último análisis DISPARADO. Empieza en 0 para que la primera
# captura tras arrancar sí analice. Se pone ANTES de lanzar el análisis, aunque falle:
# si Gemini devuelve 429 no tiene sentido reintentar a los 5 min y volver a chocar; se
# espera el intervalo completo, que es lo que respeta la cuota del tier gratuito.
_ultimo_analisis_ts = 0.0


# Si está lloviendo (rain_rate > 0) según la ÚLTIMA vez que _debe_analizar() se
# evaluó. None hasta el primer chequeo -- no dispara un análisis extra al arrancar.
_ultimo_estaba_lloviendo: Optional[bool] = None


# Cooldown mínimo (segundos) para el bypass por cambio de lluvia: sin esto, un
# rain_rate rondando el umbral (0.0/0.1 mm/h alternando por ruido del sensor)
# dispararía un análisis por cada parpadeo. 2 min es corto frente al intervalo
# normal (15 min) pero evita ráfagas.
_LLUVIA_BYPASS_COOLDOWN_S = 120


# Resultado del último intento de análisis, para el panel de diagnóstico. `ok` None
# hasta el primer intento tras arrancar.
_ultimo_analisis_resultado: Dict[str, Any] = {"ok": None, "at": None, "provider": None, "error": None}


def _registrar_analisis(provider: Optional[str], error: Optional[str]) -> None:
    """Guarda el desenlace del último análisis (lo lee /api/camera/diag)."""
    _ultimo_analisis_resultado.update({
        "ok": error is None,
        "at": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "error": error,
    })


def _debe_analizar() -> bool:
    """Throttle del análisis por `camera_analysis_interval_min`, con un bypass si
    la lluvia medida por la estación acaba de empezar o de parar.

    El análisis NO corre en cada captura: a 5 min son ~288/día y agotan la cuota diaria
    gratuita de Gemini (429), dejando el análisis congelado media tarde. Con 15 min caen
    ~72-96/día. Con el intervalo en 0 se analiza en cada captura (comportamiento previo).

    Ese mismo intervalo de 15 min deja una ventana de hasta 15 min donde la tarjeta
    muestra un análisis viejo que ya no corresponde: un chubasco pasajero que empieza
    (o termina y despeja, dejando ver la luna/estrellas) a mitad del ciclo. Como
    `rain_rate` SÍ es un dato medido y disponible en cada captura (no hace falta
    Gemini para saberlo), un cambio de estado lluvia/no-lluvia dispara un análisis
    inmediato saltándose el intervalo -- las ~2-8 veces/día que llueve, no una
    ráfaga por cada captura.
    """
    global _ultimo_analisis_ts, _ultimo_estaba_lloviendo
    interval = max(0, settings.camera_analysis_interval_min) * 60
    ahora = time.monotonic()

    rain_rate = (state.latest_by_station.get(None) or {}).get("rain_rate")
    lloviendo = bool(rain_rate and rain_rate > 0)
    cambio_lluvia = _ultimo_estaba_lloviendo is not None and lloviendo != _ultimo_estaba_lloviendo
    _ultimo_estaba_lloviendo = lloviendo

    if interval and (ahora - _ultimo_analisis_ts) < interval:
        if cambio_lluvia and (ahora - _ultimo_analisis_ts) >= _LLUVIA_BYPASS_COOLDOWN_S:
            _ultimo_analisis_ts = ahora
            return True
        return False
    _ultimo_analisis_ts = ahora
    return True


async def _current_forecast_wmo_cloudcover() -> Optional[Dict[str, Any]]:
    """Código WMO y % de nubes que predice Open-Meteo para la hora de AHORA.

    Compartido entre el endpoint `/api/camera/analysis/validation` (validación bajo
    demanda) y `_analyze_sky_background` (una validación por captura, para el
    histórico) -- ambos necesitan lo mismo: qué predijo el modelo para este momento.
    `get_forecast` ya cachea 15 min, así que llamarlo por cada captura (~5 min) no
    agrega peticiones nuevas a Open-Meteo la mayoría de las veces.
    """
    try:
        # epaper=True: el conjunto horario NORMAL (`_HOURLY` en openmeteo.py) no
        # trae `cloud_cover`, sólo el ampliado para el e-paper. Sin esto,
        # `hourly.get("cloud_cover", [0])[idx]` indexaba ese `[0]` de relleno con
        # cualquier hora que no fuera la 00:00 -> IndexError, atrapado por el
        # except de abajo, y el endpoint devolvía "sin pronóstico" TODO el día.
        forecast = await openmeteo.get_forecast(
            settings.cwop_latitude,
            settings.cwop_longitude,
            days=1,
            epaper=True,
        )
        hourly = forecast.get("hourly", {})
        times = hourly.get("time", [])
        now = _openmeteo_now_str(forecast)
        try:
            idx = times.index(now)
        except ValueError:
            idx = 0 if times else -1
        if idx < 0:
            return None
        codes = hourly.get("weather_code", [])
        clouds = hourly.get("cloud_cover", [])
        return {
            "weather_code": codes[idx] if idx < len(codes) else None,
            "cloud_cover": clouds[idx] if idx < len(clouds) else 0,
        }
    except Exception:
        return None


async def _analyze_sky_background(image_data: bytes) -> None:
    """Analiza la imagen del cielo en background y guarda el resultado."""
    try:
        station_data = dict(state.latest_by_station.get(None) or {})
        # Sol directo sin obstrucción de nubes: con el lente gran angular de esta
        # cámara, sobreexpone buena parte del encuadre durante horas (verificado con
        # fotos reales) sin que sea nubosidad -- ver sky_analyzer.sun_glare_likely()
        # y docs/archivo/PLAN-HDR-CAMARA.md (por qué no se resuelve tocando la cámara).
        try:
            lat = getattr(settings, "cwop_latitude", 19.380359)
            lon = getattr(settings, "cwop_longitude", -99.174564)
            altitude = sun_altitude(lat, lon)
            station_data["sun_glare_likely"] = sky_analyzer.sun_glare_likely(
                altitude, station_data.get("solar_radiation")
            )
        except Exception as e:
            logger.warning(f"No se pudo calcular sol_glare_likely: {e}")
        analysis = await sky_analyzer.analyze_sky(
            image_data,
            anthropic_api_key=settings.anthropic_api_key,
            gemini_api_key=settings.gemini_api_key,
            provider=settings.camera_analysis_provider,
            anthropic_model=settings.camera_analysis_model_anthropic,
            gemini_model=settings.camera_analysis_model_gemini,
            # Lecturas en vivo de la PRINCIPAL, para que el modelo no contradiga con el
            # texto lo que la propia estación ya midió (típicamente lluvia cayendo que
            # la imagen no deja ver clara). Es la misma fuente que /api/current.
            station_data=station_data,
        )
        analysis_dict = analysis.to_dict()
        # Se registra SIEMPRE el resultado del intento (éxito o error) para que el
        # panel muestre "por qué no analiza" sin escarbar en logs: el 429 de cuota
        # agotada, un timeout, etc.
        _registrar_analisis(analysis.provider, analysis.error)
        try:
            await state.alert_service.check_camera_analysis(analysis.error)
        except Exception as e:
            logger.error("Error evaluando alerta de análisis de cámara: %s", e)
        if analysis.error:
            # NO se guarda: un fallo pasajero de la API (timeout, 503 del tier
            # gratuito de Gemini) NO debe borrar el último análisis bueno. Si lo
            # guardáramos, la tarjeta del dashboard se ocultaría hasta la próxima
            # captura con éxito. Mejor dejar el anterior, que ya envejece solo con
            # su marca de tiempo.
            logger.warning("Análisis del cielo con error (%s): %s -- se conserva el anterior",
                           analysis.provider or "?", analysis.error)
        else:
            forecast_current = await _current_forecast_wmo_cloudcover()
            validation = sky_validation.validate_analysis(analysis_dict, forecast_current)
            state.camera.save_analysis(analysis_dict, validation=validation)
            logger.info("Análisis del cielo (%s): %s, %d%% nubes",
                        analysis.provider, analysis.sky_condition, analysis.cloud_coverage_pct)
            # Evaluar alertas visuales (tormenta, precipitación visible, visibilidad)
            try:
                await state.alert_service.check_sky(analysis_dict)
            except Exception as e:
                logger.error("Error evaluando alertas visuales: %s", e)
    except Exception as e:
        logger.error("Error en análisis del cielo: %s", e)
        error_msg = str(e)[:200]
        _registrar_analisis(None, error_msg)
        try:
            await state.alert_service.check_camera_analysis(error_msg)
        except Exception as e2:
            logger.error("Error evaluando alerta de análisis de cámara: %s", e2)


@router.get("/api/camera/status")
async def camera_status():
    """¿Hay foto, de cuándo es y está vieja? Lo consulta la página del kiosco."""
    return state.camera.status_with_analysis()


@router.get("/api/camera/capture-config")
async def camera_capture_config():
    """Config que la Pi lee en cada corrida para decidir si captura ahora. Pública: no
    trae secretos, y así el script no necesita el token para un simple GET."""
    return {
        "enabled": settings.camera_capture_enabled,
        "interval_min": settings.camera_capture_interval_min,
        "hour_start": settings.camera_capture_hour_start,
        "hour_end": settings.camera_capture_hour_end,
    }


@router.get("/api/camera/diag")
async def camera_diag(authorization: Optional[str] = Header(default=None)):
    """Estado consolidado para el panel: última foto, último análisis (con su error si
    lo hubo), proveedor activo y la config vigente. Así se ve 'por qué no analiza'."""
    require_admin(authorization)
    resolved = sky_analyzer.resolve_provider(
        settings.camera_analysis_provider, settings.anthropic_api_key, settings.gemini_api_key)
    return {
        "capture": {
            "enabled": settings.camera_capture_enabled,
            "interval_min": settings.camera_capture_interval_min,
            "hour_start": settings.camera_capture_hour_start,
            "hour_end": settings.camera_capture_hour_end,
            "status": state.camera.status(),
        },
        "analysis": {
            "enabled": settings.camera_analysis_enabled,
            "interval_min": settings.camera_analysis_interval_min,
            "provider_setting": settings.camera_analysis_provider,
            "active_provider": resolved,
            "has_gemini_key": bool(settings.gemini_api_key),
            "has_anthropic_key": bool(settings.anthropic_api_key),
            "model_gemini": settings.camera_analysis_model_gemini,
            "model_anthropic": settings.camera_analysis_model_anthropic,
            "last_attempt": _ultimo_analisis_resultado,
            "last_saved": state.camera.get_analysis(),
        },
        # El timelapse entra en el diagnóstico porque su fallo típico no es de datos
        # sino de despliegue: si la imagen se reconstruye sin ffmpeg, las capturas
        # siguen llegando y lo único que pasa es que el vídeo no aparece nunca.
        "timelapse": {
            "enabled": settings.camera_timelapse_enabled,
            "ffmpeg": TimelapseService.ffmpeg_available(),
            "fps": settings.camera_timelapse_fps,
            "width": settings.camera_timelapse_width,
            "min_frames": settings.camera_timelapse_min_frames,
            "retention_days": settings.camera_timelapse_retention_days,
            "disk_bytes": state.timelapse.disk_bytes(),
            "days": state.timelapse.days(),
        },
        "retention_days": settings.camera_retention_days,
        "stale_seconds": settings.camera_stale_seconds,
        "kiosk_camera_enabled": settings.kiosk_camera_enabled,
    }


@router.post("/api/camera/analyze-now")
async def camera_analyze_now(authorization: Optional[str] = Header(default=None)):
    """Fuerza el análisis de la última foto AHORA, saltándose el intervalo. Para el
    botón del panel: probar tras cambiar ajustes o refrescar a voluntad."""
    require_admin(authorization)
    if not (settings.anthropic_api_key or settings.gemini_api_key):
        raise HTTPException(status_code=400, detail="No hay API key configurada para el análisis")
    ultima = state.camera.latest()
    if ultima is None:
        raise HTTPException(status_code=404, detail="No hay ninguna foto que analizar todavía")
    data, _ = ultima
    await _analyze_sky_background(data)
    return {"status": "ok", "result": _ultimo_analisis_resultado}


@router.get("/api/camera/analysis")
async def camera_analysis():
    """Último análisis del cielo (si está habilitado y hay uno)."""
    analysis = state.camera.get_analysis()
    has_anthropic = bool(settings.anthropic_api_key)
    has_gemini = bool(settings.gemini_api_key)
    resolved = sky_analyzer.resolve_provider(
        settings.camera_analysis_provider,
        settings.anthropic_api_key,
        settings.gemini_api_key,
    )
    if analysis is None:
        return {
            "available": False,
            "enabled": settings.camera_analysis_enabled,
            "provider": settings.camera_analysis_provider,
            "active_provider": resolved,
            "has_anthropic_key": has_anthropic,
            "has_gemini_key": has_gemini,
        }
    trend = state.camera.get_trend()
    return {
        "available": True,
        "enabled": settings.camera_analysis_enabled,
        "provider": settings.camera_analysis_provider,
        "active_provider": resolved,
        "has_anthropic_key": has_anthropic,
        "has_gemini_key": has_gemini,
        "trend": trend,
        **analysis,
    }


@router.get("/api/camera/analysis/providers")
async def camera_analysis_providers():
    """Info sobre proveedores de análisis disponibles (para el panel admin)."""
    has_anthropic = bool(settings.anthropic_api_key)
    has_gemini = bool(settings.gemini_api_key)
    resolved = sky_analyzer.resolve_provider(
        settings.camera_analysis_provider,
        settings.anthropic_api_key,
        settings.gemini_api_key,
    )
    return {
        "enabled": settings.camera_analysis_enabled,
        "provider_setting": settings.camera_analysis_provider,
        "active_provider": resolved,
        "providers": sky_analyzer.PROVIDER_INFO,
        "keys_configured": {
            "anthropic": has_anthropic,
            "gemini": has_gemini,
        },
        "models": {
            "anthropic": settings.camera_analysis_model_anthropic,
            "gemini": settings.camera_analysis_model_gemini,
        },
    }


@router.get("/api/camera/analysis/history")
async def camera_analysis_history(date: Optional[str] = None):
    """
    Histórico de análisis del cielo.

    - Sin parámetros: lista los días disponibles con análisis
    - Con ?date=YYYY-MM-DD: devuelve los análisis de ese día
    """
    if date is None:
        days = state.camera.get_analysis_days()
        return {"days": days}

    # Validar formato de fecha
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (usar YYYY-MM-DD)")

    data = state.camera.get_daily_analysis(date)
    if data is None:
        raise HTTPException(status_code=404, detail=f"No hay análisis para {date}")

    # Calcular estadísticas del día
    coverages = [e.get("coverage", 0) for e in data]
    conditions = {}
    for e in data:
        c = e.get("condition", "unknown")
        conditions[c] = conditions.get(c, 0) + 1

    return {
        "date": date,
        "count": len(data),
        "stats": {
            "coverage_avg": round(sum(coverages) / len(coverages), 1) if coverages else 0,
            "coverage_min": min(coverages) if coverages else 0,
            "coverage_max": max(coverages) if coverages else 0,
            "conditions": conditions,
        },
        "entries": data,
    }


@router.get("/api/camera/analysis/validation")
async def camera_analysis_validation():
    """
    Valida el análisis del cielo contra el pronóstico actual.

    Compara lo que VE la cámara con lo que PREDICEN los modelos para
    detectar discrepancias y dar una medida de confianza.
    """
    analysis = state.camera.get_analysis()
    if not analysis or analysis.get("error"):
        return {"validated": False, "reason": "Sin análisis disponible"}

    forecast_current = await _current_forecast_wmo_cloudcover()
    result = sky_validation.validate_analysis(analysis, forecast_current)
    if not result.get("validated"):
        return result

    # Agregar info del análisis para contexto
    result["analysis"] = {
        "sky_condition": analysis.get("sky_condition"),
        "cloud_coverage_pct": analysis.get("cloud_coverage_pct"),
        "analyzed_at": analysis.get("analyzed_at"),
    }

    return result


@router.get("/api/camera/analysis/accuracy")
async def camera_analysis_accuracy(days: int = 30):
    """
    Qué tan seguido coincidió la cámara con el pronóstico en los últimos N días.

    Se arma sobre el `match` que ya se guarda por captura en el histórico diario
    (ver `CameraStore.save_analysis`) -- no recalcula nada, sólo tabula.
    """
    days = max(1, min(days, 365))
    return state.camera.get_accuracy_stats(days)


@router.get("/api/camera/best/{date}.jpg")
async def camera_best_of_day_jpg(date: str):
    """
    La foto elegida como mejor del día. Si el fotograma original ya se podó (las
    capturas completas se retienen 7 días por defecto), cae al archivo permanente
    de 1 foto/día (`CameraStore.archive_path`) antes de rendirse con 404 -- así
    la efeméride ("En este día", años atrás) puede mostrar una foto real.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (usar YYYY-MM-DD)")
    entry = state.camera.best_of_day(date)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No hay análisis para {date}")
    ruta = state.camera.frame_path(date, entry.get("ts", ""))
    if not ruta or not os.path.exists(ruta):
        ruta = state.camera.archive_path(date)
    if not ruta:
        raise HTTPException(status_code=404, detail="La foto ya no está disponible (retención de fotos)")
    return FileResponse(
        ruta,
        media_type="image/jpeg",
        # Un día cerrado no cambia; el de hoy sí puede cambiar de "mejor" según entren
        # más capturas, así que sólo se cachea un rato corto.
        headers={"Cache-Control": "max-age=600"},
    )


@router.get("/api/camera/best/{date}")
async def camera_best_of_day(date: str):
    """
    Metadato de la mejor foto del día (mayor visibilidad reportada, ver
    `CameraStore.best_of_day`). Se conserva para siempre -- vive en el análisis
    diario -- aunque la foto en sí ya se haya podado (ver el endpoint `.jpg`).

    Va DESPUÉS de `/api/camera/best/{date}.jpg` a propósito: Starlette prueba las
    rutas en el orden en que se registran, y `{date}` sin restricción hace match
    con "2026-08-29.jpg" completo (el punto no rompe el patrón). Registrada antes,
    esta ruta se comía las peticiones de la foto y respondía 400 "fecha inválida"
    en vez de dejarlas llegar al endpoint de la imagen.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (usar YYYY-MM-DD)")
    entry = state.camera.best_of_day(date)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No hay análisis para {date}")
    return entry


@router.api_route("/api/camera/latest.jpg", methods=["GET", "HEAD"])
async def camera_latest():
    """La última captura. 404 mientras no haya llegado ninguna.

    Acepta HEAD además de GET: varios servicios externos que piden una URL de
    webcam (p. ej. AWEKAS) validan el enlace con un HEAD antes de aceptarlo, y
    FastAPI/Starlette NO añade HEAD automáticamente a una ruta declarada sólo
    con GET -- sin esto, ese HEAD recibía 405 y el servicio externo rechazaba
    el enlace aunque el GET (lo que hace un navegador) funcionara perfecto.

    OJO: siempre se devuelve el cuerpo completo, sin fijarse en el método. Un
    primer intento recortaba el cuerpo a mano para HEAD (content=b"" con
    Content-Length real) -- se veía bien con el TestClient (no pasa por la red
    real) pero rompía el framing HTTP de verdad al pasar por Caddy/Cloudflare:
    anunciaban un Content-Length que nunca llegaba y el cliente se quedaba
    esperando esos bytes. Recortar el cuerpo en una respuesta HEAD es trabajo
    del servidor HTTP (uvicorn), no de la app -- dejarlo así es lo correcto."""
    ultima = state.camera.latest()
    if ultima is None:
        raise HTTPException(status_code=404, detail="Sin capturas")
    data, cuando = ultima
    return Response(
        content=data,
        media_type="image/jpeg",
        # Media cadencia: lo bastante para que un refresco no vuelva a descargarla,
        # lo bastante poco para no servir una foto vieja tras la siguiente captura.
        headers={"Cache-Control": "max-age=150", "X-Captured-At": cuando},
    )


@router.api_route("/api/camera/webcam.jpg", methods=["GET", "HEAD"])
async def camera_webcam():
    """
    Foto de la cámara + cintillo de datos de la estación, en 4:3 (800x600) --
    para publicar como webcam en redes externas (AWEKAS, Weathercloud; ver
    docs/api-reference.md para por qué esas dos y no otras). AWEKAS muestra
    la webcam en una caja ~4:3 y le añade franjas negras arriba/abajo a
    nuestra foto 16:9 si se le manda tal cual (ver services/webcam_overlay.py);
    Weathercloud no exige otra proporción, así que la misma imagen le sirve
    (campo "Webcam" del dispositivo en weathercloud.net; ~65-70 KB por
    imagen, bien por debajo de su tope de 250 KB). Mismo criterio que
    /api/camera/latest.jpg: acepta HEAD porque varios de estos servicios
    validan el enlace así.

    Se compone en cada petición (barato: un resize + dibujar texto), así que
    los datos del cintillo siempre son los más recientes, sin caché propia
    más allá de la que ya impone la cabecera.
    """
    return await _webcam_response(webcam_overlay.build_webcam_jpeg)


@router.api_route("/api/camera/webcam-wide.jpg", methods=["GET", "HEAD"])
async def camera_webcam_wide():
    """
    Igual que /api/camera/webcam.jpg pero en 16:9 (1600x900), para Windy
    Webcams: su marco es más ancho que 4:3 y a la imagen 800x600 le recortaba
    arriba y abajo. Aquí la foto va completa y el cintillo va superpuesto
    abajo (ver `webcam_overlay.build_webcam_wide_jpeg`).
    """
    return await _webcam_response(webcam_overlay.build_webcam_wide_jpeg)


# GIF transparente de 1x1: respuesta de la Tracking URL de Windy. Sirve tanto si
# Windy la llama desde su servidor como si la carga como pixel en el navegador
# de quien ve la cámara (su formulario sólo dice "Called on every webcam visit").
_PIXEL_GIF = bytes.fromhex(
    "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b"
)


_windy_limiter = secsvc.RateLimiter()


_windy_visits_logged = 0


async def _posthog_capture(event: str, properties: Dict[str, Any]) -> None:
    """Evento a PostHog desde el servidor (API pública de captura). Nunca
    lanza: la analítica no debe romper nada."""
    if not settings.posthog_project_key:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(f"{settings.posthog_host}/i/v0/e/", json={
                "api_key": settings.posthog_project_key,
                "event": event,
                # Sin perfil de persona: no sabemos quién ve la cámara en Windy,
                # sólo que alguien la vio. Un distinct_id fijo agrupa todo ahí.
                "distinct_id": "windy-webcams",
                "properties": {**properties, "$process_person_profile": False},
            })
    except Exception as e:
        logger.warning(f"PostHog: no se pudo registrar {event} ({e})")


@router.api_route("/api/camera/windy-visit", methods=["GET", "HEAD", "POST"])
async def camera_windy_visit(request: Request, background: BackgroundTasks):
    """
    "Tracking URL" de la webcam en Windy: Windy la llama en cada visita a la
    cámara. Se registra como evento `windy_webcam_view` en PostHog (mismo
    proyecto que el sitio) y se responde al instante con un pixel -- el envío
    a PostHog va en segundo plano para no hacer esperar a Windy.

    Tope GLOBAL (no por IP) de 600/min: si Windy llama desde sus propios
    servidores, todas las visitas llegan de pocas IPs y un tope por IP las
    descartaría; el global sólo evita que alguien infle el conteo a lo loco.
    """
    global _windy_visits_logged
    if request.method != "HEAD" and _windy_limiter.allow("windy", limit=600, window_s=60):
        ip = secsvc.client_ip(request)
        ua = request.headers.get("user-agent", "")[:300]
        query = {k: v[:200] for k, v in list(request.query_params.items())[:20]}
        # Las primeras llamadas se dejan en el log para ver QUÉ manda Windy
        # (parámetros, si viene de navegador o de servidor) -- no está documentado.
        if _windy_visits_logged < 20:
            _windy_visits_logged += 1
            logger.info("Windy visit: ip=%s ua=%r query=%s referer=%r", ip, ua, query,
                        request.headers.get("referer", ""))
        background.add_task(_posthog_capture, "windy_webcam_view", {
            "source": "windy",
            "$ip": ip,  # PostHog lo usa para el país (GeoIP) y lo descarta después
            "$user_agent": ua,
            "$referrer": request.headers.get("referer", ""),
            "method": request.method,
            **({"query": query} if query else {}),
        })
    return Response(content=_PIXEL_GIF, media_type="image/gif",
                    headers={"Cache-Control": "no-store, max-age=0"})


async def _webcam_response(build) -> Response:
    """Última foto + datos actuales compuestos por `build` (una de las
    variantes de services/webcam_overlay.py)."""
    ultima = state.camera.latest()
    if ultima is None:
        raise HTTPException(status_code=404, detail="Sin capturas")
    data, cuando = ultima
    weather = dict(state.latest_by_station.get(None) or {})
    # `rain_24h` es ventana móvil (integra rain_rate), NO `rain_daily` (se
    # reinicia a medianoche) -- no vive en `state.latest_by_station`, se calcula
    # aparte igual que en /api/current (ver ese endpoint, mismo criterio).
    try:
        rain_24h = await state.storage.get_rain_hours(hours=24, station=None)
        if rain_24h is not None:
            weather["rain_24h"] = rain_24h
    except Exception as e:
        logger.error(f"Error calculando rain_24h para el cintillo de webcam: {e}")
    try:
        jpeg = build(data, weather)
    except Exception as e:
        logger.error(f"Error componiendo la imagen de webcam: {e}")
        raise HTTPException(status_code=500, detail="No se pudo generar la imagen")
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "max-age=150", "X-Captured-At": cuando},
    )


@router.get("/api/camera/days")
async def camera_days():
    """Días con histórico y cuántas capturas tiene cada uno (para el timelapse)."""
    return {"retention_days": settings.camera_retention_days, "days": state.camera.days()}


@router.get("/api/camera/timelapse/days")
async def timelapse_days():
    """Qué días tienen vídeo (o fotogramas para hacerlo), del más nuevo al más viejo."""
    return {
        "enabled": settings.camera_timelapse_enabled,
        "ffmpeg": TimelapseService.ffmpeg_available(),
        "fps": settings.camera_timelapse_fps,
        "min_frames": settings.camera_timelapse_min_frames,
        "retention_days": settings.camera_timelapse_retention_days,
        "frames_retention_days": settings.camera_retention_days,
        "disk_bytes": state.timelapse.disk_bytes(),
        "days": state.timelapse.days(),
    }


@router.get("/api/camera/timelapse/{date}.mp4")
async def timelapse_video(date: str):
    """
    El vídeo del día. Si todavía no existe se pone a generarlo EN SEGUNDO PLANO y
    responde 202: el encode tarda segundos y dejar la petición colgada mientras corre
    ffmpeg daría un tiempo de espera raro en el navegador (y varias peticiones a la vez
    encolarían encodes). La web consulta `timelapse/days` y vuelve a pedirlo.
    """
    if not settings.camera_timelapse_enabled:
        raise HTTPException(status_code=404, detail="El timelapse está deshabilitado")
    try:
        st = state.timelapse.status(date)
    except TimelapseError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if st["video"]:
        return FileResponse(
            state.timelapse.video_path(date),
            media_type="video/mp4",
            filename=f"timelapse-{date}.mp4",
            # Un día cerrado no cambia nunca; el de hoy sí, según entran capturas.
            headers={"Cache-Control": "max-age=300" if st["stale"] else "max-age=86400"},
        )

    if st["generating"]:
        raise HTTPException(status_code=202, detail="El vídeo se está generando")
    if not st["enough_frames"]:
        raise HTTPException(
            status_code=404,
            detail=f"{date}: sólo hay {st['frames']} captura(s); "
                   f"hacen falta {settings.camera_timelapse_min_frames}",
        )
    if not TimelapseService.ffmpeg_available():
        raise HTTPException(status_code=503, detail="ffmpeg no está disponible en el servidor")

    asyncio.create_task(_timelapse_generar(date))
    raise HTTPException(status_code=202, detail="Generando el vídeo; vuelve a pedirlo en un momento")


@router.get("/api/camera/timelapse/{date}.jpg")
async def timelapse_poster(date: str):
    """
    Cartel del vídeo de ese día: lo usa el `poster` del `<video>` para no enseñar un
    rectángulo negro. 404 si aún no hay vídeo --el reproductor entonces se comporta
    como antes, que es el estado del que se viene--.
    """
    try:
        ruta = state.timelapse.poster_path(date)
    except TimelapseError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not os.path.exists(ruta):
        raise HTTPException(status_code=404, detail="Sin cartel para ese día")
    return FileResponse(
        ruta,
        media_type="image/jpeg",
        # El cartel de un día cerrado no cambia; el de hoy se rehace con el vídeo.
        headers={"Cache-Control": "max-age=3600"},
    )


@router.post("/api/camera/timelapse/{date}")
async def timelapse_regenerate(date: str, authorization: Optional[str] = Header(default=None)):
    """Rehace el vídeo de un día aunque ya exista (botón del panel)."""
    require_admin(authorization)
    if not TimelapseService.ffmpeg_available():
        raise HTTPException(status_code=503, detail="ffmpeg no está disponible en el servidor")
    try:
        return await state.timelapse.ensure(date, force=True)
    except TimelapseError as e:
        raise HTTPException(status_code=400, detail=str(e))


async def _timelapse_generar(date: str) -> None:
    """Encode en segundo plano. Se traga los errores: ya quedan en el log y el estado
    del día los vuelve a contar solo (sigue sin vídeo)."""
    try:
        await state.timelapse.ensure(date)
    except TimelapseError as e:
        logger.warning("timelapse %s: %s", date, e)
    except Exception as e:
        logger.error("timelapse %s falló: %s", date, e)


def _openmeteo_now_str(forecast: dict) -> str:
    """
    "YYYY-MM-DDTHH:00" de AHORA en la zona que usó Open-Meteo para las horas de
    ESTE pronóstico. Con `timezone=auto` el `hourly.time` viene en hora LOCAL sin
    sufijo (p. ej. "2026-08-19T14:00", ni "Z" ni offset), y la respuesta trae
    `utc_offset_seconds` para ese sitio -- se usa ESE, no la zona del contenedor,
    para no depender de que `TZ` en el .env coincida con la lat/lon pedida (el
    default de docker-compose.yml es `TZ=UTC`; sólo coincide hoy porque el .env
    de este despliegue lo fija a America/Mexico_City).
    """
    offset_s = forecast.get("utc_offset_seconds") or 0
    local_now = datetime.now(timezone.utc) + timedelta(seconds=offset_s)
    return local_now.strftime("%Y-%m-%dT%H:00")
