# Ecowitt Weather Station Server

Sistema de captura, almacenamiento y visualización de datos meteorológicos usando estaciones Ecowitt con servidor local.

## Características

- Recepción de datos via protocolo Ecowitt (HTTP POST)
- API local HTTP para consultas en tiempo real
- Almacenamiento en InfluxDB (series temporales)
- Dashboard web responsive
- Integración con Home Assistant
- Alertas configurables (lluvia, viento, temperatura)

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

HA está en una **red remota** distinta a la estación, por lo que lee los datos desde la **API REST del VPS**:

```yaml
# configuration.yaml
sensor:
  - platform: rest
    name: "Temperatura Exterior"
    resource: http://163.192.147.208:8080/api/current
    value_template: "{{ value_json.temperature }}"
    unit_of_measurement: "°C"
    scan_interval: 60
```

> La integración nativa Ecowitt de HA (push/webhook) solo conviene si HA está en la misma red que la estación; no es el caso aquí. Ver [Estudio de Viabilidad §11](docs/ESTUDIO_VIABILIDAD.md).

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
