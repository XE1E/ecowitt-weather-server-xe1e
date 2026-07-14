# Estación Clima XE1E — Ciudad de México

Estación meteorológica propia que publica en tiempo casi real las condiciones de un punto exacto de la Ciudad de México (Benito Juárez). El hardware **Ecowitt** envía sus datos por *push* a un servidor en un **VPS con HTTPS**, que los guarda en **InfluxDB** y los muestra en un sitio web propio (React), con pronóstico, radar, astronomía, climatología, calidad del aire y meteorología aeronáutica.

**🌦️ Sitio en vivo:** [clima.xe1e.net](https://clima.xe1e.net)

Stack propio: **FastAPI + InfluxDB + React** (Vite · TypeScript · Tailwind). Todo el dato de las páginas de Historia, Estadísticas y Climatología proviene de la propia estación.

---

## El sitio

La app principal vive en `/pro` (instalable como PWA) y tiene:

| Página | Qué muestra |
|--------|-------------|
| **Inicio** | Condiciones actuales, viento (con brújula que gira a la rosa de vientos), presión con tendencia, pronóstico, precipitación, UV/solar, sol y luna, calidad del aire, IMECA, sismos, interior y sensores adicionales |
| **Mi tablero** | Tablero personalizable: elige qué tarjetas ver y **arrástralas para reordenarlas** a tu gusto (se guarda por dispositivo) |
| **Pronóstico** | Por día y por hora, con descripciones en lenguaje natural (Open-Meteo) |
| **Historia** | Archivo de la estación con granularidad Día/Mes/Año y gráficas interactivas |
| **Estadísticas** | Resumen del año, promedios mensuales, contadores de días, grados-día y récords históricos, rosa de vientos |
| **Climatología** | Climograma, récords por mes, reporte estilo NOAA y "en este día" |
| **Radar y satélite** | Radar (Ventusky) e imagen satelital diaria (NASA GIBS) |
| **Astronomía** | Sol y luna con arcos, fases lunares y almanaque (pyephem) |
| **Calidad del aire** | AQI (WAQI) e **IMECA** estimado (norma NADF-009-AIRE-2017) con medidor y pronóstico |
| **Aeronáutica** | METAR y TAF decodificados + perfil atmosférico visual, para aeropuertos de México |
| **Estación remota** | Segunda estación (p. ej. un Ecowitt **GW1100**) que envía al mismo servidor; sus datos se guardan **por separado** y se ven en su propia página, solo lectura: condiciones, tendencias, estadística e histórico |
| **Widget** | Generador de un `<iframe>` con las condiciones actuales para insertar en otra web |

Además: **panel de administración** (`/admin`, usuario/contraseña) con **wizard de configuración inicial** (5 pasos: bienvenida, estación, alertas/Telegram, publicación, resumen) y 8 páginas: Dashboard (indicador en tiempo real, historial de alertas, acciones rápidas), Estaciones (agregar/eliminar secundarias, configuración individual con servicios por estación), Alertas (umbrales), Calibración (offsets/multiplicadores), Publicación (redes públicas), Notificaciones (Telegram con test), Integraciones (MQTT/HA con estado de conexión, test y reconexión en caliente; WAQI), y Sistema (QC, visor de logs). Todo editable en caliente sin reiniciar. **Tema claro/oscuro**, **unidades** métricas/imperiales, y una **Vista clásica** simple en `/`.

**Alertas** configurables (temperatura, viento, ráfaga, lluvia, presión, batería baja, sensor perdido, estación caída, y calidad del aire) con notificación por **Telegram**.

**Publicación a redes públicas**: Weather Underground, PWSWeather, Windy, OpenWeatherMap y CWOP/APRS.

---

## Hardware

| Componente | Modelo |
|------------|--------|
| Consola + sensor exterior | Ecowitt **WS2910** (kit con **WS69**) |
| Sensor T/H interior o por canal | Ecowitt **WN31** (hasta 8 canales) |
| Gateway (upgrade opcional) | Ecowitt **GW3000** — API local / microSD / Ethernet |
| Estación remota (opcional) | Ecowitt **GW1100** — 2ª estación que envía al mismo servidor (secundaria) |

Frecuencia 915 MHz (América). El **WS2910 basta por sí solo**: envía por *push* con protocolo Ecowitt, sin necesidad de estar en la misma red que el servidor.

---

## Arquitectura

```
WS69 (exterior)   WN31 (interior)
       │               │
       │ RF 915 MHz     │
       ▼               ▼
┌──────────────────────────────┐
│  WS2910 (consola + display)  │
│  push protocolo Ecowitt      │
└──────┬───────────────────────┘
       │ HTTP POST /data/report/
       ▼
┌──────────────────────────────────┐
│          SERVIDOR (VPS)          │
│  Receiver (FastAPI) ── InfluxDB  │
│         │                        │
│  API REST + Dashboard (React)    │
└──────────────────────────────────┘
       │ HTTPS (Cloudflare)
       ▼
   clima.xe1e.net · Home Assistant (REST)
```

---

## Fuentes de datos externas

Todo lo medido es de la estación. Lo externo (referencia) es: **Open-Meteo** (pronóstico y astronomía base), **WAQI** (AQI) y **Open-Meteo Air Quality** (IMECA estimado), **NASA GIBS** (satélite), **Ventusky** (radar), **USGS/SSN** (sismos), **aviationweather.gov/NOAA** (METAR/TAF) y **pyephem** (almanaque, cálculo local).

---

## Puesta en marcha

Requisitos: Docker y Docker Compose en un servidor accesible por internet, y (para HTTPS) un dominio.

```bash
git clone https://github.com/XE1E/ecowitt-weather-server-xe1e.git
cd ecowitt-weather-server-xe1e

cp .env.example .env      # edita tus valores (InfluxDB, admin, tokens, etc.)

docker compose up -d --build
curl http://localhost:8080/health
```

**Configurar la estación** (app *WS View Plus* → Weather Services → Customized):

- Enable: ON · Protocol: **Ecowitt** · Server IP: *tu servidor* · Port: **8080** · Path: **/data/report/** · Interval: **60 s**

**Ubicación** (pronóstico/astronomía) en [`dashboard/src/config.ts`](dashboard/src/config.ts):

```ts
export const LOCATION = {
  name: 'Ciudad de México',
  latitude: 19.4326,
  longitude: -99.1332,
}
```

Detalle completo de despliegue: **[docs/DEPLOY.md](docs/DEPLOY.md)** · dominio + HTTPS: **[docs/DOMINIO-HTTPS.md](docs/DOMINIO-HTTPS.md)**.

---

## Integración con Home Assistant

HA lee los datos desde la **API REST del VPS** (por HTTPS). Config lista para usar (integración `rest:`): [`homeassistant/ecowitt.yaml`](homeassistant/ecowitt.yaml). Ejemplo mínimo:

```yaml
sensor:
  - platform: rest
    name: "Temperatura Exterior"
    resource: https://clima.xe1e.net/api/current
    value_template: "{{ value_json.temperature_outdoor }}"
    unit_of_measurement: "°C"
    scan_interval: 60
```

Alternativa **MQTT Discovery**: si corres un broker accesible por HA, el receiver puede auto-crear las entidades. Actívalo en `.env` (`MQTT_ENABLED=true`, `HASS_DISCOVERY=true`, …).

---

## API (principales)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/data/report/` | Recibe el push de la estación |
| GET | `/api/current` | Lectura actual |
| GET | `/api/history` · `/api/stats/daily` | Histórico y estadísticas del día |
| GET | `/api/climate/*` | Resúmenes diarios, récords y reporte NOAA |
| GET | `/api/forecast` · `/api/almanac` | Pronóstico y almanaque |
| GET | `/api/airquality` · `/api/airquality/imeca` | AQI e IMECA |
| GET | `/api/metar` · `/api/taf` · `/api/satellite` | METAR/TAF y satélite |
| GET | `/health` | Estado del servicio |

> **Multi-estación:** `/api/current`, `/api/history` y `/api/stats/daily` aceptan `?station=<nombre>` para consultar una **estación secundaria** (p. ej. `gw1100`); sin el parámetro devuelven la **principal**.

Referencia completa: **[docs/api-reference.md](docs/api-reference.md)**.

---

## Estructura del proyecto

```
├── docker-compose.yml          # Orquestación
├── receiver/                   # Servidor (FastAPI)
│   ├── app/
│   │   ├── main.py             # App y endpoints
│   │   ├── config.py
│   │   └── services/           # parser, storage, aggregator, alerts,
│   │                           # imeca, metar, satellite, almanac, …
│   └── tests/
├── dashboard/                  # Frontend (React · Vite · TS · Tailwind)
│   ├── src/pages/ · src/components/station/
│   └── public/                 # guía, manifiesto PWA, iconos
├── homeassistant/              # Config para Home Assistant
├── docs/                       # Documentación (y docs/archivo/ = estudios)
├── caddy/ · uptime-worker/     # Reverse proxy y monitor de disponibilidad
└── scripts/                    # Utilidades (simulador, sonda WS2910)
```

---

## Documentación

- **[Guía completa](docs/GUIA.md)** — manual de referencia (hardware, arquitectura, cada página, API, operación)
- [Referencia de API](docs/api-reference.md)
- [Despliegue en el VPS](docs/DEPLOY.md) · [Dominio + HTTPS](docs/DOMINIO-HTTPS.md) · [VPS Oracle](docs/oracle-vps-setup.md)
- [Configurar el gateway/consola](docs/setup-gateway.md)
- [Backups a R2](docs/backups-r2.md) · [Monitor de uptime](uptime-worker/README.md)

> Notas de estudio y planeación (exploratorias) quedan archivadas en [`docs/archivo/`](docs/archivo/).

---

## Licencia

MIT.
