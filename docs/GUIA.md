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
- **Pantalla física:** también hay una **pantalla ESP32-S3 Waveshare** que muestra
  las condiciones en tiempo real.

---

## 2. Hardware

Kit **Ecowitt WS2910** + sensor **WS69** + termohigrómetros **WN31**.

| Equipo | Qué es | Qué mide / hace |
|--------|--------|-----------------|
| **Consola WS2910** | Pantalla + puente Wi-Fi | Presión (barómetro interno), temp/humedad interior; **envía todos los datos** al servidor por Wi-Fi (protocolo Ecowitt) |
| **WS69 (7-en-1)** | Sensor exterior integrado | Temperatura y humedad exterior, velocidad y dirección del viento, ráfaga, lluvia (tasa/evento/día/…), radiación solar e índice UV |
| **WN31 (×8)** | Termohigrómetros de canal | Temperatura y humedad en hasta **8 canales** independientes (habitaciones, exterior secundario, etc.) |
| **GW1100** *(estación remota, opcional)* | Gateway Wi-Fi Ecowitt | **Estación secundaria**: envía al mismo servidor; sus lecturas se guardan **aparte** y se ven en su propia página (solo lectura). Por defecto solo almacena datos, pero puede **disparar alertas propias** (y publicar/MQTT) activándolas **por estación** (ver §6) |

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

Todos los ajustes (calibración, QC, alertas, tokens, redes) se editan **en
caliente** desde el panel de administración, sin reiniciar (ver §6).

---

## 5. La página web (`/pro`)

> **El recorrido página por página vive en el manual de usuario**, no aquí:
> [`dashboard/public/guia.html`](../dashboard/public/guia.html) — publicado en
> <https://clima.xe1e.net/guia.html>. Ahí está qué es cada pestaña, qué muestra
> cada tarjeta y **cómo se interpreta** cada dato, en lenguaje para cualquiera.
> Este documento no lo repite: se quedó con lo técnico.

Lo que sí corresponde a este documento:

- **Rutas.** La SPA sirve la vista moderna en `/pro` (layout `StationLayout`, 14
  pestañas) y la clásica de una sola página en `/`. El panel vive en `/admin`, el
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
muestran el clima en tiempo real sin necesidad de abrir un navegador.

### Waveshare ESP32-S3 (pantalla táctil 7")

Una **pantalla táctil de 1024×600** basada en **ESP32-S3** que actúa como
«display tonto»: el servidor renderiza cada pantalla en headless Chromium y la
sirve como JPEG (`GET /api/display.jpg?page=N`); el ESP32 solo la baja y la
pinta. Se navega tocando la **barra inferior de 6 pestañas**.

| Página | `?page=` | Contenido | Fuente en el repo |
|--------|----------|-----------|-------------------|
| 1 | `1` | Estación: temperatura, tiles de resumen, pronóstico de 6 h | `KioskPage.tsx` |
| 2 | `2` | Sensor local BME280 del propio display, con mín/máx del día | `KioskPage.tsx` · `/api/kiosk/local` |
| 3 | `3` | Sensores: interior, jardín (CH1) y remota GW1100 | `KioskPage.tsx` |
| 4 | `4` | Pronóstico de 7 días | `KioskPage.tsx` |
| 5 | `5` | Resumen multivariable de 48 h (temp, presión, lluvia, viento, humedad) | `MultiVariableChart` en modo `2day` + `kiosk` |
| 6 | `consola` | Réplica de la consola física Ecowitt, pantalla completa sin barra | `ConsoleReplica` en modo `kiosk` |

> El **orden y el número** de pestañas deben coincidir con `NUM_PAGES` del
> firmware, que mapea el toque en la franja inferior a la página según la X.
> Página N → `TABS[N-1]` en `KioskPage.tsx`. La página 6 es full-screen y un
> toque en cualquier parte regresa a la 1.

La página 5 y la 6 **reusan componentes del dashboard** (`MultiVariableChart` y
`ConsoleReplica`), no copias: cualquier mejora que se les haga en la web llega
sola al display. `ConsoleReplica` es además la misma vista del tab
[Consola](#5-la-página-web-pro) (`/pro/consola`), con un prop `mode` como única
diferencia.

El display tiene un **BME280 integrado** que envía sus lecturas al servidor
(`POST /api/kiosk/local`), mostrándolas en la página 2; los mín/máx del día se
persisten en `/data/kiosk_local.json` para sobrevivir reinicios del contenedor.
Configuración WiFi por portal cautivo (*WiFiManager*). Firmware y documentación:
[ecowitt-display-kiosk-xe1e](https://github.com/XE1E/ecowitt-display-kiosk-xe1e).

### SVITRIX-XE1E (Ulanzi TC001)

Firmware personalizado para el **reloj píxel Ulanzi TC001** (matriz LED 32×8).
Muestra el clima de la estación en apps rotativas con iconos animados:

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
| `GET /api/current` | última lectura |
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
| `GET /api/almanac` | almanaque astronómico |
| `GET /api/alerts` | alertas activas |
| `GET /api/metar?station=` · `GET /api/taf?station=` | METAR y TAF de un aeropuerto |
| `GET /api/airquality` · `GET /api/airquality/imeca` | AQI e IMECA estimado (+ pronóstico) |
| `GET /api/satellite` | imagen satelital NASA GIBS (proxy) |
| `GET /api/earthquakes` | sismos recientes (USGS / SSN) |
| `GET /api/svitrix` | datos para SVITRIX-XE1E (Ulanzi TC001) |
| `GET /api/display.jpg?page=N` | imagen JPEG para pantalla Waveshare |
| `POST /api/kiosk/local` | recibe lecturas del BME280 de la pantalla Waveshare |
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

*Última actualización: 2026-08-01.*
