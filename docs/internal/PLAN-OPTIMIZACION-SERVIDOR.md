# Plan — Optimización del servidor y nueva integración (openSenseMap)

> Vive en git, sobrevive cambios de PC. Iniciado 2026-09-08.
> Tres frentes de la misma sesión: (A) cuatro sugerencias de optimización
> revisadas contra el código real, (B) investigación para publicar datos en
> openSenseMap, (C) sugerencias sueltas de code review revisadas después. Se
> van marcando como `[x]` conforme se implementan.

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

**Plan — HECHO 2026-09-09 (parte obligatoria):**
- [x] Alerta de "InfluxDB no responde" — `AlertService.check_influx_write()`
      en `alerts.py`, mismo patrón que `check_camera_analysis` (N fallos
      SEGUIDOS antes de avisar, normaliza al recuperarse). Conectada en
      `main.py` tras cada intento de `storage.write()`: si falla, se llama
      directo (NO por `BackgroundTasks` — esa rama re-lanza y termina en un
      500 armado por un exception handler, que nunca ejecuta tareas en segundo
      plano agregadas antes de la excepción); si escribe bien, sí va por
      `BackgroundTasks`. Settings nuevos: `alert_influx_write_enabled`,
      `alert_influx_write_fails` (default 5). Test nuevo
      `test_influx_write_failing_then_recovery`. 155 tests pasan, `ruff` limpio.
      Desplegado en el VPS 2026-09-09 (commit `3675bee`), confirmado con
      pushes reales de ambas estaciones (principal y secundaria) sin errores.
- [ ] (Opcional, baja prioridad, sin hacer) flag explícito de "dato desde
      caché" en `/api/current` cuando falten campos derivados de Influx.

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

---

## C. Sugerencias sueltas de code review

### C1. Migrar a `lifespan` + `datetime.utcnow()` — revisado 2026-09-09

**Sugerencia recibida:** migrar `station_watchdog` y demás tareas de fondo al
patrón `lifespan` de FastAPI (en vez de `@app.on_event`, deprecado), y
corregir `datetime.utcnow()` (deprecado desde Python 3.12).

**Diagnóstico:**
- `lifespan`: válido y con problema real — `main.py` arrancaba 4 tareas de
  fondo (`station_watchdog`, `air_quality_watchdog`, `daily_rollup_task`,
  `timelapse_task`) con `asyncio.create_task` dentro de
  `@app.on_event("startup")`, y el `shutdown` **no las cancelaba**: morían
  de golpe con el proceso, sin graceful shutdown real.
- `datetime.utcnow()`: 16 usos en 8 archivos, pero el Dockerfile usa
  `python:3.11-slim` — el deprecation warning es de Python 3.12, así que
  **hoy no se emite ningún warning** en producción. Además varios puntos de
  `alerts.py` (`get_history`, `check_backup_stale`, lo que alimenta
  `check_station`) dependen A PROPÓSITO de que sean naive
  (`.replace(tzinfo=None)` para poder comparar). Cambiar los 16 usos sin
  tocar esos puntos de normalización rompería con `TypeError` en cuanto
  corriera el watchdog de estación.

**Decisión (con el usuario):** hacer `lifespan` ahora; dejar el barrido de
`datetime.utcnow()` pendiente para otra sesión (no es urgente, y merece un
cambio cuidadoso que toque los 16 usos + los `.replace(tzinfo=None)` que
dependen de ellos en conjunto, no a medias).

**Plan — HECHO 2026-09-09:**
- [x] `main.py`: reemplazados `@app.on_event("startup"/"shutdown")` por
      `@asynccontextmanager async def lifespan(app)` + `FastAPI(lifespan=...)`.
      Mismo contenido de arranque, y el shutdown ahora cancela las 4 tareas
      (`task.cancel()` + `asyncio.gather(..., return_exceptions=True)`)
      antes de cerrar InfluxDB/MQTT.
- [x] Verificado en runtime (no solo `py_compile`): smoke test desechable con
      `starlette.testclient.TestClient` como context manager, que dispara el
      ciclo completo (`lifespan` arranque → request → shutdown). Arrancó,
      `/health` respondió 200, cerró sin excepciones ni tareas colgadas.
- [x] `pytest` (155 tests, 7 skip) y `ruff` sin cambios de resultado.
- [x] Desplegado en el VPS 2026-09-09 (commit `4d3e7f9`), arranque limpio y
      confirmado con pushes reales de ambas estaciones sin errores.
- [ ] Pendiente (otra sesión): barrido completo de `datetime.utcnow()` →
      `datetime.now(timezone.utc)`, incluyendo los puntos de normalización
      naive/aware en `alerts.py`.

### C2. Concurrencia segura para `latest_by_station` — revisado 2026-09-09, SIN HACER

**Sugerencia recibida:** proteger `latest_by_station` (dict global en
memoria) con `asyncio.Lock()` por si hay condiciones de carrera.

**Diagnóstico:** no hay ningún bug activo. `receiver/Dockerfile` corre
uvicorn con 1 solo worker (un único event loop), no hay ninguna iteración
sobre el diccionario completo en todo el código (solo `.get(clave)`
puntuales), y el único patrón lectura-luego-escritura real
(`receive_ecowitt_data`, leer `prev` línea ~579 y escribir línea ~614) **no
tiene ningún `await` en medio** — todo el bloque (calibración, QC,
spike-check, derivados) es síncrono, así que asyncio no puede intercalar
otra corrutina justo ahí. Sin punto de cesión, no hay carrera posible.

**Decisión:** no se implementa. Agregar un lock no corrige nada hoy, sería
complejidad especulativa. Si en el futuro se vuelve async algo entre esa
lectura y esa escritura, hay que revisar esto de nuevo.

### C3. `calculate_dew_point`: `math.log(0)` con humedad 0% — revisado y CORREGIDO 2026-09-09

**Diagnóstico confirmado real:** `quality.py` define el rango de
`humidity_outdoor` como `(0.0, 100.0)` **inclusive** (`if v < lo or v > hi`
rechaza), así que una lectura de 0% (falla del sensor WS69, o una
calibración con offset negativo mal puesto) pasa el QC sin filtrarse y
llega a `calculate_dew_point(temp, 0.0)`, donde `math.log(0/100)` lanza
`ValueError: math domain error`. Eso tumbaba el reporte completo (excepción
no relacionada con InfluxDB, fuera del try/except de A4, cae al 500
genérico de `/data/report/` — el dato de ESE ciclo se pierde).

**Plan — HECHO:**
- [x] `calculate_dew_point()` devuelve `None` si `humidity <= 0` en vez de
      llamar a `math.log` con un valor fuera de dominio.
- [x] `calculate_derived_values()` omite `dew_point`/`humidex`/`cloud_base`
      cuando `dew` es `None` (dependen de un punto de rocío válido),
      `heat_index` sigue calculándose igual (no depende de `dew`).
- [x] Tests nuevos: `test_dew_point_zero_humidity_no_crash` (unitario,
      humedad 0 y negativa) y `test_derived_values_zero_humidity_no_crash`
      (extremo a extremo vía `calculate_derived_values`). 157 tests pasan
      (2 nuevos), `ruff` limpio.
- [x] Desplegado en el VPS 2026-09-09 (commit `8fc1a32`), confirmado con
      pushes reales de ambas estaciones sin errores.

### C4. `calculate_cloud_base` (fórmula de Espy) — revisado 2026-09-09, YA ESTABA HECHA

Sugerencia de "completar" esta función resultó estar basada en una versión
vieja del código: ya existía completa (`converter.py:239-247`, 125 m/°C de
spread, clamp a 0 si el spread es negativo), conectada en
`calculate_derived_values` y en `sky_analyzer.py`, con test propio
(`test_humidex_and_cloud_base`). Sin cambios.

---

## D. Roadmap (ideas a futuro)

Lista completa de ideas 2026-09-09: UTCI/WBGT, alertas de contingencia
ambiental (SIMAT), filtro de sismos por distancia, triggers de Home
Assistant desde el análisis del cielo. Orden de prioridad acordado:
sismos primero (rápido, bien acotado), luego HA (extiende infra
existente), UTCI/SIMAT después (necesitan más investigación externa).

### D1. Filtro de sismos por distancia/magnitud ponderada — HECHO 2026-09-09

**Diagnóstico:** `check_earthquake` (alerts.py) ya calculaba `distance_km`
para sismos del SSN y lo mostraba en el mensaje, pero **no lo usaba para
filtrar** — solo magnitud global (`alert_earthquake_magnitude`, 6.0 por
omisión). Además `_from_usgs` (earthquakes.py) **nunca calculaba
`distance_km`** en absoluto (solo la rama SSN lo hacía), así que el criterio
de cercanía no podía aplicarse a sismos que llegaran por esa fuente.

**Ojo con el diseño:** un corte de distancia simple sería contraproducente
para la CDMX — los sismos más dañinos históricamente (1985, 2017) son de
subducción del Pacífico (Guerrero/Oaxaca, ~300-500 km) y se sienten fuerte
en la ciudad pese a la distancia, por el suelo del lago. Un filtro de
"cerca únicamente" los excluiría.

**Plan — HECHO:**
- [x] Dos criterios independientes en `check_earthquake` (basta uno):
      general (`alert_earthquake_magnitude`, sin importar distancia — cubre
      la subducción lejana) O local (`alert_earthquake_near_km`/
      `alert_earthquake_near_magnitude` — un sismo dentro de ese radio no
      necesita ser tan grande). Mensaje distingue "SISMO" de "SISMO CERCANO".
- [x] `_from_usgs` ahora también calcula `distance_km` (antes solo el SSN).
- [x] Fix de paso: `_notified_quakes` estaba declarado a nivel de CLASE en
      `AlertService` (no de instancia) — invisible en producción (un solo
      singleton) pero rompía el aislamiento entre tests. Movido a `__init__`.
- [x] Settings nuevos: `alert_earthquake_near_km` (150 km), `alert_earthquake_near_magnitude`
      (4.0) — mismo patrón que `alert_earthquake_magnitude` (solo
      `settings_store.py` + `getattr`, no están en `config.py`, precedente
      ya existente para estas alertas).
- [x] Tests nuevos: 6 en `test_alerts.py` (los 4 casos del filtro + no
      renotificación + criterio general sin distance_km) y 3 en
      `test_earthquakes.py` (nuevo archivo: `_haversine_km` + wiring de
      `distance_km` en `_from_usgs` con un cliente httpx falso). 166 tests
      pasan (9 nuevos), `ruff` limpio.
- [x] Desplegado en el VPS 2026-09-09 (commit `0d31d9b`), confirmado
      pegándole directo a `/api/earthquakes` (dispara `check_earthquake`)
      sin errores.

### C5. IMECA vs NADF-009-AIRE-2017 — revisado y CORREGIDO 2026-09-09

**Sugerencia recibida:** el README dice "IMECA (norma NADF-009-AIRE-2017)",
pero esa norma retiró oficialmente el nombre IMECA; y si se calculan
promedios móviles (24h para PM10/PM2.5), aclarar en el frontend qué se
muestra.

**Verificado contra el texto oficial** (Gaceta Oficial CDMX, 14-nov-2018,
PDF de aire.cdmx.gob.mx): confirmado en ambos puntos, y encontrado algo más
grave de lo que se sospechaba:
- El nombre oficial es "Índice de Calidad del Aire"; "IMECA" es el índice
  ANTERIOR (1986-2018), derogado explícitamente (transitorio SEGUNDO).
- **La norma exige promedios móviles que el código NO calculaba en
  absoluto**: O3/NO2 → 1h (ok, ya lo hacía), pero SO2/PM10/PM2.5 → **24h
  móvil** y CO → **8h móvil** (norma §6.2). `get_imeca()` usaba
  `j["current"]` de Open-Meteo, que **confirmé con la propia doc de
  Open-Meteo que es instantáneo, no promediado** — un pico de una sola hora
  se reflejaba de inmediato en vez de suavizarse.
- Hallazgo menor de paso: las tablas de PM10 y PM2.5 (Anexo C, Tablas C.5/
  C.6) tienen DOS pendientes distintas en el tramo "Peligrosa" (301-400 y
  401-500), que el código colapsaba en una sola recta — solo importa en
  concentraciones extremas.

**Plan — HECHO:**
- [x] `imeca.py`: nueva `_moving_avg()` con la "suficiencia de información"
      de la norma §5 (≥75% de horas válidas: 6/8 para CO, 18/24 para
      SO2/PM10/PM2.5). `get_imeca()` pide `past_days=2` a Open-Meteo (soporta
      hasta 92, confirmado) para tener horas ya observadas de dónde
      promediar, y aplica la ventana correcta por contaminante (`AVG_WINDOW_H`)
      tanto al valor "ahora" como al pronóstico por hora.
- [x] Tablas `TABLE_PM10`/`TABLE_PM25`: tramo 301-500 dividido en sus dos
      sub-tramos oficiales con pendiente propia.
- [x] Terminología: README (`Calidad del aire`), `AirQualityPage.tsx` y
      `ImecaCard.tsx` ahora dicen "Índice de Calidad del Aire de la CDMX" y
      aclaran que IMECA es el nombre de costumbre que la norma vigente ya no
      usa. Etiquetas cortas (tile del kiosco, mini-card) se dejan como
      "IMECA" a propósito — es como la gente lo busca.
- [x] Tests nuevos (`test_imeca.py`, no existía antes ningún test de este
      servicio): `_moving_avg` (ventana completa, insuficiencia de datos,
      umbral exacto, fuera de rango), tablas PM10/PM2.5 corregidas, y una
      integración con cliente httpx falso que prueba el caso real: un pico
      de PM2.5 de una sola hora da índice ~66 ("Regular") promediado en 24h,
      no ~350 ("Peligrosa") como el valor instantáneo del bug anterior. 175
      tests pasan (9 nuevos), `ruff` limpio, `tsc --noEmit` limpio.
- [x] Desplegado en el VPS 2026-09-09 (commit `a3e877c`), confirmado contra
      `/api/airquality/imeca` real: pronóstico horario suave (55→56→...→72→
      ...→54), sin saltos bruscos hora a hora — la señal de que el promedio
      móvil de verdad está actuando.

### C6. Migrar Open-Meteo a AIFS/GraphCast — revisado 2026-09-09, SIN HACER

**Sugerencia recibida:** usar los modelos de IA (ECMWF AIFS, GraphCast/Google
WeatherNext) de Open-Meteo en vez del `best_match` por omisión, para mejorar
la precisión de lluvias repentinas a 24-48h en el Valle de México.

**Verificado contra la doc oficial de Open-Meteo:** ambos modelos son de
resolución NATIVA de 6 horas (AIFS) o 6h interpoladas a horaria
(`google_weathernext2_ensemble`, que además solo actualiza cada 12h y **no
predice precipitación directamente, la estima** a partir de precipitación
total + temperatura + nubosidad derivada). Para una tormenta convectiva
vespertina típica del valle (dura 1-3 h, importa el momento exacto), esto es
peor que mejor: estos modelos de IA destacan en escala sinóptica de mediano
plazo (5-10 días), no en nowcasting convectivo de corto plazo — ese terreno
lo cubren modelos regionales de alta resolución horaria (HRRR, AROME,
HARMONIE...) que Open-Meteo no ofrece para México.

**Decisión:** no se migra. El código tampoco fija un `models=` explícito
hoy (usa el `best_match`/`auto` de Open-Meteo), así que ya hereda gratis
cualquier mejora que Open-Meteo incorpore a su selección automática, sin
tocar código.

### C7. Healthchecks de Docker + alerta por Telegram — HECHO 2026-09-09

**Sugerencia recibida:** agregar `healthcheck` nativo en `docker-compose.yml`
(ninguno existía) y enlazarlo al bot de Telegram para avisar si un
contenedor queda "unhealthy" — un proceso colgado pero vivo no dispara
`restart: unless-stopped` (que solo reacciona si el proceso termina).

**Plan — HECHO:**
- [x] `docker-compose.yml`: `healthcheck` en `receiver`/`renderer` (Python
      `urllib.request` contra su propio `/health` — ninguna de las dos
      imágenes trae curl/wget garantizado), `influxdb` (`curl`, viene en su
      imagen oficial) y `dashboard` (`wget`, viene en `nginx:alpine`). Caddy
      queda fuera a propósito (su imagen no trae curl/wget; si se cae, el
      dashboard deja de responder por :80/:443 y eso ya se nota solo).
- [x] Docker/Compose NO reinicia solo por estar unhealthy (eso es de Swarm) —
      solo lo marca. `AlertService.check_docker_health()` (mismo patrón que
      `check_backup_stale`: avisa en la transición, normaliza al recuperarse)
      conectada a un nuevo endpoint `POST /api/admin/docker-health`, con
      token propio (`DOCKER_HEALTH_API_TOKEN`, mismo patrón que
      `BACKUP_API_TOKEN`).
- [x] `scripts/check-docker-health.sh` (nuevo, cron cada 5 min en el HOST):
      lee el estado de cada contenedor con `docker inspect` y avisa al
      receiver — corre fuera de los contenedores porque ninguno puede verse
      entre sí ni tiene acceso al socket de Docker. Marcado `+x` en git desde
      el commit (la lección de la sesión de hoy con los scripts de backup).
- [x] Tests nuevos en `test_alerts.py` (caída/recuperación, dos contenedores
      independientes, alerta desactivada). Smoke test real del endpoint con
      `TestClient` (401 sin token, 200 con token, 400 si `unhealthy` no es
      lista) — se descartó después de verificar, no quedó como test
      permanente (necesitaría mockear `AlertService` para no depender de
      Telegram real). 178 tests pasan (3 nuevos), `ruff` limpio.
- [x] Docs: `docs/DEPLOY.md` §8c (setup del token + cron), README (alertas
      de infraestructura).
- [x] Desplegado en el VPS 2026-09-09 (commits `1b0a1dd` + `437d52d`):
      token generado y puesto en `.env`, cron instalado (`*/5 * * * *`, sin
      pisar las líneas existentes), `check-docker-health.sh` probado a mano
      (200 OK confirmado en logs del receiver). Los 4 servicios con
      healthcheck quedaron `(healthy)` en `docker compose ps`.
      **Bug real encontrado y corregido en el camino**: el healthcheck del
      `dashboard` (`wget ... http://localhost/`) fallaba en bucle
      ("Connection refused") porque `wget` resuelve `localhost` primero a
      IPv6 (`::1`) dentro del contenedor `nginx:alpine`, donde nginx no
      escucha — cambiado a `http://127.0.0.1/` explícito (`437d52d`).
