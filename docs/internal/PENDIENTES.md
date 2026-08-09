# Pendientes — Estación Clima XE1E

> Lista viva de trabajo pendiente. Vive en git (sobrevive cambios de PC).
> Última actualización: 2026-08-08.

## 1. Cuando llegue el WN32 (~2026-08-08) — depende de hardware
En la **estación Remota** habrá 2 sensores: **WN32 = exterior** y el **integrado del
GW1100 = interior** (se **apaga la trampa** `treat_indoor_as_outdoor`).
Nomenclatura se queda: **Principal = WS2910**, **Remota = GW1100**.

- [x] Apagar la trampa del GW1100 en Admin → Estaciones ("Está a la intemperie"). HECHO.
- [x] **Alerta de moho — HECHO 2026-08-04.** Se añadieron reglas propias de humedad
      interior (`humidity_indoor_low/high`, 20 % / 65 %) con umbrales
      sobreescribibles por estación y su bloque en Admin → Alertas. Ojo al dato: la
      alarma **llevaba tiempo sin vigilar nada**, no era una tarea futura — al
      retirar la trampa, `humidity_indoor` no lo evaluaba ninguna regla.
      De paso, `temperature_indoor` entró en la vigilancia de "sensor perdido".
- [ ] **Barrido interior/exterior en TODO el servidor.** Al quitar la trampa dejan de
      coincidir "lo que el GW1100 manda" con "lo que el servidor rotula", así que hay
      que revisar a detalle, extremo a extremo, que las lecturas del **WN32 salgan
      como exteriores** y las del **integrado del GW1100 como interiores**. No basta
      con el toggle: la trampa se aplica en `main.py` al ingerir (`treat_indoor_as_outdoor`,
      hoy en `main.py:391`, default `False` en `settings_store.py`), pero el rótulo
      interior/exterior se decide por separado en cada consumidor. Repasar al menos:
      - [x] `_detect_sensors_detail` en `main.py` — **HECHO**. Además se corrigió un
        fallo: identificaba el WN32 por `battery_wh32`, una clave que el parser
        **nunca producía** (no estaba en `FIELD_MAPPING`), así que el sensor habría
        salido como "Exterior" genérico y sin batería ni señal. Ahora se mapean
        `wh32batt`/`wh32sig` y se acepta también `battery_wh26` (el WN32 *es* un
        WH26 y, según el firmware, reporta con una clave o la otra).
      - [x] Tarjetas: `RemoteStationCard` y la página `/pro/remota` ya separaban
        Exterior (WN32) / Interior (GW1100), y `StationSummaryTable` lo hace con
        `indoorPrimary`. `InteriorCard` y `ExtraSensorsCard` leen datos de la
        PRINCIPAL (interior de la consola y canales WN31), así que no les afecta.
        `AtmosphericProfile` es del METAR, tampoco.
      - [x] `ConsoleReplica` — **HECHO**. La celda REMOTA prefiere el **exterior**
        (WN32) cuando existe y cae al integrado del GW1100 si no, y la etiqueta dice
        cuál de los dos se ve (`REMOTA WN32` / `REMOTA GW1100`): antes mostraba el
        interior rotulado siempre "GW1100", indistinguible. Su tipo local de fila
        histórica —que solo declaraba los `*_indoor`— se sustituyó por el
        `RemoteHistRow` compartido de `remote.ts`.
      - [x] **Kiosco, página 3 «Sensores» — HECHO 2026-08-04.** La tarjeta remota leía
        solo `temperature_indoor`/`humidity_indoor`, así que al retirar la trampa el
        **exterior quedaba invisible** y el interior salía rotulado como "Remota" sin
        más. Ahora separa **«Exterior · WN32»** (`temperature_outdoor`/
        `humidity_outdoor`) e **«Interior · GW1100»** (`_indoor` + presión), mismo
        criterio que `RemoteStationCard`. Hoy el exterior muestra `--`; se poblará
        solo cuando llegue el WN32, sin más cambios de código.
      - [x] Derivados de la remota: `dewPointC` (`remote.ts`) es genérico —recibe
        temperatura y humedad, el llamador elige cuáles— y `RemoteStationCard` ya lo
        aplica sobre el par exterior.
      - [x] Salidas hacia afuera: **no les afecta**. `/api/svitrix`, el widget y la
        publicación a redes leen `latest_by_station[None]`, es decir la PRINCIPAL
        (`publish_all` solo se invoca cuando `station is None`). `/api/display.jpg`
        renderiza páginas ya revisadas. Verificado, no supuesto.
      - Histórico ya guardado: las filas del 2026-07-24 en adelante quedaron con la
        semántica de la trampa. Decidir si se reetiquetan o se deja la discontinuidad
        documentada.
- [x] Presión: la lógica "presión en fila Exterior cuando no hay sensor interior"
      (`main.py::_detect_sensors_detail`) se **auto-revierte** — al haber interior otra
      vez, la presión vuelve a esa fila. Sin cambio.

## 1b. Svitrix (firmware) — distinguir "sin dato" de "sin conexión" — diferido

Único pendiente de la auditoría de datos que necesita tocar **otro repo**
(`svitrix-firmware-XE1E`), compilar y flashear el reloj. No urge: el lado del
servidor ya cubre el caso peligroso.

**Situación.** `/api/svitrix` devolvía un `current` con `temp_c`/`humidity`/
`pressure_mb` en `null` cuando no había ninguna lectura. ArduinoJson los convierte
a `0.0f` y `weatherData.valid` se marca `true` igual, así que el reloj mostraba
**0 °C / 0 % / 0 mb como si fueran medidas reales** — y en invierno un 0 °C en la
CDMX es lo bastante verosímil como para no notarlo.

**Ya hecho (servidor).** Ahora responde **503** en ese caso. Pero solo en ese: el
firmware reinicia el ESP32 tras `max(5 × intervalo, 15 min)` sin un HTTP 200
(`DataFetcher.cpp:150-156`, `ESP.restart()`), así que devolver error mientras la
estación está caída lo dejaría en **ciclo de reinicios cada 15 minutos**, que es
peor que mostrar un dato viejo. Con lectura disponible —aunque sea vieja— se sigue
sirviendo.

**Lo que falta (firmware).** Que distinga *"el servidor respondió pero no tiene
dato"* de *"no pude hablar con el servidor"*:

- Hoy ya trata aparte el caso de `current` ausente (*"data error — keep last
  value, leave health/retry untouched"*), pero **tampoco** actualiza
  `lastWeatherSuccessMs_`, así que por esa vía acabaría reiniciando igual.
- La idea: ante un 503 (o un `current` ausente) conservar el último valor, **no**
  contarlo como fallo de red y **sí** refrescar el reloj de auto-recuperación —
  el servidor está vivo, el problema es la estación. Y marcar el dato como no
  fresco en pantalla en vez de mostrarlo como actual.

**Cuidado al probarlo:** equivocarse aquí se manifiesta como un reloj que se
reinicia solo cada cuarto de hora. Conviene validar con el servidor devolviendo
503 a propósito antes de dar por bueno el cambio.

Relacionado y también del firmware: `/api/svitrix` ya emite `is_day`, pero el
firmware elige el icono solo por `code` (`Apps_NativeApps.cpp:433`,
`getWeatherConditionIcon`). Usarlo permitiría distinguir el sol de la luna de
madrugada. Ese sí es un cambio pequeño y sin riesgo.

## 1c. Histórico de `vpd` en dos unidades — decidir

El VPD se guardaba en InfluxDB en **inHg** (llegaba así del gateway y no se
convertía). Desde el 2026-08-04 se guarda en **kPa**, que es su unidad, así que la
serie tiene una discontinuidad: lo anterior a esa fecha está en inHg y hay que
multiplicarlo por **3.38639** para compararlo con lo nuevo.

Nadie grafica ese campo hoy, así que no corre prisa. Dos salidas:

- **Dejarlo** y que conste aquí (lo que está hecho ahora).
- **Recalcular** con un `to()` de Flux sobre el campo `vpd` anterior a esa fecha,
  igual que se hizo con la presión histórica (ver sección 6). Backup antes.

## 2. Display de consola — fase 2 (firmware) — diferido
Servidor ya listo: `GET /api/display.jpg?page=consola` (réplica de la consola física,
1024×600). **Plan detallado + decisiones:** `ecowitt-display-kiosk-xe1e/docs/PLAN-CONSOLA-XE1E.md`.
**Fase inmediata HECHA y verificada (2026-07-25):**

- [x] **Servidor:** 6ª pestaña "Consola" (🖥️) en la barra de KioskPage + fuente
      **7‑segmentos (DSEG7 Classic, OFL) solo en la consola** (en los números;
      etiquetas/unidades/fecha en sans). `public/fonts/DSEG7Classic-Bold.woff2`.
- [x] **Firmware** (`ecowitt-display-kiosk-xe1e`): barra de 6 pestañas (la 6ª → consola
      full‑screen `?page=consola`); tocar la consola en cualquier parte → **regresa a la
      página 1**. Flasheado (COM5) y funcionando.
- En curso: **ajustes visuales** de la consola.
- Futuro: consola como home + zonas de toque por bloque (pendiente de definir).

## 2.b Cámara del exterior — plan escrito, esperando hardware
**Tapo C325WB comprada el 2026-08-05, aún sin recibir.** Plan completo, comparativa
de modelos y decisiones: **`docs/internal/PLAN-CAMARA-EXTERIOR.md`**.

Lo esencial: se integra por **RTSP** (exige crear una "cuenta de cámara" en la app
Tapo), que es **sólo de red local**, así que la cámara queda tras el NAT de casa y el
VPS no puede ir a buscarla — algo en casa tiene que empujar hacia fuera, y **no se
abren puertos hacia la cámara**. Se acordó **foto cada 5-10 min + timelapse diario**
en vez de directo 24/7, que serían ~1 TB/mes de subida. Añadirla como página del
kiosco **toca también el firmware**, que tiene cableado el número de pestañas.

## 3. Rediseño de Admin + depuración de código — plan escrito
Ver **`docs/internal/PLAN-REDISENO-ADMIN.md`**. Consolidar toda la config por estación
dentro de "Estaciones" (publicación, alertas) y limpiar código muerto:

- [ ] `station_passkeys` muerto.
- [ ] Bug no-op de `create_station`.
- [ ] Unificar el registro por MAC.
- [ ] Etapas 1‑5 del plan.

## 4. Seguridad — residuales (auditoría docs/SEGURIDAD.md)
- [ ] Cerrar el puerto `:8080` (DIFERIDO: IP dinámica; se compensa con la whitelist de passkey).
- [ ] Token en el push (además de la whitelist por passkey).
- [ ] Barrer los `str(e)` de errores 500 en el resto de endpoints.

## 5b. Idea futura — video en vivo del cielo/horizonte en el dashboard
El usuario evaluará comprar una **cámara IP exterior RTSP/ONVIF** (gama media, ~$50‑80;
Reolink RLC‑520A/810A, PoE, IP66; NO Ring/Nest/Blink/Wyze‑sin‑RTSP). Pendiente hasta
validar cámara + costo. Arquitectura acordada (resuelve el CGNAT/IP dinámica):
`cámara RTSP (LAN) → go2rtc en la RPi4 (WebRTC/HLS) → Cloudflare Tunnel (cam.xe1e.net)
→ página "Cielo" embebida en el dashboard`. La **pantalla ESP32 NO** puede mostrar
video fluido (solo JPEG), sería solo web. La HP10 de Ecowitt NO sirve para esto (es
time‑lapse/snapshots, no stream; su `/capture` local solo da fotos).

## 5. Bonus (ya se puede) — señal RF por sensor
El GW1100 ya está en línea y reporta `signal_*` (0‑4). **HECHO en la consola del kiosco**
(2026-08-08, commit `9861acc`): `SignalGlyph` de cuatro barras junto a la casita, en EXT y
en la remota exterior. Ojo con la expectativa: verificado contra la API ese día, **ninguna
de las dos estaciones manda hoy un solo `signal_*`** —la principal porque la WS2910 no los
emite nunca, la remota porque aún no tiene sensores emparejados— así que el glifo está
puesto pero invisible, y en EXT lo seguirá siendo mientras la principal sea el WS2910.
Falta la UI en el resto: `AdminEstacionConfig` y la tarjeta de sensores.

## 5d. Humidex — ✅ HECHO (2026-08-08)
Se calculaba y se guardaba desde el principio, pero no tenía estadística, no tenía nivel y
las dos pantallas que lo mostraban no coincidían en la unidad. Ahora: entra en `stats_fields`
(y con eso lo heredan récords, kiosco y resumen diario, de forma retroactiva), el resumen
diario guarda `humidex_max`/`humidex_max_time`, los récords traen el de siempre y por periodo
con `humidex_days` (≥ 30), tiene celda propia en la consola con riel, color por tramo y nivel
en palabras, y muestra el máximo del día cuando no hay valor vivo. La web dejó de convertirlo
a °F. De paso entró "noche más cálida" (máximo de las mínimas) en los récords.

## 5c. Consola — tres mejoras APLAZADAS por espacio (2026-08-08)
Salieron de una ronda de propuestas; se hicieron las dos primeras (alertas en la celda y
próximas horas) y estas tres se dejaron para pensarlas, porque las tres pelean por píxeles
en celdas ya ajustadas y el operador prefirió no forzarlas:

1. ~~**Máximo del día en UV y SOLAR**~~ — ✅ **HECHO (2026-08-08)**. La salida no fue añadir
   una fila (no cabía: en ~90 px útiles ya van rótulo, cifra, categoría y riel) sino
   **conmutar el dato**: idea del operador. De noche, con la lectura viva en cero, la cifra
   grande pasa a ser el máximo del día y el renglón de la unidad o del nivel dice "MÁXIMO",
   las dos cosas en blanco puro; al amanecer vuelven solas. Cero píxeles de sitio nuevo.
2. **Progreso del día** en la celda del sol y la luna: un arco entre amanecer y atardecer
   con la posición de ahora, o sea cuánta luz queda. No necesita ningún dato nuevo; el
   problema es que esa celda ya va justa (el disco lunar de 64 px más las dos horas piden
   casi todo el interior, cuenta hecha en el código).
3. **Sparkline de 24 h** en EXT y PRES. Es la que más moderniza el aspecto y la única que
   **no tiene hueco**: habría que quitar o achicar algo de esas dos celdas.

## 6. Limpiar historial de presión falso (servidor) — ✅ HECHO (2026-07-25)
La presión relativa de la principal (WS2910) del 2026-07-19 al 2026-07-24 estaba
sistemáticamente ~14 hPa baja (~1013) porque no se aplicaba la altitud. **Corregido
sin perder datos:** se recalculó la relativa desde la **absoluta @2250 m** (misma
fórmula ISA del servidor, `round(...,1)`) con un `to()` de Flux que sobrescribió solo
ese campo (backup previo en `/data/pressure_backup_pre_altitude.csv`, 7580 filas), y
se reconstruyeron los resúmenes `weather_daily` de esos días con
`aggregator.compute_and_store_day`. También se borraron 3 lecturas anómalas de
absoluta (~790 hPa) del 07-24 22:42-22:44Z. Resultado: presión histórica real
(~1024-1032 hPa). El GW1100 se dejó igual (usa la altitud de su propia consola).

## 7. Uniformar la iconografía — hacerlo más visual
Meter iconos **en todo** el sitio y **más grandes**, para uniformizar y que se lea de
un vistazo. Falta definir juntos **dónde y cuáles**. También se van a **agregar**
algunos que hoy no existen.

Inventario de partida (verificado 2026-08-03):

- **Meteocons** (`@meteocons/svg` 0.1.0, MIT) para lo meteorológico animado: hay
  **475 iconos por variante** (`fill`, `flat`, `line`, `monochrome`) y sólo se usan
  **50**, todos de `fill`. Hay mucho sin explotar (viento por intensidad, presión,
  fases lunares completas, alertas, banderas de temperatura…).
- **Lucide** (`lucide-react` 0.303.0, ISC) para la UI: 26 importados.
- Casos que NO salen de ninguna librería y conviene decidir si se unifican:
  - La barra de pestañas del **kiosco** usa **emoji** (☀️ 📍 🏠 📅 📈 🖥️).
  - `ConsoleReplica` usa **SVG dibujados a mano** ahí mismo (termómetro, gota,
    barómetro, luna, flechas de tendencia).
  - `TrendArrow` también trae su propio SVG, aunque `CONVENCIONES.md` dice que la
    tendencia usa `ArrowUp`/`ArrowDown` de Lucide. Hay que decidir cuál es la
    fuente de verdad y alinear el documento con el código.
- Los tamaños estándar ya están en `docs/CONVENCIONES.md` (UI 16/20/24/32 px;
  meteorológicos 24/32/48/64/96/120 px). Si se agrandan, hay que actualizar esa tabla.

## 9. Kiosco — celda LLUVIA con los 3 datos de precipitación
Hoy la celda LLUVIA de la réplica de consola (`ConsoleReplica`, fila 2 columna 3)
muestra **solo 2**: `rain_daily` y `rain_rate` (la tasa, rotulada `/h`).

El servidor maneja **8** campos de lluvia y la tarjeta web (`PrecipitationCard`) ya
usa 4. Verificado en producción el 2026-08-04:

| Campo | Ejemplo | Qué es |
|-------|---------|--------|
| `rain_rate` | 3.0 | intensidad ahora (mm/h) — **ya está** |
| `rain_event` | 6.8 | el evento de lluvia en curso |
| `rain_hourly` | 5.0 | última hora |
| `rain_daily` | 6.8 | hoy — **ya está** |
| `rain_weekly` | 6.8 | semana |
| `rain_monthly` | 7.3 | mes |
| `rain_yearly` / `rain_total` | 75.4 | año |

- [x] **Hecho el 2026-08-04.** Van `rain_event` (EVENTO), `rain_rate` (TASA) y
      `rain_daily` (DÍA), en tres columnas de 30 px con etiqueta cada una: sin
      etiqueta, tres cifras de lluvia son indistinguibles entre sí.
      **`rain_event` se rotula EVENTO y no "AHORA"**: sobrevive al cambio de día, así
      que se ve acumulado del chubasco de anoche junto a un día en 0.0. Lo reinicia la
      estación --medido sobre 14 días: casi siempre ~24 h después de dejar de llover,
      siempre en hora en punto--, no el servidor, que sólo lo pasa de pulgadas a mm.
- [x] El tab **Consola** del dashboard quedó igual sin trabajo extra: es el MISMO
      componente (`ConsoleReplica`), así que se arregló en un solo lugar.

## 8. Revisiones detectadas el 2026-08-03
- [ ] **SMN sin datos — es caída de CONAGUA, no nuestra.** `/api/smn` y
      `/api/smn/municipios` devuelven 502 porque el webservice de origen responde
      **HTTP 500**: `https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1`.
      Verificado que falla **igual desde el VPS y desde otra red**, así que no es
      bloqueo de IP. Nada que arreglar del lado del servidor, pero **falta
      degradar con gracia**: hoy la página queda sin contenido en vez de decir
      "el SMN no está disponible". Considerar además cachear la última respuesta
      buena para sobrevivir estas caídas.
- [ ] **Mi Tablero no muestra tendencias.** Confirmado: `MiTableroPage.tsx` tiene
      **cero** usos de `TrendArrow`, `getTrend` y `TrendBadge`, mientras Inicio y la
      consola sí las pintan. Hay que decidir si los widgets del tablero llevan
      flecha (y con qué umbrales: los de `CONVENCIONES.md`, ±0.5 °C / ±3 % / ±1 hPa).
- [ ] **Climograma se ve raro — falta señalar meses parciales.** No es un bug de
      dibujo: `/api/climate/noaa?year=2026` devuelve **sólo 2 meses** (julio y
      agosto) porque la estación arrancó el 2026-07-19. Julio sale con 68.1 mm
      siendo un mes **incompleto** (del 19 en adelante) y agosto con 0.5 mm de 3
      días, presentados como si fueran totales mensuales — eso es lo que
      desconcierta. Un climograma es por definición una figura de 12 meses. Opciones:
      marcar visualmente los meses parciales, no graficarlos hasta tener el mes
      completo, o mostrar el aviso de "climatología en construcción" hasta juntar
      un año. Decidir cuál.

---
### Hecho reciente (referencia)
- Alertas: humedad, tendencia de presión (2 niveles), histéresis anti‑spam,
  habilitar/deshabilitar por alarma, UI en Admin, valores CDMX. (commits 38686c2,
  e9e0423, 2eaa95a, 7a82c4a, 69400dc)
- Página de consola `?page=consola` (commits 544341f, acf7216).
- Presión relativa por altitud, whitelist de passkey, registro por MAC (ver git).
