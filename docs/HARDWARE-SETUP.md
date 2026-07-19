# Configuración del Hardware Real

Guía paso a paso para poner en marcha la estación meteorológica Ecowitt real,
reemplazando el simulador.

---

## Requisitos Previos

- **Estación WS2910** (consola + sensor exterior WS69)
- **App WS View Plus** instalada en el móvil (iOS/Android)
- **Red WiFi** a la que conectar la consola
- Acceso SSH al servidor: `ssh -i oracle.key ubuntu@163.192.147.208`

### Hardware Opcional

- **GW1100** - Gateway adicional para ubicación remota
- **WN31** - Sensor de temperatura/humedad adicional (hasta 8 canales)
- **BME280** - Sensor local conectado al ESP32 display

---

## Paso 1: Detener el Simulador

El servidor viene con un simulador que genera datos de prueba. Hay que detenerlo
antes de conectar el hardware real.

### 1.1 Conectar al servidor

```bash
ssh -i ~/.ssh/oracle.key ubuntu@163.192.147.208
cd ~/ecowitt-weather-server-xe1e
```

### 1.2 Verificar si hay cron del simulador

```bash
crontab -l | grep simulate
```

Si aparece una línea con `simulate.py`, hay que quitarla:

```bash
crontab -l | grep -v simulate.py | crontab -
```

### 1.3 Borrar datos simulados de InfluxDB

**IMPORTANTE:** Esto borra TODOS los datos meteorológicos. Solo hacerlo si
no hay datos reales que conservar.

```bash
# Obtener el token de InfluxDB
TOKEN=$(grep -E '^INFLUXDB_TOKEN=' .env | cut -d= -f2-)

# Borrar datos de la medición "weather"
docker compose exec influxdb influx delete --bucket ecowitt \
  --start 2020-01-01T00:00:00Z \
  --stop 2035-01-01T00:00:00Z \
  --predicate '_measurement="weather"' \
  -t "$TOKEN"
```

### 1.4 Verificar que el servidor está listo

```bash
curl -s http://localhost:8080/health
# Debe responder: {"status":"healthy",...}

curl -s http://localhost:8080/api/current
# Debe responder: 404 (no hay datos aún)
```

---

## Paso 2: Configurar la Consola WS2910

### 2.1 Conectar la consola a WiFi

1. Encender la consola WS2910
2. Abrir la app **WS View Plus** en el móvil
3. Ir a **Device List** → **+** → buscar el dispositivo
4. Seguir el asistente para conectar a tu red WiFi

### 2.2 Configurar envío de datos al servidor

En la app WS View Plus:

1. Ir a **Device List** → seleccionar tu WS2910
2. Ir a **Weather Services** → **Customized**
3. Habilitar **Customized** (switch ON)
4. Configurar:

| Campo | Valor |
|-------|-------|
| **Protocol Type** | `Ecowitt` |
| **Server IP/Hostname** | `163.192.147.208` |
| **Port** | `8080` |
| **Path** | `/data/report/` |
| **Upload Interval** | `60` segundos |

5. Guardar cambios

### 2.3 Verificar envío de datos

En el servidor, ver los logs en tiempo real:

```bash
docker compose logs -f receiver
```

Deberías ver cada 60 segundos algo como:

```
INFO - Stored data from WS2910 (EasyWeatherPro) - Temp: 23.5°C, Humidity: 65%, Wind: 5.2 km/h
```

Si no aparece nada después de 2 minutos:
- Verificar que la consola tiene conexión WiFi
- Verificar que el Path termina en `/` (`/data/report/`)
- Verificar que el puerto 8080 está abierto en Oracle Cloud

---

## Paso 3: Configurar Ubicación y Zona Horaria

### 3.1 Obtener coordenadas exactas

Usa Google Maps o tu GPS para obtener las coordenadas exactas donde está
instalada la estación. Ejemplo para CDMX:

- Latitud: `19.380359`
- Longitud: `-99.174564`

### 3.2 Configurar en el panel de administración

1. Ir a **https://clima.xe1e.net/pro/admin**
2. Iniciar sesión con las credenciales de admin
3. Ir a **Sistema**
4. Configurar:
   - **Latitud**: tu latitud real
   - **Longitud**: tu longitud real
   - **Zona horaria**: `-6` para México Central, `-7` para Noroeste
   - **Timeout estación offline**: `15` minutos (o ajustar según necesites)
5. Guardar cambios

Esto afecta:
- Cálculos de amanecer/atardecer
- Fases lunares
- Hora mostrada en el display ESP32
- Calidad del aire (estación más cercana)

---

## Paso 4: Configurar Estaciones Secundarias (Opcional)

Si tienes un GW1100 u otro gateway, o sensores WN31 conectados a un gateway
diferente.

### 4.1 Obtener el Passkey

Cuando una estación nueva envía datos, su passkey aparece en los logs:

```bash
docker compose logs receiver | grep -i passkey
```

Ejemplo de salida:
```
INFO - New passkey detected: A1B2C3D4E5F6...
```

### 4.2 Registrar la estación secundaria

**Opción A: Via panel de admin**

1. Ir a **https://clima.xe1e.net/pro/admin** → **Estaciones**
2. Click en **+ Nueva estación**
3. Nombre: `gw1100` (o el que prefieras)
4. Passkey: pegar el passkey de los logs
5. Guardar

**Opción B: Via archivo .env**

Editar el `.env` en el servidor:

```bash
nano ~/ecowitt-weather-server-xe1e/.env
```

Agregar/modificar la línea:

```
SECONDARY_STATIONS=A1B2C3D4E5F6...:gw1100
```

Si hay múltiples estaciones, separar con comas:

```
SECONDARY_STATIONS=PASSKEY1:gw1100,PASSKEY2:jardin
```

Reiniciar el receiver:

```bash
docker compose up -d --force-recreate receiver
```

### 4.3 Configurar el GW1100

En la app **WS View Plus**, configurar el GW1100 igual que el WS2910:

| Campo | Valor |
|-------|-------|
| **Protocol Type** | `Ecowitt` |
| **Server IP/Hostname** | `163.192.147.208` |
| **Port** | `8080` |
| **Path** | `/data/report/` |
| **Upload Interval** | `60` segundos |

---

## Paso 5: Configurar Sensores WN31 (Opcional)

Los sensores WN31 se conectan a la consola WS2910 o a un GW1100 vía RF 915MHz.

### 5.1 Emparejar el WN31

1. En el WN31, presionar el botón de reset 3 segundos
2. En la consola WS2910, ir a configuración de canales
3. Buscar el sensor en el canal deseado (1-8)

### 5.2 Verificar datos

Los datos del WN31 aparecen como `temperature_ch1`, `humidity_ch1`, etc.:

```bash
curl -s http://localhost:8080/api/current | python -m json.tool | grep ch1
```

### 5.3 Personalizar nombre del sensor

En **https://clima.xe1e.net/pro/admin** → **Estaciones** → seleccionar estación
→ editar etiquetas de sensores:

- `ch1` → "Jardín"
- `ch2` → "Recámara"
- etc.

---

## Paso 6: Configurar Alertas (Opcional)

### 6.1 Habilitar alertas

En **https://clima.xe1e.net/pro/admin** → **Alertas**:

1. Habilitar **Alertas activas**
2. Configurar umbrales:
   - Temperatura alta: `35°C`
   - Temperatura baja: `5°C`
   - Viento fuerte: `50 km/h`
   - Lluvia intensa: `10 mm/h`
   - etc.

### 6.2 Configurar Telegram (recomendado)

Para recibir alertas en tu móvil:

1. En Telegram, buscar **@BotFather**
2. Enviar `/newbot` y seguir instrucciones
3. Copiar el **Bot Token** que te da
4. Buscar **@userinfobot** y enviarle cualquier mensaje para obtener tu **Chat ID**
5. En el panel de admin → **Notificaciones**:
   - Habilitar Telegram
   - Pegar Bot Token y Chat ID
   - Click en "Probar" para verificar
6. Guardar

---

## Paso 7: Verificar el Display ESP32

El display ESP32 ya está configurado para conectarse al servidor.

### 7.1 Verificar conexión

Ver los logs del ESP32 (monitor serial):

```
[WiFi] Conectando a TU_RED... OK!
[API] Servidor OK
[API] fetchAll OK (1 llamada)
[API] Principal: 23.5°C, 65%, 1013 hPa
```

### 7.2 Verificar datos en pantalla

- Dashboard debe mostrar temperatura, humedad, presión reales
- Almanac debe mostrar amanecer/atardecer correctos para tu ubicación
- Tarjetas de Jardín y Remoto deben mostrar datos si tienes esos sensores

---

## Solución de Problemas

### La consola no envía datos

1. Verificar conexión WiFi de la consola
2. Verificar que Path es `/data/report/` (con `/` al final)
3. Verificar puerto 8080 abierto:
   ```bash
   curl -s http://163.192.147.208:8080/health
   ```

### El display ESP32 no muestra datos

1. Verificar conexión WiFi del ESP32
2. Verificar URL del servidor en `my_config.h`
3. Ver logs seriales para errores de conexión

### Datos de almanac incorrectos

1. Verificar coordenadas en panel admin → Sistema
2. Verificar zona horaria

### Alertas no llegan a Telegram

1. Verificar Bot Token y Chat ID correctos
2. Usar botón "Probar" en panel admin
3. Verificar que las alertas están habilitadas

---

## Comandos Útiles

```bash
# Ver logs del receiver en vivo
docker compose logs -f receiver

# Ver último dato recibido
curl -s http://localhost:8080/api/current | python -m json.tool

# Ver estadísticas del día
curl -s http://localhost:8080/api/stats/daily | python -m json.tool

# Ver estado de estaciones
curl -s http://localhost:8080/api/stations | python -m json.tool

# Reiniciar servicios
docker compose restart receiver dashboard

# Ver estado de contenedores
docker compose ps
```

---

## Siguiente Paso: Publicar a Redes Meteorológicas

Una vez que la estación esté funcionando correctamente, puedes publicar tus
datos a redes públicas como Weather Underground, Windy, CWOP, etc.

Ver **https://clima.xe1e.net/pro/admin** → **Publicación**
