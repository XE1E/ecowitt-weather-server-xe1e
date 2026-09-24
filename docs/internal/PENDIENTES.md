# Pendientes — Estación Clima XE1E

> Lista viva de trabajo pendiente. Vive en git (sobrevive cambios de PC).
> Última actualización: 2026-09-22.

## -1. Ronda "aprovechar lo que ya tenemos" — ✅ HECHA Y EN PRODUCCIÓN (2026-09-16)

5 ideas de software (sin hardware nuevo) para exprimir datos/infra que ya
existe, en vez de comprar sensores nuevos (eso queda para una 2ª etapa de la
estación). Orden: de menor a mayor complejidad/decisiones de producto.

**Las 5 en producción (2026-09-16):** pusheado en 5 commits, VPS actualizado
tras cada una (`git pull` + `docker compose build --no-cache` de los
servicios tocados + `--force-recreate`) y verificado (contenedores healthy,
sin errores en logs, `/api/alerts/history` y `/api/history?format=csv`
responden, `backup-camera-archivo.sh` corrido a mano). Cron de
`backup-camera-archivo.sh` agregada (48 3 * * *, entre `analisis` y
`rubik-site`). **Resumen semanal (idea 5) ya activado y probado en
producción (2026-09-16):** correo de prueba enviado con datos reales
(récords, comparación, foto), `email_digest_enabled=true` persistido y
aplicado tras reiniciar el receiver -- la prueba no marcó la semana como
enviada, así que el envío real sigue su curso normal el próximo lunes 7am.

### Ajuste posterior: criterio de "mejor foto" (2026-09-16)

- [x] **Desempate por tipo de nube.** La visibilidad casi nunca varía
      (medido: ~95% de las capturas salen "good"), así que el desempate real
      era "la primera del día", sin mirar qué tan interesante se veía el
      cielo. Se agregó `sky_analyzer.CLOUD_TYPE_INTEREST` (cumulonimbus/
      altocumulus por encima de estratos lisos) como SEGUNDO criterio, sólo
      dentro de un mismo nivel de visibilidad -- la visibilidad sigue
      mandando primero. Afecta `best_of_day` y `best_of_week` (la foto del
      resumen semanal). 4 tests nuevos.
- [ ] **Luna/estrellas de noche — parqueado, necesita su propio diseño.** La
      cámara (C325WB) usa visión nocturna **ColorPro** (color, no IR B/N;
      el plan de cámara ya había verificado que "sí aporta" estructura del
      horizonte de noche), y el prompt de la IA **ya le pide** mencionar
      luna/estrellas si las ve -- pero eso cae en `description` (texto libre)
      y se descarta al comprimir la entrada diaria. Haría falta: campo
      estructurado nuevo en el schema de `sky_analyzer.py` (p. ej.
      `moon_visible`/`stars_visible` o un `night_quality`), persistirlo en
      `_append_to_daily`, y un criterio de "mejor" PROPIO para de noche
      (distinto al de nubes de día). Falta ver fotos reales de noche para
      calibrar el criterio antes de confiar en él -- no se hizo ahora para no
      arriesgar el esquema del análisis sin poder probarlo.

- [x] **1. Exportar CSV.** `GET /api/history` y `GET /api/summaries/daily`
      aceptan `format=csv` (`receiver/app/services/csv_export.py`, con tests).
      Botón "⬇ CSV" nuevo en `HistoryDayDetail.tsx` (vista de Día). La vista
      Mes/Año de `HistoryPage.tsx` **ya tenía** su propio CSV client-side
      (unit-aware) — no se duplicó, se dejó igual.
- [x] **2. Historial de alertas.** `GET /api/alerts/history?hours=24&limit=50`
      (nuevo, público) envuelve `alert_service.get_history()`, que ya existía
      pero solo se usaba dentro de `/api/admin/status` (privado). En vez de una
      página aparte, se sumó como sección plegable ("Historial reciente") en
      la tarjeta `AlertsPanel` que ya está en Inicio y Mi Tablero -- misma
      insignia de estación e icono por variable que las activas, con
      "normalizada HH:MM" o "activa" por entrada. Ojo: vive en memoria del
      proceso (hasta 100 entradas), no es un log persistente -- se vacía si el
      receiver se reinicia.
- [x] **3. Efeméride con foto real.** El bloqueo real: la efeméride SIEMPRE
      compara con años anteriores, y las capturas completas (y su respaldo en
      R2, `rclone sync`) se podan a los 7 días -- esa fecha nunca cae dentro
      de la ventana. Se agregó un archivo permanente de **1 foto/día**
      (`CameraStore.archive_best_photo`, `<camera_dir>/archive/`), copiado del
      día anterior en cada `save()` (nunca el de hoy, que aún puede cambiar de
      "mejor"). `GET /api/camera/best/{date}.jpg` cae a ese archivo antes de
      dar 404. Quinto script de respaldo R2 (`backup-camera-archivo.sh`,
      `r2_archivo_retention_days`, 0 = para siempre). En `ClimatePage.tsx`,
      la tabla "En este día" ahora es clicable por año y reusa
      `BestPhotoCard` (ya se degradaba solo a texto sin foto). Ojo: como el
      archivo arranca el 2026-09-16, ningún año anterior a esa fecha tendrá
      foto real nunca -- sólo lo que se archive de aquí en adelante.
- [x] **4. PostHog con eventos propios.** `trackEvent()` nuevo en
      `analytics.ts` (no-op fuera de vistas públicas, nunca rompe la
      interacción real). 6 eventos instrumentados: `units_toggle`,
      `radar_layer_change`, `forecast_source_change` (Open-Meteo/SMN),
      `csv_export` (día/mes/año -- adopción de la idea 1),
      `alert_history_open` (adopción de la idea 2) y `onthisday_photo_view`
      (adopción de la idea 3). Documentado en `docs/GUIA.md`. No se tocó
      `dashboard/public/guia.html`: es una guía más ligera, sin sección de
      analítica/backups que mantener en sync (se verificó antes de omitirlo,
      no es un descuido).
- [x] **5. Resumen semanal por correo.** Cadencia decidida: **semanal**
      (día/hora configurables, Admin → Notificaciones → Correo). Reusa el
      mismo canal SMTP de las alertas (`AlertService.send_digest`), con
      opt-in propio (`email_digest_enabled`, independiente de
      `email_enabled`). Contenido: máx/mín/racha (con fecha), lluvia
      acumulada, comparación **vs la semana anterior** (no "vs normal": la
      estación es de julio 2026, no hay años previos con qué comparar
      todavía) y enlace a la mejor foto de la semana (`CameraStore.best_of_week`,
      usa el archivo permanente de la idea 3). `services/digest.py` es puro
      (recibe filas ya obtenidas) para poder probarse sin InfluxDB; la
      orquestación (qué semana pedir, estado "ya enviada" en
      `digest_state_file` para no duplicar tras un reinicio) vive en
      `main.py::email_digest_task`. Botón "Enviar prueba" en el panel
      (`/api/admin/test-digest`) manda con datos reales sin esperar al
      día/hora ni marcar la semana como enviada.

## 0. Estaciones vecinas + "nuestro pronóstico" — en observación pasiva (2026-09-14)

Sesión grande del 2026-09-14: fase 3 de estaciones vecinas (Netatmo, ver
`docs/archivo/PLAN-ESTACIONES-VECINAS.md`), señal de "lluvia acercándose"
(`forecaster.detect_incoming_rain`), recalibración de `sky_validation.py`, y
`forecaster.own_forecast` (`GET /api/forecast/own`) como voz propia de la
estación sobre Open-Meteo/WeatherAPI. Todo en producción y verificado, pero
**nada de esto está "cerrado" todavía** -- falta observación real:

- [x] **`nearby_rain_signal_watchdog`** -- ELIMINADO (2026-09-23): nunca
      disparó y el usuario decidió que la lluvia de vecinas no es confiable
      (quedan solo como dato informativo). `detect_incoming_rain` sigue vivo
      en `/api/nearby-stations` y en `get_own_forecast`.
- [ ] **`forecaster.own_forecast`** -- ver cómo se siente en la práctica
      `PrecipitationCard.tsx` unos días (¿el titular aparece con sentido?,
      ¿los umbrales de confianza/viento necesitan ajuste?) antes de tocar
      nada más.
- [x] Netatmo fase 3: cerrada como dato informativo (2026-09-23, ver abajo).
- [ ] (baja prioridad) Netatmo: ninguna vecina real tiene todavía módulo pluviómetro, así que
      `rain_live`/`rain_60min` en `netatmo.py` sigue sin verificarse contra
      datos reales -- revisar si alguna vecina nueva lo trae.
- [x] **Revisión 2026-09-23 de presión de vecinas (sin cambios de código,
      decidido dejarlo así):** varias PWS de Xweather marcan 7-15 hPa por
      debajo de la propia (1024.5) y de MMMX (1025). NO es bug de fórmula:
      todas traen `altimeterMB` (el fallback a `pressureMB` no se activa) y su
      `spressureMB` cruda ya viene baja (767-773 vs 780 propia) -- es
      calibración/elevación mal puesta de cada estación (p. ej. `PWS_SCALA`
      con `elevM`=36 m). El filtro 950-1050 sí descarta las que mandan
      absoluta cruda (EDELGRIM/CHS01/INAUCA9, ~765-787). La tendencia de zona
      no se afecta (usa deltas por estación y prefiere METAR).
      **Decisión del usuario:** las vecinas quedan como dato INFORMATIVO; para
      tendencia de presión basta MMMX, y lluvia/otros de vecinas no se
      consideran confiables -- no invertir más aquí. Único ajuste hecho: las
      que mandan absoluta (`altimeterMB` 650-900 con `elevM` >1000 m) se
      reducen con ISA (`_fix_absolute_pressure` en `xweather.py`) en vez de
      descartarse.

## 0b. Detector de lluvia (piezo + capacitivo) — plan escrito, bloqueado por hardware (2026-08-16)

Plan completo en **`docs/internal/PLAN-DETECTOR-LLUVIA.md`**. No mide cuánta
agua cae (eso ya lo hace el pluviómetro) -- detecta **que está lloviendo
ahora mismo**, aunque caiga tan poco que el balancín nunca llegue a volcar
(llovizna, típica en CDMX por las tardes). Decidido: desarrollo propio,
alimentado de la red, con **fusión de dos sensores** (piezo detecta el
impacto de la gota = evento; capacitivo detecta la placa mojada = estado;
cada uno tapa el punto ciego del otro -- el piezo es inmune al rocío, el
capacitivo sabe cuándo de verdad dejó de llover).

- [x] **1a. Firmware de caracterización escrito y compilado** (2026-08-16),
      `firmware/piezo-test/`, sin warnings para `esp32dev` y
      `esp32-s3-devkitc-1`.
- [ ] **1b. Piezo en el escritorio** (probar con un cuentagotas si la señal
      de una gota se distingue de un golpe en la mesa). **Bloqueado: falta
      comprar el piezo** -- lista de compra completa en el plan (~25-30 USD
      todo el proyecto), nada más empezado.
- [ ] 2. Prueba de POST al VPS (descartar el problema de Cloudflare que ya
      dio guerra con la cámara, antes de invertir en hardware).
- [ ] 3-7. Placa capacitiva, fusión/máquina de estados, endpoint +
      almacenamiento + tarjeta en el tablero, calefactor, alerta de "empezó
      a llover" -- en ese orden, cada uno depende del anterior.

## 0c. Convenciones de diseño — ✅ HECHO (2026-09-23)

`docs/internal/AUDITORIA-CONVENCIONES.md` (2026-07-31) se revisó contra el código
real: de 45 hallazgos, 27 ya estaban corregidos sin registro (commit masivo del
2026-08-10 que recoloreó Humedad) y 11 quedaron obsoletos porque
`docs/CONVENCIONES.md` cambió después. Detalle completo y anotado en ese documento.

- [x] **`TrendBadge.tsx` y `StationSummaryTable.tsx` ahora usan `TrendArrow`/
      `getTrend` compartidos — HECHO (2026-09-22).** Antes `TrendBadge` dibujaba
      con iconos Lucide y `StationSummaryTable` con flechas Unicode (`↑↓→`) y su
      propio umbral 2% DINÁMICO sobre la media (disparaba con cualquier ruido en
      medias casi nulas -- viento en calma, radiación de noche -- y casi nunca en
      medias grandes como la presión). Ahora ambos usan `TrendArrow` y
      `StationSummaryTable` con umbrales FIJOS por variable vía `TREND_THRESHOLDS`
      (`theme/constants.ts`, que hasta entonces no consumía nadie en todo el
      repo). De paso, `getTrend()` aceptaba `previous: number | null` sin
      `undefined` (asimetría con `current`) -- corregido.
- [x] **`ImecaCard.tsx`** -- HECHO (2026-09-23): el tooltip del `AreaChart` ya tiene
      el `cursor` punteado, igual que `TemperatureChart`/`RemoteStationPage`/`PressureCard`.
- [x] **`KioskPage.tsx` → `RemoteCard`** -- HECHO (2026-09-23): el tile "Exterior" ya
      usa `#f97316`/`#2563eb` (temperatura/humedad), como el "Interior".
- [x] **`HistoryDayDetail.tsx:297`** -- HECHO (2026-09-23): la barra "Tasa de lluvia"
      (grafica `rain_rate`) ya usa `#0ea5e9`, igual que `COLORS.rainRate` en
      `theme/constants.ts` (que también decía `#38bdf8`, aunque nadie la usaba).

**No tocar:** los 2 colores de viento de `HistoryDayDetail.tsx` (líneas 188-189)
que "divergen" de la tabla son intencionales -- ajuste de contraste de
accesibilidad medido en ΔE, documentado en el propio código.

## 0d. Tema claro — `StationSummaryTable` sin adaptar — ✅ HECHO (2026-09-22)

Detectado al verificar visualmente el fix de §0c en `/tablas`. El fix del tema
claro (commit `344b42b`, mismo día) mejoró `.card` y los colores de acento, pero
`StationSummaryTable.tsx` **no usaba `.card`** -- se envolvía en
`bg-slate-800/50 border-white/10` directo, una superficie oscura semitransparente
pensada para fondo oscuro; se veía como panel gris apagado en tema claro. Mismo
problema en el placeholder vacío y los pills del selector Principal/Remota de
`TablesPage.tsx`, en la misma pantalla.

**Arreglado (commit `00c21df`):** nuevas clases `.panel`/`.panel-header`/
`.surface-muted` en `index.css` (mismo patrón que `.card`, con su propio
override bajo `[data-theme="light"]`), aplicadas en `StationSummaryTable.tsx` y
`TablesPage.tsx`. Deliberadamente NO se tocaron las ~70 ocurrencias de
`bg-slate-800/50` en `/admin` (paneles propios, siempre oscuros, fuera de
alcance) -- de ahí usar clases nuevas dedicadas en vez de sobreescribir la
utilidad Tailwind globalmente. Verificado con Playwright en `/tablas`, tema
claro (panel legible) y oscuro (pixel-idéntico a antes).

## 1. WN32 — ✅ HECHO (2026-08-09)
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
- [x] **Barrido interior/exterior en TODO el servidor.** Al quitar la trampa dejan de
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
        semántica de la trampa. **Se deja la discontinuidad documentada** — no se
        reetiquetan.
- **WN32 operativo desde 2026-08-09.** Verificado: el servidor lo detecta como sensor
  exterior de la estación remota GW1100, reportando temperatura, humedad, batería OK.
  Datos llegando cada ~1 min.
- **Bug de firmware GW1100: presión relativa cae ~26 hPa al enlazar WN32.**
  Detectado 2026-08-09. Al conectar el WN32 al GW1100, la presión **absoluta** no
  cambia (~781 hPa), pero la **relativa** cae de ~1026 a ~999 hPa — como si el
  firmware reseteara la altitud a 0m. Verificado en el historial:
  - 19:16 UTC sin WN32: P.Abs=781.1, P.Rel=1025.8 (altitud 2240m)
  - 19:18 UTC con WN32: P.Abs=781.0, P.Rel=999.2 (¡bug!)
  
  **Workaround:** subir la altitud configurada en el GW1100 de 2240m a **2430m**
  (+190m) para compensar los ~26 hPa perdidos. No es solución real — es un bug del
  firmware Ecowitt, no del servidor. El servidor solo recibe `baromrelin`/`baromabsin`
  y los guarda tal cual.
- [x] Presión: la lógica "presión en fila Exterior cuando no hay sensor interior"
      (`main.py::_detect_sensors_detail`) se **auto-revierte** — al haber interior otra
      vez, la presión vuelve a esa fila. Sin cambio.

## 1b. Svitrix (firmware) — ✅ HECHO Y FLASHEADO (2026-08-22)

Único pendiente de la auditoría de datos que necesitaba tocar **otro repo**
(`svitrix-firmware-XE1E`), compilar y flashear el reloj.

**Situación original.** `/api/svitrix` devolvía un `current` con `temp_c`/
`humidity`/`pressure_mb` en `null` cuando no había ninguna lectura. ArduinoJson
los convierte a `0.0f` y `weatherData.valid` se marca `true` igual, así que el
reloj mostraba **0 °C / 0 % / 0 mb como si fueran medidas reales**. El servidor
ya respondía **503** en ese caso (arreglo previo), pero el firmware trataba ese
503 igual que un fallo de red: no refrescaba el reloj de auto-recuperación, así
que una estación caída terminaba en **ciclo de reinicios del ESP32 cada
~15 min** — peor que mostrar el último dato conocido.

**Arreglado (commits `9d5c019` y `079d5d4`, pusheados a origin y FLASHEADOS por
USB/COM8 el 2026-08-22).** `fetchWeather()` distingue el 503 (y el `current`
ausente con HTTP 200) de un fallo de red real: conserva el último dato, no lo
cuenta en `weatherFailStreak_` y **sí** refresca `lastWeatherSuccessMs_` — ya
no reinicia por esa vía. El dato queda marcado `weatherData.stale` (expuesto en
`/api/weather/data`, **verificado en vivo**: `"stale":false` con la estación
arriba). De paso, el ícono de clima usa el `is_day` que ya emite `/api/svitrix`
(también verificado, `"isDay":1`): el código 1000 pintaba siempre el sol; de
noche pinta la fase lunar real (mismo servicio que `MoonApp`).

**Bonus del mismo repo, mismo día:** los meses salían en **inglés** ("AUG") en
la app de Fecha porque el libc del ESP32 no trae locale es_MX y `strftime`
resuelve `%b`/`%B` en inglés. Nuevo servicio `DateFormat` (`lib/services`)
sustituye esos especificadores por texto literal en español antes de llamar a
`strftime`. **Verificado en el reloj físico:** ya sale "22 AGO".

**Publicado como `v0.4.0-beta.22` (pre-release, 2026-08-22).** Tag empujado →
CI compiló, corrió tests/lint/cppcheck, publicó el `.bin` en el flasher web y
creó el release en GitHub. `CHANGELOG.md` actualizado.

**De paso se corrigió una nota de memoria equivocada: SÍ hay OTA por WiFi.**
Se creía que este reloj solo se podía flashear por USB. En realidad
`http://svitrix.local/update` (subida manual de `firmware.bin` desde el
navegador, `lib/webserver/esp-fs-webserver.cpp`) funciona sin configurar nada
— se probó en vivo subiendo el `.bin` y el reloj se reflasheó y reinició solo,
sin cable. Lo que sí sigue sin configurar es el AUTO-check por URL
(`update_firmware_url`/`/api/doupdate`, sigue siendo no-op). Para la próxima
actualización, usar `/update` por WiFi en vez de USB.

**Residual, no bloqueante:** no se hizo la prueba de forzar un 503 desde el
servidor (se descartó por riesgo de afectar datos reales servidos en
producción). Queda como prueba de rodaje: si la estación se cae alguna vez de
forma natural, ahí se confirma que el reloj aguanta sin reiniciarse. La lógica
ya se revisó por código y compila/pasa lint limpio.

## 1c. Histórico de `vpd` en dos unidades — decidir

El VPD se guardaba en InfluxDB en **inHg** (llegaba así del gateway y no se
convertía). Desde el 2026-08-04 se guarda en **kPa**, que es su unidad, así que la
serie tiene una discontinuidad: lo anterior a esa fecha está en inHg y hay que
multiplicarlo por **3.38639** para compararlo con lo nuevo.

Nadie grafica ese campo hoy, así que no corre prisa. Dos salidas:

- **Dejarlo** y que conste aquí (lo que está hecho ahora).
- **Recalcular** con un `to()` de Flux sobre el campo `vpd` anterior a esa fecha,
  igual que se hizo con la presión histórica (ver sección 6). Backup antes.

## 2. Display de consola — ✅ HECHO (cerrado 2026-08-19)
Servidor ya listo: `GET /api/display.jpg?page=consola` (réplica de la consola física,
1024×600). **Plan detallado + decisiones:** `ecowitt-display-kiosk-xe1e/docs/PLAN-CONSOLA-XE1E.md`.
**Fase inmediata HECHA y verificada (2026-07-25):**

- [x] **Servidor:** 6ª pestaña "Consola" (🖥️) en la barra de KioskPage + fuente
      **7‑segmentos (DSEG7 Classic, OFL) solo en la consola** (en los números;
      etiquetas/unidades/fecha en sans). `public/fonts/DSEG7Classic-Bold.woff2`.
- [x] **Firmware** (`ecowitt-display-kiosk-xe1e`): barra de 6 pestañas (la 6ª → consola
      full‑screen `?page=consola`); tocar la consola en cualquier parte → **regresa a la
      página 1**. Flasheado (COM5) y funcionando.
- [x] **Ajustes visuales**, dados por buenos.
- **Cerrado por decisión (2026-08-19):** "consola como home + zonas de toque por bloque"
  se deja fuera de alcance por ahora, no queda como pendiente activo.

## 2.b Cámara del exterior — ✅ HECHO Y EN PRODUCCIÓN (cerrado 2026-08-19)
**Tapo C325WB, en producción desde 2026-08-17.** Plan completo, comparativa de
modelos y decisiones (ya cerrado como terminado): **`docs/archivo/PLAN-CAMARA-EXTERIOR.md`**.

Resumen de lo esencial, ya resuelto: se integra por **RTSP** (con "cuenta de
cámara" propia de la app Tapo), que es **sólo de red local**, así que un equipo de
casa (la Pi `stn8952`) empuja la foto hacia el VPS — **nunca se abrieron puertos
hacia la cámara**. Quedó en **foto cada 5 min + timelapse diario** (no directo
24/7). Pese a lo que decía esta entrada, añadirla como página del kiosco **no
tocó el firmware** al final (se generalizó el mapeo de zonas táctiles, ver
`PLAN-KIOSCO-NAVEGACION.md`). El **2026-08-19** se instaló el Archer C6 como AP y
la cámara pasó de Wi-Fi a **ethernet**, sin tocar nada del pipeline (ver
`docs/internal/router-ap-archer-c6` en memoria / commits de esa fecha).

## 2.g Radar SACMEX — plan completo, en marcha (anotado 2026-09-23, actualizado 2026-09-24)

Contexto: desde 2026-09-23 el radar del SACMEX se sirve por nuestro backend
(`services/sacmex_radar.py`, últimos ~10 cuadros de reflectividad, uno cada ~5 min)
y se ve en `/radar` con zoom a la CDMX, anillos cada 5 km y el punto de la estación
(calibración de pixeles en `SacmexRadarCard.tsx`: centro (254, 252) px, ~3.3 px/km).

### Plan por fases (orden acordado 2026-09-24)

| Fase | Qué | Estado / cuándo |
|---|---|---|
| 0 | Proxy + tarjeta en `/radar` (09-23), historial de cuadros, decodificador de dBZ v1 y leyenda con colores plenos (09-24) | ✅ hecho y en producción |
| 1 | **Medir qué tan fiable es el servicio del SACMEX** (cuadros recibidos vs ~288/día, huecos, si falla en tardes de tormenta) | acumulando desde 2026-09-24; revisar ~**2026-10-08 a 10-15**. Decide si el radar sirve para avisos o sólo como apoyo visual |
| 2 | **Afinar el decodificador** con cuadros de una tarde de lluvia + casos de prueba reales | en paralelo a la fase 1, en cuanto el historial tenga una tarde de lluvia |
| 3 | **Guardado compacto** (matriz de dBZ) para no depender de los 45 días de JPG | después de la fase 2 y **antes de ~2026-11-07**, cuando la retención empieza a borrar los primeros cuadros |
| 4 | **Movimiento de ecos** (dirección, velocidad, extrapolación de llegada a la estación) | después de la fase 2 |
| 5 | **Usos:** cruce cámara-radar, radar como fuente en la verificación (§2.f), Z-R vs pluviómetro; **aviso por Telegram sólo si la fase 1 sale bien** | después de las fases 2 y 4 |
| 6 | **Estadística e historia** (hora típica de tormentas, mapa de frecuencia, de dónde vienen, eventos, timelapse del radar) | con semanas de historial ya decodificado (fase 3) |

Detalle de cada punto:
- [~] **Leer dBZ de los colores — PRIMERA VERSIÓN 2026-09-24** (`services/radar_decode.py`,
      revisar a ojo con `GET /api/radar/sacmex/decoded/<id>`). Los ecos van en color
      pleno y la leyenda al 40 % sobre blanco (de ahí sale la paleta); se resta un fondo
      (mediana de cuadros repartidos en el historial) porque 35-45 dBZ tienen el color de
      las carreteras, y una apertura de 3 px quita el eco disperso. En la madrugada del
      24 (sin lluvia, arcos de clutter) dejó 0-27 pixeles de ~2,600. La leyenda de la
      tarjeta ya usa los mismos colores plenos (commit 82f62ca).
- [ ] **Afinar el decodificador con una tarde de lluvia** (en cuanto el historial tenga
      una). Con la imagen original y `/decoded/<id>` encimados: que las celdas de lluvia
      salgan completas y con su nivel, que no se cuelen carreteras amarillas/naranjas
      (35-45 dBZ) ni texto del mapa, y que la apertura de 3 px no se coma el borde de
      las tormentas ni las celdas chicas. Ajustar `BG_DIFF`, `PAL_DIST`, `SPECKLE_PX`
      y guardar 2-3 cuadros de lluvia como caso de prueba real en `tests/`. Cruzar el
      dBZ sobre la estación con el pluviómetro de esas mismas horas. El fondo sale de la
      mediana del historial: revisar que una tarde entera de lluvia no se "pegue" al fondo.
- [ ] **Movimiento de las nubes a partir del radar.** Estimar dirección y velocidad
      de los ecos comparando cuadros consecutivos (correlación de fase / flujo óptico
      sobre la máscara de dBZ ≥ ~20). Con eso se puede extrapolar: "hay lluvia de
      35 dBZ a 12 km al NE moviéndose hacia la estación, llegaría en ~20 min".
      Ojo: sólo hay 10 cuadros (~50 min) y en la imagen hay mucho eco disperso
      (probable clutter): habrá que filtrar antes de medir movimiento.
- [ ] **Comparar la cámara con el radar.** La cámara mira al sureste: tomar el sector
      del radar que cae en su campo de visión y cruzarlo con lo que ve la IA
      (`precipitation_visible`, cobertura, "nubes de lluvia formándose"). Serviría para
      (a) validar/calibrar el análisis de la cámara con un dato físico y (b) confirmar
      cuando la cámara ve lluvia "en el horizonte" si de verdad hay ecos en esa dirección.

Usos (fase 5):
- [ ] **Radar como fuente en la verificación de pronósticos** (§2.f): dBZ en el pixel de
      la estación ≈ "llueve ahora"; eco acercándose ≈ "lloverá en <1 h". Se calificaría
      contra el pluviómetro igual que las demás fuentes -- así sabemos si el radar le
      gana a la cámara (hoy la mejor, CSI 45% ahora) y al horario (26% a 3 h).
- [ ] **Estimar mm/h desde el radar** (relación Z-R de Marshall-Palmer) en el pixel de
      la estación y compararlo con la tasa del pluviómetro: calibración local del radar.
- [ ] **Aviso de "lluvia acercándose" con radar** (Telegram, opt-in) cuando haya ecos
      ≥ 35 dBZ a < 10 km moviéndose hacia la estación -- sustituiría con dato real al
      vigilante de vecinas que se quitó.
- [x] **Guardar historial de cuadros — HECHO 2026-09-24.** `radar_archive_task` (cada
      5 min, aunque nadie abra la página) guarda cada cuadro en
      `/data/radar_sacmex/<día local>/`; `GET /api/radar/sacmex/archive` dice cuántos
      lleva. Se guarda el JPG original sin recortar (~220 KB, ~65 MB/día, 45 días ≈
      3 GB; el VPS tenía 29 GB libres): recortar obliga a recomprimir (el recorte en
      JPEG q95 pesaba 88 KB, en PNG 240 KB porque el mapa de fondo es muy detallado) y
      cada pasada de JPEG corre los colores con que después se lee el dBZ. Cuando exista
      el decodificador de dBZ se puede guardar la matriz (mucho más chica) para lo viejo
      y bajar la retención de los JPG.
- [ ] **¿Qué tan fiable es el servicio del SACMEX?** Primero medirlo antes de montar
      nada encima (aviso, verificación). Ya el 24-09 dejó de publicar de las 04:53 a
      las 09:49 (casi 5 h: de madrugada a media mañana). Con el historial sale sin
      pedir nada nuevo (la hora va en el nombre de
      cada cuadro): % de cuadros recibidos contra los esperados (~288/día), huecos más
      largos, a qué hora se cae, y si falla justo en tardes de tormenta (lo peor para
      nosotros). Se podría agregar a `GET /api/radar/sacmex/archive` y a la página de
      estado. Revisar con 2-3 semanas de datos; si es poco fiable, el radar queda como
      apoyo visual y no como fuente de avisos.

Estadística / historia (fase 6; cuando el decodificador esté afinado y haya algunas
semanas de historial):
- [ ] **Hora típica de las tormentas:** % de cuadros con eco ≥ 20 / ≥ 35 dBZ sobre la
      estación (radio ~2 km) por hora del día y por mes. Es la "climatología de lluvia"
      con dato del radar, comparable con la del pluviómetro.
- [ ] **Mapa de frecuencia:** en qué zonas se forman y pasan más tormentas (sierra del
      Ajusco, oriente, etc.), acumulando por pixel cuántas veces hubo eco ≥ 35 dBZ.
- [ ] **De dónde vienen:** dirección y velocidad típicas de las tormentas por mes (sale
      del movimiento de ecos) y cuánto tardan en llegar a la estación desde que se forman.
- [ ] **Eventos:** cada tormenta con inicio, fin, dBZ máximo sobre la estación y mm del
      pluviómetro; lista de "tormentas notables" (≥ 50 dBZ) con fecha.
- [ ] **Timelapse del radar por día** (como el de la cámara) y una vista de historia
      para ver cualquier día guardado, lado a lado con la cámara de esa hora.
- [ ] **Guardar compacto para lo viejo:** la matriz de dBZ del recorte de la CDMX (PNG de
      un canal, casi todo ceros) para que la estadística no dependa de los 45 días de
      JPG. Sin esto, la historia se borra sola.

## 2.f Verificación de pronósticos: ¿quién acierta? — en producción, acumulando (2026-09-23)

`GET /api/forecast/verification` + tarjeta "Precisión del pronóstico" (`/camara`)
califican cada fuente contra lo OBSERVADO (pluviómetro/cámara), no contra otra
fuente. Objetivo: saber a qué señal darle más peso en `forecaster.own_forecast`.

**Primer resultado (30 días, 2026-08-24 → 09-23):**
- *Lluvia ahora:* cámara CSI 45% (avisa 45%, 1% falsas alarmas) vs Open-Meteo
  CSI 14% (avisa 61%, **84% falsas alarmas**). Open-Meteo dice lluvia el
  60-79% del tiempo entre las 15 y 21 h; llovió 10-30%.
- *Lluvia a 3 h:* presión propia CSI 13% (avisa 35%, 83% falsas alarmas).
- *Nubosidad:* Open-Meteo pone +23 puntos de nubes de más (error típico ±35).

- [x] **Presión sin marea atmosférica — PROBADO Y DESCARTADO (2026-09-23).**
      Backtest de 30 días (1434 ventanas de 3 h, "normal" = mediana del Δ3h de
      esa media hora en los 14/30 días PREVIOS, sin mirar el futuro): avisar
      con la anomalía EMPEORA (CSI 10% con -0.5 hPa, 5% con -1 hPa, vs 12.8%
      actual). Referencia clave: avisar lluvia sólo por HORARIO (14-20 h) da
      **CSI 26%** (avisa 61%, 69% falsas alarmas) -- el doble que la presión;
      y "presión bajando Y 14-20 h" (15.5%) es PEOR que el horario solo: en
      las tormentas convectivas de CDMX la presión no anticipa la lluvia a 3 h.
- [x] **HECHO (2026-09-23):** la presión ya no dispara lluvia en
      `own_forecast` (se sigue calificando en la tarjeta como "ya no se usa"), y
      "Solo por horario (14-20 h)" aparece como referencia a vencer. Dato extra:
      para lluvia AHORA, Open-Meteo (CSI 14.2%) ni siquiera le gana al horario
      (14.6%); sólo la cámara (45%) lo supera.
- [ ] Dejar acumular la bitácora (`/data/forecast_log/`) varias semanas de
      lluvias antes de juzgar Open-Meteo/WeatherAPI/SMN/"nuestro pronóstico"
      a 3 h (hoy solo tiene datos la presión, reconstruida).
- [ ] Con eso, re-pesar `own_forecast` según lo que resulte más certero (¿meter el
      horario como señal propia si nada lo supera?).

## 2.e Corrección de sesgo del pronóstico con datos de la cámara — reencauzado (2026-09-14)

Idea derivada de comparar la cámara del exterior con el pronóstico de Open-Meteo
(§2.b, "Análisis del cielo con IA"): si la cámara ve sistemáticamente más (o menos)
nubes de las que predice el modelo a cierta hora o época del año, se le podría
aplicar al pronóstico propio la misma corrección de sesgo que ya se hizo con la
presión y la temperatura del pronóstico horario (commits `be6d6e7`, `2fc1630`).

**Ya hecho, base para esto (2026-08-29):** cada captura guarda ahora su
`match`/`forecast_condition`/`forecast_coverage_pct` en el histórico diario
(`<camera_dir>/analysis/YYYY-MM-DD.json`, ver `CameraStore.save_analysis` /
`_append_to_daily` en `receiver/app/services/camera.py`, y
`_current_forecast_wmo_cloudcover` en `main.py`). También se añadió `GET
/api/camera/analysis/accuracy` para tabular el % de acierto.

**Datos ya acumulados y analizados (2026-09-14, 1149 comparaciones / 16 días):**
exact 21.5%, close 23.8%, differ 54.6%, conflict 0.2%. Desglose real (ver
commits `e22303a`/`fbab1be`): ~40% del "differ" eran saltos de 2-3 escalones
de nubosidad (ruido de clasificación real, no un error del modelo -- se
verificó que NO se debían a una lista de pares mal calibrada, ver
`sky_validation.py`), y el resto (347 casos) era el patrón real: cámara ve
nublado sin lluvia, Open-Meteo predice lluvia en la hora actual.

**Se descartó la corrección de sesgo (offset a Open-Meteo) a favor de otra
solución al mismo problema:** en vez de ajustar el número de Open-Meteo,
`forecaster.own_forecast()` (`GET /api/forecast/own`) hace que la propia
estación (pluviómetro + cámara + presión + vecinas) sea la que decide qué se
muestra como pronóstico inmediato, y Open-Meteo pasa a ser una referencia
aparte y rotulada (`PrecipitationCard.tsx`) en vez de mezclarse sin más --
evita la incongruencia sin necesitar calibrar un offset con más semanas de
datos. Detalle completo de la sesión: commits `e22303a` (recalibración de
`sky_validation.py`) y `fbab1be` (own_forecast).

**Sigue sin hacerse, y probablemente ya no haga falta:** el offset de sesgo
propiamente dicho (por hora del día / época del año). Solo retomarlo si,
tras usar `own_forecast` unos días, se ve que el patrón persiste de forma
que un ajuste fino a Open-Meteo aportaría algo que la nueva jerarquía de
fuentes propias no cubre ya.

No confundir con `GET /api/camera/analysis/validation` (informa "la cámara y
el modelo dijeron cosas distintas ahora mismo"; sigue sin corregir nada, y
sigue siendo así a propósito).

## 2.c Timelapse diario — ✅ HECHO (2026-08-18)

Era la última casilla sin marcar de `PLAN-CAMARA-EXTERIOR.md`, que dejó abierta a
propósito la decisión de "generarlo en el VPS o en casa". **Se hace en el VPS**
(`receiver/app/services/timelapse.py`, ffmpeg en el Dockerfile del receiver) y se ve en
`/pro/camara` con selector de día. Razones y alternativas descartadas, en el plan.

Lo que hay que saber para operarlo:

- **Requiere reconstruir la imagen del receiver**: ffmpeg entra por su Dockerfile. Si
  falta, las fotos siguen llegando y lo único que pasa es que el vídeo no aparece nunca
  — de ahí que `Admin → Cámara` y `/api/camera/diag` digan si está.
- Ajustes en `Admin → Cámara`: fps, mínimo de capturas y retención de los vídeos, más un
  botón de rehacer el de hoy.
- Los vídeos viven en `<camera_dir>/timelapse/`, **fuera** de las carpetas de día y con
  retención propia (90 días): la poda de fotogramas no se los lleva.
- **Medido en producción el 2026-08-18**, porque la cifra que se escribió al implementarlo
  (~2 MB por vídeo) era optimista: 237 capturas de un día ocupan **25 MB** y dan un vídeo
  de **5.9 MB** y 19.8 s, montado en **~10 s** en el ARM del free tier. Con 90 días de
  retención son ~540 MB, contra ~175 MB de los 7 días de fotogramas. Sigue mereciendo la
  pena, pero no es "gratis" como sonaba.

## 2.d CI en rojo desde hacía semanas — ✅ ARREGLADO (2026-08-18)

Encontrado al ir a commitear el timelapse: `main` tenía el CI **rojo**, y por lo mismo
que ya había pasado antes (ver el comentario largo de `receiver/ruff.toml`) — un CI que
falla siempre deja de significar nada, así que nadie mira si lo que rompe es tuyo.

- **Ruff, 3 avisos**, todos de las reglas que ese `ruff.toml` seleccionó por ser "errores
  de verdad": `weatherapi` importado y sin usar en `main.py` (lo usa
  `forecast_consensus`, no él), `timedelta` sin usar en `forecast_consensus.py`, y un
  f-string sin placeholders en `alerts.py` (la `f` se copió de la línea vecina, que sí
  tiene uno). Los tres arreglados.
- **Un test fallando**: `test_local_forecast_rising_high` esperaba que 1025 hPa fuera
  presión "alta", pero el commit `115016d` (2026-08-11) **recalibró los umbrales para la
  CDMX** a propósito —alta ≥ 1030 en vez de ≥ 1022, porque a 2240 m la media local ya es
  1027 y con el umbral estándar casi todo día salía "alto"— y el test se quedó atrás.
  Actualizado a 1032, y añadido otro que fija justo lo que la recalibración buscaba (que
  1027 salga "normal"), para que la próxima vez el test explique el porqué.

Ojo para la próxima: **la versión de Ruff está fijada** en el workflow (0.16.2) y las
reglas en `receiver/ruff.toml`. Subirla debe ser deliberado.

## 2.f Respaldo externo a Cloudflare R2 (sensores, fotos, vídeos) — ✅ HECHO Y EN PRODUCCIÓN (2026-08-31)
Ver **`docs/archivo/PLAN-RESPALDO-R2.md`** y **`docs/backups-r2.md`**. 4 scripts
(`scripts/backup-influx.sh` + `scripts/backup-camera-{fotos,timelapse,analisis}.sh`)
corriendo por cron (3:30/35/40/45 am), credenciales de R2 en Admin → Sistema →
Respaldos (settings.json, no `.env`), alerta de "respaldo desactualizado" en
Admin → Alertas. **Verificado contra el bucket real:** 2,453 objetos, ~311 MiB
subidos con éxito en las 4 categorías.

Bugs reales encontrados y corregidos durante la puesta en marcha (documentados en
`docs/backups-r2.md` para quien toque esto después): los scripts apuntaban a
`localhost:80` (Caddy, fuerza HTTPS del dominio real) en vez de `:8080` (dashboard
directo); el campo Account ID necesitaba aceptar tanto el ID solo como la URL
completa que Cloudflare muestra pegada a él; rclone necesita el `endpoint` entre
comillas simples en la connection string (si no, corta el valor en el primer `:`).

**Incidente 2026-09-08 — 8 días sin correr por permisos.** Los 4 scripts (más
`backup-rubik-site.sh`, agregado después) quedaron committeados sin el bit de
ejecución (`git ls-files -s` mostraba `100644`, no `100755` — se habían
editado/committeado desde Windows). El cron los invoca con `./scripts/...`, así que
fallaban con `Permission denied` en silencio desde el 2026-09-01; sólo se notó al
revisar el repo el 2026-09-08. Fix: `git update-index --chmod=+x` sobre los 6
scripts afectados (los 5 de respaldo + `captura-camara.sh`, que tenía el mismo
problema latente) y commit, para que sobreviva a un clon nuevo — un `chmod +x`
manual en el VPS no se conserva en git y se puede perder en un redeploy futuro. Se
agregó el aviso a `docs/backups-r2.md` §4.

**Vigilancia de cuota del tier gratis de R2: construida pero SIN ACTIVAR** (decisión
del usuario, 2026-08-31). El Cloudflare API Token que hace falta ("Account
Analytics: Read") es de TODA la cuenta — no se puede acotar a un bucket como sí se
puede con las claves S3 — y el usuario prefirió no crear ese token por ahora. El
widget en Admin → Sistema → Respaldos ya existe y no requiere más código: activarlo
es sólo pegar el token si algún día cambia de opinión. La clasificación de
operaciones Clase A/B tampoco se pudo probar contra la API real todavía.

## 2.g HDR automático por posición del sol (cámara) — ❌ CERRADO, bloqueado por la cámara (2026-08-31)

El usuario reportó (2026-08-31) que en las mañanas el sol entra al encuadre de
la cámara (mira al sureste, sin posibilidad de girarla) como una bola que
sobreexpone el aire alrededor — se ve como bruma/nubosidad ligera cerca del
sol aunque el resto de la imagen esté bien. Se investigó parasol físico
(descartado: el C325WB es 106°/56° de FOV, tan gran angular que el sol queda
**dentro** del encuadre, no rozando el lente desde fuera — un parasol no
puede tapar eso sin recortar la imagen) y WDR/BLC (Tapo no lo llama así; el
equivalente es **HDR**, sí soportado por este modelo).

Se construyó `scripts/camara-hdr-auto.py` — enciende/apaga el HDR según la
posición **real** del sol (`GET /api/almanac`, ya lo calcula el servidor)
contra el rumbo fijo de la cámara, en vez de un horario fijo — y se intentó
desplegar en la Pi `stn8952`. **Bloqueado por la cámara, con evidencia real,
no por falta de intento:**

- **pytapo** (API propietaria): tras parchear la librería para que corriera en
  el Python 3.7 de esa Pi, la autenticación falla con "Invalid authentication
  data" / "Incorrect device_confirm value" — probado con la cuenta de cámara
  (verificada válida por RTSP), con `admin`+contraseña de la cuenta TP-Link, y
  con el correo de esa cuenta. Es un bug de compatibilidad sin resolver entre
  `pytapo` y el firmware del C325WB (reporte idéntico y sin respuesta del
  mantenedor: [pytapo#135](https://github.com/JurajNyiri/pytapo/issues/135)).
- **ONVIF** (estándar): autentica bien, pero `GetImagingSettings` en esta
  cámara sólo expone Brillo/Saturación/Contraste/Nitidez — nada de WDR/BLC.

**Conclusión: no hay forma de tocar el HDR/WDR/BLC de esta cámara por software
sin la app**, con el firmware actual (ya es el último disponible). Detalle
completo, incluido el rastro dejado en la Pi (pytapo parcheado instalado,
`libxml2-dev`/`libxslt1-dev` vía apt — primera vez que se tocó apt ahí, ambos
inertes) en **`docs/archivo/PLAN-HDR-CAMARA.md`**. El código
(`scripts/camara-hdr-auto.py` + `scripts/systemd/camara-hdr.*`) se queda en el
repo **sin desplegar/activar** — el cálculo de posición del sol es correcto y
reutilizable si algún día se retoma.

## 2.h Mitigar el halo del sol en el análisis del cielo con IA — ✅ HECHO (2026-08-31)

Pivote de 2.g: en vez de tocar la cámara, se le avisa al modelo de visión. Al revisar
fotos reales de la mañana del 2026-08-31 salió un dato que cambió el diseño: NO es
sólo una bola con halo cerca del sol -- de 8am a casi mediodía (sol ya alto, no
rasante) sale **casi todo el cuadro** en blanco, horas después de que el sol "debería"
haber salido del encuadre por geometría. La radiación solar medida esa mañana subió
limpia de 56 a 700 W/m² sin ningún bache (curva de día genuinamente despejado) --
confirma que el blanco es 100% límite de exposición de la cámara, no niebla real. Con
eso, **no hizo falta calibrar el rumbo de la cámara**: basta con la radiación medida.

`sky_analyzer.sun_glare_likely(altura_solar, radiacion_medida)` compara la radiación
contra una curva de "cielo despejado esperado" (`I0 * sin(altura)^p`, ajustada por
mínimos cuadrados a 6 puntos reales de esa mañana: I0≈793, p≈1.39). Cuando la razón
medido/esperado pasa el umbral, el prompt de Gemini/Claude recibe un aviso explícito
de que la zona blanca es sobreexposición, no nube. Altura solar: `almanac.sun_altitude()`
(pyephem, nuevo helper ligero). Wireado en `main.py::_analyze_sky_background`. 6 tests
en `tests/test_sky_analyzer.py`, anclados a los datos reales medidos ese día.

Documentado en `docs/guias/analisis-cielo.md`. Pendiente real: la curva es de UN solo
día calibrado -- revisar si con más mañanas despejadas el umbral sigue separando limpio.

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

## 5c. Consola — tres mejoras — ✅ HECHO / cerrado (2026-08-19)
Salieron de una ronda de propuestas; se hicieron las dos primeras (alertas en la celda y
próximas horas) y estas tres se dejaron para pensarlas, porque las tres pelean por píxeles
en celdas ya ajustadas y el operador prefirió no forzarlas:

1. ~~**Máximo del día en UV y SOLAR**~~ — ✅ **HECHO (2026-08-08)**. La salida no fue añadir
   una fila (no cabía: en ~90 px útiles ya van rótulo, cifra, categoría y riel) sino
   **conmutar el dato**: idea del operador. De noche, con la lectura viva en cero, la cifra
   grande pasa a ser el máximo del día y el renglón de la unidad o del nivel dice "MÁXIMO",
   las dos cosas en blanco puro; al amanecer vuelven solas. Cero píxeles de sitio nuevo.
2. ~~**Progreso del día**~~ en la celda del sol y la luna — **cerrado por decisión
   (2026-08-19):** se deja fuera de alcance, la celda no tiene hueco para el arco.
3. ~~**Sparkline de 24 h**~~ en EXT y PRES — **cerrado por decisión (2026-08-19):** sin
   hueco sin achicar otra cosa de esas celdas, no se persigue por ahora.

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

## 7. Uniformar la iconografía — ✅ HECHO (cerrado 2026-08-19)

Meter iconos **en todo** y **más grandes**. El inventario que traía esta sección estaba
viejo: decía "hay mucho sin explotar (viento por intensidad, presión, fases lunares…)"
como si fuera descuido, y en realidad `theme/icons.ts` --escrito después-- ya había
decidido y documentado por qué varias de esas familias NO se usaban. Vale la pena tener
claro el porqué antes de volver a proponerlo.

### Lo que se hizo el 2026-08-18

- [x] **El termómetro decía lo contrario que la alerta.** `iconAlerta` daba
      `thermometer-warmer` a TODA clave de temperatura, así que una alerta de `temp_low`
      --o de `feels_low`, con viento helado-- salía con un termómetro rojo de calor. Ahora
      el frío lleva `thermometer-colder` (el mismo dibujo en azul) y el rocío lleva
      `thermometer-raindrop`, que antes compartía icono con las alertas de humedad: dos
      alarmas distintas con el mismo dibujo.
- [x] **`TrendArrow` vs `CONVENCIONES.md`: gana el código.** El documento decía
      `ArrowUp`/`ArrowDown` de Lucide y la implementación nunca lo fue: `TrendArrow.tsx`
      dibuja su propio SVG, una flecha RELLENA que a 16-24 px se lee mejor que la de
      trazo de Lucide. Se alineó el documento con el código, y se dejó dicho que Lucide
      es para la iconografía de INTERFAZ y no para los datos.
- [x] **Las familias graduadas, por fin usables: `MeteoGlyph` en vez de `WeatherIcon`.**
      Aquí estaba el malentendido de fondo. Verificado leyendo los SVG del paquete: las
      variantes **`fill` y `line` están pintadas para fondo CLARO**, y este panel es
      oscuro --el número del Beaufort es `#202939`, la carátula del barómetro `#475569`,
      la brújula casi toda `#1E293B`--. O sea que el rechazo que documenta
      `theme/icons.ts` era de la VARIANTE, no del icono. La variante `monochrome` es
      negro puro y `MeteoGlyph` la tiñe, que es como la consola pinta ya su barómetro.
      Añadidos 31 glifos: `wind-beaufort-0..12`, `barometer-low..extreme`, las 8
      `compass-*` y cinco sueltos. Cuestan **+80 KB al bundle** (+15 gzip) por ir
      incrustados con `?raw`, que es lo que `MeteoGlyph` necesita para poder teñirlos.
- [x] **Herramienta para medir la caja de tinta: `scripts/tinta-meteocons.py`.** La
      cabecera de `MeteoGlyph` remitía a un `scratchpad/tinta.py` que **nunca estuvo en
      el repo**, y sin medir esa caja el glifo sale descentrado dentro de su lienzo de
      128. Ahora se calcula sin abrir el navegador, y está **validada** contra las
      cuatro cajas que se habían medido a mano (reproduce `thermometer` y `barometer`
      exactas). De paso dejó dos cosas aprendidas:
      - Varios Meteocons **laten** (`animateTransform type="scale"` hasta 1.1x): la caja
        tiene que cubrir el máximo del latido o el icono se recorta justo en el pico. Es
        lo que explicaba que la caja de `humidity` fuera mayor que su geometría.
      - El medio píxel de la caja del `windsock` **no era una medida**: su único
        `stroke="black"` vive dentro de un `clipPath` y no se pinta, así que no tiene
        contorno que desborde. Era aire añadido a mano.
- [x] **Dónde se usan: `MiniStats`.** Era la única parte del sitio hecha de texto pelado
      --once casillas sin un solo icono--, así que ahí los glifos informan en vez de
      duplicar. El resto de las tarjetas YA tiene su instrumento propio y mejor que un
      glifo, y eso es lo que hay que recordar antes de "meter iconos en todo": la brújula
      que gira de `WindFlipCard`, la escala Beaufort en segmentos de color de `WindCard`,
      el chevrón de tendencia de `PressureCard`, el `WindArrow` de `StationSummaryTable`.
      Puestos: termómetro, humedad, **barómetro por nivel**, **Beaufort por grado**,
      **brújula por rumbo** (con una casilla de *Rumbo* nueva: el dato llegaba desde el
      primer día y no estaba en la tira), gotas --huecas para la probabilidad y macizas
      para el acumulado, el mismo dibujo diciendo dos cosas--, UV y polvo para el IMECA.

### Cerrado por decisión (2026-08-19) — quedan fuera de alcance por ahora

- **La tira de pestañas del kiosco usa emoji** (☀️ 📍 🏠 📅 📈 🖥️). Sustituirlos por
      glifos teñidos es posible ya (la infraestructura está), pero el kiosco se
      **renderiza a JPEG** y habría que mirar el resultado antes. No se persigue por ahora.
- **`ConsoleReplica`**: ya usa `MeteoGlyph` (no son todos SVG a mano como decía esta
      sección), pero podría usar las familias graduadas nuevas --barómetro por nivel en
      PRES, Beaufort en la celda de viento--. Sus celdas van muy justas de píxeles y
      varias de sus rarezas son **gusto deliberado**; se deja como está.
- **Tamaños "más grandes"**: la escala de `ICON` se queda en 32/48/64/96/140.
- `cardinal()` sigue **duplicado** (`weather.ts:334` y `StationSummaryTable.tsx:75`,
      misma fórmula) — dedupe trivial pero de bajo impacto, se deja para otra ronda.

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

## 8. Revisiones detectadas el 2026-08-03 — REVERIFICADO 2026-08-18

**Aviso: dos de los tres puntos ya estaban arreglados y el tercero era un falso
positivo.** Esta sección se quedó sin actualizar y se usó como lista de trabajo el
2026-08-18, mandando a revisar cosas ya resueltas. Si se arregla algo de aquí, tacharlo
en el momento.

- [x] **SMN sin datos — HECHO (backend y frontend).** La caída sigue siendo de CONAGUA
      (su webservice responde HTTP 500), pero ya se degrada con gracia y se cachea la
      última respuesta buena, que era justo lo que pedía este punto:
      - `smn.py::_daily_all` / `_hourly_for` / `municipios` **sirven la copia guardada
        aunque haya expirado el TTL** cuando el origen falla, y la marcan con `stale` +
        `age_minutes` (edad del DATO, no de la respuesta).
      - `ForecastPage` distingue tres estados: `caido` ("El SMN no está disponible
        ahora"), `sin-municipio` ("El SMN no publica pronóstico para este municipio") y
        el aviso ámbar de dato viejo con su antigüedad. `ForecastCompareCard` también
        rotula "SMN de la última publicación".
      - Residual real, menor: la caché es **en memoria**, así que un reinicio del
        proceso con CONAGUA caído deja el 502 (ya con mensaje decente). Persistirla a
        disco sería la mejora, si alguna vez molesta.
- [x] **Climograma con meses parciales — HECHO.** `ClimatePage` calcula `parcial` (días
      con dato vs. días del mes), pinta esos meses con la trama `climoParcial` en vez
      del relleno liso, el tooltip dice "incompleto: N de M días" y hay nota al pie
      cuando `hayParciales`. No hacía falta decidir nada más.
- [x] **"Mi Tablero no muestra tendencias" — FALSO POSITIVO.** La auditoría buscó
      `TrendArrow|getTrend|TrendBadge` dentro de `MiTableroPage.tsx`, encontró cero y
      concluyó que no había tendencias. Pero **`HomePage.tsx` también tiene cero**: en
      las dos páginas las tendencias viven en los componentes hijos
      (`CurrentConditions`, `ExtraSensorsCard`, `PressureCard`, `RemoteStationCard`,
      `StationSummaryTable`), y Mi Tablero les pasa `history` exactamente igual que
      Inicio --comparadas una por una las invocaciones de ambos ficheros--. No había
      nada que arreglar. Lección: grepear una página por el helper no dice si la
      tendencia se ve; hay que mirar qué reciben los hijos.
- [x] **Lo que sí destapó la comparación: Mi Tablero le faltaban dos tarjetas.**
      `CameraCard` y `SkyAnalysisCard` estaban en Inicio y **no figuraban en el
      catálogo** de Mi Tablero, mientras su propio `PageInfo` promete "las mismas
      tarjetas del Inicio". Añadidas el 2026-08-18: análisis del cielo con `span 1`
      (como en Inicio, bajo las condiciones) y cámara con `span 3` (una foto en una
      columna de un tercio se queda en miniatura). Las dos entran en `DEFAULT`, que
      sólo afecta a quien llega nuevo --el resto tiene su selección en localStorage--.
      La cámara aquí **no** lleva `ocultarSiVacia`: si el usuario la eligió a mano,
      esconderla parece que la selección no funcionó, y en modo edición dejaría un
      marco vacío imposible de arrastrar.

---
### Hecho reciente (referencia)
- Alertas: humedad, tendencia de presión (2 niveles), histéresis anti‑spam,
  habilitar/deshabilitar por alarma, UI en Admin, valores CDMX. (commits 38686c2,
  e9e0423, 2eaa95a, 7a82c4a, 69400dc)
- Página de consola `?page=consola` (commits 544341f, acf7216).
- Presión relativa por altitud, whitelist de passkey, registro por MAC (ver git).
- `/api/camera/latest.jpg` acepta HEAD además de GET (commit 108cf26) --
  faltaba para que AWEKAS aceptara el link de webcam. Además, Cloudflare
  bloqueaba el fetch de AWEKAS a esa URL (no a un cliente normal) -- solución
  fue el enlace directo `http://<IP_VPS>:8080/...`, sin pasar por Cloudflare.
  Detalle en `docs/api-reference.md` → "Cámara del exterior".
