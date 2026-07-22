"""
Renderer del display kiosco (ESP32-S3).

Chromium headless que abre la página `/kiosko?page=N` del dashboard, espera a que
marque `data-kiosk-ready="true"` y devuelve un screenshot **JPEG 1024×600**. El
ESP32-S3 solo baja esta imagen y la pinta (display tonto, sin LVGL).

- `GET /display.jpg?page=N` → JPEG (cache ~CACHE_TTL s por página).
- `GET /health`            → estado del navegador.

El reloj que se ve en la imagen usa la zona horaria del contenedor (env TZ).
"""
import asyncio
import os
import time

from fastapi import FastAPI, Query
from fastapi.responses import Response
from contextlib import asynccontextmanager
from playwright.async_api import async_playwright

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://dashboard").rstrip("/")
WIDTH = int(os.environ.get("KIOSK_WIDTH", "1024"))
HEIGHT = int(os.environ.get("KIOSK_HEIGHT", "600"))
CACHE_TTL = float(os.environ.get("CACHE_TTL", "45"))              # segundos
READY_TIMEOUT_MS = float(os.environ.get("READY_TIMEOUT_MS", "15000"))
JPEG_QUALITY = int(os.environ.get("JPEG_QUALITY", "80"))
GOTO_RETRIES = int(os.environ.get("GOTO_RETRIES", "3"))           # reintentos de page.goto
VALID_PAGES = {"1", "2", "3", "4", "5"}

_state: dict = {"browser": None, "playwright": None}
_lock = asyncio.Lock()
_cache: dict[str, tuple[float, bytes]] = {}       # page -> (timestamp, jpeg bytes)


WARM_INTERVAL = float(os.environ.get("WARM_INTERVAL", "20"))   # segundos entre ciclos


async def _warm_loop():
    """Pre-calienta la caché renderizando todas las páginas en segundo plano,
    para que las peticiones del display siempre acierten caché (respuesta ~ms) y
    no paguen el render frío de Chromium (~1.5s), sobre todo la primera vez."""
    await asyncio.sleep(6)   # deja que el dashboard arranque
    while True:
        for p in sorted(VALID_PAGES):
            try:
                async with _lock:
                    img = await _render(p)
                    _cache[p] = (time.time(), img)
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


async def _render(page_num: str) -> bytes:
    """Abre /kiosko?page=N y devuelve el JPEG 1024×600."""
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
        try:
            # La página avisa cuándo tiene datos y es seguro capturar.
            await page.wait_for_selector(
                '[data-kiosk-ready="true"]', timeout=READY_TIMEOUT_MS
            )
        except Exception:
            # Si no llega a "ready" (datos caídos), capturamos igual para no
            # dejar al display en negro; mostrará placeholders "--".
            pass
        return await page.screenshot(
            type="jpeg",
            quality=JPEG_QUALITY,
            clip={"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT},
        )
    finally:
        await context.close()


@app.get("/display.jpg")
async def display(page: str = Query("1")):
    if page not in VALID_PAGES:
        page = "1"

    cached = _cache.get(page)
    if cached and time.time() - cached[0] < CACHE_TTL:
        img = cached[1]
    else:
        # Un render a la vez: evita abrir N Chromium contexts en paralelo si
        # varios displays (o refrescos) piden a la vez.
        async with _lock:
            cached = _cache.get(page)              # re-check tras tomar el lock
            if cached and time.time() - cached[0] < CACHE_TTL:
                img = cached[1]
            else:
                img = await _render(page)
                _cache[page] = (time.time(), img)

    return Response(
        content=img,
        media_type="image/jpeg",
        headers={"Cache-Control": f"max-age={int(CACHE_TTL)}"},
    )


@app.get("/health")
async def health():
    return {"ok": _state["browser"] is not None}
