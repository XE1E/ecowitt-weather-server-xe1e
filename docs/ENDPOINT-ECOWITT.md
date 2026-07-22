# Endpoint Ecowitt — referencia

Todo lo necesario para configurar un datalogger Ecowitt (consola WS2910 /
gateway GW1100, etc.) para que envíe (**push**) datos a este servidor.

---

## Datos del endpoint

| Campo | Valor |
|-------|-------|
| **Protocolo** | Ecowitt (HTTP POST, form-url-encoded) |
| **Servidor (IP)** | `163.192.147.208` |
| **Puerto** | `8080` (público; configurable con `WEB_PORT` en `.env`) |
| **Path** | `/data/report/` (también funciona `/data/report`) |
| **URL completa (HTTP)** | `http://163.192.147.208:8080/data/report/` |
| **URL completa (HTTPS)** | `https://clima.xe1e.net/data/report/` (vía Caddy) |
| **Intervalo** | 60 s recomendado |
| **Método** | `POST` |

> El WS2910 normalmente se deja en **HTTP por IP** (`163.192.147.208:8080`); el
> HTTPS por dominio es para navegador. La entrada pública real es el nginx del
> `dashboard`, que hace proxy de `/data/report` → `receiver:8080`.

---

## Configuración en WS View Plus

App **WS View Plus** → *Weather Services* → *Customized*:

| Campo | Valor |
|-------|-------|
| Protocol Type | **Ecowitt** |
| Server IP / Hostname | `163.192.147.208` |
| Port | `8080` |
| Path | `/data/report/` |
| Upload Interval | `60` s |

---

## Seguridad opcional del endpoint

Se configura en el panel: **Admin → Integraciones → 🔒 Seguridad del endpoint**.
Ambas opciones vienen **desactivadas por defecto** (el endpoint acepta cualquier push).

### Token secreto (recomendado)
- Al activarlo y guardar un token, el push debe incluirlo como query param:
  `‎/data/report/?token=EL_TOKEN`
- En WS View Plus se pone en el campo **Path**: `/data/report/?token=EL_TOKEN`
- Si no coincide (o falta), el servidor responde **403**.
- ⚠️ Algunos firmwares de WS View recortan el `?token=`. Tras activarlo, confirma
  que sigue llegando dato; si no, desactívalo y usa validación por PASSKEY.

### Allowlist de IP
- Solo acepta datos desde las IPs indicadas (separadas por coma).
- Compara la **IP de origen** (la IP **pública de la red donde está la estación**),
  leída de la cabecera `X-Real-IP` que fija nginx.
- ⚠️ Solo útil si esa IP pública es **fija**. Con IP doméstica **dinámica** no
  sirve (te bloquearías). En ese caso deja el campo vacío y usa el token.

---

## Estación principal vs. secundarias (PASSKEY)

- Cada dispositivo Ecowitt envía un campo **`PASSKEY`** (huella del dispositivo).
- La **estación principal** es cualquier PASSKEY **no mapeado** (sin tag; sus datos
  alimentan alertas, publicación, MQTT).
- Las **estaciones secundarias** (p. ej. un GW1100) se registran mapeando su
  PASSKEY → nombre en **Admin → Estaciones**. Solo registran datos (no disparan
  alertas ni publicación).
- El mapeo se guarda en `settings.json` (`station_passkeys`) y en la variable
  `secondary_station_map` (`.env`, formato `PASSKEY:nombre` separado por comas).

---

## Ejemplo de payload (campos crudos que manda la estación)

```
PASSKEY=ABCDEF0123456789ABCDEF0123456789
stationtype=EasyWeatherPro_V5.2.7
model=WS2900_V2.02.06
dateutc=2026-07-21+21:30:00
tempf=71.6&humidity=64&baromrelin=29.94&baromabsin=25.10
winddir=210&windspeedmph=3.4&windgustmph=6.7
solarradiation=350.2&uv=3&dailyrainin=0.12
tempinf=74.3&humidityin=48
wh65batt=0&batt1=0
freq=915M
```

- Unidades de entrada: **imperiales** (°F, mph, inHg, in). El servidor las convierte
  a métrico (°C, km/h, hPa, mm) si `OUTPUT_UNIT_SYSTEM=metric`.
- Batería: campos `*batt*` (0 = OK, 1 = baja, según el sensor).

---

## Verificar que llega dato

```bash
# Simular un push (desde el propio VPS)
curl -s -X POST http://localhost:8080/data/report/ \
  -d "stationtype=EasyWeatherPro&model=WS2910&tempf=71.6&humidity=64&baromrelin=29.94"

# Ver el último dato recibido
curl -s http://localhost:8080/api/current

# Ver datos entrando en vivo
docker compose logs -f receiver
```

---

## Notas de intervalo de publicación (hacia redes públicas)

Independiente del intervalo de **entrada** (60 s de la estación): cada red pública
(WU, PWSWeather, Windy, OpenWeatherMap, CWOP) tiene su **propio intervalo de
reenvío** configurable en **Admin → Publicación** (CWOP recomienda 10–15 min).
Ver también la lógica en `receiver/app/services/publishers.py`.
