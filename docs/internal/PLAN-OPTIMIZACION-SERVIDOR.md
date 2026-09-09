# Plan — Optimización del servidor y nueva integración (openSenseMap)

> Vive en git, sobrevive cambios de PC. Iniciado 2026-09-08.
> Dos frentes de trabajo de la misma sesión: (A) cuatro sugerencias de
> optimización revisadas contra el código real, (B) investigación para
> publicar datos en openSenseMap. Se van marcando como `[x]` conforme se
> implementan.

## A. Optimizaciones internas

Estado confirmado leyendo el código (no supuesto) el 2026-09-08.

### A1. `/data/report/` bloqueante — el más urgente

**Diagnóstico:** todo el endpoint (`receiver/app/main.py:444-621`) corre
síncrono dentro del `try` que produce la respuesta HTTP:
- `storage.write()` a InfluxDB (línea 569) — bloqueante, sin `to_thread`.
- `alert_service.process()` (línea 590) — hasta ~10-25s si dispara
  Telegram + correo (`alerts.py:782-790`).
- `publish_all()` (línea 596, `publishers.py:322-357`) — llama a
  Wunderground/PWSWeather/Windy/OWM/AWEKAS **en secuencia**, 15s de timeout
  cada uno → hasta **75-90s** en el peor caso.

El análisis de IA del cielo **no** está en este endpoint (vive en
`/api/camera/upload`, ya es async con `asyncio.create_task`).

**Plan — HECHO 2026-09-09:**
- [x] Mover `alert_service.process()` y `publish_all()` a `BackgroundTasks`
      nativo de FastAPI (no Celery/Redis — sobra para este volumen, una
      estación reportando ~cada minuto). Responder al datalogger en cuanto
      se guarda en Influx + caché en memoria (`latest_by_station`).
- [x] Paralelizar `publish_all()` con `asyncio.gather` en vez de secuencial
      (reduce el peor caso de ~90s a ~15s aunque quedara algo síncrono).
- [x] `storage.write()` bloqueaba el event loop (cliente de InfluxDB
      síncrono) — envuelto en `asyncio.to_thread`.

Verificado: 154 tests pasan (7 skipped por falta de ffmpeg local), `ruff`
limpio en los 3 archivos tocados (`main.py`, `storage.py`, `publishers.py`).
Desplegado en el VPS 2026-09-08 (commit `a460fb2`) y confirmado con un push
real de la estación: guarda, responde 200 y AWEKAS/CWOP publican después,
en background, sin errores.

### A2. `ffmpeg` sin límite de hilos/prioridad

**Diagnóstico:** 3 call sites en `receiver/app/services/timelapse.py`
(líneas 281-299 encode del timelapse, 354-360 extracción de poster/frame),
ninguno usa `-threads` ni `nice`/`ionice`. Corre cada 30 min en el mismo
contenedor/VPS que el receiver vía `asyncio.create_subprocess_exec` (no
bloquea el event loop, pero compite por CPU).

**Plan — HECHO 2026-09-09:**
- [x] Agregar `-threads 2` (encode) / `-threads 1` (poster) al comando ffmpeg.
- [x] Envolver la invocación con `nice -n 19` (`nice` viene por defecto en la
      imagen `python:3.11-slim` del Dockerfile, Debian). El tercer call site
      (`shutil.which("ffmpeg")`) no ejecuta el binario, no aplica.

Tests de timelapse no se ven afectados: ni CI ni el entorno local instalan
ffmpeg, así que corren `skipif` en ambos — nada que verificar ahí más allá
de `py_compile`. Desplegado en el VPS 2026-09-09 (commit `a72dac2`),
confirmado `nice` presente en el contenedor (`/usr/bin/nice`, viene con
Debian/`python:3.11-slim`).

### A3. Backoff exponencial en llamadas a IA (Gemini/Anthropic)

**Diagnóstico:** `receiver/app/services/sky_analyzer.py:467-534` ya tiene
un retry loop manual (3 intentos, clasifica transitorio vs no en
`_es_transitorio()` líneas 427-441) pero con espera **fija de 3s**
(`asyncio.sleep(3)`, línea 532). `tenacity` no está instalado (no aparece
en `receiver/requirements.txt`).

**Plan — HECHO 2026-09-09:**
- [x] Cambiar la espera fija por exponencial (2s, 4s, 8s..., tope 30s) en el
      loop existente — no hizo falta añadir `tenacity` como dependencia
      nueva, la lógica de clasificación de errores ya era razonable.

### A4. Fallback cuando InfluxDB está caído

**Diagnóstico:** la **lectura** ya está cubierta —
`/api/current` sirve desde `latest_by_station` (caché en memoria,
`main.py:195`), no le pega a Influx en cada request. Si Influx cae, no hay
500: solo se degradan campos derivados (acumulados de lluvia, viento
promedio de 10min), cada uno en su propio try/except
(`main.py:636-676`). El punto débil real es la **escritura**: si Influx
está caído al llegar un reporte, se pierde ese punto puntual y el
datalogger recibe 500 (`storage.py:106-107` relanza la excepción).

**Plan:**
- [ ] Agregar una alerta de "InfluxDB no responde" cuando fallen escrituras
      repetidas, mismo patrón que las alertas existentes de "respaldo
      desactualizado" o "sensor perdido".
- [ ] (Opcional, baja prioridad) flag explícito de "dato desde caché" en
      `/api/current` cuando falten campos derivados de Influx.

---

## B. Integración con openSenseMap

Objetivo: publicar las lecturas de la estación principal (WS2910) también
en [opensensemap.org](https://opensensemap.org/), red ciudadana de datos
ambientales (openSenseMap / senseBox, proyecto de la Universidad de
Münster). Mismo patrón que las redes ya soportadas en
`receiver/app/services/publishers.py`.

### Investigación de la API (fuente primaria: código del controlador,
no la doc genérica de `docs.opensensemap.org` que es un SPA y no se puede
leer con fetch simple)

Fuente: [`packages/api/lib/controllers/measurementsController.js`](https://github.com/sensebox/openSenseMap-API/blob/master/packages/api/lib/controllers/measurementsController.js)
y [`boxesController.js`](https://github.com/sensebox/openSenseMap-API/blob/master/packages/api/lib/controllers/boxesController.js)
del repo [sensebox/openSenseMap-API](https://github.com/sensebox/openSenseMap-API).

**1. Registro (una sola vez, manual vía la web — no hace falta scriptearlo):**
- Crear cuenta en opensensemap.org (email + password).
- Crear una "senseBox" nueva desde su UI (**Registrar nueva senseBox** →
  modelo "otro"/custom), con `exposure: outdoor`, la ubicación de la
  estación, y **sensores personalizados** (no hay un `model` predefinido
  que encaje con un WS2910 — se arma con `sensors[]` manual: cada uno con
  `title`, `unit`, `sensorType`, `icon` opcional). Ver `POST /boxes`
  (`boxesController.js:470-500`) para la forma exacta si se prefiere
  scriptear con JWT en vez de la web.
- Activar **`useAuth: true`** al crear la caja → la API devuelve un
  `access_token` fijo que sirve para autenticar cada publicación futura
  sin necesidad de volver a loguearse (header `Authorization: <token>`).
- De la respuesta de creación se guardan: `box._id` y el `_id` de **cada
  sensor** creado (uno por variable: temperatura, humedad, presión,
  viento, dirección, ráfaga, lluvia, radiación solar, UV).

**2. Publicar mediciones — endpoint bulk, uno por ciclo de reporte:**
```
POST https://api.opensensemap.org/boxes/:boxId/data
Content-Type: application/json
Authorization: <access_token>          (si useAuth=true)

[
  {"sensor": "<sensorId_temp>", "value": "21.4"},
  {"sensor": "<sensorId_hum>",  "value": "63"},
  ...
]
```
- Máximo 2500 mediciones por request (muy por encima de lo que necesitamos:
  ~8-10 sensores por ciclo).
- También acepta formato objeto `{sensorId: value}` o CSV, pero el arreglo
  JSON es el más directo de armar desde el `data` dict ya en métrico.
- Endpoint individual `POST /boxes/:boxId/:sensorId` existe pero implicaría
  N requests por ciclo — usar el bulk.
- No se encontró documentación de rate-limit explícito en el código fuente
  revisado; el patrón natural es 1 publicación por ciclo de ingesta (~cada
  minuto), igual que las demás redes.

**3. Integración en el servidor (mismo patrón que `_windy`/`_owm`):**
- [ ] Nueva función `_opensensemap(client, data, box_id, access_token,
      sensor_map)` en `publishers.py`, arma el array JSON con los
      `sensorId` guardados en config y hace `POST /boxes/{box_id}/data`.
      Unidades: todo ya está en métrico en `data`, coincide con lo que
      openSenseMap espera (°C, %, hPa, km/h o m/s según se registre el
      sensor, mm).
- [ ] Agregar a `publish_all()` el bloque `if opensensemap_enabled...`
      igual que las demás redes, respetando `_due()`.
- [ ] Nuevas claves en `settings_store.py` (mismo patrón que `windy_*`):
      `opensensemap_enabled`, `opensensemap_box_id`,
      `opensensemap_access_token` (a `SECRET_KEYS`), `opensensemap_interval`,
      y el mapeo variable→sensorId (uno por campo, o un solo JSON con el
      mapeo completo — decidir al implementar).
- [ ] Campo en Admin → Sistema → Publicación (o donde vivan las demás
      redes) para cargar estas credenciales.
- [ ] Probar con un POST manual antes de dejarlo en el ciclo automático,
      verificando en la página de la caja en opensensemap.org que llegan
      los valores.

### Pendiente de decidir antes de implementar
- ¿Qué variables se publican? (mínimo razonable: temp, humedad, presión,
  viento, dirección, ráfaga, lluvia horaria, radiación solar, UV — mismo
  set que ya se manda a Windy/AWEKAS).
- Nombre/ubicación pública de la caja en el mapa (queda visible a
  cualquiera en opensensemap.org, a diferencia de WU/PWS que son más
  privados).
