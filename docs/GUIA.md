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

Es un **proyecto personal sobre el clima**: una estación meteorológica propia,
instalada en un punto exacto de la Ciudad de México (Benito Juárez), que publica
en tiempo casi real las condiciones de ese lugar y las conserva para consultar su
histórico, estadísticas y climatología.

Lo que lo distingue es que **todo está hecho a la medida**: el servidor que recibe
los datos, la base de series de tiempo, la API y el sitio web se desarrollaron
específicamente para esta estación y viven en un **VPS propio** —no una plataforma
comercial "de caja"—. Eso permite decidir qué se mide, cómo se calcula y cómo se
presenta, y hacer crecer la plataforma a voluntad.

- **Objetivo principal:** aprovechar al máximo el **dato local** de la estación
  —real, cercano y del sitio exacto, no la interpolación de un modelo— y, a la par,
  **desarrollar y evolucionar una plataforma propia** (servidor + API + web) hecha
  a la medida en el VPS, además de compartir el dato con redes públicas.
- **Alcance:** meteorología en sentido amplio —condiciones actuales, histórico,
  estadísticas y climatología, pronóstico, radar y satélite— más los campos vecinos
  que enriquecen la lectura del cielo: **astronomía** (sol, luna, almanaque),
  **calidad del aire** (AQI e IMECA), **meteorología aeronáutica** (METAR/TAF) y
  **sismos** de la región.
- **Más de un sitio:** además de la estación principal, el servidor admite una
  **estación remota** (p. ej. un GW1100 en otra ubicación) que envía al mismo VPS;
  sus datos se guardan por separado y tienen su propia página, para comparar el
  clima de dos puntos distintos.
- **Dos vistas del sitio:**
  - `/` — **Vista clásica**: tablero simple de un vistazo (unificado con el estilo de `/pro`).
  - `/pro` — **Vista completa**: varias secciones con cintillo de navegación,
    unidades conmutables, tema claro/oscuro y efectos de clima; instalable como app (PWA).

---

## 2. Hardware

Kit **Ecowitt WS2910** + sensor **WS69** + termohigrómetros **WN31**.

| Equipo | Qué es | Qué mide / hace |
|--------|--------|-----------------|
| **Consola WS2910** | Pantalla + puente Wi-Fi | Presión (barómetro interno), temp/humedad interior; **envía todos los datos** al servidor por Wi-Fi (protocolo Ecowitt) |
| **WS69 (7-en-1)** | Sensor exterior integrado | Temperatura y humedad exterior, velocidad y dirección del viento, ráfaga, lluvia (tasa/evento/día/…), radiación solar e índice UV |
| **WN31 (×8)** | Termohigrómetros de canal | Temperatura y humedad en hasta **8 canales** independientes (habitaciones, exterior secundario, etc.) |
| **GW1100** *(estación remota, opcional)* | Gateway Wi-Fi Ecowitt | **Estación secundaria**: envía al mismo servidor; sus lecturas se guardan **aparte** y se ven en su propia página (solo lectura). No dispara alertas ni publica a redes |

**Baterías:** la WS69, la consola y cada canal WN31 reportan estado de batería
(OK / baja). El sistema **avisa** cuando alguna está baja (ver §7).

**Señal RF:** cada sensor inalámbrico reporta su **nivel de señal** (escala 0-4,
mayor = mejor). Se expone en `/api/current` (`signal_wh65`, `signal_ch1`…) y en
el detalle de sensores de `/api/stations`. Útil para diagnosticar ubicación o
interferencias.

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
- **Botón de tema:** ☀️ claro / 🌙 oscuro. Se recuerda entre visitas y aplica a
  ambas vistas.
- **Botón FX:** activa/desactiva los **efectos de clima** (lluvia, nieve, etc.)
  animados de fondo según la condición actual.
- **Vista clásica:** enlace a `/`.
- **Cintillo** de secciones: Inicio · Mi tablero · Pronóstico · Historia ·
  Estadísticas · Climatología · Radar · Astronomía · Calidad del aire ·
  Aeronáutica · Estación remota · Widget.

### 5.1 Inicio
Panel principal con el estado actual:

- **Mini-estadísticas (barra):** máx de hoy, viento máx, precipitación, UV,
  sensación, presión, prob. de lluvia, humedad y **"vs ayer"**.
- **Condiciones actuales:** temperatura grande + ícono + descripción; sensación,
  punto de rocío, bulbo húmedo, **humidex** y **base de nubes**; y humedad, UV y
  presión (en cajas).
- **Viento:** la tarjeta **gira** (flip) a la **rosa de vientos** al pulsar
  "Rosa de vientos".
- **Presión:** valor, mín/máx del día, **tendencia** y gráfica de 24 h con la hora.
- **Pronóstico local:** texto propio según la **tendencia del barómetro**.
- **Pronóstico (Open-Meteo)**, **gráfica de temperatura**, **precipitación**,
  **UV/solar** y **Sol y Luna**.
- **Calidad del aire (AQI)** e **IMECA**; **último sismo**; **alertas**;
  **próximos eventos** (fases lunares).
- **Interior** (temp/humedad) y **sensores adicionales WN31** (por canal, con
  nombre configurable — p. ej. "Jardín"). Abajo, el **radar**.

### 5.2 Mi tablero
Vista **personalizable**: con el botón «Personalizar» eliges qué tarjetas mostrar
u ocultar (las mismas del Inicio) y, con ese modo activo, puedes **arrastrarlas
para reordenarlas** a tu gusto (con soporte táctil). Tanto la selección como el
orden se guardan **en tu dispositivo**. La tarjeta de condiciones actuales queda
fija arriba. Entre las tarjetas disponibles está la de la **Estación remota**
(resumen compacto de la segunda estación; ver §5.11).

### 5.3 Pronóstico
Pronóstico de **Open-Meteo** (modelo `best_match`) en pestañas **por día** y
**por hora**, con tarjeta resumen del día y **descripciones en lenguaje natural**
(NLG), más la explicación de qué son los modelos y por qué es probabilidad, no
certeza.

### 5.4 Historia
El **archivo de la estación** con granularidad **Día / Mes / Año** y cinco grupos
de **gráficas interactivas** (temperatura; viento con dirección; humedad y punto
de rocío; radiación UV/solar; precipitación y presión). Tabla de días/meses
clicable, detalle diario y **exportación a CSV**.

### 5.5 Estadísticas
Con **selector de año**: **resumen del año**, **promedios mensuales**,
**contadores de días** (cálidos, noches frescas, con/sin lluvia), **grados-día**
y **evapotranspiración**, **récords históricos** en pestañas por categoría (cada
uno con su **top 5** y fecha), estadísticas por periodo y una **rosa de vientos**
(16 sectores).

### 5.6 Climatología
**Climatología Local** sobre el resumen diario:
- Tarjetas **Ayer / Este mes / Este año** (temperatura, humedad, viento, lluvia,
  grados-día y ET).
- **Climograma** anual (barras de lluvia + líneas de temperatura por mes).
- **Récords por mes calendario**.
- **Reporte estilo NOAA** (diario/mensual/anual, base 18.3 °C; "día con lluvia"
  ≥ 0.2 mm; ET por Hargreaves).
- **"En este día"** (años previos).

### 5.7 Radar y satélite
Mapa interactivo de **Ventusky** (radar, nubes, viento, temperatura…) e **imagen
satelital diaria de NASA GIBS** (color real, con selector de capa y fecha),
centrados en la estación.

### 5.8 Astronomía
- **Sol** y **Luna** con **arco de trayectoria** y estadísticas (elevación,
  azimut, iluminación, edad, distancia…).
- Fila de **fases lunares**.
- **Almanaque** (pyephem, local): los tres **crepúsculos** (civil −6°, náutico
  −12°, astronómico −18°) y los **planetas** visibles (Mercurio…Saturno) con
  orto/ocaso, altitud y magnitud.

### 5.9 Calidad del aire
- **AQI** (escala US EPA) de **WAQI/aqicn** (requiere token gratuito, se pone en
  el panel).
- **IMECA** estimado con las tablas oficiales de la norma **NADF-009-AIRE-2017**
  a partir de concentraciones modeladas (Open-Meteo/CAMS): valor y categoría con
  color, **medidor visual**, sub-índices por contaminante, **recomendaciones de
  salud**, **pronóstico del IMECA por horas** y **aviso de contingencia**.

### 5.10 Aeronáutica
**METAR** (observación) y **TAF** (pronóstico) **decodificados** al español, con
la **categoría de vuelo** (VFR/MVFR/IFR/LIFR) y un **perfil atmosférico visual**
(capas de nubes por altitud, silueta de la ciudad con volcanes, viento y QNH;
dibuja lluvia/rayos según el reporte). Buscador de cualquier código **ICAO** y
accesos a los principales aeropuertos de México. Fuente: aviationweather.gov (NOAA).

### 5.11 Estación remota
Página **solo lectura** para una **segunda estación** (p. ej. un Ecowitt
**GW1100**) que envía al mismo servidor. Sus datos se guardan **separados** de la
principal (etiqueta interna por estación), así que **no la afectan**; y esta
estación **no dispara alertas ni publica a redes públicas**. Muestra:
- **Condiciones actuales:** temperatura (con **tendencia** a 3 h), humedad y **punto de rocío**.
- **Presión** con su tendencia.
- **Estadística** (mín/prom/máx) de temperatura, humedad y presión, con selector **24 h / 7 d / 30 d**.
- **Histórico** con selector **Temp y humedad / Presión** y el mismo rango de tiempo.

Un **resumen compacto** de esta estación está disponible también como tarjeta
opcional en **Mi tablero** (§5.2).

### 5.12 Vista clásica (`/`)
Tablero sencillo para consulta rápida, **unificado con el estilo de `/pro`**
(reutiliza sus tarjetas: condiciones actuales, viento, interior, sensores,
pronóstico, sol y luna…). Incluye enlace **"App completa →"** a `/pro`.

### 5.13 Pie de página
Tres columnas (Estación / Datos / Proyecto) con hardware, ubicación, fuentes de
datos y enlaces; un párrafo descriptivo; y enlaces a **Widget** y **⚙ Admin**.

### 5.14 Widget e instalar (PWA)
- **Widget** (`/pro/compartir`): elige **unidades, tema y tamaño**, ve la
  **vista previa** y copia el **código `<iframe>`** para incrustarlo. El widget
  (`/embed`) es una tarjeta compacta que se actualiza cada minuto y acepta
  `?units=` y `?theme=`.
- **Instalable (PWA):** desde el móvil, «Añadir a pantalla de inicio» lo deja
  como app; abre directo la versión completa (`/pro`) y el "app shell" funciona
  sin conexión.

---

## 6. Panel de administración (`/admin`)

Acceso **usuario/contraseña** (sesión de 12 h). Diseño compacto en columnas.
Permite **editar en caliente** (sin reiniciar) todo lo configurable.

### Wizard de configuración inicial

La primera vez que se accede al panel, un **asistente de 5 pasos** guía la
configuración:
1. **Bienvenida** — introducción al panel
2. **Estación** — verifica que la consola esté enviando datos
3. **Alertas y Telegram** — configura umbrales y notificaciones (con botón
   «Probar» para validar las credenciales antes de guardar)
4. **Publicación** — activa las redes públicas (WU, Windy, etc.)
5. **Resumen** — muestra lo configurado y finaliza

El wizard puede saltarse y reaccederse más tarde si es necesario.

### Páginas del panel

| Página | Qué configura |
|--------|---------------|
| **Dashboard** | Vista general con **indicador en tiempo real** (pulso verde que parpadea), **historial de alertas** de las últimas 24 h (muestra estado activo/resuelto con timestamp), y **acciones rápidas** (activar/desactivar alertas, probar Telegram, refrescar manualmente). Estado de servicios (InfluxDB, Telegram, WAQI) |
| **Estaciones** | Lista de estaciones detectadas con estado (online/offline), última lectura y sensores. **«+ Agregar estación»** crea estaciones secundarias (nombre + passkey opcional que se autodetecta). Las secundarias pueden **eliminarse** (con confirmación). Cada fila enlaza a su configuración individual |
| **Configuración por estación** | Nombre/etiqueta, **watchdog** (activar/desactivar y timeout en minutos). **Servicios individuales**: activar alertas, publicación a redes y MQTT **por estación** (secundarias por defecto solo almacenan datos). **Sensores WN31** con nombres personalizados (ej. «Sala», «Recámara») |
| **Alertas** | Toggle global y por tipo. Umbrales: temp alta/baja, viento/ráfaga, lluvia tasa/diaria, presión alta/baja. Activar batería baja, sensor perdido, estación offline y calidad del aire (AQI/IMECA) |
| **Calibración** | Toggle global. Offsets: temp (°C), humedad (%), presión (hPa). Multiplicadores: viento y lluvia (factor) |
| **Publicación** | Credenciales de redes públicas: Weather Underground, PWSWeather, Windy, OpenWeatherMap, CWOP/APRS. Muestra cuáles redes están **activas** |
| **Notificaciones** | Toggle de Telegram, Bot Token, Chat ID y botón **«Probar»** para verificar |
| **Integraciones** | **MQTT/Home Assistant**: broker, puerto, topic, auth, toggle de auto-discovery y prefijo. **Indicador de conexión** (conectado/desconectado con último error), botón **«Probar conexión»** (sin afectar la conexión activa) y **«Reconectar»** para forzar reconexión en caliente. **WAQI**: token API para calidad del aire |
| **Sistema** | Info (versión, estaciones, última lectura, InfluxDB). Control de calidad (QC habilitado, filtro de picos). **Visor de logs** con filtros por nivel (todos/warning/error) y refresco en tiempo real. Enlaces útiles y stack |

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
| Viento fuerte | viento sostenido ≥ umbral |
| Ráfaga fuerte | ráfaga ≥ umbral |
| Lluvia intensa | tasa de lluvia ≥ umbral |
| Lluvia diaria alta | acumulado del día ≥ umbral |
| Presión alta / baja | presión ≥/≤ umbral |
| **Estación caída** | no llegan datos en N minutos |
| **Batería baja** | un sensor (WN31/WS69/consola) reporta batería baja |
| **Sensor perdido** | un sensor visto antes deja de reportar (se normaliza al volver) |
| **Calidad del aire** | el AQI o el IMECA superan su umbral (se revisa cada ~30 min) |

**Telegram:** se crea un bot con @BotFather, se obtiene el `chat_id` y se pega
token + chat id en el panel (o en `.env`).

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
| **Open-Meteo** | pronóstico horario/diario y astronomía base | 30 min |
| **Ventusky** | radar y mapas interactivos | en vivo (iframe) |
| **NASA GIBS** | imagen satelital de color real | diaria |
| **aviationweather.gov** (NOAA) | METAR y TAF (aeropuertos) | 10 min |
| **WAQI / aqicn** | calidad del aire (AQI) | 10 min |
| **Open-Meteo Air Quality** (CAMS) | concentraciones → IMECA estimado | 30 min |
| **USGS / SSN** | sismos recientes cercanos | 10 min |
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
| `GET /api/climate/onthisday` | efeméride: mismo día en años previos |
| `GET /api/climate/noaa?year=&month=` | reporte NOAA mensual/anual |
| `GET /api/wind/rose?start=-7d` | rosa de vientos (16 sectores) |
| `GET /api/almanac` | almanaque astronómico |
| `GET /api/alerts` | alertas activas |
| `GET /api/metar?station=` · `GET /api/taf?station=` | METAR y TAF de un aeropuerto |
| `GET /api/airquality` · `GET /api/airquality/imeca` | AQI e IMECA estimado (+ pronóstico) |
| `GET /api/satellite` | imagen satelital NASA GIBS (proxy) |
| `GET /api/earthquakes` | sismos recientes (USGS / SSN) |
| `POST /api/admin/login` · `GET/POST /api/admin/settings` · `GET /api/admin/status` | administración |
| `POST /data/report/` | **entrada** del push de la estación (Ecowitt) |

**Multi-estación:** `/api/current`, `/api/history` y `/api/stats/daily` aceptan
`?station=<nombre>` (p. ej. `gw1100`) para consultar una **estación secundaria**;
sin el parámetro devuelven la **principal**. Las secundarias se configuran en
`SECONDARY_STATIONS` del `.env` con el formato `passkey:nombre`.

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

**Backups:** respaldos periódicos del volumen de InfluxDB, con copia externa a
**Cloudflare R2** (ver `docs/backups-r2.md`). **Uptime:** monitor externo de
disponibilidad (ver `uptime-worker/`).

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
- **AQI:** índice de calidad del aire, escala US EPA (a mayor número, peor calidad).
- **IMECA:** Índice Metropolitano de la Calidad del Aire (CDMX); aquí *estimado*
  desde concentraciones modeladas con las tablas de la norma NADF-009-AIRE-2017.
- **METAR / TAF:** observación / pronóstico meteorológico aeronáutico de un aeropuerto.
- **Categoría de vuelo:** VFR / MVFR / IFR / LIFR, de mejores a peores condiciones.
- **Beaufort:** escala de fuerza del viento (0 calma … 12 huracán).

---

## 13. Estado y pendientes

**Hecho:** despliegue con HTTPS; **Vista clásica** + `/pro` con todas sus
secciones (Inicio, Mi tablero, Pronóstico, Historia, Estadísticas, Climatología,
Radar y satélite, Astronomía, Calidad del aire, Aeronáutica y Widget);
**tema claro/oscuro**, unidades y FX; **PWA instalable** y **widget insertable**
(`/embed`). Alertas completas —incluida calidad del aire (AQI/IMECA)—, Telegram y
MQTT/HA; control de calidad (rangos + picos), calibración, variables derivadas,
pronóstico local y publicación a 5 redes. Histórico Día/Mes/Año, récords
ampliados con **top-5**, **"en este día"**, reporte NOAA, **climograma**,
**grados-día + ET**, **rosa de vientos** y almanaque; **IMECA** estimado;
**satélite NASA GIBS**; **METAR/TAF** con perfil atmosférico; sismos; backups a
R2 y monitor de uptime externo. **Multi-estación**: soporte de una **estación
remota** secundaria (aislada por tag, con su propia página solo-lectura y tarjeta
opcional en Mi tablero).

**Pendiente:** versión en inglés (i18n); acciones del usuario (crear bot de
Telegram, token WAQI, credenciales de las redes públicas); y poblar el histórico
real cuando llegue el **WS2910**.

> Notas de estudio y planeación (exploratorias) quedan archivadas en `docs/archivo/`.

---

*Última actualización: 2026-07-17.*
