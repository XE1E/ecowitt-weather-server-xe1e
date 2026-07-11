# Estudio de Viabilidad: Estación Meteorológica Ecowitt
## Servidor propio (VPS) + Dashboard Web Personal

> Nota: el título original decía "Servidor Local". La arquitectura final (B) usa
> **push del WS2910 por internet a un VPS con HTTPS**, no un servidor en LAN. Las
> menciones a "red local / API local" más abajo describen la opción del GW3000
> que se evaluó y **no** se usa.

---

## 1. Objetivo del Estudio

Evaluar la viabilidad técnica y económica de implementar una estación meteorológica personal con las siguientes características:

- **Monitoreo local**: Captura de datos sin depender de servicios cloud
- **Dashboard web**: Visualización de datos en tiempo real
- **Integración**: Compatible con Home Assistant
- **Presupuesto**: ~$200-250 USD para hardware

Este documento analiza las opciones disponibles en hardware, software e infraestructura, presentando el análisis comparativo y las conclusiones para cada área de decisión.

---

## 2. Resumen de Conclusiones

**Veredicto General: VIABLE**

| Área | Decisión | Justificación |
|------|----------|---------------|
| **Hardware** | WS2910 (kit c/ WS69) + WN31 | Push a servidor custom + pantalla por ~$79-101 |
| **Infraestructura** | Oracle Cloud Free Tier (ARM) | $0/mes permanente, 12GB RAM, IP pública |
| **Software** | WeatherNode (PHP nativo) | Dashboard completo, open source, compatible ARM |

> **Revisión julio 2026:** Se confirmó que el **WS2910 sí soporta envío a servidor personalizado con protocolo Ecowitt** (verificado con manual oficial y comunidad). Como toda la arquitectura de este proyecto funciona por **push** (HTTP POST al VPS) y **no usa la API local de pull**, el GW3000 deja de ser necesario y pasa a ser un **upgrade opcional**. Ver [sección 5](#5-el-gw3000-como-upgrade-opcional).

**Costo total estimado:**
- Hardware: ~$109-131 (con accesorios)
- Infraestructura: $0/mes
- Software: $0 (open source)

**Consideraciones técnicas verificadas:**
- ✅ WS2910 soporta envío a servidor custom via protocolo Ecowitt (App WS View Plus → Weather Services → Customized → Protocol: Ecowitt)
- ✅ El WS2910 se vende como kit que **incluye el sensor WS69** 7-en-1
- ✅ WeatherNode soporta protocolo Ecowitt nativamente
- ✅ PHP 8.2 instalado en Ubuntu ARM64
- ✅ VPS Oracle operativo: http://163.192.147.208:8080
- ⚠️ Ecowitt solo soporta HTTP (no HTTPS) - el servidor usa puerto 8080
- ⚠️ Preferir la variante de firmware **`EasyWeatherPro`** (con WebUI); la variante antigua `EasyWeather-WFI` es "solo Weather Services" y no permite agregar sensores desde la app

**Estado actual:** Servidor listo, esperando hardware Ecowitt.

---

---

# PARTE I: ANÁLISIS DE HARDWARE

---

## 3. Opciones de Hardware

### 3.1 Concepto Clave: Push vs Pull

La distinción determinante para este proyecto **no es** "consola vs gateway", sino **cómo llegan los datos al servidor**:

```
┌─────────────────────────────────────────────────────────────────┐
│  PUSH (lo que usa este proyecto)                                 │
│  El dispositivo ENVÍA datos al servidor cada 60s                │
│  → HTTP POST al VPS: /data/report/ (protocolo Ecowitt)          │
│  → Lo soportan CONSOLAS (WS2910) y GATEWAYS (GW3000) por igual  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  PULL / API Local (lo que este proyecto NO usa)                 │
│  El servidor CONSULTA al dispositivo: get_livedata_info         │
│  → Requiere gateway en la MISMA red local                       │
│  → Solo garantizado en GATEWAYS (GW1100/1200/2000/3000)         │
└─────────────────────────────────────────────────────────────────┘
```

**Como la arquitectura elegida (VPS Oracle + WeatherNode) recibe datos por PUSH, cualquier dispositivo Ecowitt con "Customized server + protocolo Ecowitt" es suficiente. El WS2910 cumple.**

### 3.2 El WS2910: Consola con Push a Servidor Personalizado

El WS2910 es una consola con pantalla que **también actúa como receptor RF y cliente de servidor personalizado**:

```
    WS69 (sensor exterior 7-en-1)      WN31 (temp/hum CH1)
              │  (incluido en kit WS2910)   │
              │ RF 915MHz broadcast          │
              ▼                              ▼
    ┌─────────────────────────────────────────┐
    │        WS2910 (consola + receptor)      │
    │   Pantalla 6.8" + WiFi 2.4GHz           │
    └──────────────────┬──────────────────────┘
                       │ HTTP POST (Protocolo Ecowitt)
                       │ /data/report/  cada 60s
                       ▼
        ┌──────────────────────────────┐
        │  VPS Oracle → WeatherNode    │
        │  Dashboard web + API REST    │
        │  Home Assistant              │
        └──────────────────────────────┘
```

### 3.3 Análisis Comparativo: WS2910 vs GW3000 (para este proyecto)

| Aspecto | WS2910 (kit) | GW3000 |
|---------|--------------|--------|
| **Precio** | ~$68-90 (incluye WS69) | ~$60 (solo gateway) |
| **Pantalla** | ✅ 6.8" LCD | ❌ No |
| **Push a servidor custom (Ecowitt)** | ✅ Sí | ✅ Sí |
| **API Local (pull)** | ⚠️ No garantizada | ✅ Sí |
| **Almacenamiento SD** | ❌ No | ✅ Sí |
| **Conectividad** | WiFi 2.4GHz | WiFi + Ethernet |
| **Antena** | Interna | Externa (más alcance) |
| **Sensor incluido** | ✅ WS69 en el kit | ❌ Se compra aparte |
| **¿Requerido para este proyecto?** | ✅ Suficiente por sí solo | Opcional (upgrade) |

**Análisis**: Para la arquitectura push de este proyecto, el WS2910 hace todo lo necesario y además incluye la pantalla y el sensor WS69 en un solo kit. El GW3000 aporta capacidades (API local, SD, Ethernet, antena externa) que **esta arquitectura no aprovecha**, por lo que se reclasifica como upgrade opcional (ver [sección 5](#5-el-gw3000-como-upgrade-opcional)).

---

## 4. Análisis de Componentes Seleccionados

### 4.1 WS2910 - Consola, Receptor y Cliente de Servidor (El Corazón del Sistema)

| Especificación | Detalle |
|----------------|---------|
| **Precio** | ~$68-90 (kit, incluye WS69) |
| **Pantalla** | 6.8" LCD color |
| **Conectividad** | WiFi 2.4GHz |
| **Función** | Receptor RF + display + cliente de servidor |
| **Push a servidor custom** | ✅ Protocolo Ecowitt o Wunderground |
| **Almacenamiento SD** | ❌ No |
| **Alimentación** | USB 5V |

El WS2910 capta las señales 915MHz de todos los sensores, las muestra en pantalla y **las reenvía por HTTP POST a un servidor personalizado** usando el protocolo Ecowitt — exactamente lo que consume el `receiver` de este proyecto.

**Configuración de envío (App WS View Plus):**
```
Weather Services → Customized
  Enable: ON
  Protocol Type: Ecowitt
  Server IP: [IP pública del VPS Oracle]
  Port: 8080
  Path: /data/report/
  Upload Interval: 60 s
```

**Variantes de firmware (importante al comprar):**

| SSID que muestra | Firmware | WebUI | Agregar sensores |
|------------------|----------|-------|------------------|
| `EasyWeatherPro-xxxx` | Moderno | ✅ Sí | ✅ Sí | 
| `EasyWeather-WFIxxxx` | Antiguo ("solo Weather Services") | ❌ No | ❌ No |

Ambas variantes hacen push a servidor custom, pero para usar sensores extra (WN31) conviene la variante **Pro**.

### 4.2 WS69 - Sensor Exterior 7-en-1

| Medición | Rango | Precisión |
|----------|-------|-----------|
| Temperatura | -40°C a 60°C | ±1°C |
| Humedad | 1% - 99% | ±5% |
| Velocidad viento | 0 - 50 m/s | ±1 m/s (<10), ±10% (≥10) |
| Dirección viento | 0° - 360° | ±10° |
| Lluvia | 0 - 9999 mm | ±10% |
| UV | 0 - 16+ | - |
| Radiación solar | 0 - 200k lux | - |

**Tipo**: Anemómetro mecánico (copas + veleta)
**Alimentación**: Panel solar + baterías AA
**Frecuencia RF**: 915 MHz (América)

### 4.3 WN31 - Sensor Temperatura/Humedad Adicional

| Especificación | Detalle |
|----------------|---------|
| **Precio** | ~$11 |
| **Canales** | Configurables CH1-CH8 |
| **Rango temp** | -40°C a 60°C |
| **Rango hum** | 1% - 99% |
| **Alimentación** | 2x AA |
| **Transmisión** | 915 MHz, cada ~60s |

Tanto el WS2910 (firmware Pro) como el GW3000 soportan hasta **8 sensores WN31** simultáneamente y los reenvían en el push. Campos de datos: `temp1f`-`temp8f` y `humidity1`-`humidity8`.

---

## 5. El GW3000 como Upgrade Opcional

El GW3000 dejó de ser un componente **requerido** porque su ventaja principal — la **API local de pull** — no la usa la arquitectura push de este proyecto. Sin embargo sigue siendo un buen upgrade si en el futuro necesitas lo siguiente.

### 5.1 ¿Qué es la API Local y qué hace?

La API local es un servidor HTTP que corre **dentro del propio gateway** y responde consultas desde tu red local, sin pasar por internet ni por la nube de Ecowitt.

```
GET http://[IP_GW3000]/get_livedata_info   → JSON con todos los sensores AHORA
GET http://[IP_GW3000]/get_sensors_info    → lista de sensores y estado de batería
GET http://[IP_GW3000]/get_network_info    → configuración de red del gateway
```

`get_livedata_info` devuelve un JSON en tiempo real con temperatura, humedad, viento, lluvia, UV, radiación solar, presión y los canales WN31.

### 5.2 Pull (API local) vs Push (Customized server)

| | **Pull — API local** | **Push — Customized server** |
|---|---|---|
| **Quién inicia** | El servidor **pregunta** al gateway | El dispositivo **envía** solo |
| **Dónde funciona** | Solo en la **misma red local** (LAN) | Por internet, a cualquier IP/VPS |
| **Latencia** | Instantánea, bajo demanda | Cada N segundos (intervalo fijo) |
| **Frecuencia** | La decide el cliente (cada 1s si quieres) | Mínimo típico 16-60s |
| **Necesita servidor a la escucha** | ❌ No | ✅ Sí (el `receiver`) |
| **La usa este proyecto** | ❌ No | ✅ Sí |
| **Disponible en WS2910** | ⚠️ No garantizada | ✅ Sí |

### 5.3 Ventajas / Usos reales de la API local

La API local **sí** aporta valor en estos escenarios (ninguno es requisito hoy):

- **Integración nativa con Home Assistant en LAN**: la integración oficial de HA hace *pull* al gateway, sin depender del VPS ni de internet. Datos aunque se caiga tu internet.
- **Consultas bajo demanda / alta frecuencia**: refrescar un panel cada 1-2s (el push está limitado al intervalo de subida).
- **Depuración y diagnóstico**: ver al instante estado de sensores, nivel de batería y RSSI de señal sin esperar al siguiente push.
- **Redundancia**: fuente de datos alterna si el flujo push falla.
- **Cero dependencia de la nube**: todo queda en tu LAN.

### 5.4 Lo que la API local NO hace / limitaciones

- **No funciona a través de internet**: es solo LAN. Para un VPS remoto como el tuyo, seguirías necesitando push de todos modos.
- **No almacena histórico**: solo devuelve el estado *actual*; el histórico lo guarda tu base de datos (SQLite/InfluxDB).
- **Endpoint no documentado oficialmente**: `get_livedata_info` puede cambiar entre versiones de firmware (aunque en la práctica es estable).
- **No sustituye al push** para arquitecturas en la nube.

### 5.5 Otras ventajas del GW3000 sobre el WS2910

| Ventaja | Utilidad |
|---------|----------|
| **Almacenamiento microSD** | Backup local de datos si el servidor/VPS falla |
| **Ethernet (+ PoE en GW3010)** | Conexión más estable que WiFi; un solo cable |
| **Antena externa** | Mejor alcance RF para sensores distantes |
| **API local** | Ver 5.1-5.3 |

### 5.6 Comparativa de Gateways Ecowitt (si decides agregar uno)

| Gateway | Precio | WiFi | Ethernet | API Local | SD Card | PoE | Antena |
|---------|--------|------|----------|-----------|---------|-----|--------|
| GW1100 | ~$30 | ✅ | ❌ | ✅ | ❌ | ❌ | Interna |
| GW1200 | ~$40 | ✅ | ❌ | ✅ | ❌ | ❌ | Interna |
| GW2000 | ~$50 | ✅ | ✅ | ✅ | ❌ | ✅ | Interna |
| **GW3000** | ~$60 | ✅ | ✅ | ✅ | ✅ | ✅ | Externa |

**Recomendación:** agrega un GW3000 solo si más adelante quieres API local en LAN, backup en SD o Ethernet. Para el objetivo actual (VPS + dashboard vía push) **no es necesario**.

---

## 6. Otras Alternativas de Hardware Analizadas

### 6.1 Consolas Todo-en-Uno Ecowitt

Todas soportan push a servidor custom (protocolo Ecowitt); la diferencia es sensor, pantalla y si ofrecen API local en LAN. Más caras que el WS2910 para este proyecto.

| Modelo | Precio | Sensor | Pantalla | API Local | Veredicto |
|--------|--------|--------|----------|-----------|-----------|
| **HP2551** | $199 | WS69 | 7" TFT | ❌ | Funciona por push, pero más cara que el WS2910 |
| **HP2553** | ~$280 | WS90 | 7" TFT | ❌ | Mejor sensor (WS90), sin API local |
| **HP2560 (Wittboy Pro)** | ~$300 | WS90 | 7" TFT | ✅ | Excelente (push + API local) pero costosa |

### 6.2 Kits Wittboy (Gateway + Sensor)

| Modelo | Precio | Sensor | Pantalla | API Local | Veredicto |
|--------|--------|--------|----------|-----------|-----------|
| **GW2001** | $180-230 | WS90 | ❌ | ✅ | Sin pantalla |
| **GW3001** | $205-215 | WS90 | ❌ | ✅ + SD | Sin pantalla |

### 6.3 Otras Marcas

| Marca/Modelo | Precio | Ventajas | Desventajas |
|--------------|--------|----------|-------------|
| **Ambient Weather WS-2902** | $189 | Popular en USA | Mismo HW que Ecowitt, más caro |
| **WeatherFlow Tempest** | ~$329 | Sin partes móviles, API UDP | Más caro, menos expandible |
| **Davis Vantage Pro2** | $900+ | Grado profesional | 3-5x más caro |

### 6.4 Sensor Ultrasónico vs Mecánico

| Aspecto | WS69 (Mecánico) | WS90 (Ultrasónico) |
|---------|-----------------|-------------------|
| **Precio** | ~$65 | ~$150 |
| **Partes móviles** | Sí (copas + veleta) | No |
| **Mantenimiento** | Puede atascarse | Sin mantenimiento |
| **Precisión viento** | ±1 m/s | ±0.5 m/s |
| **Lluvia** | Cangilones | Piezoeléctrico |
| **Ideal para** | Presupuesto, clima moderado | Nieve/hielo, máxima precisión |

**Análisis**: WS69 es suficiente para este proyecto. El WS90 (+$85) no justifica el costo adicional salvo en climas extremos con nieve/hielo frecuente.

---

## 7. Frecuencias RF - Requisito Crítico

```
⚠️ REQUISITO: 915 MHz (América) - NO 433 MHz (Europa/Asia)
```

| Frecuencia | Región | Interferencia | Recomendación |
|------------|--------|---------------|---------------|
| **915 MHz** | América | Baja | ✅ Comprar esta |
| **868 MHz** | Europa | Media | Solo si estás en EU |
| **433 MHz** | Asia | **ALTA** | ❌ Evitar |

**Al comprar, verificar que diga "915 MHz" o "US Version".**

**Dónde comprar versión 915 MHz:**
- [Ecowitt Shop directo](https://shop.ecowitt.com) - Seleccionar "915M"
- [Ecowitt AliExpress](https://ecowitt.aliexpress.com/store/1102641321) - ~15-20% más barato

---

## 8. Precios y Proveedores

### 8.1 Configuración Seleccionada

El WS2910 se vende como **kit que ya incluye el sensor WS69** 7-en-1, por lo que no hay que comprar el sensor por separado.

| Producto | Ecowitt Shop | AliExpress (est.) |
|----------|-------------|-------------------|
| [WS2910 (kit con WS69)](https://shop.ecowitt.com/products/ws2910_c) | $67.99 | ~$55-65 |
| [WN31](https://shop.ecowitt.com/products/wn31) (opcional, interior) | $10.99 | ~$9-12 |
| **Subtotal equipos** | **$78.98** | **~$64-77** |

**Upgrade opcional (no requerido):**

| Producto | Ecowitt Shop | AliExpress (est.) | Aporta |
|----------|-------------|-------------------|--------|
| [GW3000](https://shop.ecowitt.com/products/gw3000-gw3010) | $59.99 | ~$50-55 | API local, SD, Ethernet |

### 8.2 Accesorios Recomendados

| Accesorio | Precio | Descripción |
|-----------|--------|-------------|
| [Bird Spikes](https://shop.ecowitt.com/products/bird-spikes-1) | $9.99 | Protección anti-pájaros para WS69 |
| [Battery Pack 10m](https://shop.ecowitt.com/products/battery-pack) | $14.99 | Cable extensión para cambiar baterías fácil |

**Total estimado con accesorios: ~$104** (Ecowitt Shop, sin GW3000)

### 8.3 Sensores Adicionales Compatibles

| Sensor | Precio | Canales | Uso Típico |
|--------|--------|---------|------------|
| **WN31** | $11 | Hasta 8 | Interior, habitaciones |
| **WN32P** | $16 | 1 | Interior con presión |
| **WH51** | $15 | Hasta 8 | Humedad de suelo |
| **WH57** | $25 | 1 | Detector de rayos |
| **WH45** | $80 | 1 | Calidad del aire (PM2.5/CO2) |

---

## 9. Resumen de Configuraciones de Hardware

| Opción | Componentes | Precio | Push Ecowitt | API Local | Pantalla |
|--------|-------------|--------|--------------|-----------|----------|
| **A: Seleccionada** | WS2910 (kit c/ WS69) + WN31 | ~$79 | ✅ Sí | ⚠️ No garantizada | ✅ 6.8" LCD |
| B: Mínima | WS2910 (kit c/ WS69) | ~$68 | ✅ Sí | ⚠️ No garantizada | ✅ 6.8" LCD |
| C: Con upgrade | WS2910 (kit) + WN31 + GW3000 | ~$139 | ✅ Sí | ✅ Sí | ✅ 6.8" LCD |
| D: Todo en uno | HP2551 | $199 | ✅ Sí | ❌ No | ✅ 7" TFT |
| E: Premium | HP2560 (Wittboy Pro) | ~$300 | ✅ Sí | ✅ Sí | ✅ 7" TFT |

### Conclusión Hardware

**Configuración seleccionada: Opción A (WS2910 kit con WS69 + WN31)**

**Justificación:**
- Envía datos al VPS por push con protocolo Ecowitt (único requisito real de la arquitectura)
- Incluye pantalla física para visualización sin computadora
- El kit ya trae el sensor WS69 — sin doble compra
- Precio muy inferior a la config anterior (~$79 vs ~$204)
- Permite expansión con el WN31 (y más sensores en variante firmware Pro)
- El GW3000 queda disponible como upgrade opcional si luego se necesita API local, SD o Ethernet (ver [sección 5](#5-el-gw3000-como-upgrade-opcional))

---

# PARTE II: ANÁLISIS DE SOFTWARE

---

## 10. Protocolo Ecowitt - Formato de Datos

### 10.1 Datos vía API Local (GW3000)

```
GET http://[IP_GW3000]/get_livedata_info
```

Respuesta JSON con datos estructurados de todos los sensores.

### 10.2 Datos vía HTTP POST (Push)

El GW3000 puede enviar datos via **HTTP POST** con `Content-Type: application/x-www-form-urlencoded`:

```
PASSKEY=MD5(MAC_ADDRESS)
stationtype=GW3000_V1.x.x
dateutc=2026-07-04+14:30:00
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
solarradiation=245.6  # Radiación solar (W/m²)
uv=3                  # Índice UV
temp1f=70.2           # Sensor WN31 CH1 (°F)
humidity1=48          # Sensor WN31 CH1 (%)
```

### 10.3 Conversión de Unidades

| Campo | Unidad Original | Conversión a Métrico |
|-------|-----------------|----------------------|
| Temperatura | °F | `(F-32)*5/9` → °C |
| Presión | inHg | `inHg * 33.8639` → hPa |
| Lluvia | in | `in * 25.4` → mm |
| Viento | mph | `mph * 1.60934` → km/h |

---

## 11. Integración con Home Assistant

> **Topología:** el HA y el Ecowitt (WS2910) están en **sitios distintos** (no en la misma red local). Por eso el **VPS actúa como punto central** que ambos alcanzan por internet.
>
> **Método elegido (Arquitectura B):** el WS2910 (sitio A) hace push al VPS, y **Home Assistant (sitio B) lee el histórico/actual desde la API REST de WeatherNode**. Ver 11.1. No requiere GW3000 ni que HA esté en la misma red que la estación.

### 11.1 Método elegido: HA lee la API REST del VPS

Home Assistant consume la API del servidor con un sensor `rest`:

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

**Ventaja:** simple, HA accede desde cualquier lugar.
**Limitación:** si se cae internet, HA no puede leer el VPS (los datos siguen viéndose en la pantalla del WS2910, pero no se registran). Ver [nota de resiliencia](#136-resiliencia-ante-cortes-de-internet).

### 11.2 Alternativa: Integración nativa Ecowitt (push directo a HA)

La integración oficial **Ecowitt de HA es un receptor push** (webhook), *no* usa la API local. Se configura el WS2910 con "Customized → Protocol: Ecowitt" apuntando a la IP de HA.

⚠️ **No recomendada en esta topología** aunque HA sea accesible por internet:
- El WS2910 tiene **un solo slot "Customized"**: push a HA *en vez de* al VPS (perderías el histórico centralizado en WeatherNode).
- Obligaría a exponer HA por **HTTP plano** (Ecowitt no soporta HTTPS). Con la Arquitectura B, en cambio, solo el VPS acepta HTTP (datos meteo no sensibles) y **HA se mantiene tras su acceso seguro (HTTPS)**.
- Al estar HA en otra red, tampoco aporta buffer local para cortes en el sitio de la estación.

Se documenta solo como referencia; la Arquitectura B (11.1) es la adecuada aquí.

### 11.3 Alternativa: ecowitt2mqtt

```yaml
# docker-compose.yml
version: '3'
services:
  ecowitt2mqtt:
    image: bachya/ecowitt2mqtt:latest
    ports:
      - "8080:8080"
    environment:
      - ECOWITT2MQTT_MQTT_BROKER=192.168.1.X
      - ECOWITT2MQTT_MQTT_TOPIC=weather/ecowitt
      - ECOWITT2MQTT_HASS_DISCOVERY=true
      - ECOWITT2MQTT_OUTPUT_UNIT_SYSTEM=metric
    restart: unless-stopped
```

### 11.4 Sensores Disponibles en Home Assistant

| Sensor | Entidad | Unidad |
|--------|---------|--------|
| Temperatura exterior | `sensor.ecowitt_outdoor_temperature` | °C |
| Humedad exterior | `sensor.ecowitt_outdoor_humidity` | % |
| Velocidad viento | `sensor.ecowitt_wind_speed` | km/h |
| Dirección viento | `sensor.ecowitt_wind_direction` | ° |
| Lluvia diaria | `sensor.ecowitt_daily_rain` | mm |
| Presión | `sensor.ecowitt_pressure` | hPa |
| UV Index | `sensor.ecowitt_uv_index` | - |
| Radiación solar | `sensor.ecowitt_solar_radiation` | W/m² |
| Temp CH1 (WN31) | `sensor.ecowitt_temp_1` | °C |
| Humedad CH1 (WN31) | `sensor.ecowitt_humidity_1` | % |

### 11.5 Automatizaciones Útiles

```yaml
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

## 12. Opciones de Software para Servidor

### 12.1 Opciones Analizadas

#### Opción A: WeatherNode

| Aspecto | Detalle |
|---------|---------|
| **URL** | https://www.weathernode.dev/ |
| **Licencia** | GNU GPL v3 (Open Source) |
| **Requisitos** | PHP 8.2+, SQLite/MySQL |
| **Despliegue** | Docker, VPS, Shared Hosting |

**Características:**
- Dashboard listo para usar con widgets drag-and-drop
- Soporte nativo para protocolo Ecowitt
- API REST JSON incluida
- Integración con pronósticos (Yr.no), calidad del aire, alertas
- Temas claro/oscuro
- Cache-first (~10ms response)
- Responsive (móvil/desktop)

**Instalación Docker:**
```bash
docker pull ghcr.io/weathernode/weathernode:latest
docker run -d -p 80:80 weathernode
```

#### Opción B: ecowitt2mqtt + Home Assistant

| Aspecto | Detalle |
|---------|---------|
| **Repo** | https://github.com/bachya/ecowitt2mqtt |
| **Lenguaje** | Python |
| **Requisitos** | MQTT Broker, Home Assistant |

**Arquitectura:**
```
GW3000 → [HTTP POST] → ecowitt2mqtt → [MQTT] → Home Assistant/Grafana
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

**Ventajas:** Conversión automática de unidades, sensores calculados, MQTT Discovery
**Desventajas:** Requiere MQTT broker adicional, más componentes

#### Opción C: Stack Personalizado (Python + InfluxDB + Grafana)

**Arquitectura:**
```
GW3000 → [HTTP POST] → Flask/FastAPI → InfluxDB → Grafana
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

**Ventajas:** Control total, aprendizaje, personalización ilimitada
**Desventajas:** Tiempo de desarrollo, mantenimiento continuo

#### Opción D: WeeWX con Interceptor Driver

| Aspecto | Detalle |
|---------|---------|
| **URL** | https://weewx.com |
| **Driver** | weewx-interceptor |
| **Skins** | Belchertown, Seasons, etc. |

**Configuración en weewx.conf:**
```ini
[Station]
    station_type = Interceptor

[Interceptor]
    driver = user.interceptor
    device_type = ecowitt-client
    port = 8080
```

**Ventajas:** Muy completo, comunidad activa, múltiples skins
**Desventajas:** Curva de aprendizaje alta, orientado a meteorólogos avanzados

### 12.2 Análisis Comparativo de Software

| Criterio | WeatherNode | ecowitt2mqtt | Stack Custom | WeeWX |
|----------|-------------|--------------|--------------|-------|
| Tiempo setup | 5 min | 15 min | Días/semanas | 1-2 horas |
| Complejidad | Baja | Media | Alta | Media-Alta |
| Personalización | Media | Media | Total | Alta |
| Mantenimiento | Bajo | Bajo | Alto | Medio |
| Dashboard incluido | ✅ Sí | ❌ No | ❌ Desarrollar | ✅ Skins |
| API REST | ✅ Sí | Via HA | ✅ Desarrollar | ❌ No |

**Análisis:**
- **WeatherNode**: Solución más rápida y completa para el caso de uso
- **ecowitt2mqtt**: Buena opción si ya tienes infraestructura MQTT
- **Stack Custom**: Excesivo para las necesidades actuales, alto costo de mantenimiento
- **WeeWX**: Orientado a meteorólogos avanzados, curva de aprendizaje alta

### 12.3 Conclusión Software

**Software seleccionado: WeatherNode**

**Justificación:**
- Dashboard completo incluido (no requiere desarrollo)
- Soporte nativo para protocolo Ecowitt
- API REST disponible para integraciones futuras
- Open source (GNU GPL v3)
- Bajo mantenimiento

**Método de instalación: PHP nativo (sin Docker)**

La imagen Docker oficial de WeatherNode no tiene soporte ARM64 confirmado. Para Oracle Cloud ARM VPS, se instalará directamente con PHP:

```bash
# Ubuntu ARM64 en Oracle Cloud
sudo apt update
sudo apt install -y apache2 php8.2 php8.2-sqlite3 php8.2-curl php8.2-xml php8.2-mbstring
sudo systemctl enable apache2

# Descargar e instalar WeatherNode
cd /var/www/html
sudo wget https://github.com/centauri/WeatherNode/releases/latest/download/weathernode.zip
sudo unzip weathernode.zip
sudo chown -R www-data:www-data /var/www/html/weathernode
```

### 12.4 Configuración del WS2910 (o GW3000) para WeatherNode

**Importante: Ecowitt NO soporta HTTPS, solo HTTP**

```
Protocolo: Ecowitt
Servidor: [IP_VPS_ORACLE]
Puerto: 8080
Path: /data/report/
Intervalo: 60 segundos
```

**Configuración en el WS2910 (App WS View Plus):**
1. Abrir la app **WS View Plus** y seleccionar la consola WS2910
2. Ir a Weather Services → Customized
3. Enable: ✅
4. Protocol Type: Ecowitt
5. Server IP: [IP pública del VPS Oracle]
6. Path: /data/report/
7. Port: 8080
8. Upload Interval: 60 seconds

> Si en el futuro agregas un GW3000, la configuración es idéntica; además podrás acceder a su Web UI local en `http://[IP_LOCAL_GW3000]`.

---

## 13. Arquitectura del Sistema

Topología actual: **estación y HA en sitios distintos**, con el VPS como punto central alcanzable por internet desde ambos.

```
  SITIO A (estación)
┌─────────────────────────────────────────────────────────────┐
│                  SENSORES RF 915MHz                         │
│         WS69 (exterior)      WN31 (interior CH1)            │
└─────────────────────┬───────────────────────────────────────┘
                      │ RF broadcast
                      ▼
┌───────────────────────────────────┐
│    WS2910 (consola + receptor)    │
│    ✅ Display LCD 6.8" color       │
│    ✅ WiFi 2.4GHz                  │
│    ✅ Push a servidor custom       │
└────────┬──────────────────────────┘
         │ HTTP POST (Ecowitt Protocol)
         │ ⚠️ Solo HTTP, no HTTPS
         │ Internet
         ▼
┌─────────────────────────────────────────────────────────────┐
│           ORACLE CLOUD VPS (Always Free)                    │
│           ARM Ampere A1 | 12GB RAM | Ubuntu 22.04           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Apache 2.4 + PHP 8.2                     │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │              WeatherNode                        │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  Receptor HTTP (:8080/data/report/)      │  │  │  │
│  │  │  └─────────────────┬─────────────────────────┘  │  │  │
│  │  │  ┌─────────────────▼─────────────────────────┐  │  │  │
│  │  │  │  Base de Datos (SQLite)                  │  │  │  │
│  │  │  └─────────────────┬─────────────────────────┘  │  │  │
│  │  │  ┌─────────────────▼─────────────────────────┐  │  │  │
│  │  │  │  Dashboard Web + API REST                │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────┬──────────────────────────────────┬───────────────┘
           │ REST (internet)                   │ HTTP
           ▼                                   ▼
┌─────────────────────┐            ┌─────────────────┐
│  Home Assistant     │            │  Navegador Web  │
│  (SITIO B, remoto)  │            │  (dashboard)    │
│  sensor: rest       │            └─────────────────┘
└─────────────────────┘
```

### 13.6 Resiliencia ante cortes de internet

Con esta topología (WS2910 sin SD, HA remoto) hay dos puntos de fallo independientes:

| Escenario | Pantalla WS2910 | Histórico en VPS | HA (remoto) |
|-----------|-----------------|------------------|-------------|
| **Todo OK** | ✅ En vivo | ✅ Guardando | ✅ Leyendo |
| **Se cae internet en Sitio A (estación)** | ✅ Sigue (RF local) | ❌ Hueco durante el corte, **datos perdidos** (sin SD ni buffer) | Muestra último dato, sin novedades |
| **Se cae internet en Sitio B (HA)** | ✅ Sigue | ✅ Intacto | ❌ No lee; se pone al día al volver |

**Conclusión:** dado que HA es y seguirá siendo **remoto** (otra red), el único riesgo real de pérdida de datos es un corte de internet **en el sitio de la estación**, donde el WS2910 no tiene dónde almacenar. Mitigación disponible en esta topología:
- **GW3000 con microSD** (upgrade opcional): guarda una copia local recuperable durante el corte. Es la única forma de no perder datos ante un corte en el sitio de la estación mientras HA esté remoto.
- Alternativa sin hardware extra: **aceptar el hueco** durante cortes (los datos meteorológicos de esos minutos no son críticos) — es el compromiso de la config "solo WS2910".

**Nota importante:** Los dispositivos Ecowitt no soportan conexiones HTTPS/TLS. El servidor debe aceptar HTTP en puerto 8080 para recibir datos del gateway.

---

# PARTE III: ANÁLISIS DE INFRAESTRUCTURA

---

## 14. Opciones de Infraestructura

### 14.1 Opciones Analizadas

#### Opción A: Oracle Cloud Free Tier

| Recurso | Especificación |
|---------|----------------|
| **Procesador** | ARM Ampere A1 (2 OCPUs) |
| **Memoria** | 12 GB RAM |
| **Almacenamiento** | 200 GB Block Volume |
| **Ancho de banda** | 10 TB/mes saliente |
| **Sistema Operativo** | Ubuntu 22.04 LTS |
| **Costo** | **$0/mes** (Always Free, no expira) |

**Ventajas:**
- Costo cero permanente (no es trial)
- Recursos generosos (12 GB RAM)
- IP pública fija incluida
- Acceso global desde cualquier lugar
- Sin mantenimiento de hardware

**Requisitos:**
1. Cuenta Oracle Cloud (tarjeta de crédito para verificación, no cobran)
2. Región con disponibilidad ARM (Phoenix, Ashburn, São Paulo recomendadas)

**Cómo obtener:**

1. Crear cuenta en [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
2. Ir a Compute → Instances → Create Instance
3. Shape: **VM.Standard.A1.Flex** (2 OCPUs, 12 GB)
4. Image: Ubuntu 22.04
5. Configurar SSH key y crear

Ver [oracle-vps-setup.md](oracle-vps-setup.md) para guía completa.

#### Opción B: Raspberry Pi (Local)

| Recurso | Especificación |
|---------|----------------|
| **Hardware** | Raspberry Pi 4 (2GB+) |
| **Almacenamiento** | microSD 32GB+ o SSD USB |
| **Red** | IP fija local o DDNS |
| **Costo inicial** | ~$45-75 |
| **Costo mensual** | ~$3/año electricidad |

**Ventajas:**
- Control físico total
- Sin dependencia de terceros
- Una vez comprado, sin costos recurrentes

**Desventajas:**
- Requiere configurar port forwarding o DDNS
- Dependiente de conexión de internet local
- Mantenimiento de hardware (SD cards fallan)
- No accesible si internet local cae

#### Opción C: VPS de Pago

| Proveedor | Specs Mínimos | Costo Mensual |
|-----------|---------------|---------------|
| DigitalOcean | 1 vCPU, 1GB RAM | $4-6 |
| Vultr | 1 vCPU, 1GB RAM | $5 |
| Hetzner | 2 vCPU, 2GB RAM | €3.79 |
| Linode | 1 vCPU, 1GB RAM | $5 |

**Ventajas:**
- Más regiones disponibles
- Soporte dedicado
- Setup más simple que Oracle

**Desventajas:**
- Costo mensual recurrente
- Oracle Free ofrece más recursos gratis

### 14.2 Análisis Comparativo de Infraestructura

| Criterio | Oracle Free | Raspberry Pi | VPS Pago |
|----------|-------------|--------------|----------|
| Costo inicial | $0 | ~$45-75 | $0 |
| Costo mensual | **$0** | ~$0.25 | $4-6 |
| RAM | 12 GB | 2-8 GB | 1-2 GB |
| IP pública | ✅ Incluida | ❌ DDNS | ✅ Incluida |
| Acceso global | ✅ Sí | ⚠️ Depende | ✅ Sí |
| Mantenimiento HW | ❌ No necesario | ✅ Sí | ❌ No necesario |
| Disponibilidad | ⚠️ Por región | ✅ Siempre | ✅ Siempre |

**Análisis:**
- **Oracle Free**: Mejor relación costo/beneficio (gratis con 12GB RAM)
- **Raspberry Pi**: Viable pero requiere configuración de red adicional
- **VPS Pago**: Innecesario dado que Oracle ofrece más recursos gratis

### 14.3 Consideraciones de Red

```
Si el servidor está en casa (Raspberry Pi):
  Router → Port Forward 8080 → Raspberry Pi
  O usar DDNS (noip.com, duckdns.org)
  
Si usas VPS (Oracle/otro):
  GW3000 → Internet (HTTP:8080) → VPS (IP pública directa)
```

### 14.4 Limitación de Seguridad: Solo HTTP

**Los dispositivos Ecowitt NO soportan HTTPS/TLS.**

| Aspecto | Implicación |
|---------|-------------|
| **Protocolo** | Solo HTTP (puerto 8080) |
| **Datos en tránsito** | No cifrados |
| **Riesgo** | Bajo - solo datos meteorológicos, no sensibles |
| **Mitigación** | Los datos no contienen información personal |

**Configuración en Oracle Cloud (ya configurado):**
- Security List: Puerto TCP 8080 abierto ✅
- Network Security Group (NSG): Puerto TCP 8080 abierto ✅
- iptables: `sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT` ✅

**Nota importante:** Oracle Cloud requiere abrir puertos en **TRES** lugares:
1. **Security List** (nivel de subnet)
2. **Network Security Group** (nivel de VNIC) 
3. **iptables** (nivel de sistema operativo)

**Nota:** Si necesitas acceder al dashboard de forma segura, puedes configurar un reverse proxy (Nginx) que ofrezca HTTPS para el acceso web, mientras mantiene HTTP interno para recibir datos de Ecowitt.

### 14.5 Conclusión Infraestructura

**Infraestructura seleccionada: Oracle Cloud Free Tier**

**Justificación:**
- Costo cero permanente (Always Free, no es trial)
- Recursos generosos: 12 GB RAM, 200 GB almacenamiento
- IP pública fija incluida
- Acceso global sin configuración adicional
- Sin mantenimiento de hardware
- PHP 8.2 y Apache disponibles para ARM64

**Stack de instalación:**
```
Ubuntu 22.04 ARM64
├── Apache 2.4 (servidor web)
├── PHP 8.2 (runtime)
│   ├── php8.2-sqlite3
│   ├── php8.2-curl
│   ├── php8.2-xml
│   └── php8.2-mbstring
└── WeatherNode (aplicación)
```

**Nota sobre seguridad:** El servidor debe aceptar conexiones HTTP (puerto 8080) porque los dispositivos Ecowitt no soportan HTTPS/TLS.

Ver [oracle-vps-setup.md](oracle-vps-setup.md) para guía de configuración completa.

---

# PARTE IV: CONCLUSIONES Y PLAN DE IMPLEMENTACIÓN

---

## 15. Hoja de Ruta

### Fase 0: Compra del Hardware
- [ ] Comprar **WS2910 kit** (915MHz, incluye WS69) - ~$68 · verificar firmware **EasyWeatherPro**
- [ ] Comprar **WN31** (915MHz, opcional interior) - ~$11
- [ ] Comprar accesorios (bird spikes, battery pack) - ~$25
- [ ] **Total: ~$104**
- [ ] _(Opcional / upgrade)_ **GW3000** (915MHz) - ~$60, si luego quieres API local / SD / Ethernet

### Fase 1: Configurar VPS Oracle ✅ COMPLETADO
- [x] Crear cuenta en [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
- [x] Crear instancia ARM Ampere A1 (2 OCPU, 12GB RAM)
- [x] Configurar Security List (puerto 8080 abierto)
- [x] Configurar Network Security Group (puerto 8080 abierto)
- [x] Instalar stack (Apache 2.4 + PHP 8.2)
- [x] Instalar WeatherNode (Laravel 12)
- [x] Configurar firewall del SO (iptables)
- [x] Probar acceso web: http://163.192.147.208:8080

**Stack instalado:**
```
Ubuntu 22.04.5 LTS (aarch64)
├── Apache 2.4.52 (puerto 8080)
├── PHP 8.2.31
│   ├── php8.2-sqlite3
│   ├── php8.2-curl
│   ├── php8.2-xml
│   ├── php8.2-mbstring
│   └── php8.2-intl
└── WeatherNode (Laravel 12.62.0)
    └── SQLite database
```

**Acceso SSH:**
```bash
ssh -i "oracle.key" ubuntu@163.192.147.208
```

### Fase 2: Instalación Física del Hardware
- [ ] Montar WS69 en exterior (verificar distancia RF)
- [ ] Ubicar el WS2910 donde sea visible y con buena señal WiFi 2.4GHz
- [ ] Configurar WN31 en canal CH1
- [ ] _(Opcional)_ Ubicar GW3000 en interior e insertar microSD

### Fase 3: Configuración de la Consola WS2910
- [ ] Configurar WS2910 vía app **WS View Plus** (WiFi 2.4GHz)
- [ ] Verificar que la consola recibe datos de los sensores en pantalla
- [ ] Configurar Custom Server (Weather Services → Customized):
  - Server: [IP_VPS_ORACLE]
  - Port: 8080
  - Path: /data/report/
  - Protocol: Ecowitt
  - Interval: 60s
- [ ] _(Opcional, si agregas GW3000)_ Probar API local: `http://[IP_GW3000]/get_livedata_info`

### Fase 4: Verificación e Integración
- [ ] Verificar datos llegando a WeatherNode
- [ ] Configurar dashboard en WeatherNode
- [ ] Configurar integración Home Assistant (opcional)
- [ ] Probar alertas y notificaciones

### Fase 5: Mantenimiento
- [ ] Configurar cron job para mantener VPS activo
- [ ] Configurar backups de base de datos
- [ ] Monitorear estado de sensores

---

## 16. Proyectos Open Source Relevantes

| Proyecto | Lenguaje | Descripción |
|----------|----------|-------------|
| [ecowitt2mqtt](https://github.com/bachya/ecowitt2mqtt) | Python | Bridge MQTT con sensores calculados |
| [homeassistant_ecowitt](https://github.com/garbled1/homeassistant_ecowitt) | Python | Integración Home Assistant |
| [WeatherNode](https://weathernode.dev) | PHP | Dashboard completo |
| [ha-ecowitt-iot](https://github.com/Ecowitt/ha-ecowitt-iot) | Python | Oficial Ecowitt para HA |

---

## 17. Fuentes y Referencias

### Documentación Oficial Ecowitt
- [Ecowitt Support Downloads](https://www.ecowitt.com/support/download/1)
- [Ecowitt HTTP API Protocol V1.0.5](https://oss.ecowitt.net/uploads/20260109/HTTP%20API%20interface%20Protocol%20(Generic)-(V1.0.5-2025-10-08).pdf)
- [GW3000 Manual](https://oss.ecowitt.net/uploads/20241204/GW3000Manual.pdf)
- [WS View Plus Manual](https://oss.ecowitt.net/uploads/20250408/WS%20View%20Plus%20&%20Web%20UI%20Manual%20(Generic).pdf)
- [Ecowitt Shop - GW3000](https://shop.ecowitt.com/products/gw3000-gw3010)
- [Ecowitt Shop - WS2910](https://shop.ecowitt.com/products/ws2910_c)
- [Ecowitt Shop - WS69](https://shop.ecowitt.com/products/ws69)

### WeatherNode
- [WeatherNode - Sitio Oficial](https://www.weathernode.dev/)
- [WeatherNode - GitHub](https://github.com/centauri/WeatherNode)

### Oracle Cloud
- [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)
- [Apache PHP en Ubuntu - Oracle Docs](https://docs.oracle.com/en-us/iaas/Content/developer/apache-on-ubuntu/01oci-ubuntu-apache-summary.htm)

### Home Assistant
- [Ecowitt Integration - Home Assistant](https://www.home-assistant.io/integrations/ecowitt/)
- [ecowitt2mqtt - GitHub](https://github.com/bachya/ecowitt2mqtt)

### Tutoriales y Guías
- [Ecowitt to InfluxDB - Ben Tasker](https://www.bentasker.co.uk/posts/blog/house-stuff/receiving-weather-info-from-ecowitt-weather-station-and-writing-to-influxdb.html)
- [Ecowitt Gateways Compared - Smartout](https://smartout.net/ecowitt-gateways-compared-gw1100-gw1200-gw2000-gw3000/)
- [Home Assistant Ecowitt Setup - Derek Seaman](https://www.derekseaman.com/2023/12/home-assistant-ecowitt-weather-station-setup.html)

### Foros y Comunidad
- [wxforum - Ecowitt](https://www.wxforum.net/index.php?board=85.0)
- [Home Assistant Community - Ecowitt](https://community.home-assistant.io/t/ecowitt-weatherstation-integration-for-home-assistant/194718)
