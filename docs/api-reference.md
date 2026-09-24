# API Reference

Documentación de la API REST del servidor Ecowitt Weather Station.

## Base URL

```
http://localhost:8080            # en el servidor
https://clima.xe1e.net           # producción (vía Cloudflare/HTTPS)
```

## Endpoints

### Health Check

Verifica el estado del servicio.

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "version": "1.0.0"
}
```

---

### Receive Data (Internal)

Endpoint para recibir datos del gateway Ecowitt. No usar directamente.

```http
POST /data/report/
Content-Type: application/x-www-form-urlencoded
```

**Response:**
```json
{
  "status": "success",
  "message": "Data received"
}
```

---

### Current Weather Data

Obtiene los datos meteorológicos más recientes.

```http
GET /api/current
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `station` | string | *(principal)* | Nombre de una estación **secundaria** (p. ej. `gw1100`). Omitir = estación principal |

**Response:**
```json
{
  "temperature_outdoor": 25.3,
  "temperature_indoor": 22.1,
  "humidity_outdoor": 65,
  "humidity_indoor": 45,
  "pressure_relative": 1013.2,
  "pressure_absolute": 1010.5,
  "wind_speed": 12.5,
  "wind_gust": 18.2,
  "wind_direction": 180,
  "rain_rate": 0.0,
  "rain_daily": 2.5,
  "rain_weekly": 15.3,
  "rain_monthly": 45.2,
  "rain_yearly": 320.5,
  "solar_radiation": 450.2,
  "uv_index": 5,
  "dew_point": 18.2,
  "feels_like": 26.1,
  "humidex": 27.3,
  "cloud_base": 890,
  "station_type": "WS2910_V1.0.0",
  "model": "WS69",
  "received_at": "2024-01-15T14:30:00.000Z"
}
```

**Error Response (404):**
```json
{
  "detail": "No data available yet"
}
```

---

### Historical Data

Obtiene datos históricos en un rango de tiempo.

```http
GET /api/history
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start` | string | `-24h` | Inicio del rango. Formatos: `-24h`, `-7d`, `2024-01-01T00:00:00Z` |
| `stop` | string | `now()` | Fin del rango. Formatos: `now()`, `2024-01-02T00:00:00Z` |
| `measurement` | string | `weather` | Nombre del measurement en InfluxDB |
| `station` | string | *(principal)* | Estación **secundaria** (p. ej. `gw1100`); omitir = principal |
| `format` | string | `json` | `json` (default) o `csv` para descargar el mismo rango como archivo (`Content-Disposition: attachment`) |

**Examples:**

```bash
# Últimas 24 horas
curl "http://localhost:8080/api/history"

# Últimos 7 días
curl "http://localhost:8080/api/history?start=-7d"

# Rango específico
curl "http://localhost:8080/api/history?start=2024-01-01T00:00:00Z&stop=2024-01-02T00:00:00Z"

# Descargar como CSV
curl -OJ "http://localhost:8080/api/history?start=-7d&format=csv"
```

**Response:**
```json
{
  "data": [
    {
      "_time": "2024-01-15T14:00:00.000Z",
      "temperature_outdoor": 24.5,
      "humidity_outdoor": 68,
      "wind_speed": 10.2
    },
    {
      "_time": "2024-01-15T14:01:00.000Z",
      "temperature_outdoor": 24.6,
      "humidity_outdoor": 67,
      "wind_speed": 11.0
    }
  ]
}
```

---

### Daily Statistics

Obtiene estadísticas del día (mínimo, máximo, promedio).

```http
GET /api/stats/daily
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start` | string | `-24h` | Ventana Flux: `-24h`, `-7d`, `-30d`… |
| `station` | string | *(principal)* | Estación **secundaria** (p. ej. `gw1100`); omitir = principal |

**Response:**
```json
{
  "period": "24h",
  "stats": {
    "temperature_outdoor": {
      "min": 18.2,
      "max": 28.5,
      "avg": 23.4
    },
    "humidity_outdoor": {
      "min": 45,
      "max": 85,
      "avg": 65
    },
    "wind_speed": {
      "min": 0.0,
      "max": 25.3,
      "avg": 8.5
    },
    "wind_gust": {
      "min": 0.0,
      "max": 42.1,
      "avg": 15.2
    },
    "rain_daily": {
      "min": 0.0,
      "max": 2.5,
      "avg": 2.5
    },
    "pressure_relative": {
      "min": 1010.5,
      "max": 1015.2,
      "avg": 1012.8
    }
  },
  "generated_at": "2024-01-15T14:30:00.000Z"
}
```

---

### Más endpoints

Todos bajo la misma base. Devuelven JSON.

| Endpoint | Descripción |
|----------|-------------|
| `GET /api/stats/records?start=-30d` | Estadísticas (mín/máx/prom con fecha del extremo) sobre un rango |
| `GET /api/compare` | Últimas 24 h vs 24 h previas ("vs ayer") |
| `GET /api/forecast?lat=&lon=` | Pronóstico Open-Meteo con caché en el servidor. Si el origen falla sirve la última copia buena, marcada con `stale` y `age_minutes` |
| `GET /api/forecast/local` | Pronóstico local por tendencia barométrica (dato propio) |
| `GET /api/forecast/own` | "Nuestro pronóstico": pluviómetro + cámara + estaciones vecinas, en ese orden de autoridad (`forecaster.own_forecast`). No depende de Open-Meteo/WeatherAPI y, desde 2026-09-23, **ya no usa la presión** (verificada contra el pluviómetro no anticipaba las tormentas). Sin nada que decir devuelve `source: "none"` |
| `GET /api/forecast/consensus` | Pronóstico combinado: estación + Open-Meteo + WeatherAPI. La tendencia de presión va sólo como dato (`pressure`): desde 2026-09-23 ya no genera avisos de lluvia |
| `GET /api/smn?ides=9&idmun=14&hourly=1` | Pronóstico oficial del SMN (CONAGUA) por municipio (por defecto Benito Juárez, CDMX). `hourly=0` omite el horario |
| `GET /api/smn/municipios` | Lista de municipios del SMN (para búsqueda/autocompletar) |
| `GET /api/nearby-stations?lat=&lon=` | Estaciones vecinas (Xweather + Netatmo) con `incoming_rain`. Sin ninguna red configurada devuelve la lista vacía, no error |
| `GET /api/stations` · `GET /api/stations/<nombre>` | Estaciones registradas con su estado actual / detalle de una (`principal` = la principal). `PUT /api/stations/<nombre>` actualiza su configuración y **requiere admin** |
| `GET /api/rain/last` | Fecha/hora de la última lluvia registrada (`rain_rate > 0`). Acepta `station` |
| `GET /api/rain/hours?hours=2` | Lluvia acumulada en las últimas N horas (máx 24). Acepta `station` |
| `GET /api/rain/daily?days=7` | Lluvia por día local de los últimos N días (histograma de la consola). Acepta `station` |
| `GET /api/climate/records` | Récords: de siempre, por mes calendario, este mes/año, ayer |
| `GET /api/climate/onthisday` | Efeméride: mismo día en años previos |
| `GET /api/climate/noaa?year=YYYY&month=MM` | Reporte climatológico NOAA (mensual con `month`, anual sin él) |
| `GET /api/wind/rose?start=-7d` | Rosa de vientos (16 sectores, frecuencia y velocidad) |
| `GET /api/almanac` | Almanaque: sol, crepúsculos, luna y planetas |
| `GET /api/alerts` | Alertas activas |
| `GET /api/alerts/history?hours=24&limit=50` | Historial reciente (activadas y, si ya se normalizaron, con `resolved_at`). En memoria del proceso (hasta 100 entradas) -- un reinicio del receiver lo vacía, no es un log persistente |
| `GET /api/metar?station=MMMX` | METAR del aeropuerto (proxy a aviationweather.gov) |
| `GET /api/taf?station=MMMX` | TAF (pronóstico de aeródromo) del aeropuerto |
| `GET /api/satellite?layer=&date=&lat=&lon=` | Imagen satelital NASA GIBS (JPEG, proxy con caché en el servidor) |
| `GET /api/radar/sacmex` | Últimos cuadros (~10, uno cada ~5 min) del radar del SACMEX con su hora UTC, `latest_age_minutes` y `stale`. Se lee su página cada 5 min (no se deja incrustar: `X-Frame-Options: SAMEORIGIN`) — ver `services/sacmex_radar.py` |
| `GET /api/radar/sacmex/archive` | Historial propio de cuadros del radar SACMEX: cuadros y MB por día (`radar_archive_dir`, se guardan cada 5 min en segundo plano; se borran pasados `radar_archive_days`, 45 por defecto) |
| `GET /api/radar/sacmex/decoded/<id>` | Los ecos que lee el decodificador de dBZ (`services/radar_decode.py`) en un cuadro: PNG transparente 702×512 con los colores de la escala, para compararlo encima del original. 503 hasta que el historial tenga ≥10 cuadros para sacar el fondo |
| `GET /api/radar/sacmex/<id>` | Un cuadro del radar SACMEX (JPEG 702×512, servido desde la caché; el id se valida contra el patrón del nombre) |
| `GET /api/airquality?lat=&lon=` | Calidad del aire (WAQI); requiere `WAQI_TOKEN` |
| `GET /api/airquality/imeca?lat=&lon=` | IMECA estimado (NADF-009-AIRE-2017) desde concentraciones de Open-Meteo |
| `GET /api/earthquakes` | Sismos recientes (fuente híbrida SSN → USGS) |
| `GET /api/svitrix` | Dato actual con forma WeatherAPI `current.json` para el reloj SVITRIX (ver abajo) |
| `GET /api/bim32` | JSON compacto para el firmware BIM32 (ESP32, ver abajo) |
| `GET /api/bim32/history?period=30` | Historial exterior en baldes de `period` minutos, para BIM32 (ver abajo) |
| `GET /api/epaper/forecast.json` | Dato con forma WeatherAPI `forecast.json` para el e-paper LilyGo 4.7" (ver abajo) |
| `GET /api/summaries/daily?days=30` | Resúmenes diarios crudos, una fila por día. Alimenta los detalles de 7 y 30 días del kiosco. Incluye `humidex_max` y `humidex_max_time` desde 2026-08-08 (los días anteriores se rellenaron con `backfill(force=True)`). Acepta `format=csv` para descargarlo directo |
| `GET /api/kiosk/config` | Config pública de las páginas del kiosco (de momento sólo `camera_enabled`) |
| `GET /api/kiosk/local` · `POST /api/kiosk/local` | Última lectura del BME280 del display + mín/máx del día / la recibe (`temperature`, `humidity`, `pressure`) |
| `GET /api/camera/status` | Estado de la cámara del exterior (ver abajo) |
| `GET /api/camera/capture-config` | Config que lee la Pi en cada corrida para decidir si captura (sin secretos) |
| `GET`/`HEAD /api/camera/latest.jpg` | Última captura, con la cabecera `X-Captured-At`. Sirve para enlazarla como webcam en servicios externos (p. ej. AWEKAS) — acepta HEAD porque varios de esos servicios validan el enlace así antes de aceptarlo |
| `GET`/`HEAD /api/camera/webcam.jpg` | Igual, pero recompuesta en 4:3 (800×600) con un cintillo de datos de la estación abajo — para AWEKAS/Weathercloud (ver abajo) |
| `GET`/`HEAD /api/camera/webcam-wide.jpg` | Variante 16:9 (1600×900) con el cintillo superpuesto abajo — para Windy Webcams (ver abajo) |
| `GET`/`HEAD`/`POST /api/camera/windy-visit` | "Tracking URL" de Windy: responde un GIF 1×1 y registra la visita en PostHog (ver abajo) |
| `GET /api/camera/days` | Días con histórico y cuántas capturas tiene cada uno |
| `GET /api/camera/analysis` | Último análisis del cielo + tendencia (nowcasting) |
| `GET /api/camera/analysis/providers` | Proveedores de análisis disponibles, el activo y si hay claves configuradas (para el panel) |
| `GET /api/camera/analysis/validation` | Validación en vivo vs pronóstico de Open-Meteo |
| `GET /api/camera/analysis/accuracy?days=30` | % de acierto vs pronóstico de los últimos N días (ver abajo) |
| `GET /api/forecast/verification?days=30` | ¿Qué fuente ACIERTA? Cada pronóstico calificado contra el pluviómetro (lluvia) y la cámara (nubosidad) (ver abajo) |
| `GET /api/camera/analysis/history` | Días con análisis, o `?date=` para la curva de un día |
| `GET /api/camera/best/<fecha>` · `GET /api/camera/best/<fecha>.jpg` | Metadato y foto de mejor visibilidad de ese día (ver abajo) |
| `GET /api/camera/timelapse/days` | Qué días tienen vídeo (o fotogramas para montarlo) |
| `GET /api/camera/timelapse/<fecha>.mp4` | El timelapse de ese día (ver abajo) |
| `GET /api/camera/timelapse/<fecha>.jpg` | Cartel (`poster`) del vídeo de ese día; `404` si aún no hay vídeo |
| `POST /api/camera/timelapse/<fecha>` | Rehace el vídeo del día. **Requiere admin** |
| `POST /api/camera/upload` | Recibe una captura. **Requiere token** (ver abajo) |

### Cámara del exterior

La cámara vive en la red de casa, detrás del NAT, y el servidor en el VPS: no se va a
buscar la foto, **la empuja** un proceso local (ver
`docs/archivo/PLAN-CAMARA-EXTERIOR.md`). Cadencia acordada: **cada 5 minutos**.

```
POST /api/camera/upload
X-Camera-Token: <CAMERA_UPLOAD_TOKEN>
Content-Type: image/jpeg          # o multipart con el campo `file`

<bytes del JPEG>
```

```bash
curl -H "X-Camera-Token: $TOKEN" --data-binary @foto.jpg \
     https://clima.xe1e.net/api/camera/upload
```

| Respuesta | Cuándo |
|---|---|
| `200` | Guardada. Devuelve `{ok, captured_at, bytes}` |
| `400` | El cuerpo no es un JPEG, o es absurdamente grande o pequeño |
| `401` | Falta el token o no coincide |
| `503` | `CAMERA_UPLOAD_TOKEN` sin configurar: la subida está deshabilitada |

El token es **propio**, no el del panel de administración: lo lleva un proceso
desatendido y, si se filtra, sólo permite subir fotos.

```json
GET /api/camera/status
{
  "available": true,
  "captured_at": "2026-08-07T01:57:04+00:00",
  "age_seconds": 240,
  "stale": false,          // true pasados CAMERA_STALE_SECONDS (900 = 15 min)
  "bytes": 118826
}
```

Con `available: false` la web oculta la tarjeta de Inicio y el kiosco muestra «sin
imagen»; con `stale: true` ambos marcan **FOTO ANTIGUA** sobre la propia imagen.

**Enlace de webcam para servicios externos (AWEKAS y similares):** `GET
/api/camera/latest.jpg` (por el dominio, HTTPS) es correcto y funciona bien con
cualquier cliente normal (navegador, curl, Python) — verificado. Pero **AWEKAS
no pudo bajarla** (mostraba su ícono propio de "Imagen no encontrada") mientras
Cloudflare estuviera de por medio; el servidor de AWEKAS parece toparse con
algo del proxy de Cloudflare (bloqueo/desafío) que un cliente normal no ve —
mismo patrón que ya se dio antes con otro proceso automatizado externo
(`cf-mitigated: challenge`, ver `scripts/captura-camara.sh`). **Solución
verificada (2026-09-01):** dar el enlace directo al VPS, sin pasar por
Cloudflare — mismo puerto que ya usa el WS2910 para el push, así que no abre
nada nuevo:

```
http://<IP_DEL_VPS>:8080/api/camera/latest.jpg
```

Si algún día otro servicio externo rechaza el link de la cámara con un error
parecido, probar primero esta URL directa antes de suponer que el archivo está
mal — probablemente sea el mismo bloqueo de Cloudflare a fetches server-to-server.

**Formato especial con cintillo de datos (`/api/camera/webcam.jpg`,
2026-09-14, nombre genérico a propósito -- lo usan varias redes, no solo
una):** nació para AWEKAS, cuya caja de webcam es ~4:3 (verificado con una
captura real: 540×404, centrando nuestra foto 16:9 con franjas negras arriba
y abajo). En vez de dejarlas en negro, este endpoint compone un lienzo
800×600 propio: la foto se reescala a 800 de ancho SIN recortar ni
distorsionar (a 16:9 sobran exactamente 148 px) y ese espacio se llena con un
cintillo — encabezado "XE1E STATION · Mexico City" + "clima.xe1e.net", y 6
columnas de ancho variable, medido contra la fuente real para que ninguna
quede apretada (temperatura, humedad, presión, lluvia 24h + tasa, viento +
rumbo, radiación + UV), tomadas de `/api/current` en el momento de la
petición. Ver `services/webcam_overlay.py`. Usa la misma URL directa al VPS
que `latest.jpg` (mismo bloqueo de Cloudflare aplica):

```
http://<IP_DEL_VPS>:8080/api/camera/webcam.jpg
```

**Variante 16:9 para Windy Webcams (`/api/camera/webcam-wide.jpg`,
2026-09-23).** Windy muestra la webcam en un marco más ancho que 4:3: con la
imagen 800×600 de arriba recortaba arriba y abajo (el ancho quedaba entero).
Esta variante es 1600×900 exacto: la foto (ya ~16:9, 1600×904) va completa y el
mismo cintillo, escalado 1.5×, se superpone semitransparente sobre la franja de
abajo (suelo/edificios) en vez de añadir alto. La de 4:3 NO cambió (AWEKAS y
Weathercloud siguen con ella). ~120 KB.

```
http://<IP_DEL_VPS>:8080/api/camera/webcam-wide.jpg
```

**Tracking URL de Windy (`/api/camera/windy-visit`, 2026-09-23).** El
formulario de la webcam en Windy tiene un campo "Tracking URL — Called on every
webcam visit". Apunta ahí:

```
http://<IP_DEL_VPS>:8080/api/camera/windy-visit
```

Responde al instante un GIF de 1×1 (sirve tanto si Windy lo llama desde su
servidor como si lo carga como pixel en el navegador del visitante) y manda en
segundo plano el evento `windy_webcam_view` a PostHog (mismo proyecto que el
sitio, `distinct_id` fijo `windy-webcams`, sin perfil de persona; `$ip` para el
país). Tope global de 600/min. Las primeras 20 llamadas tras cada arranque se
dejan en el log (`grep "Windy visit"`) para ver qué parámetros manda Windy, que
no lo documenta. La "Stream URL" se deja vacía: es para video en vivo y la cámara
publica fotos periódicas a propósito.

**También conectado a Weathercloud (2026-09-14).** De las 9 redes a las que
publicamos (`publishers.py`), investigado cuáles soportan webcam en el perfil
de la estación: **solo Weathercloud** tiene esa función activa y documentada
además de AWEKAS — campo "Webcam" en weathercloud.net (Dispositivos → Editar),
con tope de 250 KB (nuestra imagen pesa ~65-70 KB, sin margen que cuidar) y
sin requisito de proporción, así que usa la misma URL de arriba tal cual. El
resto se descartó con evidencia, no por omisión: Weather Underground
**discontinuó** su servicio de webcam el 2021-10-21; PWSWeather, WOW-BE y
OpenWeatherMap no tienen esa función documentada; Windy sí tiene "Webcams"
pero es un sistema aparte (mapa comunitario con moderación manual, no ligado
al perfil de la estación); openSenseMap y CWOP no soportan imágenes por
diseño (el primero solo acepta valores numéricos, el segundo es un protocolo
de texto vía APRS).

### Precisión del pronóstico y mejor foto del día

Desde 2026-08-29 cada captura analizada guarda también si coincidió con el
pronóstico de ese instante (antes esto sólo se calculaba al vuelo, en cada visita
al dashboard, y se descartaba). `GET /api/camera/analysis/accuracy` tabula esos
datos ya guardados:

```json
GET /api/camera/analysis/accuracy?days=30
{
  "days_requested": 30,
  "days_with_data": 22,
  "total": 187,
  "counts": {"exact": 96, "close": 45, "differ": 34, "conflict": 12},
  "pct": {"exact": 51.3, "close": 24.1, "differ": 18.2, "conflict": 6.4}
}
```

`/api/camera/analysis/accuracy` sólo dice si la cámara y Open-Meteo *coincidieron*,
no quién tenía razón. Para eso está `GET /api/forecast/verification?days=30`
(`services/forecast_verification.py`), que califica cada fuente contra lo
OBSERVADO: el pluviómetro (`rain_total`, >= 0.2 mm) para lluvia y la cámara para
nubosidad. Dos horizontes:

- `now` -- ¿llueve ahora? (±30 min alrededor de cada foto de día). Fuentes:
  Open-Meteo y la cámara; retroactivo desde el histórico diario de la cámara.
- `next3h` -- ¿lloverá en 3 h? La presión propia se reconstruye de InfluxDB
  (se sigue calificando, rotulada "ya no se usa": desde 2026-09-23 no alimenta
  `/api/forecast/own`);
  Open-Meteo/WeatherAPI/SMN (avisan con probabilidad >= 50%), "nuestro
  pronóstico" (`/api/forecast/own`) y la tendencia de la cámara salen de una
  bitácora nueva (`<forecast_log_dir>/YYYY-MM-DD.json`, una foto cada 30 min,
  120 días) y sólo cuentan desde que existe.

En ambos horizontes se agrega una referencia "a vencer", `climatology`: avisar
lluvia sólo por la hora local (14-20 h), sin mirar nada más. Una fuente que no
la supera no aporta información.

Por fuente: aciertos/fallos/falsas alarmas, POD, FAR y CSI ("acierto en lluvia",
la métrica del ranking: no premia decir siempre "no llueve"); por hora local
(`by_hour`) y CSI móvil de 7 días (`trend`). `sky` da el sesgo de nubosidad de
Open-Meteo frente a la cámara. `days` se acota a 1-60. Caché de 10 min.

`GET /api/camera/best/<fecha>` elige, de ese día, la entrada con mayor visibilidad
reportada (excluye la noche salvo que el día entero lo haya sido); a igual
visibilidad --el caso casi siempre, medido: ~95% de las capturas salen "good"--
desempata el tipo de nube más "interesante" (`sky_analyzer.CLOUD_TYPE_INTEREST`:
cumulonimbus/altocumulus por encima de estratos lisos), y a empate total, la
primera del día:

```json
GET /api/camera/best/2026-08-29
{"ts": "2026-08-29T15:00:00Z", "condition": "clear", "cloud_type": "clear",
 "visibility": "excellent", "coverage": 5, "precip": false}
```

`GET /api/camera/best/<fecha>.jpg` sirve esa foto. El metadato se conserva para
siempre (vive en el análisis diario), pero la foto original puede haberse podado ya
--las capturas se retienen 7 días por defecto, mucho menos que el análisis--. Antes
de responder `404`, cae al archivo permanente de "1 foto por día"
(`<camera_dir>/archive/YYYY-MM-DD.jpg`, ver `CameraStore.archive_best_photo`): la
mejor foto de cada día se copia ahí para siempre (día ya cerrado, nunca el de hoy),
que es lo que permite mostrar una foto real en la efeméride "En este día"
(`/api/climate/onthisday`) años después de que la carpeta del día se haya podado.

### Timelapse diario

Las capturas archivadas de un día (`<camera_dir>/YYYY-MM-DD/HHMMSS.jpg`) se juntan en un
**MP4** con ffmpeg, **en el VPS**. La alternativa —animar los JPEG en el navegador— se
descartó: a tamaño completo son ~50 MB de tráfico por día, y reducirlo pedía otra
dependencia más un reproductor a mano, para acabar con algo que no se comparte ni se
busca.

```json
GET /api/camera/timelapse/days
{
  "enabled": true,
  "ffmpeg": true,               // false = la imagen se construyó sin ffmpeg
  "fps": 12,
  "min_frames": 10,
  "retention_days": 90,         // de los VÍDEOS (los fotogramas duran 7)
  "frames_retention_days": 7,
  "disk_bytes": 4194304,
  "days": [
    {
      "date": "2026-08-18",
      "frames": 168,            // capturas archivadas de ese día
      "video": true,
      "bytes": 2097152,
      "fps": 12,
      "seconds": 14.0,
      "frames_used": 168,       // con cuántas se montó el vídeo que hay
      "stale": false,           // true = han llegado capturas nuevas desde el montaje
      "generating": false,
      "enough_frames": true
    }
  ]
}
```

```
GET /api/camera/timelapse/2026-08-18.mp4
```

| Respuesta | Cuándo |
|---|---|
| `200` | El vídeo, `Content-Type: video/mp4`. `max-age=86400` si el día está cerrado |
| `202` | No existe todavía: **se ha puesto a generarlo** en segundo plano. Volver a pedirlo |
| `400` | La fecha no es `YYYY-MM-DD` |
| `404` | Ese día no junta `min_frames` capturas, o el timelapse está deshabilitado |
| `503` | El servidor no tiene ffmpeg |

El `202` es deliberado: el encode tarda segundos y dejar la petición colgada daría una
espera muda en el navegador. La web consulta `timelapse/days` y vuelve a pedirlo.

**Quién mantiene el vídeo.** Una tarea del servidor refresca el de **hoy** cada 30 min
según entran capturas y cierra el de **ayer**; el endpoint público **no** rehace un
vídeo que ya existe aunque le falten las últimas capturas (`stale: true`), para que el
encode ocurra a un ritmo conocido y no dependa de cuánta gente entre a la página.

**Dónde viven.** En `<camera_dir>/timelapse/`, **fuera** de las carpetas de día: así la
poda de fotogramas no se los lleva. Medido en producción el 2026-08-18: 237 capturas de
un día ocupan **25 MB** y su vídeo **5.9 MB** (19.8 s), y el encode tardó ~10 s en el ARM
del free tier. O sea que el timelapse es lo que puede sobrevivir meses
(`CAMERA_TIMELAPSE_RETENTION_DAYS`, 90 por defecto ≈ 540 MB).

### SVITRIX (reloj Ulanzi TC001)

```
GET /api/svitrix
```

Devuelve el dato **real de la estación** con la **misma forma que WeatherAPI
`current.json`**, para que el firmware SVITRIX (fork AWTRIX3) pueda apuntar aquí
en lugar de WeatherAPI.com cambiando solo la URL (campo *Servidor propio* en el
reloj). Incluye campos **extra** que WeatherAPI no tiene.

**Respuesta** (`current`):

| Campo | Descripción |
|-------|-------------|
| `temp_c` / `temp_f` | Temperatura exterior |
| `humidity` | Humedad exterior (%) |
| `pressure_mb` | Presión relativa (hPa) |
| `wind_kph` / `wind_degree` / `wind_dir` / `gust_kph` | Viento (km/h, grados, rumbo EN, ráfaga) |
| `uv` | Índice UV |
| `precip_mm` / `precip_in` | Lluvia acumulada de HOY (estándar WeatherAPI) |
| `condition` | `{text, code}` derivado (códigos WeatherAPI) |
| `air_quality` | `us-epa-index` (1–6) + `pm2_5`, `pm10`, `o3`, `no2`, `so2`, `co` |
| `solar_radiation` | **Extra:** radiación solar (W/m²) |
| `precip_event_mm` | **Extra:** lluvia del evento de lluvia actual (mm) |
| `rain_rate_mm` | **Extra:** intensidad de lluvia actual (mm/h) |

También devuelve `location` (nombre/lat/lon) y `source`. Los campos son `null`
si aún no hay dato de la estación (p. ej. justo tras reiniciar el receiver).

```bash
curl -s https://clima.xe1e.net/api/svitrix | jq '.current | {temp_c, uv, solar_radiation, precip_event_mm}'
```

### BIM32 (display ESP32 propio)

```
GET /api/bim32
GET /api/bim32/history?period=30
```

`BIM32` es el firmware propio (Arduino, `weather.hpp`) del display Waveshare
ESP32-S3 — ver `docs/internal` para el proyecto. Ya sabía leer OpenWeatherMap,
Weatherbit y Open-Meteo, y traduce los íconos de cualquiera de esos proveedores
a un vocabulario propio de 8 códigos (`Weather::_convertIcon()`). `/api/bim32`
reempaqueta como un proveedor más, en **una sola petición** en vez de las 2-3
que el ESP32 hacía antes directo a Open-Meteo:

- `current`: dato **real** de la estación (temperatura/humedad/presión/viento,
  igual que `/api/svitrix`) — sin calidad del aire ni IMECA, que BIM32 no usa
  (trae su propio BME680 local). El viento va en `wind_ms` (m/s), no en km/h:
  es la unidad que usa el firmware internamente. El ícono de `current`
  prioriza el análisis visual de la cámara (`sky_analyzer.py`) sobre el índice
  de claridad solar cuando no hay lluvia medida — de noche ese índice no tiene
  radiación con qué distinguir nubes y siempre cae en "Despejado". Sin lectura
  de la estación (recién reiniciado el receiver) se cae al pronóstico de la
  hora en curso, igual que `/api/epaper/forecast.json`.
- `daily`: 5 días de Open-Meteo (máx/mín, viento, ícono), corregido con el
  mismo sesgo real de la estación que usa `/api/forecast` (antes BIM32 recibía
  la presión cruda de Open-Meteo, muy por debajo de la relativa ya calibrada).
- `hourly`: hasta 40 puntos, muestreados cada 3 h desde ahora — ya resuelto
  aquí para que el ESP32 no tenga que filtrar 144 horas él mismo.

Ver `services/bim32.py` para las tablas de traducción de íconos (WMO y
WeatherAPI → los 8 códigos de `_convertIcon()`). **Nunca devuelve 503**: el
firmware necesita algo con qué refrescar su pantalla en cada ciclo.

`/api/bim32/history` reemplaza el mecanismo de ThingSpeak
(`Thingspeak::sendHistory`/`receiveHistory()`) — el ESP32 ya no manda su
propia lectura a un canal externo cada `history_period` minutos, porque este
servidor ya tiene el histórico real de la estación en InfluxDB. Devuelve hasta
24 baldes de `period` minutos (temperatura/humedad/presión), de más viejo a
más nuevo; un balde sin lecturas en esa ventana se omite en vez de rellenarse
con 0, para que el firmware lo distinga de una lectura real.

### E-paper LilyGo T5 4.7"

```
GET /api/epaper/forecast.json
```

Dato de la estación con la forma de WeatherAPI `forecast.json`, que es
exactamente lo que `DecodeWeatherAPI()` del firmware ya sabe parsear — el
display cambia de fuente sin tocar una línea de su dibujado (11+ pantallas,
touch, deep sleep), y puede volver a WeatherAPI.com de respaldo cambiando solo
la URL. Es el mismo patrón que `/api/svitrix` (reusa `svitrix.build_weatherapi`
como base del bloque `current`) más:

- `forecast.forecastday[]`: 3 días con las 24 horas de cada uno, para las
  gráficas del display.
- `astro`: calculado con pyephem para las coordenadas exactas del sitio.
- `xe1e{}`: lo que WeatherAPI no puede dar — radiación, lluvia del evento,
  IMECA, máximos MEDIDOS, tendencia real de presión.

Igual que `/api/bim32`, **nunca devuelve 503**: el e-paper despierta, pide una
vez y se vuelve a dormir, así que un error lo dejaría con la pantalla vieja
hasta el siguiente ciclo. Sin dato de la estación se cae al pronóstico de la
hora en curso (marcado en `xe1e.source`), y cada fuente externa (WAQI, IMECA)
se pide con tolerancia a fallos para que un proveedor caído no cueste la
pantalla entera. Ver `services/epaper.py` y, en el repo del firmware,
`PLAN-FUENTE-DATOS-XE1E.md`.

### Administración (requiere sesión)

| Endpoint | Descripción |
|----------|-------------|
| `POST /api/admin/login` | `{user, password}` → `{token}` (sesión 12 h) |
| `POST /api/admin/logout` | Revoca el token de sesión en el servidor (no solo en el cliente) |
| `GET /api/admin/settings` | Ajustes actuales (tokens/claves enmascarados). Header `Authorization: Bearer <token>` |
| `POST /api/admin/settings` | Actualiza ajustes editables (en blanco = conservar secretos) |
| `GET /api/admin/status` | Estado de alertas/estación |

---

## Data Fields Reference

### Temperature Fields

| Field | Unit | Description |
|-------|------|-------------|
| `temperature_outdoor` | °C | Temperatura exterior |
| `temperature_indoor` | °C | Temperatura interior |
| `dew_point` | °C | Punto de rocío calculado |
| `feels_like` | °C | Sensación térmica |
| `heat_index` | °C | Índice de calor (solo en temp > 27°C) |
| `wind_chill` | °C | Sensación térmica por viento (solo temp < 10°C) |
| `humidex` | índice | Bochorno (temp + humedad, sobre ~20°C). **Sin unidad**: la escala de Environment Canada está definida sobre la Celsius, así que convertirlo a °F daría un número sin significado |
| `cloud_base` | m | Altura estimada de la base de nubes |
| `temperature_ch1`…`ch8` | °C | Canales WN31 (1-8) |

### Humidity Fields

| Field | Unit | Description |
|-------|------|-------------|
| `humidity_outdoor` | % | Humedad relativa exterior |
| `humidity_indoor` | % | Humedad relativa interior |

### Pressure Fields

| Field | Unit | Description |
|-------|------|-------------|
| `pressure_relative` | hPa | Presión relativa (ajustada al nivel del mar) |
| `pressure_absolute` | hPa | Presión absoluta |

### Wind Fields

| Field | Unit | Description |
|-------|------|-------------|
| `wind_speed` | km/h | Velocidad del viento |
| `wind_gust` | km/h | Ráfaga de viento |
| `wind_gust_max_daily` | km/h | Ráfaga máxima del día |
| `wind_direction` | ° | Dirección del viento (0-359, 0=Norte) |

### Rain Fields

| Field | Unit | Description |
|-------|------|-------------|
| `rain_rate` | mm/h | Tasa de lluvia actual |
| `rain_event` | mm | Lluvia del evento actual — **no se reinicia a medianoche**, ver nota abajo |
| `rain_hourly` | mm | Lluvia última hora |
| `rain_daily` | mm | Lluvia del día |
| `rain_weekly` | mm | Lluvia de la semana |
| `rain_monthly` | mm | Lluvia del mes |
| `rain_yearly` | mm | Lluvia del año |

> **`rain_event` lo reinicia la estación, no el servidor.** El receptor sólo traduce
> `eventrainin` de pulgadas a mm (`parser.py` → `converter.py`); no hay lógica de
> reinicio en el servidor. Consecuencia práctica: el evento **sobrevive al cambio de
> día**, así que es normal ver `rain_event` en 6.8 con `rain_daily` en 0.0 y
> `rain_rate` en 0.0 — el chubasco fue anoche. Medido sobre 14 días del histórico de
> producción (2026-08-04): 6 reinicios, tres de ellos a 22.9–24.3 h de haber dejado de
> llover, lo que apunta a una regla de ~24 h sin lluvia, y todos en hora en punto, así
> que el gateway lo evalúa por tic horario. Por eso la consola rotula esa cifra
> **EVENTO** y no «AHORA».
| `rain_total` | mm | Lluvia total acumulada |

### Solar Fields

| Field | Unit | Description |
|-------|------|-------------|
| `solar_radiation` | W/m² | Radiación solar |
| `uv_index` | - | Índice UV (0-15) |

### Battery Fields

| Field | Type | Description |
|-------|------|-------------|
| `battery_wh65` | boolean | Estado batería WH65/WS69 (true=OK, false=Low) |
| `battery_ws69` | boolean | Alias de battery_wh65 |
| `battery_ch1`…`ch8` | boolean | Batería WN31 canales 1-8 (true=OK, false=Low) |
| `battery_wh40` | float | Voltaje batería WH40 (pluviómetro externo) |
| `battery_wh57` | int | Nivel batería WH57 (0-5, sensor rayos) |
| `battery_wh68` | float | Voltaje batería WH68 |
| `battery_wh80` | float | Voltaje batería WH80 |
| `battery_wh90` | float | Voltaje batería WH90 |

### RF Signal Strength Fields

Niveles de señal RF de sensores inalámbricos. Escala 0-4 (mayor = mejor señal).

| Field | Type | Description |
|-------|------|-------------|
| `signal_wh65` | int (0-4) | Señal RF del sensor WH65/WS69 exterior |
| `signal_ws69` | int (0-4) | Alias de signal_wh65 |
| `signal_ch1`…`ch8` | int (0-4) | Señal RF de sensores WN31 canales 1-8 |
| `signal_wh25` | int (0-4) | Señal RF del sensor WH25 |
| `signal_wh26` | int (0-4) | Señal RF del sensor WH26 |
| `signal_wh40` | int (0-4) | Señal RF del pluviómetro WH40 |
| `signal_wh57` | int (0-4) | Señal RF del sensor de rayos WH57 |
| `signal_wh68` | int (0-4) | Señal RF del sensor WH68 |
| `signal_wh80` | int (0-4) | Señal RF del sensor WH80 |
| `signal_wh90` | int (0-4) | Señal RF del sensor WH90 |

Los campos de señal RF aparecen en `/api/current` y también en el detalle de sensores (`sensors_detail`) del endpoint `/api/stations`.

---

## Error Handling

Todos los errores siguen el formato:

```json
{
  "detail": "Error message here"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 401 | Sin sesión admin / token inválido |
| 404 | Resource not found |
| 429 | Rate limit excedido (ver abajo) |
| 502 | Falló un proveedor externo (Open-Meteo, SMN, satélite…) |
| 500 | Internal server error |

---

## Rate Limiting

En memoria (no persiste entre reinicios); por IP salvo donde se indica:

| Endpoint | Límite |
|----------|--------|
| `POST /data/report/` (`/data/report`) | 60 peticiones/min — muy holgado para el datalogger real (~1-4/min), pensado como defensa ante flood/DoS |
| `POST /api/admin/login` | 5 intentos/min — anti-fuerza-bruta |
| `/api/camera/windy-visit` | 600/min **global** (no por IP: Windy puede llamar desde pocas IPs). Pasado el tope sigue respondiendo el pixel, pero no registra la visita |

El resto de endpoints no tiene límite propio.

---

## CORS

Restringido a orígenes conocidos (`allow_credentials=False`): `https://clima.xe1e.net` en
producción, más `http://localhost:5173` y `http://localhost:8080` para desarrollo local. La
API se sirve **mismo-origen** en producción (el dashboard hace de proxy de `/api`), así que
CORS solo importa para desarrollo/integraciones externas — ajusta `allow_origins` en
`receiver/app/main.py` si necesitas otro origen.
