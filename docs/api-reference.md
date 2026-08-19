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

**Examples:**

```bash
# Últimas 24 horas
curl "http://localhost:8080/api/history"

# Últimos 7 días
curl "http://localhost:8080/api/history?start=-7d"

# Rango específico
curl "http://localhost:8080/api/history?start=2024-01-01T00:00:00Z&stop=2024-01-02T00:00:00Z"
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
| `GET /api/climate/records` | Récords: de siempre, por mes calendario, este mes/año, ayer |
| `GET /api/climate/onthisday` | Efeméride: mismo día en años previos |
| `GET /api/climate/noaa?year=YYYY&month=MM` | Reporte climatológico NOAA (mensual con `month`, anual sin él) |
| `GET /api/wind/rose?start=-7d` | Rosa de vientos (16 sectores, frecuencia y velocidad) |
| `GET /api/almanac` | Almanaque: sol, crepúsculos, luna y planetas |
| `GET /api/alerts` | Alertas activas |
| `GET /api/metar?station=MMMX` | METAR del aeropuerto (proxy a aviationweather.gov) |
| `GET /api/airquality?lat=&lon=` | Calidad del aire (WAQI); requiere `WAQI_TOKEN` |
| `GET /api/earthquakes` | Sismos recientes (fuente híbrida SSN → USGS) |
| `GET /api/svitrix` | Dato actual con forma WeatherAPI `current.json` para el reloj SVITRIX (ver abajo) |
| `GET /api/summaries/daily?days=30` | Resúmenes diarios crudos, una fila por día. Alimenta los detalles de 7 y 30 días del kiosco. Incluye `humidex_max` y `humidex_max_time` desde 2026-08-08 (los días anteriores se rellenaron con `backfill(force=True)`) |
| `GET /api/camera/status` | Estado de la cámara del exterior (ver abajo) |
| `GET /api/camera/latest.jpg` | Última captura, con la cabecera `X-Captured-At` |
| `GET /api/camera/days` | Días con histórico y cuántas capturas tiene cada uno |
| `GET /api/camera/analysis/history` | Días con análisis, o `?date=` para la curva de un día |
| `GET /api/camera/timelapse/days` | Qué días tienen vídeo (o fotogramas para montarlo) |
| `GET /api/camera/timelapse/<fecha>.mp4` | El timelapse de ese día (ver abajo) |
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

### Administración (requiere sesión)

| Endpoint | Descripción |
|----------|-------------|
| `POST /api/admin/login` | `{user, password}` → `{token}` (sesión 12 h) |
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
| 404 | Resource not found |
| 500 | Internal server error |

---

## Rate Limiting

No hay rate limiting implementado por defecto. El gateway envía datos cada 60 segundos típicamente.

---

## CORS

CORS está habilitado para todos los orígenes (`*`). En producción, considera restringir a tu dominio específico.
