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
| Gateway + Sensor | Ecowitt GW3002 (GW3000 + WS69) | $119 |
| Pantalla (opcional) | Ecowitt WS2910_C | $68 |
| Accesorios | Bird Spikes, Battery Pack 10m | $25 |

**Frecuencia**: 915 MHz (América)

## Arquitectura

```
WS69 (sensor exterior)
       │
       │ RF 915MHz
       ▼
┌──────────────┐     ┌──────────────┐
│   GW3000     │     │  WS2910_C    │
│  (gateway)   │     │  (pantalla)  │
└──────┬───────┘     └──────────────┘
       │
       │ HTTP API Local / Push
       ▼
┌──────────────────────────────────┐
│         SERVIDOR                 │
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

## Configuración del Gateway GW3000

1. Conectar GW3000 a la red WiFi via app **WSView** o **WS Tool**
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

```yaml
# configuration.yaml
sensor:
  - platform: rest
    name: "Temperatura Exterior"
    resource: http://localhost:8080/api/current
    value_template: "{{ value_json.temperature }}"
    unit_of_measurement: "°C"
```

O usar la integración oficial Ecowitt si el gateway está en la misma red.

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
