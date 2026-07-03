# Estudio de Viabilidad: Ecowitt HP2551 Weather Station
## Servidor Local + Dashboard Web Personal

---

## 1. Resumen Ejecutivo

**Veredicto: ✅ VIABLE** - El proyecto es totalmente factible con múltiples opciones de implementación, desde soluciones listas para usar hasta desarrollo personalizado.

La estación HP2551 soporta envío de datos HTTP a servidores personalizados usando el protocolo Ecowitt, lo que permite captura local sin depender de la nube de Ecowitt.

---

## 2. Comparativa de Estaciones Meteorológicas

### 2.1 Ecowitt - Línea Completa

| Modelo | Precio USD | Sensor | Pantalla | API Local | Ideal Para |
|--------|-----------|--------|----------|-----------|------------|
| **HP2551** | $199 | WS69 (mecánico) | 7" TFT | ❌ No | Principiantes, presupuesto ajustado |
| **HP2553** | ~$280 | WS90 (ultrasónico) | 7" TFT | ❌ No | Mejor precisión viento, sin mantenimiento |
| **Wittboy GW2001** | $180-230 | WS90 (ultrasónico) | Sin pantalla (gateway) | ✅ Sí | Integración Home Assistant |
| **Wittboy GW3001** | $205-215 | WS90 (ultrasónico) | Sin pantalla (gateway) | ✅ Sí + SD | **⭐ RECOMENDADO** para este proyecto |
| **HP2560 (Wittboy Pro)** | ~$300 | WS90 (ultrasónico) | 7" TFT | ✅ Sí | Lo mejor de ambos mundos |

### 2.2 Diferencias Clave entre Sensores

#### WS69 (Mecánico) - Incluido en HP2551
- Anemómetro de copas giratorias + veleta
- **Pros**: Económico, probado
- **Contras**: Partes móviles que se desgastan, puede atascarse con hielo/nieve
- Precisión viento: ±1 m/s (<10 m/s), ±10% (≥10 m/s)

#### WS90 (Ultrasónico) - Incluido en modelos superiores
- Sin partes móviles, medición por ultrasonido
- Pluviómetro piezoeléctrico (no de cangilones)
- **Pros**: Sin mantenimiento, más preciso, más duradero
- **Contras**: Más caro (~$150 solo el sensor)
- Precisión viento: ±0.5 m/s (<10 m/s), ±5% (≥10 m/s)
- **Nota**: Para lluvia muy precisa, recomiendan agregar WH40 tradicional

### 2.3 Gateways vs Consolas (¡IMPORTANTE para tu proyecto!)

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONSOLAS (HP2551, HP2553)                    │
│  ✅ Pantalla grande para ver datos                              │
│  ✅ Todo en uno                                                  │
│  ❌ SIN API LOCAL - Solo puede ENVIAR datos (push)              │
│  → Tu servidor debe ESCUCHAR conexiones entrantes               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              GATEWAYS (GW2000, GW3000, Wittboy)                 │
│  ❌ Sin pantalla (usas app móvil o web)                         │
│  ✅ API LOCAL HTTP - Puedes CONSULTAR datos cuando quieras      │
│  ✅ Más flexible para integración                                │
│  ✅ Almacenamiento SD (GW3000)                                   │
│  → Tu servidor puede hacer PULL de datos                        │
└─────────────────────────────────────────────────────────────────┘
```

**⚠️ RECOMENDACIÓN**: Si la integración con servidor es tu prioridad principal, **un gateway (GW2000/GW3000/Wittboy) es mejor opción que una consola HP2551**, aunque pierdas la pantalla física.

### 2.4 Comparativa Gateways Ecowitt

| Gateway | Precio | WiFi | Ethernet | API Local | SD Card | PoE | Antena |
|---------|--------|------|----------|-----------|---------|-----|--------|
| GW1100 | ~$30 | ✅ | ❌ | ✅ | ❌ | ❌ | Interna |
| GW1200 | ~$40 | ✅ | ❌ | ✅ | ❌ | ❌ | Interna |
| GW2000 | ~$50 | ✅ | ✅ | ✅ | ❌ | ✅ | Interna |
| **GW3000** | ~$60 | ✅ | ✅ | ✅ | ✅ | ✅ | Externa (mejor alcance) |

### 2.5 Alternativas de Otras Marcas

#### Ambient Weather (Diseños licenciados de Ecowitt)
| Modelo | Precio USD | Notas |
|--------|-----------|-------|
| WS-2902C Osprey | $189 | Equivalente a HP2551, muy popular en USA |
| WS-5000 | ~$400 | Gama alta, ultrasónico, mejor soporte USA |

**Nota**: Ambient Weather licencia diseños de Ecowitt. El WS-4000 es idéntico al Wittboy Pro. Los Ambient cuestan más pero tienen mejor soporte en Norteamérica.

#### WeatherFlow Tempest
| Aspecto | Detalle |
|---------|---------|
| Precio | ~$329 |
| Sensor | Todo en uno, sin partes móviles |
| API | ✅ Local (UDP) + Cloud REST |
| Ventaja | Detección de rayos, haptic rain gauge |
| Desventaja | Más caro, menos expandible |

**API Local**: Usa UDP en red local, perfecto para Home Assistant sin depender de cloud.

#### Davis Instruments (Grado Profesional)
| Modelo | Precio USD | Notas |
|--------|-----------|-------|
| Vantage Vue | ~$695 | Requiere WeatherLink Hub ($395 extra) |
| Vantage Pro2 | ~$900+ | Usado por National Weather Service |

**Nota**: Davis es el estándar profesional pero el costo es 3-5x mayor. La precisión es superior (±0.3°F vs ±1°F), pero para uso personal Ecowitt es suficiente.

### 2.6 Tabla Resumen - Mejor Opción por Caso de Uso

| Caso de Uso | Recomendación | Precio Aprox |
|-------------|---------------|--------------|
| **Presupuesto mínimo + pantalla** | HP2551 | $199 |
| **Mejor calidad sin pantalla** | Wittboy GW3001 | $205-215 |
| **API local + pantalla** | HP2560 (Wittboy Pro) | ~$300 |
| **Sin mantenimiento (nieve/hielo)** | Cualquiera con WS90 | $180+ |
| **Home Assistant prioritario** | GW3001 o GW2000 + WS90 | $200-260 |
| **Máxima precisión** | Davis Vantage Pro2 | $900+ |
| **Todo en uno sin complicaciones** | WeatherFlow Tempest | $329 |

### 2.7 Frecuencias RF - ¡IMPORTANTE!

```
⚠️ REQUISITO: 915 MHz (América) - NO 433 MHz (Europa)
```

Las estaciones Ecowitt vienen en dos variantes de frecuencia:

| Frecuencia | Región | Interferencia | Disponibilidad |
|------------|--------|---------------|----------------|
| **915 MHz** | América (Norte/Sur) | Baja | Amazon US, Ecowitt directo |
| **868 MHz** | Europa | Media | Amazon EU |
| **433 MHz** | Asia/algunos EU | **ALTA** ⚠️ | Evitar si hay interferencia |

**¿Por qué importa?**
- 433 MHz es una banda muy congestionada (controles remotos, sensores baratos, IoT genérico)
- 915 MHz tiene menos dispositivos compitiendo, mejor alcance y confiabilidad
- **Al comprar, verificar que diga "915 MHz" o "US Version"**

**Dónde comprar versión 915 MHz:**
- [Ecowitt Shop directo](https://shop.ecowitt.com) - Seleccionar "915M" en las opciones
- Amazon US (envío internacional disponible)
- Verificar en la descripción del producto la frecuencia

### 2.8 Mi Recomendación para Tu Proyecto

#### ⭐ CONFIGURACIÓN RECOMENDADA (Gateway + Pantalla + Sensores)

**Presupuesto: ~$205 | Requiere: 915 MHz | Prioridad: Home Assistant + Servidor propio**

| Componente | Precio | Descripción |
|------------|--------|-------------|
| **GW3000** | $60 | Gateway WiFi/Ethernet con API local y SD |
| **WS69** | $65 | Sensor exterior 7-en-1 (temp, hum, viento, lluvia, UV, solar) |
| **WS2910** | $68 | Pantalla LCD 6.8" color con WiFi |
| **WN31** | $11 | Sensor temperatura/humedad adicional (CH1) |
| **TOTAL** | **~$204** | ✅ Dentro de presupuesto |

**¿Por qué esta combinación?**

```
    WS69 (sensor exterior 7-en-1)      WN31 (temp/hum CH1)
              │                              │
              │ RF 915MHz broadcast          │
              ▼                              ▼
    ┌─────────────────────────────────────────┐
    │     Ambos receptores captan todas       │
    │     las señales de sensores 915MHz      │
    └──────────────────┬──────────────────────┘
                       │
               ┌───────┴───────┐
               ▼               ▼
            GW3000          WS2910
           (gateway)       (pantalla)
               │
               │ API Local HTTP
               │ Almacenamiento SD
               ▼
        ┌──────────────────┐
        │  Home Assistant  │
        │  Servidor propio │
        │  Dashboard web   │
        └──────────────────┘
```

**Lo que obtienes:**
- ✅ **API local HTTP** - Consulta datos cuando quieras (no solo push)
- ✅ **Almacenamiento SD** - Backup local de datos
- ✅ **Ethernet + WiFi** - Conexión más estable
- ✅ **Pantalla física 6.8"** - Ver datos sin computadora
- ✅ **Sensor mecánico WS69** - Económico, funcional, 7 mediciones
- ✅ **Sensor extra WN31** - Temp/humedad interior (expandible hasta 8)
- ✅ **Compatible 915 MHz** - Sin interferencias
- ✅ **Integración Home Assistant** - Nativa

### 2.9 Sensores Adicionales Compatibles

El GW3000 soporta hasta **8 sensores WN31** simultáneamente (canales CH1-CH8).

| Sensor | Precio | Canales | Uso Típico |
|--------|--------|---------|------------|
| **WN31** | $11 | Hasta 8 | Interior, habitaciones, bodega |
| **WN32** | $14 | 1 | Exterior (reemplazo) |
| **WN32P** | $16 | 1 | Interior con presión |
| **WN31EP** | $69 | Hasta 8 | Alta precisión, sonda para piscina/suelo |
| **WH51** | $15 | Hasta 8 | Humedad de suelo |
| **WH57** | $25 | 1 | Detector de rayos |
| **WH45** | $80 | 1 | Calidad del aire (PM2.5/CO2) |

**Protocolo de datos WN31:**
Los sensores envían campos `temp1f`-`temp8f` y `humidity1`-`humidity8` según el canal configurado.

**Dónde comprar (915 MHz):**

| Producto | Ecowitt Shop | AliExpress (est.) | Notas |
|----------|-------------|-------------------|-------|
| [GW3000](https://shop.ecowitt.com/products/gw3000-gw3010) | $59.99 | ~$50-55 | Gateway WiFi/Ethernet + SD |
| [WS69](https://shop.ecowitt.com/products/ws69) | $64.99 | ~$55-60 | Sensor exterior 7-en-1 |
| [WS2910](https://shop.ecowitt.com/products/ws2910_c) | $67.99 | ~$55-65 | Consola/pantalla LCD 6.8" |
| [WN31](https://shop.ecowitt.com/products/wn31) | $10.99 | ~$9-12 | Sensor temp/hum adicional |
| **Subtotal equipos** | **$203.96** | **~$170-190** | |

**Accesorios recomendados:**

| Accesorio | Precio | Descripción |
|-----------|--------|-------------|
| [Bird Spikes](https://shop.ecowitt.com/products/bird-spikes-1) | $9.99 | Protección anti-pájaros para WS69 |
| [Battery Pack 10m](https://shop.ecowitt.com/products/battery-pack) | $14.99 | Cable extensión 10m para cambiar baterías fácil |
| MicroSD card (para GW3000) | ~$5-10 | Almacenamiento local (no incluida) |

**Total estimado con accesorios:**
- Ecowitt Shop: ~$229 (equipos + bird spikes + battery pack)
- AliExpress: ~$195-215 (estimado con accesorios)

**Tienda Oficial Ecowitt en AliExpress:**
- [ecowitt.aliexpress.com/store/1102641321](https://ecowitt.aliexpress.com/store/1102641321)
- Envío mundial, precios ~15-20% menores que tienda oficial
- Verificar siempre opción **915MHz** al seleccionar variante

---

#### Alternativas según prioridad:

| Opción | Componentes | Precio | API Local | Pantalla |
|--------|-------------|--------|-----------|----------|
| **A: Recomendada** | GW3000 + WS69 + WS2910 + WN31 | ~$204 | ✅ Sí | ✅ 6.8" LCD |
| B: Sin sensor extra | GW3000 + WS69 + WS2910 | ~$193 | ✅ Sí | ✅ 6.8" LCD |
| C: Sin pantalla | GW3000 + WS69 + WN31 | ~$136 | ✅ Sí | ❌ No |
| D: Todo en uno | HP2551 | $199 | ❌ No | ✅ 7" TFT |
| E: Premium | HP2560 (Wittboy Pro) | ~$300 | ✅ Sí | ✅ 7" TFT |

---

## 3. Especificaciones Técnicas del HP2551

### Conectividad
- **WiFi**: 2.4GHz 802.11 b/g/n
- **Protocolo de datos**: HTTP POST (Ecowitt Protocol o Weather Underground)
- **Servidor personalizado**: Sí, configurable vía app WSView o WS Tool

### Configuración de Servidor Personalizado
```
Tipo: HTTP (Ecowitt)
IP/Host: [tu servidor]
Puerto: 8080 (o el que elijas)
Path: /data/report/
Intervalo: 20-300 segundos
```

### Limitación Importante
⚠️ El HP2551 **NO tiene API local** como los gateways GW1000/GW2000. Solo puede **enviar** datos (push), no recibirlos (pull). Esto significa que tu servidor debe **escuchar** las conexiones entrantes.

---

## 4. Protocolo Ecowitt - Formato de Datos

El HP2551 envía datos via **HTTP POST** con `Content-Type: application/x-www-form-urlencoded`.

### Campos Típicos Recibidos
```
PASSKEY=MD5(MAC_ADDRESS)
stationtype=HP2551_V1.6.8
dateutc=2024-01-15+14:30:00
tempinf=72.5          # Temperatura interior (°F)
humidityin=45         # Humedad interior (%)
baromrelin=29.92      # Presión relativa (inHg)
baromabsin=29.85      # Presión absoluta (inHg)
tempf=68.3            # Temperatura exterior (°F)
humidity=62           # Humedad exterior (%)
winddir=180           # Dirección viento (grados)
windspeedmph=5.6      # Velocidad viento (mph)
windgustmph=8.2       # Ráfaga máxima (mph)
rainratein=0.00       # Tasa lluvia (in/hr)
dailyrainin=0.12      # Lluvia diaria (in)
weeklyrainin=0.45     # Lluvia semanal (in)
monthlyrainin=2.34    # Lluvia mensual (in)
yearlyrainin=15.67    # Lluvia anual (in)
solarradiation=245.6  # Radiación solar (W/m²)
uv=3                  # Índice UV
wh26batt=0            # Estado batería (0=OK)
freq=868M             # Frecuencia RF
model=HP2551          # Modelo
```

### Notas sobre Unidades
- **Temperatura**: Fahrenheit (convertir a Celsius: `(F-32)*5/9`)
- **Presión**: Pulgadas de Hg (convertir a hPa: `inHg * 33.8639`)
- **Lluvia**: Pulgadas (convertir a mm: `in * 25.4`)
- **Viento**: Millas/hora (convertir a km/h: `mph * 1.60934`)

---

## 5. Integración con Home Assistant

Dado que ya tienes Home Assistant funcionando, la integración es directa.

### 5.1 Con Gateway GW3000/GW2000 (Recomendado)

El gateway tiene **API local**, lo que permite integración nativa sin cloud.

**Opción A: Integración oficial Ecowitt (más fácil)**
```yaml
# Home Assistant detecta automáticamente el gateway
# Ir a: Configuración → Dispositivos y Servicios → Agregar integración → Ecowitt
```

**Opción B: ecowitt2mqtt (más flexible)**
```yaml
# docker-compose.yml
version: '3'
services:
  ecowitt2mqtt:
    image: bachya/ecowitt2mqtt:latest
    ports:
      - "8080:8080"
    environment:
      - ECOWITT2MQTT_MQTT_BROKER=192.168.1.X  # Tu broker MQTT
      - ECOWITT2MQTT_MQTT_TOPIC=weather/ecowitt
      - ECOWITT2MQTT_HASS_DISCOVERY=true
      - ECOWITT2MQTT_OUTPUT_UNIT_SYSTEM=metric
    restart: unless-stopped
```

Configura el GW3000 para enviar a `http://[IP_HA]:8080/data/report/`

### 5.2 Sensores Disponibles en Home Assistant

Una vez integrado, tendrás estas entidades:

| Sensor | Entidad | Unidad |
|--------|---------|--------|
| Temperatura exterior | `sensor.ecowitt_outdoor_temperature` | °C |
| Humedad exterior | `sensor.ecowitt_outdoor_humidity` | % |
| Velocidad viento | `sensor.ecowitt_wind_speed` | km/h |
| Dirección viento | `sensor.ecowitt_wind_direction` | ° |
| Ráfaga máxima | `sensor.ecowitt_wind_gust` | km/h |
| Lluvia diaria | `sensor.ecowitt_daily_rain` | mm |
| Lluvia rate | `sensor.ecowitt_rain_rate` | mm/h |
| Presión | `sensor.ecowitt_pressure` | hPa |
| UV Index | `sensor.ecowitt_uv_index` | - |
| Radiación solar | `sensor.ecowitt_solar_radiation` | W/m² |
| Punto de rocío | `sensor.ecowitt_dew_point` | °C |
| Sensación térmica | `sensor.ecowitt_feels_like` | °C |

### 5.3 Ejemplo de Dashboard Lovelace

```yaml
type: vertical-stack
cards:
  - type: weather-forecast
    entity: weather.ecowitt
    
  - type: horizontal-stack
    cards:
      - type: sensor
        entity: sensor.ecowitt_outdoor_temperature
        name: Temperatura
        
      - type: sensor
        entity: sensor.ecowitt_outdoor_humidity
        name: Humedad
        
  - type: history-graph
    entities:
      - sensor.ecowitt_outdoor_temperature
      - sensor.ecowitt_outdoor_humidity
    hours_to_show: 24
```

### 5.4 Automatizaciones Útiles

```yaml
# Alerta de lluvia
automation:
  - alias: "Alerta Lluvia"
    trigger:
      - platform: numeric_state
        entity_id: sensor.ecowitt_rain_rate
        above: 0
    action:
      - service: notify.mobile_app
        data:
          message: "¡Está lloviendo! {{ states('sensor.ecowitt_rain_rate') }} mm/h"

  # Alerta viento fuerte
  - alias: "Alerta Viento Fuerte"
    trigger:
      - platform: numeric_state
        entity_id: sensor.ecowitt_wind_gust
        above: 50
    action:
      - service: notify.mobile_app
        data:
          message: "Ráfaga de viento: {{ states('sensor.ecowitt_wind_gust') }} km/h"
```

---

## 6. Opciones de Implementación (Servidor Propio)

### Opción A: WeatherNode (Recomendada para Simplicidad)
**⭐ Mejor opción si quieres algo funcionando rápido**

| Aspecto | Detalle |
|---------|---------|
| URL | https://www.weathernode.dev/ |
| Licencia | GNU GPL v3 (Open Source) |
| Requisitos | PHP 8.2+, SQLite/MySQL |
| Despliegue | Docker, VPS, Shared Hosting |

**Características:**
- Dashboard listo para usar con widgets drag-and-drop
- Soporte nativo para Ecowitt
- API REST JSON incluida
- Integración con pronósticos (Yr.no), calidad del aire, alertas
- Temas claro/oscuro
- Cache-first (~10ms response)

**Instalación Docker:**
```bash
docker pull ghcr.io/weathernode/weathernode:latest
docker run -d -p 80:80 weathernode
```

---

### Opción B: ecowitt2mqtt + Home Assistant
**⭐ Mejor para domótica e integración IoT**

| Aspecto | Detalle |
|---------|---------|
| Repo | https://github.com/bachya/ecowitt2mqtt |
| Estrellas | 294+ ⭐ |
| Lenguaje | Python |
| Despliegue | pip, Docker |

**Arquitectura:**
```
HP2551 → [HTTP POST] → ecowitt2mqtt → [MQTT] → Home Assistant/Grafana/etc
```

**Docker Compose:**
```yaml
version: '3'
services:
  ecowitt2mqtt:
    image: bachya/ecowitt2mqtt:latest
    ports:
      - "8080:8080"
    environment:
      - ECOWITT2MQTT_MQTT_BROKER=192.168.1.100
      - ECOWITT2MQTT_MQTT_TOPIC=weather/ecowitt
      - ECOWITT2MQTT_HASS_DISCOVERY=true
      - ECOWITT2MQTT_OUTPUT_UNIT_SYSTEM=metric
```

**Ventajas:**
- Conversión automática de unidades
- Sensores calculados (punto de rocío, sensación térmica, etc.)
- MQTT Discovery para Home Assistant
- Soporte multi-gateway

---

### Opción C: Stack Personalizado (Python + InfluxDB + Grafana)
**⭐ Mejor para control total y aprendizaje**

**Arquitectura:**
```
HP2551 → [HTTP POST] → Flask/FastAPI → InfluxDB → Grafana
                              ↓
                        PostgreSQL (histórico)
                              ↓
                        Web Dashboard (React/Vue)
```

**Receptor Básico (Python/Flask):**
```python
from flask import Flask, request
from influxdb_client import InfluxDBClient, Point

app = Flask(__name__)
client = InfluxDBClient(url="http://localhost:8086", token="your-token", org="your-org")
write_api = client.write_api()

def convert_to_metric(key, value):
    """Convierte unidades imperiales a métricas"""
    if key.endswith('f') and 'temp' in key:
        return (float(value) - 32) * 5/9  # °F → °C
    if key.endswith('mph'):
        return float(value) * 1.60934     # mph → km/h
    if key.endswith('in') and 'rain' in key:
        return float(value) * 25.4        # in → mm
    if key.startswith('barom'):
        return float(value) * 33.8639     # inHg → hPa
    return value

@app.route('/data/report/', methods=['POST'])
def receive_data():
    data = request.form
    point = Point("weather")
    
    for key, value in data.items():
        if key in ['PASSKEY', 'stationtype', 'model']:
            point.tag(key, value)
        else:
            try:
                converted = convert_to_metric(key, value)
                point.field(key, float(converted))
            except ValueError:
                point.field(key, value)
    
    write_api.write(bucket="weather", record=point)
    return "OK", 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
```

---

### Opción D: WeeWX con Interceptor Driver
**⭐ Mejor para meteorólogos aficionados serios**

| Aspecto | Detalle |
|---------|---------|
| URL | https://weewx.com |
| Driver | weewx-interceptor |
| Skins | Múltiples (Belchertown, Seasons, etc.) |

**Configuración en weewx.conf:**
```ini
[Station]
    station_type = Interceptor

[Interceptor]
    driver = user.interceptor
    device_type = ecowitt-client
    port = 8080
```

---

## 7. Proyectos Open Source Relevantes

| Proyecto | Estrellas | Lenguaje | Descripción |
|----------|-----------|----------|-------------|
| [ecowitt2mqtt](https://github.com/bachya/ecowitt2mqtt) | 294 | Python | Bridge MQTT con sensores calculados |
| [homeassistant_ecowitt](https://github.com/garbled1/homeassistant_ecowitt) | 157 | Python | Integración Home Assistant |
| [WundergroundStationForwarder](https://github.com/leoherzog/WundergroundStationForwarder) | 114 | JS | Reenvío a múltiples plataformas |
| [ha-ecowitt-iot](https://github.com/Ecowitt/ha-ecowitt-iot) | 90 | Python | Oficial Ecowitt para HA |
| [ecowitt_http_gateway](https://github.com/iz0qwm/ecowitt_http_gateway) | 65 | PHP | Gateway HTTP simple |
| [offgrid-weather-station](https://github.com/vinthewrench/offgrid-weather-station) | 53 | C++ | Raspberry Pi + RTL-SDR |
| [WeatherNode](https://weathernode.dev) | - | PHP | Dashboard completo |

---

## 8. Arquitectura Propuesta para tu Proyecto

### Stack Recomendado (Balance costo/funcionalidad)

```
┌─────────────────────────────────────────────────────────────┐
│                     ECOWITT HP2551                          │
│                    (WiFi 2.4GHz)                            │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP POST cada 60s
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              SERVIDOR (VPS/Raspberry Pi/NAS)                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Receptor HTTP (Python/Node.js)                       │  │
│  │  - Puerto 8080                                        │  │
│  │  - Validación/Conversión unidades                     │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                               │
│  ┌───────────────────────────▼───────────────────────────┐  │
│  │  Base de Datos                                        │  │
│  │  - InfluxDB (series temporales) ← Recomendado         │  │
│  │  - PostgreSQL (alternativa relacional)                │  │
│  │  - SQLite (simple, sin servidor)                      │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                               │
│  ┌───────────────────────────▼───────────────────────────┐  │
│  │  API REST                                             │  │
│  │  - FastAPI/Express                                    │  │
│  │  - Endpoints: /current, /history, /stats              │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                               │
│  ┌───────────────────────────▼───────────────────────────┐  │
│  │  Dashboard Web                                        │  │
│  │  - React/Vue/Vanilla JS                               │  │
│  │  - Gráficos: Chart.js, Recharts, D3                   │  │
│  │  - Actualización: WebSocket o polling                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Requisitos de Infraestructura

### Opción Económica: Raspberry Pi
- **Hardware**: Raspberry Pi 4 (2GB+) - ~$45
- **Almacenamiento**: microSD 32GB+ o SSD USB
- **Red**: IP fija local o DDNS
- **Costo mensual**: $0 (electricidad ~$3/año)

### Opción Cloud: VPS

#### ⭐ Oracle Cloud Free Tier (GRATIS de por vida)

Oracle ofrece un VPS **Always Free** que es más que suficiente para este proyecto:

| Recurso | Especificación |
|---------|----------------|
| **Procesador** | ARM Ampere A1 (2 OCPUs) |
| **Memoria** | 12 GB RAM |
| **Almacenamiento** | 200 GB Block Volume |
| **Ancho de banda** | 10 TB/mes saliente |
| **Costo** | **$0/mes** (siempre gratis) |

**Cómo obtener Oracle Cloud Free Tier:**

1. **Crear cuenta**: [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
   - Requiere tarjeta de crédito (solo verificación, no cobran)
   - Seleccionar región cercana (ej: São Paulo, Phoenix)
   
2. **Crear instancia ARM**:
   - Ir a Compute → Instances → Create Instance
   - Shape: **VM.Standard.A1.Flex**
   - OCPUs: 2, Memory: 12 GB
   - Image: Ubuntu 22.04 o Oracle Linux 8
   - Agregar SSH key pública
   
3. **Configurar red**:
   - Abrir puerto 8080 en Security List (para receptor Ecowitt)
   - Asignar IP pública reservada (gratis)
   
4. **Instalar stack**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install docker.io docker-compose -y
   git clone https://github.com/XE1E/ecowitt-weather-server-xe1e.git
   cd ecowitt-weather-server-xe1e
   docker-compose up -d
   ```

**Notas importantes:**
- La instancia ARM es **Always Free** (no expira)
- Si no usas la instancia por 7 días, Oracle puede reclamarla
- Configura un cron job simple para mantenerla activa
- Disponible en la mayoría de regiones (excepto Corea del Sur)

**Referencia**: [Oracle Cloud Free Tier Docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

---

### Guía Completa: Configurar VPS Oracle (Mientras Llega el Equipo)

Esta guía te permite tener el servidor listo antes de que llegue el hardware.

#### Paso 1: Crear Cuenta Oracle Cloud

1. Ir a [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
2. Click en "Start for free"
3. Llenar formulario:
   - Email válido
   - País/Región
   - Nombre completo
4. Verificar email
5. Agregar tarjeta de crédito (solo verificación, **no cobran**)
6. Seleccionar **Home Region** (no se puede cambiar después):
   - **Recomendadas**: Phoenix, Ashburn, São Paulo
   - Evitar regiones con alta demanda (pueden no tener ARM disponible)

#### Paso 2: Crear Instancia ARM

1. Ir a **Compute → Instances → Create Instance**

2. **Name**: `ecowitt-server`

3. **Image and Shape**:
   - Click "Edit"
   - Image: **Ubuntu 22.04** (Canonical)
   - Shape: Click "Change Shape"
     - Instance type: **Virtual machine**
     - Shape series: **Ampere** (ARM)
     - Shape: **VM.Standard.A1.Flex**
     - OCPUs: **2**
     - Memory: **12 GB**

4. **Networking**:
   - Crear nueva VCN o usar existente
   - Subnet: pública
   - ✅ Assign public IPv4 address

5. **SSH Keys**:
   - Generar par de llaves o subir tu clave pública
   - **¡GUARDAR LA LLAVE PRIVADA!** (solo se descarga una vez)

6. Click **Create**

#### Paso 3: Configurar Firewall (Security List)

1. Ir a **Networking → Virtual Cloud Networks**
2. Click en tu VCN → **Security Lists** → Default Security List
3. **Add Ingress Rules**:

| Source CIDR | Protocol | Dest Port | Descripción |
|-------------|----------|-----------|-------------|
| 0.0.0.0/0 | TCP | 8080 | Receptor Ecowitt |
| 0.0.0.0/0 | TCP | 80 | HTTP (dashboard) |
| 0.0.0.0/0 | TCP | 443 | HTTPS |
| 0.0.0.0/0 | TCP | 3000 | Grafana (opcional) |

#### Paso 4: Conectar por SSH

```bash
# Linux/Mac
chmod 400 ~/Downloads/ssh-key.key
ssh -i ~/Downloads/ssh-key.key ubuntu@<IP_PUBLICA>

# Windows (PowerShell)
ssh -i C:\Users\TU_USER\Downloads\ssh-key.key ubuntu@<IP_PUBLICA>
```

#### Paso 5: Configuración Inicial del Servidor

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker
sudo apt install -y docker.io docker-compose git curl

# Agregar usuario al grupo docker (evita usar sudo)
sudo usermod -aG docker $USER

# Aplicar cambios de grupo (o reconectar SSH)
newgrp docker

# Verificar Docker
docker --version
docker-compose --version
```

#### Paso 6: Configurar Firewall del SO (iptables)

Oracle Ubuntu tiene iptables bloqueando puertos por defecto:

```bash
# Abrir puertos necesarios
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT

# Guardar reglas permanentemente
sudo netfilter-persistent save
```

#### Paso 7: Clonar y Levantar el Proyecto

```bash
# Clonar repositorio
cd ~
git clone https://github.com/XE1E/ecowitt-weather-server-xe1e.git
cd ecowitt-weather-server-xe1e

# Crear archivo de configuración
cp .env.example .env
nano .env  # Ajustar variables si necesario

# Levantar contenedores
docker-compose up -d

# Verificar que están corriendo
docker-compose ps

# Ver logs
docker-compose logs -f
```

#### Paso 8: Probar con Datos Simulados

Mientras esperas el equipo, prueba que el servidor funciona:

```bash
# Simular envío de datos Ecowitt
curl -X POST http://localhost:8080/data/report/ \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "PASSKEY=test123&stationtype=GW3000&dateutc=2026-07-03+12:00:00&tempf=77.0&humidity=55&baromrelin=29.92&windspeedmph=5.5&winddir=180&dailyrainin=0.1&uv=3&solarradiation=250"

# Verificar respuesta
curl http://localhost:8080/api/current
```

#### Paso 9: Mantener Instancia Activa (Evitar Reclamación)

Oracle puede reclamar instancias inactivas después de 7 días. Crea un cron job simple:

```bash
# Editar crontab
crontab -e

# Agregar esta línea (ping cada 6 horas)
0 */6 * * * curl -s http://localhost:8080/api/current > /dev/null
```

#### Paso 10: Servicios Adicionales (Opcional)

Mientras llega el equipo, puedes instalar otros servicios útiles:

**Uptime Kuma (monitoreo de sitios):**
```bash
docker run -d \
  --name uptime-kuma \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --restart unless-stopped \
  louislam/uptime-kuma:1
```

**Nginx Proxy Manager (reverse proxy + SSL):**
```bash
mkdir ~/nginx-proxy && cd ~/nginx-proxy
cat > docker-compose.yml << 'EOF'
version: '3'
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    ports:
      - '80:80'
      - '443:443'
      - '81:81'
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    restart: unless-stopped
EOF
docker-compose up -d
# Acceder: http://<IP>:81 (admin@example.com / changeme)
```

**WireGuard VPN (acceso seguro):**
```bash
docker run -d \
  --name=wireguard \
  --cap-add=NET_ADMIN \
  -e PUID=1000 -e PGID=1000 \
  -e TZ=America/Mexico_City \
  -e SERVERURL=<TU_IP_PUBLICA> \
  -e PEERS=3 \
  -p 51820:51820/udp \
  -v ~/wireguard:/config \
  --restart unless-stopped \
  lscr.io/linuxserver/wireguard
# Configs en ~/wireguard/peer*/peer*.conf
```

#### Verificación Final

| Servicio | URL | Estado Esperado |
|----------|-----|-----------------|
| Receptor Ecowitt | `http://<IP>:8080/data/report/` | Acepta POST |
| API Current | `http://<IP>:8080/api/current` | JSON con datos |
| Dashboard | `http://<IP>:80` | Página web |
| Uptime Kuma | `http://<IP>:3001` | Panel monitoreo |
| Nginx Proxy | `http://<IP>:81` | Panel admin |

---

#### Alternativas de pago (si Oracle no está disponible)
- **Proveedores**: DigitalOcean, Vultr, Hetzner
- **Specs mínimos**: 1 vCPU, 1GB RAM, 25GB SSD
- **Costo**: $4-6/mes
- **Ventaja**: Más regiones disponibles, soporte dedicado

### Consideraciones de Red
```
Si el servidor está en casa:
  Router → Port Forward 8080 → Raspberry Pi
  
Si usas VPS:
  HP2551 → Internet → VPS (IP pública)
```

---

## 10. Hoja de Ruta Sugerida

### Fase 1: MVP (1-2 semanas)
- [ ] Configurar HP2551 para enviar a servidor personalizado
- [ ] Crear receptor HTTP básico (Python/Flask)
- [ ] Almacenar en SQLite
- [ ] Dashboard HTML simple con datos actuales

### Fase 2: Persistencia (1 semana)
- [ ] Migrar a InfluxDB o PostgreSQL
- [ ] Implementar retención de datos (90 días detallado, agregados permanentes)
- [ ] API REST para consultas históricas

### Fase 3: Visualización (2 semanas)
- [ ] Dashboard React/Vue con gráficos interactivos
- [ ] Gráficos históricos (24h, 7d, 30d, 1y)
- [ ] Widgets: temperatura actual, pronóstico, records

### Fase 4: Funcionalidades Avanzadas
- [ ] Alertas (temperatura extrema, lluvia, viento)
- [ ] Comparación con datos históricos
- [ ] Exportación CSV/JSON
- [ ] PWA para móviles

---

## 11. Estructura Propuesta del Repositorio

```
ecowitt-weather-station/
├── README.md
├── docker-compose.yml
├── .env.example
│
├── receiver/                 # Servidor receptor HTTP
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app.py
│   └── utils/
│       ├── converters.py
│       └── validators.py
│
├── api/                      # API REST
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
│
├── dashboard/                # Frontend Web
│   ├── package.json
│   ├── src/
│   └── public/
│
├── database/
│   └── schema.sql
│
└── docs/
    ├── setup.md
    ├── hp2551-config.md
    └── api-reference.md
```

---

## 12. Próximos Pasos

### Fase 0: Compra del Hardware (Todo 915MHz)
- [ ] Comprar **GW3000** (gateway) - ~$60
- [ ] Comprar **WS69** (sensor exterior 7-en-1) - ~$65
- [ ] Comprar **WS2910** (pantalla LCD) - ~$68
- [ ] Comprar **WN31** (sensor temp/hum extra) - ~$11
- [ ] Comprar **Bird Spikes** + **Battery Pack 10m** - ~$25
- [ ] Verificar envío a tu ubicación (AliExpress o Ecowitt directo)
- [ ] **Total estimado: ~$229**

### Fase 1: Instalación Física
- [ ] Montar sensor WS69 en exterior (poste, techo, etc.)
- [ ] Instalar Bird Spikes en WS69
- [ ] Ubicar GW3000 en interior con buena señal WiFi
- [ ] Ubicar WS2910 donde puedas ver la pantalla
- [ ] Ubicar WN31 en habitación deseada (configurar canal CH1)
- [ ] Conectar equipos a la red eléctrica

### Fase 2: Configuración Básica
- [ ] Configurar GW3000 vía app WSView o WS Tool
- [ ] Conectar a WiFi de casa
- [ ] Verificar que WS2910_C recibe datos del sensor
- [ ] Probar acceso a API local: `http://[IP_GW3000]/get_livedata_info`

### Fase 3: Integración Home Assistant
- [ ] Agregar integración Ecowitt en HA
- [ ] Verificar entidades de sensores
- [ ] Crear dashboard básico
- [ ] Configurar automatizaciones (alertas lluvia, viento, etc.)

### Fase 4: Dashboard Web Personal (Opcional)
- [ ] Decidir: ¿WeatherNode o desarrollo propio?
- [ ] Crear repositorio GitHub
- [ ] Implementar receptor de datos
- [ ] Crear visualización web

### Fase 5: Funcionalidades Avanzadas
- [ ] Históricos y gráficos
- [ ] Exportación de datos
- [ ] Alertas por email/Telegram
- [ ] PWA móvil

---

## Fuentes

### Documentación Oficial
- [Ecowitt Support Downloads](https://www.ecowitt.com/support/download/1)
- [Ecowitt HTTP API Protocol V1.0.5](https://oss.ecowitt.net/uploads/20260109/HTTP%20API%20interface%20Protocol%20(Generic)-(V1.0.5-2025-10-08).pdf)
- [Ecowitt Shop - HP2551](https://shop.ecowitt.com/products/hp2551)
- [Ecowitt Shop - WS90 Sensor](https://shop.ecowitt.com/products/ws90)
- [Ecowitt Shop - GW3001](https://shop.ecowitt.com/products/gw3001-gw3011)

### Proyectos Open Source
- [ecowitt2mqtt - GitHub](https://github.com/bachya/ecowitt2mqtt)
- [WeatherNode](https://www.weathernode.dev/)
- [weewx-interceptor](https://github.com/matthewwall/weewx-interceptor)
- [Home Assistant Ecowitt Integration](https://www.home-assistant.io/integrations/ecowitt/)
- [GitHub Topics: Ecowitt](https://github.com/topics/ecowitt)

### Tutoriales y Guías
- [Ecowitt to InfluxDB - Ben Tasker](https://www.bentasker.co.uk/posts/blog/house-stuff/receiving-weather-info-from-ecowitt-weather-station-and-writing-to-influxdb.html)
- [Ecowitt Gateways Compared - Smartout](https://smartout.net/ecowitt-gateways-compared-gw1100-gw1200-gw2000-gw3000/)
- [Which Ecowitt Should I Buy - Weather Station Experts](https://theweatherstationexperts.com/ecowitt-weather-station/)

### Foros y Discusiones
- [wxforum - HP2551 Custom Server](https://www.wxforum.net/index.php?topic=38476.0)
- [wxforum - HP2553 vs HP2551](https://www.wxforum.net/index.php?topic=42421.0)
- [Cumulus Support - Ecowitt](https://cumulus.hosiene.co.uk/viewtopic.php?t=19343)
- [Home Assistant Community - Ecowitt](https://community.home-assistant.io/t/ecowitt-weatherstation-integration-for-home-assistant/194718)

### Comparativas
- [Best Weather Stations 2026 - TechHive](https://www.techhive.com/article/582346/best-home-weather-station.html)
- [Best Weather Stations for Home Assistant 2026](https://www.smarthomeexplorer.com/guides/best-smart-weather-stations-home-assistant-irrigation-2026)
- [WeatherFlow Tempest API](https://weatherflow.github.io/Tempest/api/)
