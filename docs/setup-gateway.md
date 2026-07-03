# Configuración del Gateway Ecowitt GW3000

Guía paso a paso para configurar el gateway GW3000 para enviar datos a tu servidor.

## Requisitos Previos

- Gateway GW3000 conectado a la corriente
- Smartphone con app **WSView** o **WS Tool** instalada
- Red WiFi 2.4GHz (no soporta 5GHz)
- Servidor receptor funcionando

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
