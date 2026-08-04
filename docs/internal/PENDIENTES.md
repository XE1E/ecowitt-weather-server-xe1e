# Pendientes — Estación Clima XE1E

> Lista viva de trabajo pendiente. Vive en git (sobrevive cambios de PC).
> Última actualización: 2026-08-03.

## 1. Cuando llegue el WN32 (~2026-08-08) — depende de hardware
En la **estación Remota** habrá 2 sensores: **WN32 = exterior** y el **integrado del
GW1100 = interior** (se **apaga la trampa** `treat_indoor_as_outdoor`).
Nomenclatura se queda: **Principal = WS2910**, **Remota = GW1100**.

- [ ] Apagar la trampa del GW1100 en Admin → Estaciones ("Está a la intemperie").
- [ ] **Alerta de moho:** hoy usa `humidity_high=65` sobre `humidity_outdoor` (por la
      trampa). Al quitarla, la humedad del GW1100 vuelve a `humidity_indoor` → hay que
      **agregar regla de humedad interior** en `alerts.py` (hoy solo evalúa
      `humidity_outdoor`) y mover ahí el umbral de moho.
- [ ] **Barrido interior/exterior en TODO el servidor.** Al quitar la trampa dejan de
      coincidir "lo que el GW1100 manda" con "lo que el servidor rotula", así que hay
      que revisar a detalle, extremo a extremo, que las lecturas del **WN32 salgan
      como exteriores** y las del **integrado del GW1100 como interiores**. No basta
      con el toggle: la trampa se aplica en `main.py` al ingerir (`treat_indoor_as_outdoor`,
      hoy en `main.py:391`, default `False` en `settings_store.py`), pero el rótulo
      interior/exterior se decide por separado en cada consumidor. Repasar al menos:
      - `_detect_sensors_detail` en `main.py` (qué fila muestra cada sensor).
      - Tarjetas del dashboard: `RemoteStationCard`, `InteriorCard`, `ExtraSensorsCard`,
        `AtmosphericProfile`, `StationSummaryTable` y la página `/pro/remota`.
      - `ConsoleReplica`: la celda REMOTA y PRESIÓN GW1100 leen `temperature_indoor` /
        `humidity_indoor` del GW1100; con WN32 hay que decidir si esa celda pasa a
        exterior o se separa en dos.
      - Datos derivados de la remota: punto de rocío (`dewPointC` en `remote.ts`) y
        cualquier sensación térmica — con la trampa se calculaban sobre lecturas
        rotuladas exterior.
      - Salidas hacia afuera: `/api/svitrix` (reloj Ulanzi), widget embebible,
        `/api/display.jpg` y la publicación a redes públicas (WU/AWEKAS), donde mandar
        una lectura interior como exterior sí tiene consecuencias.
      - Histórico ya guardado: las filas del 2026-07-24 en adelante quedaron con la
        semántica de la trampa. Decidir si se reetiquetan o se deja la discontinuidad
        documentada.
- [x] Presión: la lógica "presión en fila Exterior cuando no hay sensor interior"
      (`main.py::_detect_sensors_detail`) se **auto-revierte** — al haber interior otra
      vez, la presión vuelve a esa fila. Sin cambio.

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
El GW1100 ya está en línea y reporta `signal_*` (0‑4). Falta la UI: barras/íconos de
señal por sensor (p. ej. en `AdminEstacionConfig` / tarjeta de sensores).

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
