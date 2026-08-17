"""
Renderer del display kiosco (ESP32-S3).

Chromium headless que abre la página `/kiosko?page=N` del dashboard, espera a que
marque `data-kiosk-ready="true"` y devuelve un screenshot **JPEG 1024×600**. El
ESP32-S3 solo baja esta imagen y la pinta (display tonto, sin LVGL).

- `GET /display.jpg?page=N` → JPEG, con el TTL que declara cada página.
- `GET /health`            → estado del navegador.

La respuesta lleva además la cabecera **`X-Kiosk-Nav`** con las zonas táctiles de esa
pantalla (rectángulo → página destino), que la propia página publica en el DOM. Es lo
que permite que el firmware no sepa qué páginas existen: sólo compara el toque con la
lista que acaba de recibir. Ver `docs/internal/PLAN-KIOSCO-NAVEGACION.md`.

El reloj que se ve en la imagen usa la zona horaria del contenedor (env TZ).
"""
import asyncio
import os
import re
import time
from collections import OrderedDict

from fastapi import FastAPI, Query
from fastapi.responses import Response
from contextlib import asynccontextmanager
from playwright.async_api import async_playwright

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://dashboard").rstrip("/")
WIDTH = int(os.environ.get("KIOSK_WIDTH", "1024"))
HEIGHT = int(os.environ.get("KIOSK_HEIGHT", "600"))
CACHE_TTL = float(os.environ.get("CACHE_TTL", "45"))              # segundos, por defecto
READY_TIMEOUT_MS = float(os.environ.get("READY_TIMEOUT_MS", "15000"))
# TTL de una captura hecha SIN que la página llegara a "ready". Corto a propósito:
# esa imagen lleva placeholders, y con el TTL normal se quedaba pegada en el display
# los 45 s completos --el sintoma de "tras un deploy la primera pantalla sale en
# ceros y al refrescar ya va bien"--. Con esto se corrige sola en la siguiente
# petición. No baja de 5 s para no dejar al renderer redibujando sin parar si los
# datos están caídos de verdad.
NOT_READY_TTL = float(os.environ.get("NOT_READY_TTL", "10"))
JPEG_QUALITY = int(os.environ.get("JPEG_QUALITY", "80"))
GOTO_RETRIES = int(os.environ.get("GOTO_RETRIES", "3"))           # reintentos de page.goto

# Página con la que arranca el display, y la única que se precalienta siempre.
HOME_PAGE = os.environ.get("HOME_PAGE", "consola")

# Validación de FORMA, no de lista.
#
# Antes había aquí un conjunto fijo con las seis páginas, que obligaba a tocar este
# archivo cada vez que el dashboard estrenaba una pantalla --y a acordarse de hacerlo,
# porque olvidarlo daba un 200 con la página 1 dibujada, no un error--. Con el árbol de
# navegación son treinta y tantos slugs y esa lista sería imposible de mantener
# sincronizada.
#
# Quién decide qué páginas existen es el DASHBOARD: si el slug no le suena, cae a la
# consola. Aquí sólo se comprueba que la cadena sea inofensiva antes de meterla en una
# URL.
PAGE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")

# Tope de entradas en caché. Con ~35 páginas reales sobra, y evita que pedir slugs
# inventados en bucle haga crecer la memoria sin límite: al pasarse, se tira la entrada
# más vieja (la caché es un OrderedDict usado como LRU).
CACHE_MAX = 64

_state: dict = {"browser": None, "playwright": None}
_lock = asyncio.Lock()
# page -> (timestamp, jpeg, cabecera de navegación, ttl en segundos)
_cache: "OrderedDict[str, tuple[float, bytes, str, float]]" = OrderedDict()
# Últimas páginas pedidas por alguien, de más reciente a menos. Es lo que decide qué
# se precalienta (ver _warm_loop).
_recientes: list[str] = []

WARM_INTERVAL = float(os.environ.get("WARM_INTERVAL", "20"))   # segundos entre ciclos
WARM_MAX = int(os.environ.get("WARM_MAX", "3"))    # páginas recientes por ciclo


def _cache_put(page: str, img: bytes, nav: str, ttl: float) -> None:
    _cache[page] = (time.time(), img, nav, ttl)
    _cache.move_to_end(page)
    while len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)


def _marcar_reciente(page: str) -> None:
    if page in _recientes:
        _recientes.remove(page)
    _recientes.insert(0, page)
    del _recientes[WARM_MAX:]


async def _warm_loop():
    """
    Precalienta la caché para que el display acierte siempre y no pague el render
    frío de Chromium (~1.5 s).

    ADAPTATIVO: la home y, como mucho, las `WARM_MAX` páginas pedidas más
    recientemente. Antes recorría la lista entera de páginas, que con seis se
    aguantaba pero con treinta y tantas no: el VPS tiene 2 vCPU y una vuelta completa
    serían ~50 s de Chromium a pleno rendimiento, cada ciclo y para siempre, casi todo
    dibujando pantallas que nadie está mirando.

    Además sólo se re-renderiza lo que ya EXPIRÓ según el TTL que declara cada página:
    un resumen mensual sólo cambia cuando el rollup cierra el día, así que volver a
    dibujarlo cada 20 s sería quemar CPU para pintar exactamente lo mismo.
    """
    await asyncio.sleep(6)   # deja que el dashboard arranque
    while True:
        objetivo = [HOME_PAGE] + [p for p in _recientes if p != HOME_PAGE]
        for p in objetivo[:WARM_MAX + 1]:
            try:
                entrada = _cache.get(p)
                if entrada and time.time() - entrada[0] < entrada[3]:
                    continue          # todavía vale, no se toca
                async with _lock:
                    img, nav, ttl = await _render(p)
                    _cache_put(p, img, nav, ttl)
            except Exception as e:
                print(f"[warm] pagina {p} fallo: {e}", flush=True)
            await asyncio.sleep(0.5)
        await asyncio.sleep(WARM_INTERVAL)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Un solo navegador para todo el proceso; se crea un context por render.
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )
    _state["playwright"] = pw
    _state["browser"] = browser
    warm_task = asyncio.create_task(_warm_loop())
    try:
        yield
    finally:
        warm_task.cancel()
        await browser.close()
        await pw.stop()


app = FastAPI(lifespan=lifespan, title="Ecowitt Kiosk Renderer")


async def _render(page_num: str) -> tuple[bytes, str, float]:
    """
    Abre /kiosko?page=N y devuelve (JPEG 1024×600, mapa de zonas, ttl).

    El mapa de zonas se lee del DOM justo antes de capturar, del atributo
    `data-kiosk-nav` que publica la página. Va en la MISMA respuesta que la imagen
    (cabecera `X-Kiosk-Nav`) por dos razones: el ESP32 no tiene que hacer una segunda
    petición, y sobre todo imagen y zonas no se pueden desincronizar --si viajaran
    aparte, un display podría acabar con los botones de una pantalla sobre el dibujo
    de otra--.
    """
    browser = _state["browser"]
    context = await browser.new_context(
        viewport={"width": WIDTH, "height": HEIGHT},
        device_scale_factor=1,
    )
    try:
        page = await context.new_page()
        url = f"{DASHBOARD_URL}/kiosko?page={page_num}"
        # Reintentar el goto ante fallos de red transitorios (p. ej.
        # ERR_NAME_NOT_RESOLVED justo tras recrear el contenedor dashboard:
        # el Chromium de larga vida conserva DNS viejo unos segundos).
        last_err = None
        for attempt in range(GOTO_RETRIES):
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                last_err = None
                break
            except Exception as e:
                last_err = e
                print(f"[render] goto pagina {page_num} intento {attempt + 1} falló: {e}", flush=True)
                await asyncio.sleep(1.5 * (attempt + 1))
        if last_err is not None:
            raise last_err
        listo = True
        try:
            # La página avisa cuándo tiene datos y es seguro capturar.
            await page.wait_for_selector(
                '[data-kiosk-ready="true"]', timeout=READY_TIMEOUT_MS
            )
        except Exception:
            # Si no llega a "ready" (datos caídos), capturamos igual para no
            # dejar al display en negro; mostrará placeholders "--". Pero la
            # imagen se marca como provisional para que caduque enseguida: ver
            # NOT_READY_TTL.
            listo = False
            print(f"[render] pagina {page_num} capturada SIN ready; "
                  f"ttl recortado a {NOT_READY_TTL}s", flush=True)

        # Zonas táctiles y TTL, leídos DESPUÉS del ready: hasta ese momento el layout
        # puede moverse --llega un dato y una cifra cambia de ancho-- y las medidas
        # serían las de un dibujo que ya no es el que se captura.
        nav, ttl = "", CACHE_TTL
        try:
            el = await page.query_selector("[data-kiosk-nav]")
            if el:
                nav = (await el.get_attribute("data-kiosk-nav")) or ""
                crudo = await el.get_attribute("data-kiosk-ttl")
                if crudo:
                    # Cota inferior de 5 s: una página que declarara 0 se re-renderizaría
                    # en cada petición y tumbaría los 2 vCPU ella sola.
                    ttl = max(5.0, float(crudo))
        except Exception as e:
            print(f"[render] sin mapa de zonas en {page_num}: {e}", flush=True)

        # Una captura sin datos no puede heredar el TTL largo de la página: es
        # provisional y tiene que dejar sitio al primer render bueno.
        if not listo:
            ttl = max(5.0, min(ttl, NOT_READY_TTL))

        img = await page.screenshot(
            type="jpeg",
            quality=JPEG_QUALITY,
            clip={"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT},
        )
        return img, nav, ttl
    finally:
        await context.close()


@app.get("/display.jpg")
async def display(page: str = Query(HOME_PAGE)):
    if not PAGE_RE.match(page):
        page = HOME_PAGE
    _marcar_reciente(page)

    def vigente(e):
        return e and time.time() - e[0] < e[3]

    cached = _cache.get(page)
    if vigente(cached):
        _cache.move_to_end(page)
    else:
        # Un render a la vez: evita abrir N Chromium contexts en paralelo si
        # varios displays (o refrescos) piden a la vez.
        async with _lock:
            cached = _cache.get(page)              # re-check tras tomar el lock
            if not vigente(cached):
                img, nav, ttl = await _render(page)
                _cache_put(page, img, nav, ttl)
                cached = _cache[page]

    _, img, nav, ttl = cached
    headers = {"Cache-Control": f"max-age={int(ttl)}"}
    # Sólo si la página publicó zonas. Sin la cabecera, un firmware nuevo cae a su
    # comportamiento de siempre (barra de pestañas), que es lo que mantiene vivo el
    # display si alguna pantalla se queda sin mapa.
    if nav:
        headers["X-Kiosk-Nav"] = nav
    return Response(content=img, media_type="image/jpeg", headers=headers)


@app.get("/health")
async def health():
    return {"ok": _state["browser"] is not None}
