# Ecowitt Weather Station Server

Sistema de captura, almacenamiento y visualización de datos meteorológicos usando estaciones Ecowitt con servidor local.

## Características

- Recepción de datos via protocolo Ecowitt (HTTP POST) — WS2910 o gateway
- API REST para consultas (actual, histórico, estadísticas del día)
- Almacenamiento en InfluxDB (series temporales)
- **Dashboard web** con:
  - Iconos meteorológicos animados (Meteocons/Basmilius, MIT) y efectos de clima (lluvia/nieve/rayos/niebla)
  - Hero con condición actual, sensación, punto de rocío y máx/mín del día
  - Tarjetas de humedad, presión, UV, viento (con brújula), lluvia e interiores
  - Hasta 8 canales WN31 con aviso de batería baja
  - Resumen del día (mín/máx/promedio) e histórico con selector de periodo (24h/7d/30d) y métrica
  - Pronóstico de 7 días y astronomía (amanecer/atardecer, fase lunar) vía Open-Meteo
  - Badges LIVE/OFFLINE según frescura del dato
- Integración con Home Assistant (REST vía `https://clima.xe1e.net`)

## Hardware Recomendado

| Componente | Modelo | Precio Aprox |
|------------|--------|--------------|
| Consola + Sensor | Ecowitt WS2910_C (kit, incluye WS69) | $68 |
| Sensor interior (opcional) | Ecowitt WN31 | $11 |
| Accesorios | Bird Spikes, Battery Pack 10m | $25 |
| Gateway (upgrade opcional) | Ecowitt GW3000 — API local / SD / Ethernet | $60 |

**Frecuencia**: 915 MHz (América) · Preferir firmware **EasyWeatherPro**

> El **WS2910** envía datos al servidor por push con protocolo Ecowitt, por lo que basta por sí solo. El **GW3000** es un upgrade opcional que añade API local (pull en LAN), backup en microSD y Ethernet. Ver [Estudio de Viabilidad §5](docs/ESTUDIO_VIABILIDAD.md).

## Arquitectura

```
WS69 (exterior)   WN31 (interior)
       │               │
       │ RF 915MHz      │
       ▼               ▼
┌──────────────────────────────┐
│   WS2910 (consola + display)  │
│   push protocolo Ecowitt      │
└──────┬────────────────────────┘
       │  (opcional: GW3000 en LAN → API local / SD / Ethernet)
       │ HTTP POST /data/report/
       ▼
┌──────────────────────────────────┐
│         SERVIDOR (VPS)           │
│  ┌────────────┐  ┌────────────┐  │
│  │  Receiver  │  │  InfluxDB  │  │
│  │  (FastAPI) │──│  (datos)   │  │
│  └─────┬──────┘  └─────┬──────┘  │
│        │               │         │
│  ┌─────▼───────────────▼──────┐  │
│  │      API REST + Dashboard  │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
       │
       ▼
┌──────────────┐
│Home Assistant│
└──────────────┘
```

## Requisitos

- Python 3.11+
- Docker & Docker Compose
- Red local (el gateway y servidor deben estar en la misma red)

## Instalación Rápida

```bash
# Clonar repositorio
git clone https://github.com/tu-usuario/ecowitt-weather-station.git
cd ecowitt-weather-station

# Copiar configuración
cp .env.example .env
# Editar .env con tus valores

# Iniciar servicios
docker-compose up -d

# Verificar
curl http://localhost:8080/health
```

## Configuración del Dispositivo (WS2910 o GW3000)

1. Conectar el WS2910 (o GW3000) a la red WiFi 2.4GHz via app **WS View Plus**
2. Ir a **Weather Services** → **Customized**
3. Configurar:
   - **Enable**: ON
   - **Protocol**: Ecowitt
   - **Server IP**: [IP de tu servidor]
   - **Port**: 8080
   - **Path**: /data/report/
   - **Interval**: 60 segundos

## Configuración del Dashboard (ubicación)

El pronóstico y la astronomía usan la ubicación de la estación. Ajústala en
[`dashboard/src/config.ts`](dashboard/src/config.ts):

```ts
export const LOCATION = {
  name: 'Ciudad de México',
  latitude: 19.4326,
  longitude: -99.1332,
}
```

> Cambia `latitude`/`longitude` por las coordenadas reales de tu estación
> (clic derecho en Google Maps → copiar). El dato del clima local (Open-Meteo)
> es gratuito y no requiere API key.

## Estructura del Proyecto

```
ecowitt-weather-station/
├── docker-compose.yml      # Orquestación de servicios
├── .env.example            # Variables de entorno ejemplo
│
├── receiver/               # Servidor receptor HTTP
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py        # FastAPI app
│   │   ├── config.py      # Configuración
│   │   ├── models.py      # Modelos de datos
│   │   └── services/
│   │       ├── parser.py  # Parser protocolo Ecowitt
│   │       ├── converter.py # Conversión unidades
│   │       └── storage.py # Escritura a InfluxDB
│   └── tests/
│
├── api/                    # API REST pública
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       └── routers/
│           ├── current.py  # Datos actuales
│           ├── history.py  # Datos históricos
│           └── stats.py    # Estadísticas
│
├── dashboard/              # Frontend Web
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── hooks/
│   └── public/
│
├── homeassistant/          # Configuración Home Assistant
│   └── ecowitt.yaml
│
└── docs/                   # Documentación
    ├── ESTUDIO_VIABILIDAD.md
    ├── setup-gateway.md
    └── api-reference.md
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/data/report/` | Recibe datos del gateway |
| GET | `/api/current` | Datos meteorológicos actuales |
| GET | `/api/history?from=&to=` | Datos históricos |
| GET | `/api/stats/daily` | Estadísticas diarias |
| GET | `/health` | Estado del servicio |

## Integración Home Assistant

HA está en una **red remota** distinta a la estación, por lo que lee los datos desde la **API REST del VPS** (vía HTTPS con el dominio). Config lista para usar (31 sensores, integración `rest:`): [`homeassistant/ecowitt.yaml`](homeassistant/ecowitt.yaml) — cópiala a `<config>/packages/` y actívala. Ejemplo mínimo:

```yaml
# configuration.yaml
sensor:
  - platform: rest
    name: "Temperatura Exterior"
    resource: https://clima.xe1e.net/api/current
    value_template: "{{ value_json.temperature_outdoor }}"
    unit_of_measurement: "°C"
    scan_interval: 60
```

> La integración nativa Ecowitt de HA (push/webhook) solo conviene si HA está en la misma red que la estación; no es el caso aquí. Ver [Estudio de Viabilidad §11](docs/ESTUDIO_VIABILIDAD.md) y [DOMINIO-HTTPS.md](docs/DOMINIO-HTTPS.md).

### Opción MQTT (auto-discovery)

Si corres un broker MQTT accesible por HA, el receiver puede publicar los datos
y **auto-crear las entidades** en Home Assistant (MQTT Discovery). Actívalo en `.env`:

```bash
MQTT_ENABLED=true
MQTT_BROKER=192.168.1.100
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_TOPIC=weather/ecowitt
HASS_DISCOVERY=true
HASS_DISCOVERY_PREFIX=homeassistant
```

El receiver publica el estado en `weather/ecowitt/state` y los configs de
discovery bajo `homeassistant/...` (sensores de temperatura, humedad, presión,
viento, lluvia, UV, radiación, canales WN31 y baterías). HA crea el dispositivo
"Ecowitt WS2910" automáticamente.

## Documentación

- [Estudio de Viabilidad](docs/ESTUDIO_VIABILIDAD.md)
- [Configuración del Gateway](docs/setup-gateway.md)
- [Referencia API](docs/api-reference.md)

## Licencia

MIT License

## Contribuir

1. Fork el repositorio
2. Crear rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request
