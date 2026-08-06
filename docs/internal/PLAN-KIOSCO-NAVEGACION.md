# Plan — Navegación del kiosco: la consola como índice

> Escrito el 2026-08-06. Vive en git. Cruza dos repos: **servidor**
> `ecowitt-weather-server-xe1e` (dibuja las páginas) y **firmware**
> `ecowitt-display-kiosk-xe1e` (las muestra y lee el toque).
>
> **Estado: fase 1 empezada.** Ver *Avance* al final.

## Objetivo

Que la **consola sea el índice** de la estación. Tocas la celda de la lluvia y sale el
histórico de lluvia; desde ahí cambias de periodo o saltas a los récords; tocas fuera de
un botón y vuelves, pantalla a pantalla, hasta la consola.

Hoy el display arranca en la consola y un toque en cualquier parte salta a la página 1.
Las otras cinco se navegan con una barra de seis pestañas que el servidor dibuja y el
firmware mapea por la X del toque.

## El problema de fondo

No es dibujar pantallas nuevas: es que **hoy el firmware tiene que saber qué páginas
existen**. El número de pestañas está cableado en `src/config.h` y tiene que coincidir con
el array `TABS` del dashboard. Está documentado como contrato manual en los dos repos:

> *El nº de pestañas de la barra (servidor) DEBE coincidir con el mapeo del touch
> (firmware). Si se agrega una página hay que tocar ambos lados.*

Con seis pestañas se aguanta. Con un árbol de treinta pantallas, cada ajuste de layout
sería recompilar y reflashear. Y ya hay una segunda víctima esperando: el
[plan de la cámara](PLAN-CAMARA-EXTERIOR.md) daba por hecho que su página sería "la 7ª
pestaña" y que arrastraba firmware — y apuntaba a esta misma salida: *"conviene decidir si
se generaliza el mapeo en el firmware en vez de acumular casos particulares"*.

Este plan mueve ese conocimiento al servidor **una sola vez**. Después, añadir una pantalla
es escribir React y desplegar.

## Decisiones tomadas (2026-08-06)

| # | Decisión | Por qué |
|---|---|---|
| 1 | **Mapa de zonas servido por el servidor** | El firmware se vuelve genérico. Una OTA y no se toca más. |
| 2 | **Las páginas 1-5 se conservan** tal cual | Aunque el árbol nuevo las haga redundantes, la 2 (BME280 del propio display) es única y no tiene equivalente en la web. Cuelgan de un menú. |
| 3 | **Estilo "consola extendida"** | Negro, cifras en DSEG, contorno del color de la variable. Sales de una celda negra y llegas a una pantalla negra: se lee como que la celda se expandió, no como otra aplicación. Además la consola ya está pensada para leerse de lejos; las páginas 1-5 tienen texto de 13-15 px que a dos metros no se lee. |
| 4 | **Botón = acción, resto = atrás** | Es lo que la consola ya hace hoy, y no hay que apuntar fino para volver. |
| 5 | **Plantilla parametrizada** | Una página de detalle `det-<variable>-<periodo>` en vez de una a medida por combinación. |
| 6 | **La cámara entra en el árbol desde ya** | Slug reservado y página que degrada con gracia. Cuando llegue la cámara no habrá que tocar el firmware. |

## Cómo funciona: el contrato `X-Kiosk-Nav`

El renderer ya abre la página en Chromium antes de capturar. Se aprovecha ese momento para
leer del DOM el mapa de zonas y devolverlo **en una cabecera de la misma respuesta**: así
imagen y zonas nunca se desincronizan y el ESP32 no hace una segunda petición.

```
GET /api/display.jpg?page=det-rain-7d

200 OK
Content-Type: image/jpeg
X-Kiosk-Nav: v=1;back=det-rain-24h;ttl=1800;z=0,536,120,64,consola;z=120,536,150,64,det-rain-24h;…
```

Formato plano a propósito, no JSON: al otro lado hay un ESP32 parseando con `strtok`, y
meter un parser de JSON en el firmware para esto sería desproporcionado.

- `v` versión del formato
- `back` a dónde va el toque fuera de zona (sólo respaldo: el firmware lleva su propia
  pila y normalmente hace *pop*)
- `ttl` segundos que vale la imagen
- `z=x,y,w,h,slug` una por zona, hasta 16

### Las zonas se MIDEN, no se escriben

Cada elemento navegable lleva `data-nav="slug"`. Un hook recorre el DOM ya renderizado,
toma el rectángulo real de cada uno con `getBoundingClientRect()` y compone la cadena.

Esto no es comodidad: las coordenadas escritas a mano se desincronizan del layout al primer
retoque, **en silencio** — el botón sigue dibujado, sólo que tocarlo ya no hace nada, y
ningún test lo nota. Midiéndolas, si una celda se mueve su zona se mueve con ella.

Las zonas se ordenan de **menor a mayor área**, porque el firmware se queda con la primera
que contenga el toque: así un botón dentro de un bloque navegable más grande gana al
bloque.

Para verificarlo hay un modo **`?debug=nav`** que dibuja los rectángulos encima de la
propia página. En el display no hay puntero ni hover, y una zona desplazada 20 px no se
nota hasta que alguien toca y no pasa nada.

## El árbol

```
consola  (home, arranque)
├─ celda EXT ──────────────→ det-temp-24h ─┬─ 7 D ─ 30 D ─ AÑO
├─ celda HUMEDAD ──────────→ det-hum-24h   │
├─ celda PRES + riel ──────→ det-press-24h │  (los periodos son botones
├─ celda VIENTO (óvalo) ───→ det-wind-24h  │   de la misma plantilla)
├─ celda LLUVIA ───────────→ det-rain-24h  │
├─ celda ROCÍO/SENS/HUMIDEX → det-temp-24h │
├─ celda SOLAR/UV/ICA ─────→ det-sun-24h   │
├─ celdas INTERIOR · JARDÍN · REMOTA ×2 ──→ det-sens-24h
├─ celda PRESIÓN REMOTA ───→ det-press-24h
├─ celda condición/luna ───→ 4   (pronóstico 7 días, la que ya existe)
└─ celda reloj ────────────→ menu ─→ 1 · 2 · 3 · 4 · 5 · cámara

cualquier detalle ──[RÉCORDS]──→ stats-mes ─┬─ HOY · AÑO · SIEMPRE
```

Siete variables × cuatro periodos + cuatro de estadísticas + menú + cámara = **35 URLs con
tres componentes React**. Añadir una variable es una fila en una tabla.

### Por qué "AÑO" y no "12 meses"

Los resúmenes se agregan por **año calendario** (`/api/climate/noaa?year=`). Una ventana
móvil de doce meses obligaría a pedir dos años y pegarlos a mano para ganar bien poco. Se
rotula "AÑO" para que diga la verdad.

## Anatomía de una pantalla de detalle

```
┌─ LLUVIA · 7 DÍAS ───────────────────────────────── 11:17 ─┐  ← contorno celeste
│  TOTAL            MÁX DÍA          DÍAS CON LLUVIA        │
│  41.6 mm          16.4 mm          4 de 7                 │  ← DSEG, 42 px
│                                                            │
│      ██                                                    │
│      ██        ██              ██                          │  ← gráfica sobre
│      ██   ██   ██   ██         ██                          │     negro
│       V    S    D    L    M    M    J                      │
├────────┬────────┬────────┬────────┬───────────────────────┤
│ ATRÁS  │  24 H  │  7 D   │  30 D  │       RÉCORDS         │  ← barra de 64 px
└────────┴────────┴────────┴────────┴───────────────────────┘
```

- **Cabecera** con la variable y el periodo, en el color de la variable.
- **Tres o cuatro cifras** en DSEG, distintas por variable: lluvia da total / máximo diario
  / días con lluvia; viento da media / ráfaga / rumbo dominante; presión da mínima / máxima
  / variación.
- **Gráfica** sobre negro con la paleta de siempre. Para el viento, la rosa que ya existe.
- **Barra de botones** de 64 px, la misma altura que la barra de pestañas de las páginas
  clásicas, para que el dedo encuentre lo mismo en toda la pantalla. El botón activo se
  marca en el color de la variable y **no es zona** (ya estás ahí).

Los datos salen de endpoints que ya existen: `/api/history`, `/api/stats/records`,
`/api/rain/daily`, `/api/wind/rose`, `/api/climate/records`, `/api/climate/onthisday`,
`/api/climate/noaa`. Hace falta **uno nuevo**, `/api/summaries/daily?days=N`, porque hoy la
serie diaria sólo se puede pedir por mes calendario y "los últimos 30 días" cae a caballo
entre dos; el `storage.query_daily_summaries()` que necesita ya existe y lo usa
`/api/rain/daily`.

## Rendimiento: el límite real es el VPS

Dos vCPU y carga 0.6 con el precalentado actual de seis páginas cada 20 s. **Precalentar 35
no cabe.** Tres medidas, por orden de importancia:

1. **TTL declarado por cada página** (`data-kiosk-ttl`). De 7 días en adelante lo que se
   dibuja son resúmenes diarios, que el rollup escribe una vez al terminar el día:
   redibujar el mensual cada 45 s es quemar CPU para pintar exactamente lo mismo.

   | Pantalla | TTL |
   |---|---|
   | consola, páginas 1 y 3 | 45 s |
   | detalle 24 h, página 5, cámara | 5 min |
   | detalle 7 días, página 4 | 15 min |
   | detalle 30 días, stats del mes | 30 min |
   | detalle AÑO, stats de año/siempre, menú | 1 h |

2. **Precalentado adaptativo**: en vez de recorrer una lista fija, el renderer refresca la
   home y **las tres últimas páginas pedidas**. Se ajusta solo a lo que el display mira.

3. **Sin prefetch por ahora.** El firmware ya pinta un spinner y una página fría cuesta
   ~1.5 s de render más ~300 ms de bajada. Con 2 vCPU, un prefetch agresivo sería
   contraproducente. Queda como palanca si molesta.

Volver es gratis en el caso normal: los dos framebuffers del panel cachean las dos últimas
páginas, así que consola → detalle → consola es un intercambio puro, sin red.

## Qué se toca

### Servidor `ecowitt-weather-server-xe1e`

| Archivo | Qué | Estado |
|---|---|---|
| `dashboard/src/kiosk-nav.ts` | Tabla única: slugs, variables, periodos, TTL, padres, colores | ✅ hecho |
| `dashboard/src/pages/kiosk/nav-zones.tsx` | Medir el DOM, serializar el mapa, overlay `?debug=nav` | ✅ hecho |
| `dashboard/src/components/station/console-css.ts` | El CSS de la consola, extraído para compartirlo | ✅ hecho |
| `dashboard/src/components/station/ConsoleReplica.tsx` | `data-nav` en las celdas | ⏳ 4 de 15 |
| `dashboard/src/pages/kiosk/DetailPage.tsx` | La plantilla (variable × periodo) | ⏳ |
| `dashboard/src/pages/kiosk/StatsPage.tsx` | Las cuatro vistas de estadísticas | ⏳ |
| `dashboard/src/pages/kiosk/MenuPage.tsx` | Menú de las clásicas + cámara | ⏳ |
| `dashboard/src/pages/kiosk/CamaraPage.tsx` | Foto del exterior, degradando con gracia | ⏳ |
| `dashboard/src/pages/KioskPage.tsx` | Enrutar los slugs nuevos | ⏳ |
| `receiver/app/main.py` | `/api/summaries/daily?days=N` | ⏳ |
| `renderer/app.py` | Validar por regex, leer el mapa del DOM y devolverlo en cabecera, TTL por página, precalentado adaptativo | ⏳ |

### Firmware `ecowitt-display-kiosk-xe1e`

| Archivo | Qué |
|---|---|
| `src/net.h` | `collectHeaders({"X-Kiosk-Nav"})` y devolver la cadena junto al JPEG. La página pasa de `int` a cadena. |
| `src/main.cpp` | Parsear zonas; pila de navegación de 8 niveles; toque en zona → destino, fuera → *pop*; contabilidad de los framebuffers por **hash FNV-1a del slug** en vez de por número. |
| `src/config.h` | Fuera `NUM_TABS` y `MAX_PAGE_ID`; `PAGE_HOME` pasa a ser el slug `"consola"`. |
| `src/portal.h` | Ajuste nuevo: **volver solo a la home tras N minutos de inactividad** (0 = desactivado). Un display de pared debe acabar siempre enseñando la consola. |

**Compatibilidad en los dos sentidos**, para no quedarse con un display muerto si un
despliegue va a medias: si la respuesta no trae `X-Kiosk-Nav`, el firmware cae al
comportamiento de hoy; y el servidor sigue sirviendo `?page=1..5|consola` igual que ahora
para un firmware viejo.

## Fases

**Fase 1 — sólo servidor.** Todo lo de la tabla de arriba. El display sigue funcionando
exactamente igual (ignora la cabecera) y las pantallas nuevas se revisan desde el navegador
y con `/api/display.jpg?page=det-rain-7d`. Ningún riesgo sobre lo que ya funciona.

**Fase 2 — firmware.** Zonas, pila, hash de slugs, respaldo, inactividad. OTA desde el
portal, sin cable.

**Fase 3 — pulido y documentación.** Afinar layouts con capturas reales, actualizar
`docs/GUIA.md` §7 y `dashboard/public/guia.html`, cerrar la *decisión 4* de
`PLAN-CONSOLA-XE1E.md` en el repo del firmware (que además tiene el layout de la consola
desactualizado) y corregir la sección de kiosco de `PLAN-CAMARA-EXTERIOR.md`, que da por
hecho un reflasheo que ya no hará falta.

## Verificación

- **Las 35 pantallas, sin display**: el script de Playwright del scratchpad ya levanta
  vite, simula `/api/**` y captura 1024×600. Extenderlo para recorrer todos los slugs y
  revisar las imágenes de golpe.
- **Zonas**: `?debug=nav` sobre cada pantalla.
- **Cabecera**: `curl -sI ".../api/display.jpg?page=det-rain-7d"`.
- **CPU**: `docker stats` en el VPS antes y después; la carga no debería pasar de ~0.8.
- **Display**: recorrer consola → detalle → periodos → récords → atrás hasta la home, con
  los tiempos del bloque *Estado* del portal.

## Riesgos

- **El más caro es el visual**: 35 pantallas que hay que mirar una a una. Por eso la
  plantilla y por eso el script de captura masiva antes de tocar el firmware.
- **CPU del VPS** si los TTL se quedan cortos. Medible con `docker stats`.
- **La cabecera podría perderse** en algún proxy. Caddy no filtra cabeceras de respuesta y
  el display va por HTTP directo al `:8080`, saltándose Cloudflare; verificar con `curl -I`
  de todos modos.

## Decisiones abiertas

- Qué tres o cuatro cifras lleva cada variable en su cabecera (hay borrador por variable,
  se afina viendo las capturas).
- Si la celda de la condición del cielo pasa a llevar a la **cámara** en vez de al
  pronóstico, cuando la cámara esté instalada y con el encuadre fijado.
- Retención de las fotos de la cámara (heredada del plan de la cámara).

## Avance

Hecho hasta la pausa del 2026-08-06:

- `kiosk-nav.ts` con las siete variables, los cuatro periodos, las cuatro vistas de
  estadísticas, la cámara, los TTL, los padres y la regex de slugs válidos.
- `nav-zones.tsx` con la medición del DOM, la serialización y el overlay de depuración.
- `console-css.ts`: el CSS de la consola extraído y ya compartido; `ConsoleReplica` lo
  importa en vez de llevarlo dentro.
- `data-nav` puesto en 4 de las 15 celdas de la consola (EXT, VIENTO, HUMEDAD, PRES).
- `tsc` limpio. Nada desplegado todavía; el display sigue con la versión anterior.
