# Guía completa — Estación meteorológica XE1E

> **Documentación técnica** del sistema: hardware, arquitectura, cómo se procesa
> el dato, endpoints, administración, despliegue y operación.
>
> **¿Buscas cómo usar el sitio o qué significa un dato?** Eso está en el
> **[manual de usuario](../dashboard/public/guia.html)**
> (<https://clima.xe1e.net/guia.html>): recorrido por cada página e interpretación
> de cada número, sin tecnicismos. Los dos documentos son **complementarios y no
> se repiten** — si algo cabe en los dos, va en el manual y aquí se enlaza.
>
> **Sitio público:** https://clima.xe1e.net
> **Ubicación:** Benito Juárez, Ciudad de México, México · 19.380359, −99.174564 · ~2250 m
> **Repositorio:** github.com/XE1E/ecowitt-weather-server-xe1e

---

## Índice
1. [El proyecto](#1-el-proyecto)
2. [Hardware](#2-hardware)
3. [Arquitectura y flujo de datos](#3-arquitectura-y-flujo-de-datos)
4. [Procesamiento del dato local](#4-procesamiento-del-dato-local)
5. [La página web](#5-la-página-web-pro) (rutas y estado; el recorrido está en el manual)
6. [Widget para tu sitio](#6-widget-para-tu-sitio)
7. [Pantallas físicas](#7-pantallas-físicas)
8. [Impresión 3D](#8-impresión-3d)
9. [Panel de administración](#9-panel-de-administración-admin)
10. [Alertas y notificaciones](#10-alertas-y-notificaciones)
11. [Publicación a redes públicas](#11-publicación-a-redes-públicas)
12. [Fuentes de datos externas](#12-fuentes-de-datos-externas)
13. [API (endpoints)](#13-api-endpoints)
14. [Operación y mantenimiento](#14-operación-y-mantenimiento)
15. [Glosario de términos e índices](#15-glosario-de-términos-e-índices)
16. [Estado y pendientes](#16-estado-y-pendientes)

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
  **calidad del aire** (AQI e IMECA), **meteorología aeronáutica** (METAR/TAF),
  **sismos** de la región y la **cámara** del exterior (`/pro/camara`), que pone
  delante lo que los números describen.
- **Más de un sitio:** además de la estación principal, el servidor admite una
  **estación remota** (p. ej. un GW1100 en otra ubicación) que envía al mismo VPS;
  sus datos se guardan por separado y tienen su propia página, para comparar el
  clima de dos puntos distintos.
- **Dos vistas del sitio:**
  - `/` — **Vista clásica**: tablero simple de un vistazo (unificado con el estilo de `/pro`).
  - `/pro` — **Vista completa**: varias secciones con cintillo de navegación,
    unidades conmutables, tema claro/oscuro y efectos de clima; instalable como app (PWA).
- **Pantallas físicas:** el mismo servidor alimenta un **kiosco táctil ESP32-S3
  Waveshare**, un **e-paper LilyGo 4.7"** y un **reloj de píxeles Ulanzi TC001**,
  que muestran las condiciones sin abrir un navegador (ver §7).

---

## 2. Hardware

Kit **Ecowitt WS2910** + sensor **WS69** + termohigrómetros **WN31**.

| Equipo | Qué es | Qué mide / hace |
|--------|--------|-----------------|
| **Consola WS2910** | Pantalla + puente Wi-Fi | Presión (barómetro interno), temp/humedad interior; **envía todos los datos** al servidor por Wi-Fi (protocolo Ecowitt) |
| **WS69 (7-en-1)** | Sensor exterior integrado | Temperatura y humedad exterior, velocidad y dirección del viento, ráfaga, lluvia (tasa/evento/día/…), radiación solar e índice UV |
| **WN31 (×8)** | Termohigrómetros de canal | Temperatura y humedad en hasta **8 canales** independientes (habitaciones, exterior secundario, etc.) |
| **GW1100** *(estación remota, opcional)* | Gateway Wi-Fi Ecowitt | **Estación secundaria**: envía al mismo servidor; sus lecturas se guardan **aparte** y se ven en su propia página (solo lectura). Por defecto solo almacena datos, pero puede **disparar alertas propias** (y publicar/MQTT) activándolas **por estación** (ver §6) |

Fuera del kit Ecowitt hay dos añadidos, ambos opcionales y ambos detallados en
§7: la **cámara Tapo C325WB** del exterior y las **pantallas físicas** (kiosco
táctil Waveshare ESP32-S3, e-paper LilyGo 4.7" y reloj de píxeles Ulanzi TC001).

**Baterías:** la WS69, la consola y cada canal WN31 reportan estado de batería
(OK / baja). El sistema **avisa** cuando alguna está baja (ver §7).

**Señal RF:** el sistema **soporta** el nivel de señal por sensor (escala 0-4,
mayor = mejor; campos `signal_wh65`, `signal_ch1`… en `/api/current` y en el
detalle de `/api/stations`) **si el dispositivo lo envía**. La consola **WS2910**
(firmware EasyWeatherPro) **no incluye** estos campos en su push —solo el estado
de **batería**—, así que aparecen vacíos; los **gateways** tipo GW1100 / GW3000
sí los reportan.

**Envío:** la consola se configura en *Weather Services → Customized* con
protocolo **Ecowitt**, apuntando a `clima.xe1e.net` (o la IP/host del servidor),
ruta `/data/report/`. Envía una lectura cada ~16–60 s.

### Endpoint Ecowitt (configurar el datalogger)

El datalogger (consola WS2910 o gateway GW1100) envía por **HTTP POST**
(protocolo Ecowitt). En la app **WS View Plus** → *Weather Services → Customized*:

| Campo | Valor |
|-------|-------|
| Protocol Type | **Ecowitt** |
| Server IP / Hostname | `163.192.147.208` (o `clima.xe1e.net`) |
| Port | `8080` |
| Path | `/data/report/` |
| Upload Interval | `60` s |

URL completa: `http://163.192.147.208:8080/data/report/` (o
`https://clima.xe1e.net/data/report/` por dominio). Las unidades de entrada son
imperiales (°F, mph, inHg); el servidor las convierte a métrico. El **PASSKEY**
que envía cada dispositivo se deriva de su **dirección MAC**; el servidor lo usa
para identificar la estación de origen.

**Seguridad opcional** (Admin → Integraciones → 🔒 Seguridad del endpoint,
desactivada por defecto): **token secreto** (`/data/report/?token=…`, responde
403 si no coincide) y **allowlist de IP** (solo útil con IP pública fija).

**Principal vs. secundarias:** cada dispositivo manda un `PASSKEY`; la principal
es cualquier PASSKEY no mapeado, y las secundarias (p. ej. GW1100) se registran
mapeando su PASSKEY a un nombre en Admin → Estaciones. Detalle completo, payload
de ejemplo y verificación en **[ENDPOINT-ECOWITT.md](ENDPOINT-ECOWITT.md)** y
**[setup-gateway.md](setup-gateway.md)**.

---

## 3. Arquitectura y flujo de datos

```
  WS2910 (consola)                     Internet / VPS Oracle (ARM)
  WS69 + WN31  ──HTTP push──►  Cloudflare (Orange Cloud, HTTPS)
       │        protocolo         │
       │        Ecowitt           ▼
  C325WB (casa) ─JPEG push─►  Caddy (TLS, Origin Cert)
       │                          │
       │                          ▼
       │                     Dashboard (React)  ◄── navegador del usuario
       │                          │  (sirve la web y hace de proxy /api)
       │                          ├──► Renderer (Chromium) ──► kiosco Waveshare
       │                          ▼
       └──────────────►   Receiver (FastAPI)  ──►  InfluxDB 2.7 (histórico)
                                  │                     │
                                  │                     └─► Grafana (opt-in)
                                  ├─► MQTT / Home Assistant (opcional)
                                  ├─► Alertas (Telegram / correo / log)
                                  ├─► Pantallas (e-paper LilyGo, reloj Ulanzi)
                                  └─► Redes públicas (WU, Windy, PWS, OWM, CWOP)
```

**Componentes** (contenedores Docker):
- **receiver** (FastAPI, Python): recibe el push, procesa y guarda; expone la API.
- **influxdb** (InfluxDB 2.7): base de series temporales (histórico).
- **dashboard** (React + Nginx): sirve la web y reenvía `/api/*` al receiver.
- **renderer** (Chromium headless): fotografía las páginas del kiosco y las sirve
  como JPEG en `/api/display.jpg` (ver §7). Sólo lo consume la pantalla física.
- **caddy**: TLS/HTTPS con certificado *Origin* de Cloudflare.
- **grafana** *(opcional, perfil `grafana`)*: apagado por defecto. Apunta a
  InfluxDB y sirve para hurgar en el dato crudo; el sitio no lo necesita y el
  proxy no lo publica (ver §14).
- **cloudflare**: proxy (Orange Cloud), cache y protección delante del VPS.

**Frecuencia de actualización (front-end):**
| Qué | Cada |
|-----|------|
| Datos actuales, stats del día, comparación, pronóstico local | **60 s** |
| Historia (página) | 5 min |
| Pronóstico (Open-Meteo y SMN) y astronomía | 30 min |
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

**El humidex tiene estadística desde 2026-08-08**, y se consigue con una línea: entra en
`stats_fields` (`storage.py`), que es la lista que consulta `get_daily_stats`. De ahí lo
heredan **todos** sus consumidores a la vez —`/api/stats/daily`, los récords, el kiosco y el
resumen diario, que aplanan lo que devuelve ese método— y además de forma **retroactiva**,
porque la consulta lee el dato crudo, cuya retención es infinita.

Del resumen diario se guardan `humidex_max` y `humidex_max_time`, **no la media**: de un día
se recuerda cuánto llegó a apretar, y la media saldría engañosamente baja porque de noche el
índice no existe y esas horas no cuentan. En los récords hay `humidex_max` (de siempre, con
fecha) y, por periodo, `humidex_max` con fecha más `humidex_days` —los días con máximo ≥ 30,
que es a este índice lo que «días con lluvia» a la lluvia—.

⚠️ **Al añadir un campo nuevo al resumen hay que forzar el recálculo.** El backfill salta los
días que ya tienen resumen (sólo refresca hoy y ayer), así que el campo nuevo aparecería sólo
de ese día en adelante. Para eso `aggregator.backfill()` acepta `force=True`:

```bash
docker compose exec -T receiver python -c "
import asyncio
from app.main import storage, settings
from app.services import aggregator
asyncio.run(aggregator.backfill(storage, days=90, station=None, force=True))
"
```

No se pone en el arranque a propósito: son ~90 consultas a InfluxDB y no hay motivo para
pagarlas en cada reinicio.

Todos los ajustes (calibración, QC, alertas, tokens, redes) se editan **en
caliente** desde el panel de administración, sin reiniciar (ver §6).

---

## 5. La página web (`/pro`)

### Capturas de pantalla

<details>
<summary><strong>Ver las 15 páginas del sitio</strong></summary>

#### Inicio
![Inicio](capturas/01-inicio.png)

#### Mi tablero
![Tablero](capturas/02-tablero.png)

#### Pronóstico
![Pronóstico](capturas/03-pronostico.png)

#### Historia
![Historia](capturas/04-historia.png)

#### Estadísticas
![Estadísticas](capturas/05-estadisticas.png)

#### Tablas
![Tablas](capturas/06-tablas.png)

#### Climatología
![Climatología](capturas/07-climatologia.png)

#### Radar
![Radar](capturas/08-radar.png)

#### Cámara
![Cámara](capturas/09-camara.png)

#### Astronomía
![Astronomía](capturas/10-astronomia.png)

#### Calidad del aire
![Calidad del aire](capturas/11-calidad-aire.png)

#### Aeronáutica
![Aeronáutica](capturas/12-aeronautica.png)

#### Estación remota
![Estación remota](capturas/13-remota.png)

#### Widget
![Widget](capturas/14-widget.png)

#### Consola
![Consola](capturas/15-consola.png)

</details>

> **El recorrido página por página vive en el manual de usuario**, no aquí:
> [`dashboard/public/guia.html`](../dashboard/public/guia.html) — publicado en
> <https://clima.xe1e.net/guia.html>. Ahí está qué es cada pestaña, qué muestra
> cada tarjeta y **cómo se interpreta** cada dato, en lenguaje para cualquiera.
> Este documento no lo repite: se quedó con lo técnico.

Lo que sí corresponde a este documento:

- **Rutas.** La SPA sirve la vista moderna en `/pro` (layout `StationLayout`, 15
  pestañas: Inicio, Mi tablero, Pronóstico, Historia, Estadísticas, Tablas,
  Climatología, Radar, Cámara, Astronomía, Calidad del aire, Aeronáutica,
  Estación remota, Widget y Consola) y la clásica de una sola página en `/`.
  La lista viva es `NAV_ACTIVE` en `dashboard/src/pages/StationLayout.tsx`.
  **Consola** no tiene página propia: monta el mismo `ConsoleReplica` que pinta
  el kiosco (§7), así que lo que se ve en el navegador es lo que hay en la pared. El panel vive en `/admin`, el
  kiosco en `/kiosko?page=N` y el widget embebible en `/widget`.
- **Estado compartido.** `StationDataProvider` (`dashboard/src/station-data.tsx`)
  centraliza `current`, `stats/daily`, `history`, `compare` y `forecast/local`, y
  los refresca cada 60 s (el pronóstico cada 30 min). Las páginas consumen el
  contexto en vez de pedir cada una lo suyo.
- **Unidades.** `useUnits()` (`dashboard/src/units.tsx`) convierte en la vista, no
  en el servidor: el backend siempre guarda y sirve métrico. La preferencia se
  persiste en `localStorage`.
- **Convenciones visuales** (colores por variable, umbrales de tendencia, tamaños
  de icono): `docs/CONVENCIONES.md`.


## 6. Widget para tu sitio

Cualquiera puede poner el clima en vivo de la estación en su web o blog con un
**widget `<iframe>`**. La página [Widget para tu sitio](https://clima.xe1e.net/pro/compartir)
es un generador: eliges **unidades** (°C/°F), **tema** (claro/oscuro) y **tamaño**,
ves una vista previa y copias el código listo para pegar.

### Cómo insertarlo
1. Ajusta unidades, tema y tamaño hasta que la vista previa te guste.
2. Pulsa **«Copiar código»**.
3. Pega el código en el HTML de tu página: en **WordPress** un bloque «HTML
   personalizado»; en **Blogger/Wix** un elemento «Insertar código»; en **HTML
   puro**, dentro del `<body>`.

Ejemplo del código:
```html
<iframe src="https://clima.xe1e.net/embed?units=metric&theme=dark"
  width="360" height="210"
  style="border:0;border-radius:16px;max-width:100%"
  title="Clima CDMX" loading="lazy"></iframe>
```

- **Ruta base:** `/embed`, con parámetros opcionales `?units=metric|imperial` y
  `&theme=light|dark`.
- **Muestra:** temperatura, sensación y condición, más presión, humedad y viento;
  se actualiza solo cada minuto.
- **Responsivo** (`max-width:100%`), sin cuentas ni permisos; al hacer clic abre
  el sitio completo.

---

## 7. Pantallas físicas

Además del sitio web, el servidor alimenta **pantallas físicas dedicadas** que
muestran el clima en tiempo real sin necesidad de abrir un navegador. Son tres, y
se reparten en **dos modelos opuestos**:

| Pantalla | Quién dibuja | Qué le sirve el servidor |
|---|---|---|
| **Waveshare ESP32-S3** táctil 7" | el **servidor** (cliente tonto) | la pantalla ya hecha, `GET /api/display.jpg` |
| **LilyGo e-paper** 4.7" | el **display** (cliente gordo) | dato con forma WeatherAPI, `GET /api/epaper/forecast.json` |
| **Ulanzi TC001** (reloj píxel) | el **display** | dato con forma WeatherAPI, `GET /api/svitrix` |

El primer modelo hace que añadir pantallas sea trabajo de servidor; el segundo
deja al firmware su propio dibujado, y el servidor sólo suplanta la API que ese
firmware ya sabía consumir.

### Waveshare ESP32-S3 (pantalla táctil 7")

Una **pantalla táctil de 1024×600** basada en **ESP32-S3** que actúa como
«display tonto»: el servidor renderiza cada pantalla en headless Chromium y la
sirve como JPEG (`GET /api/display.jpg?page=<slug>`); el ESP32 solo la baja y la
pinta. Arranca en la **consola**, que hace de índice: cada celda lleva al detalle
histórico de esa variable.

<p align="center">
  <img src="images/kiosk-consola.jpg" alt="Kiosco: réplica de la consola" width="400"/>
  <img src="images/kiosk-camara.jpg" alt="Kiosco: cámara del exterior con el análisis del cielo" width="400"/>
</p>
<p align="center">
  <em>El display colgado: la réplica de la consola y la página de la cámara con el análisis del cielo</em>
</p>

#### Navegación: el mapa de zonas

El firmware **no sabe qué páginas existen**. Con cada JPEG recibe la cabecera
**`X-Kiosk-Nav`** con las zonas táctiles de esa pantalla, y sólo tiene que buscar
en qué rectángulo cayó el toque:

```
X-Kiosk-Nav: v=1;back=det-rain-24h;ttl=1800;z=0,536,171,64,det-rain-24h;z=171,536,171,64,det-rain-7d;…
```

`back` es a dónde va un toque **fuera** de cualquier zona (el firmware lleva además
su propia pila, así que normalmente vuelve por donde vino) y `ttl` cuántos segundos
vale la imagen.

Las zonas **se miden del DOM** en `pages/kiosk/nav-zones.tsx`: cada elemento
navegable lleva `data-nav="slug"` y su rectángulo sale de `getBoundingClientRect()`.
Por eso mover una celda no rompe su zona — y por eso **ya no hay contrato que
mantener entre los dos repos**, que es lo que antes obligaba a reflashear el firmware
por cada página nueva. Para comprobar que las zonas caen donde se ven:
`?page=consola&debug=nav` las dibuja encima.

#### Las pantallas

| Slug | Contenido | Fuente en el repo |
|------|-----------|-------------------|
| `consola` | Réplica de la consola física (rejilla 3×5). **Home**, y el índice de todo lo demás | `ConsoleReplica` en modo `kiosk` |
| `det-<var>-<periodo>` | Detalle histórico. `var`: `temp`, `hum`, `press`, `wind`, `rain`, `sun`. `periodo`: `24h`, `7d`, `30d`, `12m` | `pages/kiosk/DetailPage.tsx` |
| `stats-<vista>` | Extremos y récords. `vista`: `hoy`, `mes`, `ano`, `siempre` | `pages/kiosk/StatsPage.tsx` |
| `menu` | Puerta a las páginas clásicas y a la cámara. Se abre tocando el reloj | `pages/kiosk/MenuPage.tsx` |
| `camara` | Vista del exterior. Se abre tocando la celda de **sol y luna** de la consola. Degrada con gracia mientras no llegue foto, y marca **FOTO ANTIGUA** si pasa de 15 min (tres capturas perdidas) | `pages/kiosk/CamaraPage.tsx` |
| `info` | **Slug reservado**: no existe en el servidor. Lo intercepta el firmware y pinta su pantalla de diagnóstico (IP, SSID, señal, versión) | — |
| `1` | Estación: temperatura, tiles de resumen, pronóstico de 6 h | `KioskPage.tsx` |
| `2` | Sensor local BME280 del propio display, con mín/máx del día | `KioskPage.tsx` · `/api/kiosk/local` |
| `3` | Sensores: interior, jardín (CH1) y remota GW1100 | `KioskPage.tsx` |
| `4` | Pronóstico de 7 días | `KioskPage.tsx` |
| `5` | Resumen multivariable de 48 h | `MultiVariableChart` en modo `2day` + `kiosk` |

Todo eso sale de **una tabla única**, `dashboard/src/kiosk-nav.ts`: qué pantallas hay,
de quién cuelga cada una, su color y su TTL. Añadir una variable es una fila ahí.

**No hay detalle de los sensores** (interior, jardín, remota) aunque la consola les
dedique cuatro celdas: el rollup diario sólo guarda campos de la estación principal,
así que sus periodos largos saldrían vacíos. Esas celdas llevan a la página 3.

#### La cámara del exterior

La cámara (Tapo C325WB) vive **detrás del NAT de casa** y el servidor en el VPS, así
que el VPS no puede ir a buscarla: algo en casa saca un JPEG del RTSP cada 5 min y
lo **empuja**. Ver `docs/internal/PLAN-CAMARA-EXTERIOR.md`.

##### Arquitectura del flujo de captura

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              RED LOCAL (casa)                                    │
│                                                                                  │
│  ┌──────────────┐     RTSP/TCP      ┌──────────────────────────────────────┐    │
│  │ Tapo C325WB  │ ────────────────► │  Raspberry Pi / nodo captura         │    │
│  │ (cámara 2K)  │   stream1/554     │  ┌────────────────────────────────┐  │    │
│  └──────────────┘                   │  │  captura-camara.sh (timer 5m)  │  │    │
│                                     │  │  ├─ ffmpeg: 1 frame RTSP→JPEG  │  │    │
│                                     │  │  ├─ escala a max 1600px        │  │    │
│                                     │  │  └─ reintentos (3× con backoff)│  │    │
│                                     │  └────────────────────────────────┘  │    │
│                                     └───────────────┬──────────────────────┘    │
└─────────────────────────────────────────────────────┼────────────────────────────┘
                                                      │
                                          POST /api/camera/upload
                                          X-Camera-Token: $TOKEN
                                          Content-Type: image/jpeg
                                          (TLS pinning directo al VPS)
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              VPS Oracle (servidor)                               │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  receiver/app/services/camera.py  (CameraStore)                           │  │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  save(data, taken_at)                                               │  │  │
│  │  │  ├─ Validar tamaño (1 KB - 12 MB)                                   │  │  │
│  │  │  ├─ Validar firma JPEG (FFD8FF)                                     │  │  │
│  │  │  ├─ Escritura ATÓMICA: tmp → rename                                 │  │  │
│  │  │  │   └─ Evita servir media foto durante volcado                     │  │  │
│  │  │  ├─ Guardar metadato (captured_at, bytes) → latest.json             │  │  │
│  │  │  ├─ Archivar en histórico: YYYY-MM-DD/HHMMSS.jpg                    │  │  │
│  │  │  └─ Purgar días > CAMERA_RETENTION_DAYS (7)                         │  │  │
│  │  └─────────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                        │                                         │
│                                        ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  Análisis con IA (sky_analyzer.py)                                        │  │
│  │  ├─ Gemini Vision o Claude (según config)                                 │  │
│  │  ├─ Extrae: condición, nubes, cobertura, visibilidad, desarrollo, precip  │  │
│  │  └─ Guarda: latest_analysis.json, history, diario                         │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                        │                                         │
│                       ┌────────────────┼────────────────┐                        │
│                       ▼                ▼                ▼                        │
│               ┌───────────┐    ┌───────────┐    ┌───────────┐                   │
│               │ Dashboard │    │  Kiosco   │    │  Alertas  │                   │
│               │ /pro/cam  │    │ Waveshare │    │ Telegram  │                   │
│               └───────────┘    └───────────┘    └───────────┘                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

##### El script de captura (`scripts/captura-camara.sh`)

Corre en una Raspberry Pi (o cualquier Linux en la red local) cada 5 min vía timer
de systemd. Por qué es necesario: la cámara solo habla RTSP/ONVIF dentro de la LAN
(FAQ de TP-Link), el servidor está en un VPS externo, y el router no tiene reenvío
de puertos. Alguien **dentro de casa** tiene que sacar la foto y **empujarla**.

**Configuración** (`camara.env`):
```bash
CAMERA_IP=192.168.1.100       # IP de la Tapo en la LAN
CAMERA_USER=admin             # Credenciales del stream RTSP
CAMERA_PASS=secreto
CAMERA_STREAM=stream1         # stream1=alta res, stream2=baja
API_URL=https://clima.xe1e.net
UPLOAD_TOKEN=token_secreto    # El mismo que CAMERA_UPLOAD_TOKEN del servidor
MAX_WIDTH=1600                # Escalar a este ancho máximo
RETRIES=3                     # Reintentos si ffmpeg falla
VPS_IP=163.192.147.208        # IP directa del VPS (salta Cloudflare)
TLS_PIN=sha256//xxxxx         # Pin de clave pública para validar TLS
```

**Captura con ffmpeg:**
```bash
ffmpeg -rtsp_transport tcp \
  -i "rtsp://user:pass@IP:554/stream1" \
  -ss 1 -frames:v 1 -q:v 3 \
  -vf "scale='min(1600,iw)':-2" \
  -f image2 foto.jpg
```
- `-rtsp_transport tcp`: evita bandas por paquetes UDP perdidos
- `-ss 1`: descarta el primer segundo (el primer keyframe suele venir incompleto)
- `-q:v 3`: calidad JPEG buena sin llegar a 1 MB
- `scale`: reduce si excede MAX_WIDTH, mantiene proporción

**Manejo de VPN/túnel:** si el nodo sale por una VPN (p.ej. AMPRNet), Cloudflare
puede bloquear esa IP. El script detecta si la ruta al VPS pasa por `tun*|ppp*|wg*`
y la reescribe para salir por la LAN real, sin tocar la configuración permanente.

**TLS pinning:** al ir directo al VPS (saltando Cloudflare), el certificado Origin
de Cloudflare no valida con CAs públicas. En lugar de deshabilitar TLS, se fija la
clave pública del servidor (`--pinnedpubkey`). Sin `TLS_PIN`, el script **no envía**.

**Reintentos con backoff:** si ffmpeg falla, reintenta hasta `RETRIES` veces con
esperas crecientes (5s, 10s, 15s). Si todos fallan, **no sube nada** — es mejor dejar
la foto anterior (que el servidor marcará como stale) que subir un JPEG roto.

**Modo sin cámara:** si las credenciales están en valores placeholder (`CAMBIAR`),
el script sale limpiamente con código 0. Así el timer puede quedar activo esperando
que se configure la cámara, sin llenar el journal de errores.

##### Procesamiento en el servidor (`CameraStore`)

**Validaciones al recibir:**
1. **Tamaño mínimo** (1 KB): rechaza cuerpos vacíos o triviales
2. **Tamaño máximo** (12 MB): la Tapo 2K da ~200-600 KB; 12 MB es un tope de seguridad
3. **Firma JPEG** (`FFD8FF`): rechaza HTML de portales cautivos, errores de ffmpeg, etc.

**Escritura atómica:**
```python
tmp = "latest.jpg.tmp"
with open(tmp, "wb") as f:
    f.write(data)
os.replace(tmp, "latest.jpg")  # rename atómico
```
Sin esto, una petición GET durante el volcado serviría media imagen.

**Estructura de archivos:**
```
/data/camera/
├── latest.jpg              # La última captura
├── latest.json             # Metadato: {"captured_at": "...", "bytes": 123456}
├── latest_analysis.json    # Último análisis de IA
├── analysis_history.json   # Últimos 12 análisis (para nowcasting)
└── 2026-08-11/
    ├── 080532.jpg          # Histórico del día (HHMMSS.jpg)
    ├── 081033.jpg
    └── analysis.json       # Todos los análisis del día
```

**Retención:** el histórico se poda por **días completos**, no por número de fotos.
Si un día solo llegaron 10 capturas, no se borran para hacer hueco; se borran cuando
el día tiene más de `CAMERA_RETENTION_DAYS` (default 7) de antigüedad.

**Detección de foto vieja:** `stale_seconds` (default 900 = 15 min, tres capturas
perdidas con la cadencia de 5 min). Si la foto
tiene más edad, `stale: true` en el status y el kiosco puede mostrarlo visualmente.

##### Endpoints de la cámara

| Endpoint | Qué |
|---|---|
| `POST /api/camera/upload` | Recibe la captura. Multipart (campo `file`) o el JPEG en crudo |
| `GET /api/camera/latest.jpg` | La última, con `X-Captured-At` |
| `GET /api/camera/status` | `available`, `captured_at`, `age_seconds`, `stale` |
| `GET /api/camera/days` | Días con histórico y cuántas capturas tiene cada uno |
| `GET /api/camera/timelapse/days` | Qué días tienen vídeo (o fotogramas para montarlo) |
| `GET /api/camera/timelapse/<fecha>.mp4` | El timelapse de ese día |
| `POST /api/camera/timelapse/<fecha>` | Rehace el vídeo del día (requiere admin) |

```bash
curl -H "X-Camera-Token: $TOKEN" --data-binary @foto.jpg \
     https://clima.xe1e.net/api/camera/upload
```

**Códigos de respuesta:**
- `200`: subida OK
- `400`: el contenido no es un JPEG válido
- `401`: token incorrecto
- `503`: `CAMERA_UPLOAD_TOKEN` no configurado en el servidor

`CAMERA_UPLOAD_TOKEN` es un token **propio**, no el del panel de administración: lo
lleva un script desatendido y, si se filtra, sólo permite subir fotos. Sin token
configurado la subida responde **503** y no guarda nada.

##### Timelapse diario

Las capturas del día se juntan en un **MP4** con **ffmpeg**, y se ven en `/pro/camara`
con un selector de día. Se genera **en el VPS**, donde ya están los fotogramas: hacerlo
en la Raspberry Pi de casa habría metido un encode en un nodo IRLP en producción y
habría añadido subida por el enlace de casa, que es el recurso escaso.

| Ajuste | Default | Qué |
|---|---|---|
| `CAMERA_TIMELAPSE_ENABLED` | `true` | Apagarlo deja de generar (las fotos siguen guardándose) |
| `CAMERA_TIMELAPSE_FPS` | `12` | Con la ventana de 06–20 h a 5 min son ~168 capturas: ~14 s de vídeo |
| `CAMERA_TIMELAPSE_WIDTH` | `1280` | La cámara da 2K; 1280 deja el archivo en un par de MB |
| `CAMERA_TIMELAPSE_MIN_FRAMES` | `10` | Por debajo no se genera: duraría un pestañeo |
| `CAMERA_TIMELAPSE_RETENTION_DAYS` | `90` | Retención de los **vídeos** (0 = no purgar) |

Los cuatro últimos se editan también en **Admin → Cámara**, con un botón para rehacer el
vídeo de hoy y el aviso de si al contenedor le falta ffmpeg.

**Dos decisiones que conviene conocer:**

- **Los vídeos se guardan aparte de las fotos**, en `<camera_dir>/timelapse/`, con
  retención propia y mucho más larga. Medido el 2026-08-18: un día son 237 capturas =
  25 MB de fotos y 5.9 MB de vídeo (19.8 s), montado en ~10 s. Así que el timelapse es lo
  que puede sobrevivir meses --90 días ≈ 540 MB-- mientras los fotogramas se podan a los
  7 días.
- **La frescura la lleva una tarea del servidor**, no las visitas: refresca el de hoy
  cada 30 min y cierra el de ayer. El endpoint público sirve el vídeo que hay aunque le
  falten las últimas capturas; si cada visita regenerara el día en curso, un par de
  visitantes bastarían para tener ffmpeg corriendo sin parar. Un día que aún no tiene
  vídeo sí se monta al pedirlo: el endpoint responde `202` y la página espera.

##### Qué sobrevive a qué (retenciones)

Tres cosas distintas con tres retenciones distintas, y conviene tenerlo claro porque
determina qué se puede consultar de un día pasado:

| Qué | Dónde | Retención | Tamaño al día |
|---|---|---|---|
| Fotogramas | `<camera_dir>/YYYY-MM-DD/` | `CAMERA_RETENTION_DAYS` (7) | ~25 MB |
| Vídeo del timelapse | `<camera_dir>/timelapse/` | `CAMERA_TIMELAPSE_RETENTION_DAYS` (90) | ~6 MB |
| Histórico de análisis | `<camera_dir>/analysis/` | `CAMERA_ANALYSIS_RETENTION_DAYS` (0 = nunca) | ~6 KB |

Las dos últimas viven **fuera** de la carpeta del día justamente para que la poda de
fotogramas no se las lleve. El análisis estuvo dentro hasta el 2026-08-18 y por eso
moría a los 7 días; al sacarlo se añadió una **migración que corre al arrancar** y sube
lo que quedara en el sitio viejo (idempotente, y funde en vez de pisar si hubiera datos
en los dos sitios).

##### Análisis del cielo con IA

Cada foto se analiza automáticamente con un modelo de visión (**Gemini** o **Claude**)
para extraer información sobre el estado del cielo:

| Campo | Qué detecta | Ejemplo |
|-------|-------------|---------|
| `sky_condition` | Condición general | clear, partly_cloudy, stormy |
| `cloud_type` | Tipo de nubes (clasificación meteorológica) | cumulus, cumulonimbus, cirrus |
| `cloud_coverage_pct` | Porcentaje de cobertura | 0-100 |
| `visibility` | Visibilidad | excellent, good, poor |
| `development` | Estado de desarrollo de las nubes | building, stable, dissipating |
| `precipitation_visible` | Lluvia visible en el horizonte | true/false |
| `forecast_hint` | Pronóstico a corto plazo | "Posible lluvia en 30-60 min" |

El análisis se muestra en la **tarjeta "Estado del cielo"** del inicio y en la página
de **Cámara**, junto con el histórico diario.

**Endpoints:**

| Endpoint | Qué |
|----------|-----|
| `GET /api/camera/analysis` | Último análisis + tendencia (nowcasting) |
| `GET /api/camera/analysis/validation` | Validación vs pronóstico de Open-Meteo |
| `GET /api/camera/analysis/history` | Sin params: lista días; con `?date=YYYY-MM-DD`: datos del día |
| `GET /api/camera/analysis/providers` | Info de proveedores configurados |

**Nowcasting (tendencias):** el sistema guarda los últimos 12 análisis (~1 hora con
cadencia de 5 min) y calcula tendencias: "↑ Nublándose", "↓ Despejando", "→ Estable",
"⛈️ Posible tormenta" (cobertura + desarrollo intensificándose), "🌧️ Precipitación
aproximándose" (lluvia apareció en horizonte).

**Validación vs modelos:** compara lo que **ve** la cámara con lo que **predicen** los
modelos (Open-Meteo) y muestra un indicador de confianza: ✓ Coincide (95%),
≈ Similar (80%), ? Difiere (60%), ⚠ Discrepa (30%).

**Alertas visuales:** el sistema puede notificar (Telegram/correo) cuando detecta:
- `sky_storm`: Nubes de tormenta (cumulonimbus) en desarrollo
- `sky_precipitation`: Lluvia visible en el horizonte
- `sky_visibility`: Visibilidad reducida (pobre o muy pobre)

Las alertas usan **histéresis** (requieren 2 análisis consecutivos) para evitar falsos
positivos. Se activan en Admin → Notificaciones → categoría "Visual (cielo)".

**Configuración:** en Admin → Sistema hay opciones para:
- Habilitar/deshabilitar el análisis
- Elegir proveedor (auto, gemini, anthropic)
- API keys de Gemini (tier gratuito: 1500 req/día) y Anthropic (de pago)

**Archivos guardados:**
- `latest_analysis.json` — último análisis
- `analysis_history.json` — últimos 12 para tendencias
- `YYYY-MM-DD/analysis.json` — histórico del día

> **Ojo con nginx y las rutas de la API acabadas en `.jpg`.** Las `location` por regex
> ganan a las de prefijo, así que la regla de estáticos `\.jpg$` se tragaba
> `/api/camera/latest.jpg` y devolvía su propio 404 con la foto guardada. El bloque de
> la API es `location ^~ /api` justamente para cortar esa evaluación.

#### TTL: por qué cada pantalla declara el suyo

El VPS tiene 2 vCPU y cada pantalla es un render de Chromium (~1.5 s). Precalentarlas
todas no cabe, así que cada página publica en `data-kiosk-ttl` cuánto vale su imagen
—45 s la consola, 30 min un resumen mensual que sólo cambia cuando el rollup cierra el
día— y el precalentado es **adaptativo**: la home más las tres páginas pedidas más
recientemente, y sólo si su TTL ya expiró.

La página 5 y la consola **reusan componentes del dashboard** (`MultiVariableChart` y
`ConsoleReplica`), no copias: cualquier mejora que se les haga en la web llega
sola al display. `ConsoleReplica` es además la misma vista del tab
[Consola](#5-la-página-web-pro) (`/pro/consola`), con un prop `mode` como única
diferencia.

Las pantallas del árbol nuevo heredan la estética de la consola —negro, cifras en
DSEG, el color de cada variable— porque se llega a ellas tocando una celda: con otro
aspecto se leerían como salir a otra aplicación en vez de como abrir la celda que
acabas de tocar. El CSS lo comparten en
`components/station/console-css.ts`, y el marco común (cabecera, cifras y barra de
botones de 64 px) en `pages/kiosk/chrome.tsx`.

> **Ojo con las letras en las cifras.** DSEG es de siete segmentos: un "4 de 7" se
> lee "4 dE 7". Los valores que pueden traer letras —días con lluvia, rumbo
> dominante— se detectan con `esCifra()` y se pintan en la condensada.

El display tiene un **BME280 integrado** que envía sus lecturas al servidor
(`POST /api/kiosk/local`), mostrándolas en la página 2; los mín/máx del día se
persisten en `/data/kiosk_local.json` para sobrevivir reinicios del contenedor.
Configuración WiFi por portal cautivo (*WiFiManager*). Firmware y documentación:
[ecowitt-display-kiosk-xe1e](https://github.com/XE1E/ecowitt-display-kiosk-xe1e).

### La réplica de consola (`ConsoleReplica`)

Rejilla de **3 columnas × 5 filas** en 1024×600, con la celda del viento abarcando
las dos primeras filas. Cada celda lleva **contorno de color según el origen** del
dato, que es lo que agrupa la pantalla de un vistazo:

| Contorno | Significado | Celdas |
|----------|-------------|--------|
| Ámbar | Lectura de la estación principal | EXT, HUMEDAD, PRES, VIENTO, LLUVIA, INTERIOR, y las **tres** de ROCÍO · SENSACIÓN · HUMIDEX |
| Verde | Sensor de canal (WN31) | JARDÍN |
| Azul | Estación remota | las **tres** celdas rotuladas REMOTA: exterior (WN32), interior (integrado del gateway) y presión |
| Blanco | Ni lectura cruda ni de la estación | condición + próximas horas, sol/luna, SOLAR, UV, IMECA |
| Rojo (5 px) | Reloj | fecha/hora. Es la zona táctil principal (abre el menú), y por eso el rojo del reloj (`--red`) es **distinto** del de alarma (`--alarma`) |

Las tres celdas de la remota se llaman **sólo «REMOTA»**, sin el modelo del aparato:
lo que mide cada una lo dicen sus glifos —casa hueca = a la intemperie, casa rellena
= bajo techo, barómetro = presión—, que es el mismo criterio por el que EXT, HUMEDAD,
PRES y LLUVIA no llevan rótulo. Antes decían «REMOTA WN32» y «REMOTA GW1100» en
morado, lo que además gastaba el color de la presión en un nombre de equipo.

Varias celdas **no llevan rótulo** (EXT, HUMEDAD, PRES, VIENTO, LLUVIA): las
identifica su icono —termómetro, gota, barómetro— igual que en una consola física.
Los glifos de ubicación son **una sola casa en dos versiones**: hueca = sensor a la
intemperie, rellena = bajo techo.

Los iconos son de **Meteocons**, teñidos y recortados en `MeteoGlyph.tsx`. Tres
detalles que ya costaron una vez y conviene no rehacer: (1) las cajas de recorte
llevan sumada **la mitad del trazo**, porque `getBBox()` mide sólo la geometría y
sin ese margen el aro del barómetro sale comido por los cuatro costados; (2) al
termómetro se le **borra la escala** grabada en el cristal (un tramo del propio
`path`), que a 46 px cae sobre el mercurio y se ve como suciedad; (3) cada
instancia reescribe los `id` del SVG con un prefijo propio —los del paquete son
fijos y con dos barómetros en pantalla, al desmontarse el primero el otro se
quedaba sin su `clip-path`—.

**El riel de tendencia de PRES** dice *cuánto* ha cambiado la presión en 3 h
mientras la flecha de la celda dice el sentido. Notas de implementación:

- El rango es **±5 hPa y se razona siempre en hPa**; sólo se traducen los rótulos
  (5 hPa = 0.15 inHg). Un riel rotulado ±5 en imperial estaría mintiendo.
- El valor **se pinza** contra el extremo, y por eso los topes llevan `≤` y `≥` a
  los costados del riel: la marca del extremo representa ese valor *y todo lo que
  haya más allá*. Van al costado y no junto a la cifra porque a la izquierda de la
  marca del −5 sólo quedan 12 px y el símbolo se saldría del `viewBox`.
- En métrico se numeran **las once marcas** (−5 … 5), centradas sobre su marca; en
  imperial sólo los extremos y el cero, porque numerarlas todas daría
  0.03 / 0.06 / 0.09… en 31 px de hueco.
- El **puntero cruza el riel** de abajo arriba y su punta acaba en el borde
  superior. Se dibuja el último, después de las marcas y del relleno.
- `PS_W = 335` es el ancho de la celda sin bordes, y el dibujo reserva 12 px a cada
  lado *por dentro* del `viewBox`: el contenedor no lleva sangría propia o los dos
  márgenes se suman y el riel sale más corto que el histograma de LLUVIA.

**Avisos de alerta en la propia celda.** La consola pide `/api/alerts` cada minuto y
señala la alerta viva de dos formas a la vez: tiñe de rojo (`--alarma`, rojo puro) el
**glifo de identidad** de la celda afectada —o su rótulo si no tiene glifo— y dibuja un
**triángulo con «!»** a la izquierda de su flecha de tendencia. La clave de la alerta
trae la estación como prefijo (`gw1100:humidity_high`), y es eso lo que decide si pinta
aquí o en una de las celdas de la remota; rocío y sensación van a la celda de derivadas,
donde se leen sus cifras. Batería y sensor perdido no tiñen nada: la pila ya se pone roja
sola. La celda de la remota exterior lleva **dos** triángulos, uno por lectura
(temperatura a la izquierda, humedad bajo la casita), porque es la única con dos
magnitudes y alarmas propias de cada una.

El **texto** de la alerta va en el renglón del reloj, el mismo que se convierte en «SIN
DATOS», y la caída tiene prioridad: sin dato nuevo las reglas se evalúan sobre lecturas
congeladas. Dos cuidados con ese texto: los mensajes del motor empiezan por **emoji** y
hay que quitarlo (el Chromium del renderer corre sin fuente de emoji en color y saldría
un cuadro vacío), y se le recorta el **umbral entre paréntesis**, que es la parte
que no hace falta a esa distancia y sigue entera en el correo y en la web.

El renglón admite **dos líneas** y se recorta con puntos suspensivos a partir de la tercera.
El tope no es un descuido: una tercera línea empuja el reloj fuera de la celda. Para que las
dos entraran hubo que sacar 12 px de la celda, y el sitio salió de dos medidas —interior de
99 px, texto 28, fila del reloj 53 y su separación 6—: la sangría vertical baja de 9 a 3, y
la fila del reloj medía 55 en vez de 53 porque la mandaba la **caja de línea** de los dígitos
de 46 px (interlineado 1.2 por defecto) y no su tinta; con `lineHeight: 1` esos 2 px se van al
aire de arriba, que es donde se notan.

**Próximas cuatro horas** en la celda de condición, bajo el icono y su descripción: hora,
temperatura y **probabilidad de lluvia**, ésta en el azul de la lluvia. Sale de
`fetchForecast()`, que ya devolvía las horas con su icono de día o de noche resuelto. El
icono de condición bajó de 108 a 62 px para hacerle sitio: traía ~50 px de tinta en una
caja que ni cabía en la celda.

**UV e IMECA dicen su nivel en palabras** donde SOLAR pone su unidad. El de UV sale de
`uvLabel` (`weather.ts`), compartido con la tarjeta de Inicio para que los cortes de la
OMS no puedan separarse de los del color; el del IMECA lo manda el backend en `category`,
la misma fuente de la que sale el color del dígito. Van a 13 px y no a 14 porque
«MODERADO» —el caso de casi cualquier mañana— mide 68.2 px en un interior de 68.0.

**De noche esas dos celdas enseñan el MÁXIMO DEL DÍA** en vez de su cero: la cifra grande
pasa a `stats.<campo>.max`, el renglón de la unidad o del nivel dice «MÁXIMO», las dos cosas
en **blanco puro** —el blanco no está en la rampa de colores de esas celdas, así que de un
vistazo se sabe que ese número no es una lectura viva— y el riel se llena hasta ese máximo
para no contradecir a la cifra. Al amanecer, con la primera lectura por encima de cero,
vuelven solas a lo normal. Dos detalles del criterio: se exige que el máximo sea **> 0** y no
sólo que la lectura esté a cero, porque los stats son del día en curso y a las 00:05 el
máximo también es 0 (se anunciaría «0 MÁXIMO» toda la madrugada); y el corte es **< 1** y no
«= 0», porque el UV llega entero pero la radiación puede quedarse en decimales de crepúsculo
y entonces no conmutaría nunca. No aplica al IMECA, que no se apaga de noche.

**Señal RF 0-4** junto a la casita, en EXT y en la remota exterior: cuatro barras que
crecen en alto y en color (4-3 verde, 2 ámbar, 1-0 rojo). La manda el **gateway** por cada
sensor emparejado; la consola WS2910 **no manda señal de nada** (verificado: `/api/current`
no trae un solo campo `signal_*`), así que en EXT el glifo está montado pero no se dibuja.

**Rumbo dominante de 24 h** como un punto verde metido en el riel del aro del compás,
mientras la flecha sigue diciendo de dónde sopla ahora. Se calcula del histórico que la
consola ya tiene cargado, con media **vectorial pesada por la velocidad**: promediar
grados no vale —el promedio de 350° y 10° daría 180°, el rumbo contrario— y una hora de
viento fuerte dice más de la procedencia del aire que seis de brisa. Descarta calmas
(≤ 0.5 km/h) y exige 20 muestras.

**La hora del pico de ráfaga** va encima del rótulo RÁFAGA DÍA (`stats.wind_gust.max_time`),
no a su lado: al lado, el bloque se ensancha y su extremo izquierdo se mete bajo el óvalo.

Datos que **sólo existen para esta vista** y conviene no confundir con lecturas del
aparato:

- **PROMEDIO** del viento usa `wind_speed_avg10m`, que **calcula el servidor** sobre
  las muestras guardadas: la estación no manda ningún promedio (el campo
  `windspdmph_avg10m` es del protocolo Wunderground, no del formato Ecowitt, y se
  verificó contra InfluxDB que nunca llega). `wind_speed` es instantánea y es la que
  va en el centro del óvalo. **RÁFAGA DÍA** es `wind_gust_max_daily`, no la ráfaga
  del instante.
- El **histograma de lluvia** de 7 días viene de `/api/rain/daily` (ver §13).
- El **aviso «SIN DATOS»** sustituye al nombre de la estación en la celda del reloj
  cuando la última lectura tiene 5 min o más. Cuidado al tocarlo: el `timestamp` de
  `/api/current` viene en UTC pero **sin sufijo de zona**, y `new Date()` interpreta
  un ISO sin zona como hora local; sin añadirle la `Z` la antigüedad sale desfasada
  las 6 h del huso y el aviso nunca salta.
- **HUMIDEX** aparece sólo con 20 °C o más, porque el receiver no lo calcula por
  debajo (§4). Sin valor vivo la celda muestra el **máximo del día** en blanco con el
  rótulo «MÁXIMO», igual que SOLAR y UV de noche; el `--` queda sólo para cuando el día
  todavía no ha llegado a 20 °C.

**Los tres derivados son TRES CELDAS**, no una con tres columnas, y el motivo es el
humidex: al ser un ÍNDICE le toca su riel de escala como a UV y al IMECA, y un riel dentro
de una celda compartida se leería como si midiera las tres cifras. Estructura y cuerpos
copiados de la fila SOLAR/UV/IMECA —rótulo 16, cifra 38, renglón de apoyo y riel al pie—
así que las dos filas de tres celdas de la consola pesan igual. Cada celda mide (342−6)/3 =
112 px, o sea 100 de interior, donde el caso peor («SENSACIÓN», ~70 px) entra.

En el HUMIDEX, el **número toma el color de su tramo** —no el naranja de la temperatura que
heredaba de la clase `gt`— y debajo va el **nivel en palabras**, con los cortes de
Environment Canada (`humidexLabel` en `weather.ts`, compartido con la tarjeta de la web para
que no puedan divergir): hasta 29 confort, 30-39 incómodo, 40-45 muy incómodo, 46+ peligro y
54+ extremo. Color, palabra y banda encendida del riel salen de los mismos cortes, así que
no pueden contradecirse. El riel llega a 60 aunque el índice no exista por debajo de 20:
arranca en 0 como todos los demás, y uno que empezara en 20 mentiría sobre lo que significa
«vacío».

ROCÍO y SENSACIÓN llevan el **rótulo arriba** —los tres de la fila caen en la misma línea— y
el **valor centrado** en el hueco que queda debajo (`margin: auto 0`), que es el que el
humidex gasta en su riel. Centrar la celda entera bajaba también el rótulo.

**Dos tipografías**, las dos de la familia DSEG (OFL) en `dashboard/public/fonts/`:
**DSEG7** de siete segmentos para las cifras y **DSEG14** de catorce para el rumbo
del viento. Hacen falta las dos porque con siete segmentos la `N` y la `O` salen a
media altura y la `S` sin la barra de arriba, así que `OSO` se leía «oSo». Las dos van
**sin modificar**: su licencia reserva el nombre «DSEG» y la OFL 1.1 prohíbe que una
versión modificada lo conserve, de modo que subconjuntarlas obligaría a renombrarlas.
Detalle en el `README.md` de esa carpeta.

> **Ojo con las clases de glow** (`.gt .gh .gp .gr .gv .gy`): además del color
> arrastran `font-family: DSEG7`, así que aplicadas a texto con letras lo deforman.
> Para texto, `.seg14` o color inline.

### LilyGo e-paper 4.7"

Un **display e-paper de 4.7"** que vive en **deep sleep**: despierta, pide una vez
y se vuelve a dormir. Al revés que el kiosco, **dibuja él mismo** sus 11+ pantallas,
así que el servidor no le manda imagen sino dato.

El truco está en `GET /api/epaper/forecast.json` (`services/epaper.py`): sirve el
dato **real de la estación** con la forma de **WeatherAPI `forecast.json`**, que es
justo lo que el `DecodeWeatherAPI()` del firmware ya sabía parsear. Así el display
**cambia de fuente sin tocar una línea de su dibujado** —pantallas, táctil y deep
sleep se quedan igual— y puede volver a WeatherAPI.com como respaldo cambiando sólo
la URL. Es el mismo patrón de `svitrix.py`, que cubre `current.json` para el reloj,
y de hecho reusa su `build_weatherapi()` para el bloque `current`. Encima añade:

- `forecast.forecastday[]` de **tres días con sus 24 horas**, que el e-paper
  necesita para sus gráficas.
- `astro` calculado con **pyephem** para las coordenadas exactas del sitio.
- un bloque **`xe1e{}`** con lo que WeatherAPI no puede dar: radiación solar, lluvia
  del evento, IMECA, los **máximos medidos** del día y la tendencia real de presión.

> **Este endpoint nunca devuelve 503**, al contrario que `/api/svitrix`. El e-paper
> pide una sola vez por ciclo, así que un error no se reintenta: lo dejaría con la
> pantalla vieja hasta el siguiente despertar. Si falta el dato de la estación se cae
> al pronóstico de la hora en curso y lo marca en `xe1e.source`; y cada fuente externa
> se pide con tolerancia a fallos, porque que se caiga WAQI o el IMECA no puede costar
> la pantalla entera.

El texto va en español porque el firmware se configura con `Language = "es"`, igual
que devolvería WeatherAPI con `lang=es`; los códigos WMO de Open-Meteo se traducen a
condición de WeatherAPI en una tabla que cubre **todos** los casos del `switch` del
firmware —importa, porque su caso por omisión dibuja «nublado» y un código no
contemplado pasaría desapercibido—.

### SVITRIX-XE1E (Ulanzi TC001)

Firmware personalizado para el **reloj píxel Ulanzi TC001** (matriz LED 32×8).
Muestra el clima de la estación en apps rotativas con iconos animados:

<p align="center">
  <img src="images/ulanzi-hora.jpg" alt="Ulanzi TC001: app de hora" width="400"/>
  <img src="images/ulanzi-temp.jpg" alt="Ulanzi TC001: temperatura exterior de la estación" width="400"/>
</p>
<p align="center">
  <em>El reloj rotando entre sus apps: la hora y la temperatura exterior de la estación</em>
</p>

- **Apps de clima:** temperatura exterior, humedad, presión, calidad del aire,
  UV, viento, radiación solar y precipitación.
- **Apps nativas:** hora (varios modos), fecha, fase lunar, temperatura/humedad
  interna, batería.
- **Efectos:** overlays de lluvia, nieve, tormenta; 20+ efectos de fondo.
- **Integración:** API HTTP/MQTT, auto-discovery en Home Assistant, notificaciones push.

El servidor expone `/api/svitrix` con los datos en el formato que espera el reloj;
el Ulanzi lo consulta cada 1–5 minutos. Flasher en línea, interfaz web de
configuración y OTA. Firmware y documentación:
[svitrix-firmware-XE1E](https://github.com/XE1E/svitrix-firmware-XE1E).

---

## 8. Impresión 3D

Piezas imprimibles en 3D para complementar la estación y proteger los sensores en
instalaciones exteriores.

### Escudo de radiación para sensores (Radiation Shield)

Un **escudo de radiación** imprimible en 3D diseñado para proteger sensores de
temperatura y humedad Ecowitt (**WN31**, **WN32**, **WN35**) de la radiación solar
directa. Ideal para **estaciones remotas** donde el sensor se instala a la intemperie.

| Aspecto | Detalle |
|---------|---------|
| **Función** | Protege el sensor del calor radiante del sol para obtener lecturas más precisas de temperatura y humedad ambiental |
| **Compatibilidad** | Sensores Ecowitt **WN31**, **WN32** y **WN35** |
| **Material recomendado** | PETG o ASA (resistentes a UV y temperatura); blanco o color claro para máxima reflexión |
| **Diseño** | Múltiples lamas horizontales que permiten la circulación de aire mientras bloquean la radiación directa |

**Descargar:** los archivos STL están disponibles en
[Printables](https://www.printables.com/model/1616544-ecowitt-sensor-radiation-shield)
y en la carpeta [`3d-prints/radiation-shield/`](../3d-prints/radiation-shield/) del
repositorio.

> **Tip:** para una estación remota con un **GW1100** y un sensor **WN32** a la
> intemperie, este escudo es esencial para evitar lecturas de temperatura infladas
> por el sol.

---

## 9. Panel de administración (`/admin`)

### Capturas de pantalla

<details>
<summary><strong>Ver las 9 páginas del panel de admin</strong></summary>

#### Dashboard
![Dashboard](capturas/admin-01-dashboard.png)

#### Estaciones
![Estaciones](capturas/admin-02-estaciones.png)

#### Alertas
![Alertas](capturas/admin-03-alertas.png)

#### Calibración
![Calibración](capturas/admin-04-calibracion.png)

#### Publicación
![Publicación](capturas/admin-05-publicacion.png)

#### Notificaciones
![Notificaciones](capturas/admin-06-notificaciones.png)

#### Integraciones
![Integraciones](capturas/admin-07-integraciones.png)

#### Sistema
![Sistema](capturas/admin-08-sistema.png)

#### Wizard de configuración
![Wizard](capturas/admin-09-wizard.png)

</details>

Acceso **usuario/contraseña** (sesión de 12 h). Diseño compacto en columnas.
Permite **editar en caliente** (sin reiniciar) todo lo configurable.

### Wizard de configuración inicial

La primera vez que se accede al panel, un **asistente de 5 pasos** guía la
configuración:
1. **Bienvenida** — introducción al panel
2. **Estación** — verifica sensores, ubicación y zona horaria
3. **Alertas** — configura **Telegram** y **correo SMTP** (ambos con botón
   «Probar» para validar las credenciales antes de guardar)
4. **Publicación** — activa las redes públicas (WU, Windy, etc.)
5. **Resumen** — muestra lo configurado y finaliza

El wizard puede saltarse y reaccederse más tarde si es necesario.

### Páginas del panel

| Página | Qué configura |
|--------|---------------|
| **Dashboard** | Vista general con **indicador en tiempo real**, **tiles de resumen** (última lectura, uptime, retención, versión), **historial de alertas** de 24 h, **resumen de batería** por estación y **tarjeta «Endpoint Ecowitt»** (URL de push con copiar). Botón **«Probar conexiones»** (Telegram, correo y MQTT de una). Estado de servicios agrupado en **Notificaciones** (InfluxDB, Telegram, Correo) e **Integraciones** (MQTT, WAQI, Seguridad endpoint), cada grupo con enlace «Configurar» |
| **Estaciones** | Lista de estaciones detectadas con estado (online/offline), última lectura y sensores. **«+ Agregar estación»** crea estaciones secundarias (nombre + passkey opcional que se autodetecta). Las secundarias pueden **eliminarse** (con confirmación). Cada fila enlaza a su configuración individual |
| **Configuración por estación** | Nombre/etiqueta, **watchdog** (activar/desactivar y timeout en minutos). **Servicios individuales**: activar alertas, publicación a redes y MQTT **por estación** (secundarias por defecto solo almacenan datos). **Sensores WN31** con nombres personalizados (ej. «Sala», «Recámara»). En secundarias, opción **«a la intemperie»**: trata el sensor integrado (que reporta como *interior*) como **exterior** en todo el sistema (alertas, calibración, página remota, publicación) |
| **Alertas** | Toggle global y por tipo. Umbrales configurables **por estación** con selector. En la **principal (WS69)**: temp alta/baja, humedad alta/baja, viento/ráfaga, lluvia tasa/diaria, presión alta/baja, UV alto, radiación solar alta, punto de rocío alto/bajo, sensación térmica alta/baja, **tendencias** (temp y presión subiendo/bajando), más batería baja, sensor perdido, estación offline y calidad del aire (AQI/IMECA). En **secundarias (GW1100)** aplican **temperatura**, **humedad**, **presión**, **punto de rocío**, **tendencias** y **«offline después de»** (watchdog propio); viento, lluvia, UV y radiación no aplican (son del WS69). Indica estado de **Telegram** y **Correo** |
| **Calibración** | Toggle global y **por estación** con selector. Offsets: temp (°C), humedad (%), presión (hPa); multiplicadores de viento, lluvia, solar y UV (factor). En **secundarias (GW1100)** solo aparece lo aplicable: **sensor integrado** (temp/humedad, etiquetado *Exterior* o *Interior* según el «a la intemperie») + **presión** (sin viento/lluvia/solar/UV ni canales WN31) |
| **Publicación** | Credenciales de redes públicas: Weather Underground, PWSWeather, Windy, OpenWeatherMap, CWOP/APRS y **AWEKAS**. Cada red con **intervalo de envío** propio (min; CWOP 10–15; `0` = cada dato) y **badge de estado** (Configurado / Falta configurar) |
| **Notificaciones** | Dos canales: **Telegram** (Bot Token + Chat ID) y **Correo (SMTP)** (servidor, puerto, usuario, contraseña, remitente, destinatarios, STARTTLS). **Selección por canal** de qué categorías de alerta recibe cada uno. Botón **«Enviar prueba»** por canal, validación de canal incompleto y ojo mostrar/ocultar en secretos |
| **Integraciones** | **MQTT/Home Assistant**: broker, puerto, topic, auth, auto-discovery. **Indicador de conexión**, **«Probar conexión»** y **«Reconectar»**. **WAQI**: token API. **🔒 Seguridad del endpoint**: token secreto (`/data/report/?token=…`) y allowlist de IP (desactivado por defecto) |
| **Sistema** | Info (versión, estaciones, última lectura, InfluxDB). Control de calidad (QC habilitado, filtro de picos). **Visor de logs** con filtros por nivel (todos/warning/error) y refresco en tiempo real. Enlaces útiles y stack |

Los **tokens/claves se muestran enmascarados** (últimos 4 caracteres) y si se
dejan **en blanco al guardar, se conservan**. Los ajustes se guardan en
`/data/settings.json` y se aplican al instante; al reiniciar se recargan.

Si `ADMIN_USER`/`ADMIN_PASSWORD` están vacíos, el panel queda **deshabilitado**.

---

## 10. Alertas y notificaciones

Se evalúan en cada lectura y avisan **una vez al activarse** y otra **al
normalizarse** (no spamean). Canales: **Telegram** y/o **correo (SMTP)**, con
**selección por canal** de qué categorías recibe cada uno; si ninguno está
configurado, van al log. Los umbrales se configuran **por estación**: la
principal (WS69) y cada secundaria (que se activa de forma independiente, opt-in).

### Estación principal (WS69)

| Alerta | Se dispara cuando… |
|--------|--------------------|
| Temp alta / baja | temp ≥/≤ umbral |
| Humedad alta / baja | humedad ≥/≤ umbral |
| Viento fuerte | viento sostenido ≥ umbral |
| Ráfaga fuerte | ráfaga ≥ umbral |
| Lluvia intensa | tasa de lluvia ≥ umbral |
| Lluvia diaria alta | acumulado del día ≥ umbral |
| Presión alta / baja | presión ≥/≤ umbral |
| UV alto | índice UV ≥ umbral |
| Radiación solar alta | radiación ≥ umbral W/m² |
| Punto de rocío alto / bajo | punto de rocío ≥/≤ umbral |
| Sensación térmica alta / baja | sensación ≥/≤ umbral |
| Tendencia temp (subiendo/bajando) | cambio de temp dentro de la ventana ≥ umbral (2 niveles: aviso / fuerte) |
| Tendencia presión (subiendo/bajando) | cambio de presión dentro de la ventana ≥ umbral (2 niveles: aviso / fuerte) |
| **Estación caída** | no llegan datos en N minutos |
| **Batería baja** | un sensor (WN31/WS69/consola) reporta batería baja |
| **Sensor perdido** | un sensor visto antes deja de reportar (se normaliza al volver) |
| **Calidad del aire** | el AQI o el IMECA superan su umbral (se revisa cada ~30 min) |
| **Sismos** | magnitud ≥ umbral (default 6.0), cercanos a la estación (≤ 800 km); fuente SSN/USGS |

### Estación remota (GW1100)

| Alerta | Se dispara cuando… |
|--------|--------------------|
| Temp alta / baja | temp ≥/≤ umbral |
| Humedad alta / baja | humedad ≥/≤ umbral |
| Presión alta / baja | presión ≥/≤ umbral |
| Punto de rocío alto / bajo | punto de rocío ≥/≤ umbral |
| Tendencia temp (subiendo/bajando) | cambio de temp dentro de la ventana ≥ umbral (2 niveles: aviso / fuerte) |
| Tendencia presión (subiendo/bajando) | cambio de presión dentro de la ventana ≥ umbral (2 niveles: aviso / fuerte) |
| **Estación caída** | no llegan datos en N minutos (watchdog propio) |

**Telegram:** se crea un bot con @BotFather, se obtiene el `chat_id` y se pega
token + chat id en el panel (o en `.env`).

---

## 11. Publicación a redes públicas

El servidor reenvía cada lectura (de forma tolerante a fallos) a las redes que
se activen, con sus credenciales, desde el panel:

| Red | Aporta / recibe |
|-----|-----------------|
| **Weather Underground** | mayor audiencia, página propia, histórico, apps |
| **Windy.com** | visibilidad en el mapa |
| **PWSWeather** | respaldo, ecosistema Aeris |
| **OpenWeatherMap** | acceso a su API a cambio |
| **CWOP / APRS** | entra a MADIS → modelos de NOAA (mayor aporte científico) |
| **AWEKAS** | red europea con mapa interactivo y estadísticas |

Filosofía: aportar a todas las útiles. Cada red usa sus unidades; el servidor
convierte según el protocolo de cada una.

Cada red tiene un **intervalo de envío** configurable en minutos (CWOP recomienda
10–15 min; `0` = reenviar en cada dato recibido, ~60 s). Así se respeta el ritmo
sugerido por cada red aunque la estación reporte cada minuto.

> Seguridad del endpoint de entrada (`/data/report/`) y su configuración completa:
> ver **[ENDPOINT-ECOWITT.md](ENDPOINT-ECOWITT.md)**.

---

## 11½. Sistema de pronóstico

El sistema combina **múltiples fuentes** de pronóstico para mayor precisión y fiabilidad,
siguiendo el principio de que el **dato real de la estación tiene prioridad** sobre cualquier
modelo externo.

### Fuentes de pronóstico

| Fuente | Qué aporta | Archivo |
|--------|------------|---------|
| **Estación local** | Condición REAL ahora (lluvia, radiación solar → nubosidad) | — |
| **Tendencia de presión** | Alerta de tormenta inminente (0-3h), método Zambretti | `forecaster.py` |
| **Open-Meteo** | Pronóstico horario gratuito (1-7 días), códigos WMO | `openmeteo.py` |
| **WeatherAPI** | Más preciso para ciudades grandes (1-3 días), requiere API key | `weatherapi.py` |
| **SMN (CONAGUA)** | Pronóstico oficial por municipio (4 días + 48h) | `smn.py` |

### Arquitectura del consenso (`forecast_consensus.py`)

El sistema de **consenso** combina todas las fuentes con esta lógica de prioridad:

```
1. ¿Está lloviendo según la estación? → "Lloviendo" (dato REAL, no pronóstico)
2. ¿Hay radiación solar? → Nubosidad REAL por índice de claridad
3. ¿La presión indica tormenta inminente? → "Tormenta cercana"
4. Si no hay dato local → Usar pronóstico promediado
```

**Principios clave:**
- La estación local tiene **prioridad absoluta** si hay precipitación (el pluviómetro es dato real)
- El **índice de claridad** (radiación medida ÷ teórica) determina nubosidad real de día
- La **tendencia de presión** detecta tormentas ANTES de que lleguen (caída de presión)
- Cuando Open-Meteo y WeatherAPI difieren, se usa el **promedio de severidad** (no el peor caso)

### Pronóstico local por presión (`forecaster.py`)

Método clásico del barómetro (base Zambretti): la presión a nivel del mar y su **tendencia
en las últimas 3 horas** anticipan el tiempo a corto plazo:

| Cambio 3h (hPa) | Tendencia | Pronóstico |
|-----------------|-----------|------------|
| ≤ -7 | Cayendo muy rápido | Tormenta inminente (0-1h) |
| -7 a -5 | Cayendo rápido | Lluvia probable en 1-2h |
| -5 a -3 | Bajando | Posible lluvia en 2-4h |
| -3 a +3 | Estable | Sin cambios esperados |
| +3 a +5 | Subiendo | Tiempo mejorando |
| > +5 | Subiendo rápido | Cielos despejando |

#### Umbrales de presión calibrados para CDMX

Los umbrales estándar del método Zambretti (alta ≥1022, normal ≥1009 hPa) **no aplican**
para la Ciudad de México porque el promedio local ya supera el umbral "alto" estándar.

Se calibraron umbrales locales basados en **90 días de histórico** de la estación:

| Estadística | Valor (hPa) |
|-------------|-------------|
| Mínimo | 999.1 |
| **Promedio** | **1027.1** |
| Máximo | 1035.6 |
| Percentil 10 | 1024.1 |
| Percentil 90 | 1029.7 |

**Umbrales calibrados (CDMX, ~2240 m):**

| Nivel | Umbral | Criterio |
|-------|--------|----------|
| **Alta** | ≥ 1030 hPa | Por encima del P90 |
| **Normal** | 1024-1029 hPa | Rango típico (P10-P90) |
| **Baja** | < 1024 hPa | Por debajo del P10 |

Estos umbrales se recalibrarán con más histórico (idealmente 1 año completo para capturar
variación estacional). Última calibración: 2026-08-11.

**Endpoint:** `GET /api/forecast/local`

### Open-Meteo (`openmeteo.py`)

Pronóstico horario y diario gratuito, sin API key. Se cachea 15 min en el servidor con
fallback a copia stale si el origen no responde.

**Campos obtenidos:**
- Diarios: `weather_code`, `temp_max/min`, `precip_probability`, `precip_sum`, `wind`, `sunrise/sunset`
- Horarios: `weather_code`, `temp`, `precip_probability` (+ campos extras para e-paper)

**Códigos WMO:** Open-Meteo usa códigos WMO estándar (0=despejado, 3=nublado, 61-65=lluvia,
95-99=tormenta). Ver `_WMO_SEVERITY` en `forecast_consensus.py` para la tabla completa.

**Endpoint:** `GET /api/forecast?lat=&lon=`

### WeatherAPI (`weatherapi.py`)

Complemento de Open-Meteo con mejor precisión para ciudades grandes. Requiere API key
gratuita (1M llamadas/mes). Los códigos propios se convierten a WMO para unificar
(`_WEATHERAPI_TO_WMO`).

**Normalización:** la respuesta se transforma al formato Open-Meteo para que el frontend
pueda usar cualquiera de las dos fuentes sin cambios.

**Endpoint:** (interno, se usa solo para el consenso)

### Consenso combinado (`forecast_consensus.py`)

**Endpoint:** `GET /api/forecast/consensus`

Combina todas las fuentes y devuelve:

```json
{
  "current": {
    "code": 2,
    "label": "Parcialmente nublado",
    "source": "station",
    "rain_now": false,
    "storm_approaching": false,
    "clearness_index": 0.58
  },
  "pressure": {
    "trend": "stable",
    "delta_3h": -0.8,
    "storm_likely": false,
    "confidence": "medium",
    "message": "Presión estable..."
  },
  "hourly": [...],  // 48 horas, promedio de fuentes
  "daily": [...],   // 7 días
  "alerts": [...],  // Alertas generadas
  "sources": ["pressure", "open-meteo", "weatherapi"]
}
```

**Fusión de pronósticos horarios:**
- Se usa Open-Meteo como base y se enriquece con WeatherAPI
- Cuando ambos difieren, se calcula el **promedio de severidad** (evita sesgo pesimista)
- Probabilidad de precipitación: promedio de ambas fuentes
- Temperatura: promedio si ambas disponibles

### Caché y resiliencia

Todos los servicios de pronóstico siguen el patrón de **caché con fallback**:

1. Si hay copia en caché y no expiró (15 min) → se sirve
2. Se intenta obtener dato fresco del origen
3. Si falla pero hay copia expirada → se sirve marcada como `stale: true`
4. Si no hay copia → error (solo `/api/epaper/forecast.json` nunca da 503)

El campo `stale` permite al frontend mostrar advertencia de dato viejo.

### Integración con displays

| Display | Endpoint | Formato |
|---------|----------|---------|
| Dashboard web | `/api/forecast`, `/api/forecast/consensus` | JSON propio |
| E-paper LilyGo | `/api/epaper/forecast.json` | WeatherAPI `forecast.json` |
| Ulanzi TC001 | `/api/svitrix` | WeatherAPI `current.json` |

El endpoint e-paper **nunca devuelve 503**: si falta dato cae al pronóstico y lo marca en
`xe1e.source`, porque el display despierta, pide una vez y se vuelve a dormir.

---

## 12. Fuentes de datos externas

| Fuente | Qué aporta | Frecuencia / caché |
|--------|-----------|--------------------|
| **Estación Ecowitt** (push) | todo el dato local (real) | ~16–60 s |
| **Open-Meteo** | pronóstico horario/diario y astronomía base | 30 min |
| **SMN / CONAGUA** | pronóstico **oficial por municipio** (4 días + 48 h), cualquier municipio de México | 30 min (SMN publica c/hora) |
| **Ventusky** | radar y mapas interactivos | en vivo (iframe) |
| **NASA GIBS** | imagen satelital de color real | diaria |
| **aviationweather.gov** (NOAA) | METAR y TAF (aeropuertos) | 10 min |
| **WAQI / aqicn** | calidad del aire (AQI) | 10 min |
| **Open-Meteo Air Quality** (CAMS) | concentraciones → IMECA estimado | 30 min |
| **USGS / SSN** | sismos recientes cercanos | 10 min |
| **pyephem** (local) | almanaque: crepúsculos, luna, planetas | 10 min |
| **InfluxDB** (propio) | histórico, estadísticas, climatología | consultas en vivo |

---

## 13. API (endpoints)

Todos bajo el receiver, servidos vía `/api/*`:

| Endpoint | Devuelve |
|----------|----------|
| `GET /api/current` | última lectura. Además de lo que manda la estación añade, calculados al servir: los acumulados de lluvia semanal/mensual/anual que falten y `wind_speed_avg10m`, el promedio de viento de 10 min (la estación no manda ninguno) |
| `GET /api/history?start=-24h` | histórico crudo |
| `GET /api/stats/daily` | mín/máx/prom del día |
| `GET /api/stats/records?start=-30d` | mín/máx/prom del rango |
| `GET /api/compare` | 24 h vs 24 h previas ("vs ayer") |
| `GET /api/forecast/local` | pronóstico por tendencia barométrica |
| `GET /api/forecast` | pronóstico Open-Meteo con caché |
| `GET /api/smn` · `GET /api/smn/municipios` | pronóstico oficial SMN por municipio (4 días + 48 h) y lista de municipios |
| `GET /api/climate/records` | récords (siempre, por mes, este mes/año, ayer) |
| `GET /api/climate/onthisday` | efeméride: mismo día en años previos |
| `GET /api/climate/noaa?year=&month=` | reporte NOAA mensual/anual |
| `GET /api/wind/rose?start=-7d` | rosa de vientos (16 sectores) |
| `GET /api/rain/daily?days=7` | lluvia por día **local** de los últimos N días (histograma de la consola). Un día sin resumen devuelve `null`, no `0`; el día en curso se completa con el acumulado vivo, porque su resumen no se cierra hasta la medianoche |
| `GET /api/rain/last` | fecha/hora de la última lluvia registrada |
| `GET /api/almanac` | almanaque astronómico |
| `GET /api/alerts` | alertas activas |
| `GET /api/metar?station=` · `GET /api/taf?station=` | METAR y TAF de un aeropuerto |
| `GET /api/airquality` · `GET /api/airquality/imeca` | AQI e IMECA estimado (+ pronóstico) |
| `GET /api/satellite` | imagen satelital NASA GIBS (proxy) |
| `GET /api/earthquakes` | sismos recientes (USGS / SSN) |
| `GET /api/svitrix` | datos para SVITRIX-XE1E (Ulanzi TC001), con forma WeatherAPI `current.json` |
| `GET /api/epaper/forecast.json` | datos para el e-paper LilyGo, con forma WeatherAPI `forecast.json` (3 días × 24 h + bloque `xe1e`). **Nunca devuelve 503** |
| `GET /api/display.jpg?page=N` | imagen JPEG para pantalla Waveshare (la sirve el contenedor `renderer`) |
| `POST /api/kiosk/local` · `GET /api/kiosk/local` | recibe y devuelve las lecturas del BME280 de la pantalla Waveshare |
| `POST /api/camera/upload` · `GET /api/camera/latest.jpg` · `status` · `days` | cámara del exterior (ver §7) |
| `POST /api/admin/login` · `GET/POST /api/admin/settings` · `GET /api/admin/status` | administración |
| `POST /data/report/` | **entrada** del push de la estación (Ecowitt) |

**Multi-estación:** `/api/current`, `/api/history` y `/api/stats/daily` aceptan
`?station=<nombre>` (p. ej. `gw1100`) para consultar una **estación secundaria**;
sin el parámetro devuelven la **principal**. Las secundarias se configuran en
`SECONDARY_STATIONS` del `.env` con el formato `passkey:nombre`.

---

## 14. Operación y mantenimiento

**Servidor:** VPS Oracle ARM, cuenta **PAYG** (para evitar recuperación por
inactividad de la capa gratuita). Dominio `clima.xe1e.net` tras Cloudflare.

**Desplegar / actualizar:**
```bash
cd ~/ecowitt-weather-server-xe1e
git pull
docker compose up -d --build      # --build cuando cambian dependencias o imágenes
docker compose ps                 # verificar estado
```

**Grafana (opcional):** el `docker-compose.yml` trae un Grafana ya apuntado a
InfluxDB, **apagado por defecto** tras el perfil `grafana`. No hace falta para
nada del sitio —es para hurgar en el dato crudo cuando algo no cuadra—, y por eso
queda **fuera del reverse proxy**: publica el 3000 del VPS, que el cortafuegos no
abre, así que se llega por **túnel SSH** (igual que al admin de InfluxDB):
`ssh -L 3000:localhost:3000 …`.

```bash
docker compose --profile grafana up -d    # credenciales: GRAFANA_ADMIN_* del .env
```

**Configuración inicial (`.env`):** credenciales de InfluxDB, `ADMIN_USER` /
`ADMIN_PASSWORD`, `WEB_PORT`, TZ. El resto (alertas, QC, calibración, tokens,
redes) es preferible dejarlo por defecto y ajustarlo desde el panel.

**Backups:** respaldos periódicos del volumen de InfluxDB, con copia externa a
**Cloudflare R2** (ver `docs/backups-r2.md`). **Uptime:** monitor externo de
disponibilidad (ver `uptime-worker/`).

**Persistencia:** los ajustes del panel viven en el volumen `receiver-data`
(`/data/settings.json`), así que sobreviven a reinicios y reconstrucciones.

**Estación en operación:** el WS2910 está **instalado y enviando datos reales**
desde ~2026-07-19. La consola apunta a `clima.xe1e.net`, ruta `/data/report/`
(*Weather Services → Customized → Ecowitt*), y las lecturas reales se ven en
`/api/current` y en la web.

---

## 15. Glosario de términos e índices

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

## 16. Estado y pendientes

**Pendiente:** versión en inglés (i18n) y acciones del usuario (crear bot de
Telegram, credenciales de las redes públicas).

> Notas de estudio y planeación (exploratorias) quedan archivadas en `docs/archivo/`.

---

*Última actualización: 2026-08-18.*
