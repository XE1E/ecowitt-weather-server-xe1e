# Guía completa — Estación meteorológica XE1E

> Documento descriptivo y de operación de todo el sistema: qué es el proyecto,
> el hardware, cómo fluye y se procesa el dato, qué muestra cada página de la
> web y cómo administrarla y mantenerla.
>
> **Sitio público:** https://clima.xe1e.net
> **Ubicación:** Benito Juárez, Ciudad de México, México · 19.380359, −99.174564 · ~2240 m
> **Repositorio:** github.com/XE1E/ecowitt-weather-server-xe1e

---

## Índice
1. [El proyecto](#1-el-proyecto)
2. [Hardware](#2-hardware)
3. [Arquitectura y flujo de datos](#3-arquitectura-y-flujo-de-datos)
4. [Procesamiento del dato local](#4-procesamiento-del-dato-local)
5. [La página web](#5-la-página-web-pro) (sección por sección)
6. [Panel de administración](#6-panel-de-administración-proadmin)
7. [Alertas y notificaciones](#7-alertas-y-notificaciones)
8. [Publicación a redes públicas](#8-publicación-a-redes-públicas)
9. [Fuentes de datos externas](#9-fuentes-de-datos-externas)
10. [API (endpoints)](#10-api-endpoints)
11. [Operación y mantenimiento](#11-operación-y-mantenimiento)
12. [Glosario de términos e índices](#12-glosario-de-términos-e-índices)
13. [Estado y pendientes](#13-estado-y-pendientes)

---

## 1. El proyecto

Es un **proyecto personal sobre el clima**: una estación meteorológica propia
que publica en tiempo casi real las condiciones de un punto exacto de la Ciudad
de México, con histórico, pronóstico, radar, astronomía y climatología.

- **Objetivo principal:** aprovechar al máximo el **dato local** de la estación
  (real y cercano = información precisa del sitio), y además compartirlo con
  redes públicas.
- **Alcance:** meteorología. No es un proyecto de radios/antenas (aunque "XE1E"
  sea un indicativo de radioaficionado, aquí es solo el nombre de la estación).
- **Dos vistas del sitio:**
  - `/` — **Vista clásica**: tablero simple de un vistazo.
  - `/pro` — **Vista completa** (estilo WeatherNode): 8 secciones con cintillo
    de navegación, unidades conmutables y efectos de clima.

---

## 2. Hardware

Kit **Ecowitt WS2910** + sensor **WS69** + termohigrómetros **WN31**.

| Equipo | Qué es | Qué mide / hace |
|--------|--------|-----------------|
| **Consola WS2910** | Pantalla + puente Wi-Fi | Presión (barómetro interno), temp/humedad interior; **envía todos los datos** al servidor por Wi-Fi (protocolo Ecowitt) |
| **WS69 (7-en-1)** | Sensor exterior integrado | Temperatura y humedad exterior, velocidad y dirección del viento, ráfaga, lluvia (tasa/evento/día/…), radiación solar e índice UV |
| **WN31 (×8)** | Termohigrómetros de canal | Temperatura y humedad en hasta **8 canales** independientes (habitaciones, exterior secundario, etc.) |

**Baterías:** la WS69, la consola y cada canal WN31 reportan estado de batería
(OK / baja). El sistema **avisa** cuando alguna está baja (ver §7).

**Envío:** la consola se configura en *Weather Services → Customized* con
protocolo **Ecowitt**, apuntando a `clima.xe1e.net` (o la IP/host del servidor),
ruta `/data/report/`. Envía una lectura cada ~16–60 s.

> **Nota:** el hardware llega ~2026-07-17. Hasta entonces el sitio puede correr
> con un simulador de datos; al instalar la estación se apaga el simulador, se
> limpian los datos falsos y se apunta la consola al servidor.

---

## 3. Arquitectura y flujo de datos

```
  WS2910 (consola)                     Internet / VPS Oracle (ARM)
  WS69 + WN31  ──HTTP push──►  Cloudflare (Orange Cloud, HTTPS)
       │        protocolo         │
       │        Ecowitt           ▼
       │                        Caddy (TLS, Origin Cert)
       │                          │
       │                          ▼
       │                     Dashboard (React)  ◄── navegador del usuario
       │                          │  (sirve la web y hace de proxy /api)
       │                          ▼
       └──────────────►   Receiver (FastAPI)  ──►  InfluxDB 2.7 (histórico)
                                  │
                                  ├─► MQTT / Home Assistant (opcional)
                                  ├─► Alertas (Telegram / log)
                                  └─► Redes públicas (WU, Windy, PWS, OWM, CWOP)
```

**Componentes** (contenedores Docker):
- **receiver** (FastAPI, Python): recibe el push, procesa y guarda; expone la API.
- **influxdb** (InfluxDB 2.7): base de series temporales (histórico).
- **dashboard** (React + Nginx): sirve la web y reenvía `/api/*` al receiver.
- **caddy**: TLS/HTTPS con certificado *Origin* de Cloudflare.
- **cloudflare**: proxy (Orange Cloud), cache y protección delante del VPS.

**Frecuencia de actualización (front-end):**
| Qué | Cada |
|-----|------|
| Datos actuales, stats del día, comparación, pronóstico local | **60 s** |
| Historia (página) | 5 min |
| Pronóstico y astronomía (Open-Meteo) | 30 min |
| METAR, calidad del aire, almanaque (caché en el servidor) | 10 min |
| Resumen diario (Dayfile) | al arrancar (90 días) + hoy/ayer cada hora |

---

## 4. Procesamiento del dato local

Cada lectura que llega pasa por un **pipeline** (inspirado en WeeWX) antes de
guardarse:

```
parsear → convertir a métrico → calibrar → QC rangos → QC picos → derivar
        → guardar (InfluxDB) → MQTT → alertas → publicar a redes
```

1. **Parseo (protocolo Ecowitt):** convierte los campos crudos en nombres claros.
2. **Conversión a métrico:** °F→°C, inHg→hPa, in→mm, mph→km/h.
3. **Calibración** *(opcional, `cal_*`)*: corrige sesgos conocidos del sensor
   con offsets (temp/humedad/presión) y multiplicadores (viento/lluvia).
4. **Control de calidad — rangos** (`qc_enabled`): descarta valores
   físicamente imposibles (temp −80 °C, humedad 150 %, presión absurda para
   CDMX, etc.).
5. **Control de calidad — picos** (`qc_spike_enabled`): descarta un valor que
   **salta de forma imposible** respecto a la lectura anterior (glitch del
   sensor). No filtra viento ni lluvia (varían a saltos legítimos) y se omite si
   la lectura previa tiene más de 15 min.
6. **Variables derivadas:** calcula punto de rocío, sensación térmica, índice de
   calor, sensación por frío/viento, **humidex** y **base de nubes** (ver §12).
7. **Guardado:** en InfluxDB, además del **resumen diario** ("Dayfile"): un
   registro por día con mín/máx/prom/total y la hora de cada extremo, que hace
   rápidas las consultas de récords y climatología.

Todos los ajustes (calibración, QC, alertas, tokens, redes) se editan **en
caliente** desde el panel de administración, sin reiniciar (ver §6).

---

## 5. La página web (`/pro`)

### Barra superior y navegación
- **Título y ubicación** de la estación.
- **Reloj** en vivo (hora y fecha local).
- **Botón de unidades:** conmuta métrico (°C · km/h · mm · mb) ↔ imperial
  (°F · mph · in · inHg). Afecta a todo el sitio.
- **Botón FX:** activa/desactiva los **efectos de clima** (lluvia, nieve, etc.)
  animados de fondo según la condición actual.
- **Vista clásica:** enlace a `/`.
- **Cintillo** (8 secciones): Inicio · Pronóstico · Historia · Estadísticas ·
  Climatología · Radar · Astronomía · Calidad del aire.

### 5.1 Inicio
Panel principal con el estado actual. Contiene:

- **Mini-estadísticas (barra superior):** máx de hoy, viento máx, precipitación,
  índice UV, sensación, presión, prob. de lluvia, humedad y **"vs ayer"**.
- **Condiciones actuales:** temperatura grande + ícono animado + descripción;
  debajo, sensación térmica, punto de rocío, bulbo húmedo, **humidex** y
  **base de nubes**; y humedad, UV y presión.
- **Viento:** rosa de vientos con dirección, velocidad, ráfaga y escala Beaufort.
- **Presión:** valor actual, mín/máx del día, **tendencia** (subiendo/estable/
  bajando) y mini-gráfica de 24 h.
- **Pronóstico local:** texto propio según la **tendencia del barómetro**
  (independiente de Open-Meteo) — p. ej. "Mejorando gradualmente".
- **Pronóstico (Open-Meteo):** tarjetas de 5 días / por hora.
- **Gráfica de temperatura:** observado (histórico) + pronóstico.
- **Precipitación:** tasa actual, acumulado de hoy/mes/año y prob. próximas horas.
- **UV y radiación solar.**
- **Sol y Luna:** amanecer/atardecer, horas de luz y fase lunar.
- **Alertas:** avisos activos (o "desactivadas").
- **Próximos eventos:** próximas fases lunares.
- **Sensores extra (WN31):** temperatura/humedad de los canales activos + batería.
- **Radar** (Ventusky) y **METAR** (MMMX) embebidos.

### 5.2 Pronóstico
Pronóstico de **Open-Meteo** (modelo `best_match`) horario y a varios días, con
un texto explicativo de qué son los modelos meteorológicos y por qué el
pronóstico es una probabilidad, no una certeza.

### 5.3 Historia
Gráficas del **histórico propio** (InfluxDB). Selector de **métrica**
(temperatura, humedad, viento, presión, lluvia…) y de **periodo**. Incluye
**barras de lluvia diaria acumulada** y botón para **exportar CSV** del rango.

### 5.4 Estadísticas
- **Récords de siempre:** temp máx/mín, ráfaga máxima, día más lluvioso, presión
  máx/mín — cada uno con la **fecha** en que ocurrió.
- **Estadísticas por periodo** (7 días / 30 días / año / histórico): promedio,
  máx y mín (con fecha/hora del extremo) de cada variable.

### 5.5 Climatología
Construida sobre el **resumen diario**. Tres bloques:
- **Resúmenes rápidos:** Ayer · Este mes · Este año (media, máx/mín, lluvia,
  días con lluvia).
- **Récords por mes calendario:** p. ej. "el junio más caluroso de siempre".
- **Reporte climatológico estilo NOAA:** selector de **año** y **mes/anual**.
  - *Mensual:* una fila por día — media, máx/mín con hora, **grados-día** de
    calefacción y refrigeración (base 18.3 °C), lluvia y ráfaga + resumen del mes.
  - *Anual:* una fila por mes + resumen del año.
  - "Día con lluvia" = ≥ 0.2 mm.

### 5.6 Radar
Mapa interactivo de **Ventusky** centrado en la CDMX, con capas (radar de
precipitación, nubes, viento, temperatura…) y modelos seleccionables.

### 5.7 Astronomía
- **Sol y Luna** (Open-Meteo): amanecer/atardecer, horas de luz, fase.
- **Próximas fases** lunares.
- **Almanaque ampliado** (cálculo local con pyephem):
  - Sol: orto, ocaso, mediodía solar, duración del día.
  - **Crepúsculos:** civil (−6°), náutico (−12°) y astronómico (−18°), amanecer
    y anochecer.
  - **Luna:** orto/ocaso, fase, **% de iluminación**, próxima nueva y llena.
  - **Planetas** (Mercurio, Venus, Marte, Júpiter, Saturno): orto/ocaso, altitud
    actual, magnitud y si están sobre (●) o bajo (○) el horizonte.

### 5.8 Calidad del aire
Índice de calidad del aire (AQI) y contaminantes (PM2.5, PM10, O₃, NO₂…) de la
red **WAQI/aqicn** para la CDMX. Requiere un token gratuito (se configura en el
panel). Si no hay token, la sección lo indica.

### 5.9 Vista clásica (`/`)
Tablero sencillo con las condiciones actuales y una gráfica de temperatura, para
consulta rápida.

### 5.10 Pie de página
Tres columnas (Estación / Datos / Proyecto) con hardware, ubicación, fuentes de
datos y enlace al repositorio; un párrafo descriptivo; y un enlace discreto
**⚙ Admin**.

---

## 6. Panel de administración (`/pro/admin`)

Acceso **usuario/contraseña** (sesión de 12 h). Permite **editar en caliente**
(sin reiniciar el contenedor) y de forma segura todo lo configurable:

- **Alertas:** activar; umbrales de temp alta/baja, viento y lluvia; minutos para
  "estación caída"; **batería baja** y **sensor perdido**.
- **Control de calidad:** activar QC por rangos y filtro de picos.
- **Calibración:** offsets (temp/humedad/presión) y factores (viento/lluvia).
- **Telegram:** activar + token del bot + chat id.
- **Calidad del aire:** token WAQI.
- **Redes públicas:** activar y credenciales de WU, PWSWeather, Windy,
  OpenWeatherMap y CWOP/APRS.

Los **tokens/claves se muestran enmascarados** (últimos 4 caracteres) y si se
dejan **en blanco al guardar, se conservan**. Los ajustes se guardan en
`/data/settings.json` y se aplican al instante; al reiniciar se recargan.

Si `ADMIN_USER`/`ADMIN_PASSWORD` están vacíos, el panel queda **deshabilitado**.

---

## 7. Alertas y notificaciones

Se evalúan en cada lectura y avisan **una vez al activarse** y otra **al
normalizarse** (no spamean). Canal: **Telegram** si está configurado, o el log.

| Alerta | Se dispara cuando… |
|--------|--------------------|
| Temp alta / baja | temp ≥/≤ umbral |
| Viento fuerte | ráfaga (o viento) ≥ umbral |
| Lluvia intensa | tasa de lluvia ≥ umbral |
| **Estación caída** | no llegan datos en N minutos |
| **Batería baja** | un sensor (WN31/WS69/consola) reporta batería baja |
| **Sensor perdido** | un sensor visto antes deja de reportar (se normaliza al volver) |

**Telegram:** se crea un bot con @BotFather, se obtiene el `chat_id` y se pega
token + chat id en el panel (o en `.env`). Ver procedimiento en `MEJORAS.md`.

---

## 8. Publicación a redes públicas

El servidor reenvía cada lectura (de forma tolerante a fallos) a las redes que
se activen, con sus credenciales, desde el panel:

| Red | Aporta / recibe |
|-----|-----------------|
| **Weather Underground** | mayor audiencia, página propia, histórico, apps |
| **Windy.com** | visibilidad en el mapa |
| **PWSWeather** | respaldo, ecosistema Aeris |
| **OpenWeatherMap** | acceso a su API a cambio |
| **CWOP / APRS** | entra a MADIS → modelos de NOAA (mayor aporte científico) |

Filosofía: aportar a todas las útiles. Cada red usa sus unidades; el servidor
convierte según el protocolo de cada una.

---

## 9. Fuentes de datos externas

| Fuente | Qué aporta | Frecuencia / caché |
|--------|-----------|--------------------|
| **Estación Ecowitt** (push) | todo el dato local (real) | ~16–60 s |
| **Open-Meteo** | pronóstico horario/diario y astronomía | 30 min |
| **Ventusky** | radar y mapas interactivos | en vivo (iframe) |
| **aviationweather.gov** | METAR del aeropuerto MMMX | 10 min |
| **WAQI / aqicn** | calidad del aire (AQI) | 10 min |
| **pyephem** (local) | almanaque: crepúsculos, luna, planetas | 10 min |
| **InfluxDB** (propio) | histórico, estadísticas, climatología | consultas en vivo |

---

## 10. API (endpoints)

Todos bajo el receiver, servidos vía `/api/*`:

| Endpoint | Devuelve |
|----------|----------|
| `GET /api/current` | última lectura |
| `GET /api/history?start=-24h` | histórico crudo |
| `GET /api/stats/daily` | mín/máx/prom del día |
| `GET /api/stats/records?start=-30d` | mín/máx/prom del rango |
| `GET /api/compare` | 24 h vs 24 h previas ("vs ayer") |
| `GET /api/forecast/local` | pronóstico por tendencia barométrica |
| `GET /api/climate/daily` | resúmenes diarios |
| `GET /api/climate/records` | récords (siempre, por mes, este mes/año, ayer) |
| `GET /api/climate/noaa?year=&month=` | reporte NOAA mensual/anual |
| `GET /api/almanac` | almanaque astronómico |
| `GET /api/alerts` | alertas activas |
| `GET /api/metar?station=MMMX` | METAR |
| `GET /api/airquality` | calidad del aire (WAQI) |
| `POST /api/admin/login` · `GET/POST /api/admin/settings` · `GET /api/admin/status` | administración |
| `POST /data/report/` | **entrada** del push de la estación (Ecowitt) |

---

## 11. Operación y mantenimiento

**Servidor:** VPS Oracle ARM, cuenta **PAYG** (para evitar recuperación por
inactividad de la capa gratuita). Dominio `clima.xe1e.net` tras Cloudflare.

**Desplegar / actualizar:**
```bash
cd ~/ecowitt-weather-server-xe1e
git pull
docker compose up -d --build      # --build cuando cambian dependencias o imágenes
docker compose ps                 # verificar estado
```

**Configuración inicial (`.env`):** credenciales de InfluxDB, `ADMIN_USER` /
`ADMIN_PASSWORD`, `WEB_PORT`, TZ. El resto (alertas, QC, calibración, tokens,
redes) es preferible dejarlo por defecto y ajustarlo desde el panel.

**Backups:** respaldos periódicos del volumen de InfluxDB. (Pendiente: copiar
fuera del VPS, p. ej. a R2/almacenamiento externo.)

**Persistencia:** los ajustes del panel viven en el volumen `receiver-data`
(`/data/settings.json`), así que sobreviven a reinicios y reconstrucciones.

**Cuando llegue el WS2910 (~2026-07-17):**
1. Apagar el simulador de datos.
2. Limpiar los datos falsos de InfluxDB.
3. En la consola: *Weather Services → Customized → Ecowitt*, host
   `clima.xe1e.net`, ruta `/data/report/`.
4. Verificar en `/api/current` y en la web que llegan lecturas reales.

---

## 12. Glosario de términos e índices

- **Punto de rocío:** temperatura a la que el aire se satura; alto = bochorno.
- **Sensación térmica (feels like):** cómo se percibe la temperatura combinando
  calor/humedad (índice de calor) o frío/viento (wind chill).
- **Índice de calor (heat index):** temperatura aparente con calor + humedad
  (válido ≥ 27 °C y ≥ 40 % HR).
- **Sensación por frío/viento (wind chill):** enfriamiento por el viento
  (válido ≤ 10 °C y viento ≥ 4.8 km/h).
- **Humidex:** índice canadiense de bochorno (temp + humedad), útil sobre 20 °C.
- **Bulbo húmedo:** temperatura con evaporación máxima; relevante para salud/calor.
- **Base de nubes:** altura estimada de la base de las nubes (≈125 m por cada °C
  entre temperatura y punto de rocío).
- **Tendencia barométrica:** cambio de presión en ~3 h; base del pronóstico local.
- **Grados-día:** medida de demanda de calefacción/refrigeración respecto a una
  base (18.3 °C); útil para energía/agricultura.
- **Crepúsculo civil/náutico/astronómico:** momentos en que el Sol está 6°/12°/18°
  bajo el horizonte (luz decreciente).
- **AQI:** índice de calidad del aire (a mayor número, peor calidad).
- **METAR:** reporte meteorológico aeronáutico estándar (aquí, del MMMX).
- **Beaufort:** escala de fuerza del viento (0 calma … 12 huracán).

---

## 13. Estado y pendientes

El estado detallado y el roadmap viven en **`docs/MEJORAS.md`**. Resumen:

**Hecho:** despliegue con HTTPS, vista clásica + `/pro` con 8 secciones, unidades
y FX, alertas (umbral + estación caída + batería + sensor perdido), Telegram,
MQTT/HA, control de calidad (rangos + picos), calibración, variables derivadas
ampliadas, pronóstico local, publicación a 5 redes, resumen diario, récords
ampliados, reporte NOAA y almanaque ampliado.

**Pendiente:** alarmas de ráfaga/lluvia diaria/presión; "en este día"; rosa de
vientos y grados-día como estadística visible; evapotranspiración; tema claro;
PWA; backups fuera del VPS; artículo de blog; y las acciones del usuario
(crear bot de Telegram, token WAQI, credenciales de redes).

---

*Última actualización: 2026-07-08.*
