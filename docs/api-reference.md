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
| `GET /api/forecast/local` | Pronóstico local por tendencia barométrica (dato propio) |
| `GET /api/climate/daily?start=-365d` | Resúmenes diarios (Dayfile) |
| `GET /api/climate/records` | Récords: de siempre, por mes calendario, este mes/año, ayer |
| `GET /api/climate/onthisday` | Efeméride: mismo día en años previos |
| `GET /api/climate/noaa?year=YYYY&month=MM` | Reporte climatológico NOAA (mensual con `month`, anual sin él) |
| `GET /api/wind/rose?start=-7d` | Rosa de vientos (16 sectores, frecuencia y velocidad) |
| `GET /api/almanac` | Almanaque: sol, crepúsculos, luna y planetas |
| `GET /api/alerts` | Alertas activas |
| `GET /api/metar?station=MMMX` | METAR del aeropuerto (proxy a aviationweather.gov) |
| `GET /api/airquality?lat=&lon=` | Calidad del aire (WAQI); requiere `WAQI_TOKEN` |
| `GET /api/earthquakes` | Sismos recientes (fuente híbrida SSN → USGS) |

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
| `humidex` | °C | Índice de bochorno (temp + humedad, sobre ~20°C) |
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
| `rain_event` | mm | Lluvia del evento actual |
| `rain_hourly` | mm | Lluvia última hora |
| `rain_daily` | mm | Lluvia del día |
| `rain_weekly` | mm | Lluvia de la semana |
| `rain_monthly` | mm | Lluvia del mes |
| `rain_yearly` | mm | Lluvia del año |
| `rain_total` | mm | Lluvia total acumulada |

### Solar Fields

| Field | Unit | Description |
|-------|------|-------------|
| `solar_radiation` | W/m² | Radiación solar |
| `uv_index` | - | Índice UV (0-15) |

### Battery Fields

| Field | Type | Description |
|-------|------|-------------|
| `battery_ws69` | boolean | Estado batería WS69 (true=OK, false=Low) |

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
