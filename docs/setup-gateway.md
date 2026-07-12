# Configuración del Dispositivo Ecowitt (WS2910 / GW3000 / GW1100)

Guía paso a paso para configurar el envío de datos a tu servidor.

> **¿WS2910, GW3000 o GW1100?**
> - **WS2910** (consola con pantalla, incluye el sensor WS69) puede enviar datos a un servidor personalizado con protocolo Ecowitt por sí solo — es el dispositivo principal recomendado.
> - **GW3000** es un upgrade opcional que además ofrece API local en LAN, backup en microSD y Ethernet.
> - **GW1100** es un gateway WiFi compacto con sensor de interior integrado (temperatura, humedad, presión barométrica) — ideal para estaciones remotas o monitoreo de interiores adicionales.
>
> **El Paso 4 (Servidor Personalizado) es idéntico en todos.** Los pasos de conexión WiFi son equivalentes; todos usan la app **WS View Plus**.

## Requisitos Previos

- Dispositivo (WS2910 o GW3000) conectado a la corriente
- Smartphone con app **WS View Plus** instalada
- Red WiFi 2.4GHz (no soporta 5GHz)
- Servidor receptor funcionando
- _(WS2910)_ Preferir la variante de firmware **EasyWeatherPro** (con WebUI)

## Paso 1: Conexión Inicial

1. Enciende el GW3000
2. El LED parpadeará indicando modo configuración
3. En tu smartphone, conecta al WiFi del gateway:
   - SSID: `EasyWeather-XXXX` o `GW3000-XXXX`
   - Sin contraseña

## Paso 2: Configuración WiFi

1. Abre la app **WSView** o **WS Tool**
2. Selecciona "Configure Device" o "Configurar Dispositivo"
3. La app detectará el gateway automáticamente
4. Selecciona tu red WiFi de casa
5. Ingresa la contraseña
6. Guarda y espera a que se conecte

## Paso 3: Verificar Sensores

1. En la app, ve a "Device List" o "Lista de Dispositivos"
2. Selecciona tu GW3000
3. Ve a "Sensor ID" o "ID de Sensores"
4. Verifica que el WS69 aparezca y esté recibiendo datos

## Paso 4: Configurar Servidor Personalizado

Esta es la configuración clave para enviar datos a tu servidor.

1. En la app, selecciona tu GW3000
2. Ve a **Weather Services** → **Customized**
3. Configura:

| Campo | Valor |
|-------|-------|
| Enable | ON |
| Protocol Type | Ecowitt |
| Server IP/Hostname | `192.168.1.X` (IP de tu servidor) |
| Port | `8080` |
| Upload Interval | `60` segundos |
| Path | `/data/report/` |

4. Guarda la configuración

## Paso 5: Verificar Conexión

### Desde el servidor:

```bash
# Ver logs del receiver
docker logs -f ecowitt-receiver

# Deberías ver algo como:
# INFO - Stored data - Temp: 25.3°C, Humidity: 65%, Wind: 12.5 km/h
```

### Probar endpoint:

```bash
curl http://localhost:8080/api/current
```

## Configuración Avanzada

### Acceso a la API Local del GW3000

El GW3000 tiene una API HTTP local. Desde cualquier dispositivo en tu red:

```bash
# Obtener datos en vivo
curl "http://[IP_GW3000]/get_livedata_info"

# Obtener configuración de red
curl "http://[IP_GW3000]/get_network_info"

# Obtener lista de sensores
curl "http://[IP_GW3000]/get_sensors_info"
```

### Configuración via Web

También puedes acceder a la configuración via navegador:

1. Abre `http://[IP_GW3000]` en tu navegador
2. Usuario: `admin`
3. Contraseña: `admin` (cambiar después)

---

## GW1100 como Estación Remota

El **GW1100** es un gateway WiFi compacto con sensor de interior integrado. Es ideal para:
- Monitorear un segundo sitio (oficina, bodega, casa de campo)
- Agregar sensores de interior adicionales a tu setup
- Instalaciones donde no necesitas pantalla ni Ethernet

### Características del GW1100

| Característica | Valor |
|----------------|-------|
| Sensores integrados | Temperatura, humedad, presión barométrica (interior) |
| Conectividad | WiFi 2.4GHz |
| Alimentación | USB 5V |
| Sensores externos | Soporta hasta 8 canales WH31/WN31 adicionales |

### Paso 1: Conexión Inicial del GW1100

1. Conecta el GW1100 a un puerto USB (cargador de celular o similar)
2. El LED parpadeará indicando modo configuración
3. En tu smartphone, conecta al WiFi del gateway:
   - SSID: `GW1100-XXXX`
   - Sin contraseña

### Paso 2: Configuración WiFi

1. Abre la app **WS View Plus**
2. Selecciona "Configurar Dispositivo"
3. La app detectará el GW1100 automáticamente
4. Selecciona la red WiFi del sitio remoto
5. Ingresa la contraseña y guarda

### Paso 3: Configurar Servidor Personalizado (VPS Remoto)

Esta es la configuración para enviar datos al mismo servidor que tu estación principal.

1. En la app, selecciona tu GW1100
2. Ve a **Weather Services** → **Customized**
3. Configura:

| Campo | Valor |
|-------|-------|
| Enable | ON |
| Protocol Type | Ecowitt |
| Server IP/Hostname | `tu-dominio.com` o IP pública del VPS |
| Port | `443` (HTTPS via Caddy) o `8080` (directo) |
| Upload Interval | `60` segundos |
| Path | `/data/report/` |

4. Guarda la configuración

> **Nota:** Si usas HTTPS con Caddy, el puerto es `443`. Si apuntas directo al receiver (sin Caddy), usa `8080`.

### Paso 4: Capturar el Passkey

Para que el servidor identifique al GW1100 como estación secundaria, necesitas su **passkey**:

1. Apunta el GW1100 al servidor y espera a que envíe datos
2. Revisa los logs del receiver:
   ```bash
   docker logs ecowitt-receiver | grep -i passkey
   ```
3. Busca una línea como:
   ```
   INFO - Device: GW1100A_V2.3.5 | passkey: ABC123DEF456...
   ```
4. Copia el passkey (32 caracteres hexadecimales)

### Paso 5: Registrar como Estación Secundaria

1. Edita el archivo `.env` del servidor:
   ```bash
   SECONDARY_STATIONS=<passkey_capturado>:gw1100
   ```

2. Reinicia el receiver:
   ```bash
   docker compose restart receiver
   ```

3. Verifica que los datos llegan separados:
   ```bash
   curl "http://localhost:8080/api/current?station=gw1100"
   ```

### Paso 6: Verificar en el Dashboard

- Los datos del GW1100 aparecen en `/pro/remota`
- La estación principal (`/pro`) **no se ve afectada**
- El GW1100 no dispara alertas ni publica a redes públicas (WU, etc.)

### Probar sin Hardware (Simulador)

Si aún no tienes el GW1100 físico, puedes simular datos:

```bash
# Registrar passkey ficticio en .env
SECONDARY_STATIONS=F00DCAFEF00DCAFEF00DCAFEF00DCAFE:gw1100

# Ejecutar simulador
./scripts/simulate-gw1100.sh                    # localhost
./scripts/simulate-gw1100.sh https://tu-dominio/data/report  # VPS
```

---

## Solución de Problemas

### El gateway no aparece en la app

- Verifica que estés conectado al WiFi del gateway
- Reinicia el gateway (desconecta y conecta la alimentación)
- Asegúrate de usar 2.4GHz, no 5GHz

### No llegan datos al servidor

1. Verifica que el servidor esté corriendo:
   ```bash
   curl http://localhost:8080/health
   ```

2. Verifica la IP del servidor en la configuración del gateway

3. Verifica que el puerto 8080 esté abierto:
   ```bash
   # En el servidor
   netstat -tlnp | grep 8080
   ```

4. Verifica firewall:
   ```bash
   # Linux
   sudo ufw allow 8080/tcp
   
   # Windows (PowerShell como admin)
   New-NetFirewallRule -DisplayName "Ecowitt" -Direction Inbound -Port 8080 -Protocol TCP -Action Allow
   ```

### El sensor WS69 no aparece

- Verifica que las baterías estén instaladas (aunque tenga panel solar)
- Verifica que la frecuencia sea correcta (915 MHz para América)
- Acerca el sensor al gateway temporalmente para probar

### Datos incorrectos o faltantes

- Revisa la orientación del sensor (norte magnético)
- Verifica que no haya obstrucciones para el panel solar
- El pluviómetro debe estar nivelado (usa la burbuja)

### El GW1100 no envía datos al VPS remoto

1. Verifica conectividad desde el sitio remoto:
   ```bash
   curl -X POST https://tu-dominio/data/report/ -d "test=1"
   ```

2. Verifica que el puerto esté abierto en el VPS:
   - Puerto 443 si usas Caddy (HTTPS)
   - Puerto 8080 si apuntas directo al receiver

3. Revisa los logs del receiver:
   ```bash
   docker logs -f ecowitt-receiver
   ```

4. Si usas dominio, verifica que resuelva correctamente:
   ```bash
   nslookup tu-dominio.com
   ```

### Los datos del GW1100 aparecen mezclados con la estación principal

- Verifica que el passkey esté registrado en `SECONDARY_STATIONS`
- El passkey debe coincidir exactamente (32 caracteres hex)
- Reinicia el receiver después de modificar `.env`

### El GW1100 aparece offline pero tiene WiFi

- El GW1100 no tiene LED de actividad de red; usa los logs del servidor para verificar
- Verifica que el Upload Interval no sea muy largo (recomendado: 60s)
- Algunos routers bloquean conexiones salientes; verifica el firewall del sitio remoto

## Configuración de Servicios en la Nube (Opcional)

Además del servidor personalizado, puedes configurar:

### Weather Underground

1. Crea cuenta en wunderground.com
2. Registra tu estación y obtén Station ID y Key
3. En la app: Weather Services → Wunderground
4. Ingresa Station ID y Key

### Ecowitt.net

1. Crea cuenta en ecowitt.net
2. En la app: Weather Services → Ecowitt
3. Vincula tu dispositivo

### WeatherCloud

1. Crea cuenta en weathercloud.net
2. Registra dispositivo y obtén ID y Key
3. En la app: Weather Services → WeatherCloud
4. Ingresa credenciales
