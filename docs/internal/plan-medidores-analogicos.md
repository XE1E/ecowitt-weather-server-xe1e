# Plan: Medidores Analógicos de Alta Calidad

**Fecha**: 2026-07-29 · **Implementado**: 2026-09-09
**Estado**: HECHO
**Referencia visual**: Estilo AWEKAS / **plugin "SteelSeries Weather Gauges" de WeeWX**
(captura de referencia: <https://weewx.com/screenshots/slavalru.png> — pedida por el
usuario el 2026-09-09).

**Sobre la referencia WeeWX y licencias:** esos medidores NO son WeeWX
(GPLv3) en sí — son un plugin/skin de terceros que envuelve una librería
aparte ("steelseries.js", de Gerrit Grunwald) con su propia licencia, que no
se verificó a detalle. De cualquier forma, solo se tenía una captura PNG (no
el código/SVG original), así que no había nada literal que "copiar": se
recreó el **estilo** (bisel metálico, carátula crema, zonas de color,
aguja, pantalla LCD — un lenguaje visual de instrumentación genérico, no
exclusivo de ningún proyecto) con **SVG propio de cero**, sin vendorizar
ningún asset ni código de terceros. Ver la sección "Implementación real"
más abajo para el resultado final (difiere del plan original en varios
detalles de proporciones/radios, ajustados durante la verificación visual).

## Objetivo

Crear componentes de medidores (gauges) con apariencia de instrumentos analógicos de alta calidad, similar a los de AWEKAS. Deben simular medidores físicos reales con detalles como:
- Bisel metálico con reflejos
- Carátula con gradientes sutiles
- Agujas con sombra y centro decorativo
- Marcas de escala precisas
- Números legibles y bien posicionados
- Efecto de cristal/vidrio sutil

## Medidores a Implementar

### 1. Termómetro (Temperatura)

```
┌─────────────────────────────┐
│      ╭───────────────╮      │
│     ╱   TEMPERATURA   ╲     │
│    │    ·  ·  ·  ·     │    │
│    │  -10  0  10  20   │    │
│    │ ·               · │    │
│   -20       ↗        30│    │
│    │ ·    23.5°C     · │    │
│    │  40          50   │    │
│    │    ·  ·  ·  ·     │    │
│     ╲       °C        ╱     │
│      ╰───────────────╯      │
└─────────────────────────────┘
```

**Especificaciones:**
- Rango: -20°C a +50°C (configurable para imperial: -4°F a 122°F)
- Zonas de color:
  - Azul: < 10°C (frío)
  - Verde: 10-25°C (confortable)
  - Amarillo: 25-35°C (cálido)
  - Rojo: > 35°C (caliente)
- Valor digital centrado debajo de la aguja
- Indicador de tendencia (flecha arriba/abajo)

### 2. Barómetro (Presión Atmosférica)

```
┌─────────────────────────────┐
│      ╭───────────────╮      │
│     ╱    BARÓMETRO    ╲     │
│    │ LLUVIA    SECO   │     │
│    │  960  980 1000   │     │
│    │ ·               · │    │
│  950       ↗       1020│    │
│    │ ·  1013.2 hPa   · │    │
│    │  1040        1060 │    │
│    │    VARIABLE      │     │
│     ╲      hPa        ╱     │
│      ╰───────────────╯      │
└─────────────────────────────┘
```

**Especificaciones:**
- Rango: 950-1050 hPa (o 28.0-31.0 inHg)
- Zonas con etiquetas:
  - "TORMENTA" / "LLUVIA" (< 1000 hPa)
  - "VARIABLE" (1000-1020 hPa)
  - "BUEN TIEMPO" / "SECO" (> 1020 hPa)
- Tendencia de 3 horas (flecha)
- Segunda aguja fina para "presión hace 3h" (opcional)

### 3. Anemómetro (Velocidad del Viento)

```
┌─────────────────────────────┐
│      ╭───────────────╮      │
│     ╱     VIENTO      ╲     │
│    │   0   10   20    │     │
│    │ ·               · │    │
│    │30      ↗       40│     │
│    │ ·    15 km/h    · │    │
│    │  50          60   │    │
│    │    RÁFAGA: 23    │     │
│     ╲     km/h        ╱     │
│      ╰───────────────╯      │
│         N                   │
│       W ✦ E    [brújula]    │
│         S                   │
└─────────────────────────────┘
```

**Especificaciones:**
- Rango: 0-100 km/h (escala no lineal, más detalle en 0-40)
- Zonas Beaufort con colores:
  - Verde: Calma a brisa (0-20 km/h)
  - Amarillo: Viento moderado (20-40 km/h)
  - Naranja: Viento fuerte (40-60 km/h)
  - Rojo: Temporal (> 60 km/h)
- Indicador de ráfaga máxima
- Mini brújula de dirección debajo o integrada

## Arquitectura Técnica

### Componente Base: `AnalogGauge.tsx`

```typescript
interface GaugeProps {
  value: number
  min: number
  max: number
  unit: string
  title: string
  zones?: Array<{start: number, end: number, color: string, label?: string}>
  ticks?: {major: number, minor: number}
  trend?: 'up' | 'down' | 'stable'
  secondary?: {value: number, label: string}  // segunda aguja
  size?: 'sm' | 'md' | 'lg'
}
```

### Renderizado SVG

1. **Capa base**: Círculo con gradiente radial (efecto 3D)
2. **Bisel**: Anillo exterior con gradiente metálico
3. **Zonas de color**: Arcos con colores semitransparentes
4. **Marcas de escala**: Líneas major/minor con rotación
5. **Números**: Texto posicionado en arco
6. **Aguja**: Path con gradiente, sombra drop-shadow
7. **Centro**: Círculo decorativo (tornillo/pivote)
8. **Cristal**: Overlay con gradiente de brillo

### Animaciones

- Aguja: Transición suave con easing (spring physics)
- Valor: Contador animado al cambiar
- Tendencia: Fade in/out sutil

## Archivos a Crear

```
dashboard/src/components/gauges/
├── AnalogGauge.tsx      # Componente base reutilizable
├── TemperatureGauge.tsx # Wrapper con config de temperatura
├── PressureGauge.tsx    # Wrapper con config de presión
├── WindGauge.tsx        # Wrapper con velocidad + dirección
├── gauges.css           # Estilos compartidos (gradientes, sombras)
└── index.ts             # Exports
```

## Página de Destino

Crear nueva página `GaugesPage.tsx` accesible desde el menú, o integrar en página existente como sección "Instrumentos".

## Estimación

- AnalogGauge base: 2-3 horas (el más complejo, SVG detallado)
- TemperatureGauge: 30 min
- PressureGauge: 30 min  
- WindGauge: 1 hora (incluye brújula)
- Integración y ajustes: 1 hora

**Total estimado: 5-6 horas**

## Implementación real — 2026-09-09

Difiere del plan original en varios puntos (decisiones tomadas durante la
implementación, con confirmación del usuario para alcance y ubicación):

- **12 medidores, no un subconjunto**: temperatura, punto de rocío,
  humedad, viento (velocidad), dirección del viento (brújula 360°
  completa, sin el hueco de 90°), rosa de vientos, presión, lluvia
  acumulada del día, tasa de lluvia, UV, radiación solar y base de nubes
  (`cloud_base`, ya calculado por el servidor). Todos con datos reales ya
  disponibles en `useStationData()`, salvo la rosa de vientos
  (`/api/wind/rose?start=-7d`, fetch propio de la página).
- **Página nueva "Instrumentos"** en la barra de navegación (no una
  sección dentro de otra página): `/pro/instrumentos`, ruta agregada en
  `main.tsx` y `StationLayout.tsx` (`NAV_ACTIVE`).
- **Archivos reales** (`dashboard/src/components/gauges/`):
  - `AnalogGauge.tsx` — el medidor de aguja genérico (10 de los 12: todos
    salvo dirección y rosa de vientos). Recibe zonas de color, ticks
    mayor/menor, título, unidad y decimales.
  - `CompassGauge.tsx` — variante para dirección del viento: círculo
    completo de 360° (no el barrido de 270° con hueco de las demás),
    rótulos cardinales N/NE/E/SE/S/SO/O/NO en vez de números.
  - `GaugeFrame.tsx` — marco circular con el mismo bisel (bordes
    metálicos) para envolver contenido que NO es un dial de aguja; se usa
    para la rosa de vientos, que **reutiliza el componente `WindRose.tsx`
    ya existente** (compacto) en vez de reconstruir un histograma polar
    desde cero. Su interior usa los colores de tema normales
    (`var(--surface)`/`var(--ink)`, adaptables claro/oscuro), no la
    carátula crema de los demás -- retemar `WindRose` solo para esta
    página no valía el esfuerzo.
  - `index.ts` — exports. No se creó `gauges.css` ni wrappers por variable
    (`TemperatureGauge.tsx`, etc.): un solo componente genérico
    parametrizado cubre los 10 medidores de aguja, no hacía falta un
    wrapper por cada uno.
- **Convención angular**: bearing 0° = arriba, sentido horario --misma
  convención que ya usaba `WindRose.tsx` (`pt()`)--, así que el código
  nuevo la reutiliza en vez de inventar otra. Barrido de 270° con hueco de
  90° abajo (bearing 225°→495°) para los medidores de aguja normales;
  360° completos sin hueco para la brújula.
- **Ajuste de proporciones tras verificación visual real** (capturas con
  Playwright contra el dev server, no solo revisión de código): la
  primera versión tenía el título encimado con los números de la escala
  en los 12 medidores (el bearing 0°/arriba casi siempre cae cerca de un
  tick, y el título compartía esa misma zona). Se resolvió apretando el
  anillo de marcas/números contra el borde exterior (0.60-0.92 × radio de
  carátula) y bajando el título a 0.20 × radio, con margen de sobra entre
  ambos. También se cambió el bisel de `GaugeFrame` de gradiente lineal a
  `conic-gradient` -- con lineal, el reflejo metálico solo se veía en una
  porción del anillo circular, casi invisible en algunos ángulos.
- **Unidades**: cada medidor usa las mismas funciones de conversión que ya
  usa el resto del sitio (`u.tempN`, `u.windN`, `u.pressN`, `u.rainN`,
  `u.rateN`); los anclajes de zona (p. ej. "35°C = calor") se definen en
  métrico y se convierten con la misma función, así caen en el mismo punto
  real de la escala sin importar el sistema de unidades. Base de nubes no
  tenía conversor numérico en `units.tsx` (solo `alt()`, que da un string
  ya formateado) -- se agregó una conversión local en la página
  (`m / 0.3048` si es imperial).
- Verificado: `npx tsc --noEmit` limpio. Verificación visual con
  Playwright (Chromium headless) contra el dev server de Vite -- no con
  datos reales de la estación (el dev server no tiene proxy al backend),
  pero sí confirma el estado "sin dato" (`--`) y el layout/estilo de los
  12 medidores. Pendiente: verificar visualmente con datos reales una vez
  desplegado, y el modo imperial (no se pudo probar interactivamente por
  limitaciones del entorno de pruebas -- sí se revisó a mano que las
  conversiones no producen NaN ni crashean).
- **Falsa alarma tras desplegar** (2026-09-09): con datos reales, la aguja
  de Presión parecía apuntar al lado equivocado en una captura de página
  completa a baja resolución. Se verificó con el `transform="rotate(...)"`
  real extraído del DOM (Playwright + `page.evaluate`) y con una captura
  recortada solo de ese medidor: la aguja SÍ apuntaba donde debía (1027 mb,
  borde gris→verde) -- el error fue de lectura visual de una miniatura
  comprimida, no del código. Lección: para verificar posición de aguja,
  recortar el elemento (`elementHandle.screenshot()`) o leer el atributo
  del DOM, no confiar en una captura de página completa a baja resolución.

## Referencia adicional: Medusa (HanSolo) — 2026-09-09

El usuario señaló <https://github.com/HanSolo/medusa/wiki/Gauge-Skins>
(mismo autor que steelseries.js, Gerrit Grunwald) pidiendo mejorar el
realismo del bisel y el detalle de carátula/escalas, especialmente
inspirado en sus skins LCD/Digital.

**Licencia verificada** (`gh api repos/HanSolo/medusa/license`):
**Apache License 2.0** — permisiva de verdad, a diferencia de la duda sobre
el plugin de WeeWX. Pero **no aplica de todos modos**: Medusa es una
librería **JavaFX** (Java de escritorio), no JavaScript — no puede correr
en un navegador sin importar la licencia. Se usó solo como referencia
visual (misma lógica que la captura de WeeWX), nunca como código a
importar.

**Mejoras de realismo aplicadas** (`AnalogGauge.tsx`, `CompassGauge.tsx`,
`GaugeFrame.tsx`):
- Bisel: gradiente lineal de 7 paradas (antes 4) para un reflejo
  metálico con luz y sombra reales, más una **ranura oscura** entre el
  bisel y la carátula (profundidad, como el borde maquinado de un
  instrumento real).
- **Reflejo de cristal**: gradiente radial semitransparente sobre la
  carátula (blanco en la esquina superior-izquierda, desvaneciendo a
  transparente) simulando el vidrio del medidor.
- **Pantalla LCD**: tinte verdoso clásico (`#cdd9bd`, no blanco/crema) con
  un marco recesado (rect más oscuro detrás, desplazado 1px) simulando la
  sombra interior de una ventana LCD real.
- Remaches del bisel con highlight/sombra propios (antes un solo color).

## Segunda ronda de correcciones — 2026-09-09

Feedback del usuario tras ver el resultado con datos reales en producción:
más subdivisiones de escala, el LCD encimado con los números, la aguja
detrás del LCD, agujas más gruesas, bisel más grueso, y si se podían
simular dígitos LCD de 7 segmentos de verdad (no solo una fuente
monoespaciada).

- [x] **Más divisiones/subdivisiones**: `minorStep` de cada medidor en
      `InstrumentosPage.tsx` reducido a la mitad o más (4-5 subdivisiones
      por marca mayor, antes 1-2).
- [x] **LCD encimado con los números — corregido reposicionando, no
      agrandando el hueco**: el LCD vivía a media carátula
      (`cy + faceR*0.32`), que coincide justo con donde caen los números
      de las esquinas inferiores (bearing 135°/225°, los más cercanos al
      hueco de abajo). Se movió pegado al centro (`cy + size*0.05`, justo
      debajo del cubo de la aguja) y se angostó (`0.30×size` en vez de
      `0.37×size`), dejando margen real contra esas esquinas.
- [x] **Aguja detrás del LCD — orden de pintado**: en SVG el orden del
      marcado determina qué queda encima. El LCD se movió ANTES que la
      aguja en el JSX (antes iba después), y el reflejo de cristal se
      movió al final de todo (es el vidrio que cubre el instrumento
      completo, aguja incluida).
- [x] **Agujas más gruesas, forma ancha→angosta**: base casi duplicada
      (`size*0.026` de semi-ancho, antes `0.014`), sigue afilando a un
      punto en la punta.
- [x] **Bisel más grueso**: `faceR = R - size*0.075` (antes `0.045`) en
      `AnalogGauge`/`CompassGauge`; `GaugeFrame` (rosa de vientos) subido
      de `0.09` a `0.11` para que combine.
- [x] **Dígitos LCD de 7 segmentos de verdad**: nuevo
      `SevenSegmentDisplay.tsx` -- cada dígito son 7 `<line>` (segmentos
      a-g) con extremos redondeados; los segmentos APAGADOS se dibujan
      también, en un verde "fantasma" apenas visible, igual que una LCD
      real (no aparecen/desaparecen, están siempre ahí, solo cambian de
      tono). El punto decimal no ocupa celda propia. Aplicado solo en
      `AnalogGauge` (siempre son números) -- `CompassGauge` se queda con
      texto normal porque su LCD muestra letras (`259° SSO`), que un
      7-segmentos no puede representar con claridad; en su lugar se le
      ensanchó el recuadro (`0.42×size`, antes `0.37×size`) para que quepa
      el rumbo de 3 letras más largo sin recortarse.
  - **Bug encontrado y corregido durante la verificación visual**: la
    primera versión de `SevenSegmentDisplay` nunca recibía la coordenada
    `y` en `DigitCell` -- los dígitos se dibujaban todos arriba de la
    carátula (cerca de `y≈0`), no dentro del recuadro LCD. Se vio como dos
    "píldoras verdes" raras encima de cada bisel en la primera captura.
    Encontrado con Playwright + captura, no leyendo el código.
- Verificado con capturas recortadas por elemento (`elementHandle.screenshot()`,
  más preciso que la página completa) de Temperatura, Presión, Base de
  nubes y Dirección: bisel visiblemente más grueso, LCD limpio sin
  encimarse con números, aguja cruzando por ENCIMA del LCD, dígitos de 7
  segmentos legibles con los segmentos apagados tenues de fondo. `tsc`
  limpio.

## Tercera ronda de correcciones — 2026-09-09

El usuario probó los dígitos de 7 segmentos en el navegador real y no se
veían bien (aunque en las capturas de Playwright de la sesión anterior sí
se veían correctos) -- se revierte esa parte. Además pidió más
subdivisiones (con un tercer nivel de marca, no solo mayor/menor), que las
marcas fueran SOBRE el arco de colores en vez de en un anillo aparte más
adentro (para liberar espacio de carátula), y que los puntos cardinales de
Dirección salieran del anillo de marcas hacia el borde.

- [x] **7 segmentos revertido**: se borró `SevenSegmentDisplay.tsx`
      (código muerto, no se deja sin usar). `AnalogGauge` vuelve al
      `<text>` monoespaciado de antes, con un `feDropShadow` sutil nuevo
      (`filter`, no clase CSS -- los filtros SVG no heredan de Tailwind)
      para darle algo de profundidad sin la complejidad de los segmentos.
- [x] **Marcas sobre el arco de colores**: antes el arco de color vivía
      AFUERA del anillo de marcas (`zoneR=0.92` > `tickOuterR=0.84`,
      radios relativos a `faceR`); ahora comparten la misma banda exterior
      (`tickOuterR=0.94`, `zoneR=0.87` cruzando por en medio de las
      marcas), liberando toda la zona centro-carátula.
- [x] **Tercer nivel de marca** (`midStep`, prop nueva en `AnalogGauge`):
      marca media SIN número entre dos marcas mayores (p. ej. temperatura
      0→10 con mayor en 0 y 10, media en 5) más `minorStep` para la
      subdivisión más fina (de 1 en 1 en temperatura, proporcional en el
      resto). Los tres niveles se dibujan con distinto grosor/opacidad
      (mayor > medio > menor) y `range()` filtra duplicados (una marca
      menor que cae justo en un valor mayor o medio no se redibuja).
- [x] **Puntos cardinales afuera de las marcas** (`CompassGauge`):
      `labelR` pasó de estar DENTRO del anillo de marcas (0.60, menor que
      `tickOuterR` 0.84) a estar AFUERA (0.92, mayor que el nuevo
      `tickOuterR` 0.78) -- ahora se leen como en una brújula física, con
      las marcas de grado hacia adentro. De paso, más subdivisión ahí
      también (marca cada 5°, antes cada 10°).
- Verificado con capturas por elemento (Temperatura, Dirección): los tres
  niveles de marca cruzan visiblemente el arco de color, N/NE/E/SE/S/SO/O/NO
  quedan claramente afuera del anillo de grados. `tsc` limpio.

## Cuarta ronda: arco más amplio — 2026-09-09

El usuario compartió un recorte de la captura de referencia (WeeWX
SteelSeries) y pidió extender el arco de la escala para que el primer y
último valor queden más abajo, dando más espacio libre al recuadro LCD.
Aprovechó para preguntar qué decía el texto en ruso de la captura original
(«снаружи»/«внутри» = exterior/interior — selector de sensor, no relevante
para este proyecto más allá de la referencia visual).

- [x] `AnalogGauge`: `START` 225→210, `SWEEP` 270→300 (hueco de abajo de
      90° a 60°). Solo afecta a `AnalogGauge` -- `CompassGauge` ya usa 360°
      completos sin hueco, no le aplica.
- Verificado con captura por elemento (Temperatura) y de página completa
  (los 12 medidores): el primer/último valor quedan más abajo, más
  parecido a la referencia, y el LCD gana margen arriba. `tsc` limpio.

## Notas

- Usar SVG nativo, no librerías externas (mantener bundle pequeño)
- Responsive: tamaños sm/md/lg con escalado proporcional
- Tema: Adaptar colores a dark/light mode
- Accesibilidad: Incluir aria-labels con valores actuales

## Quinta ronda: marcas más cortas, arco más angosto — 2026-09-09

Pedido: acortar las líneas de marca, angostar el arco de colores, y pegar
los números al extremo interior de la marca mayor, todo para ganar espacio
libre en el centro de la carátula.

- [x] `AnalogGauge`: `tickMajorInnerR` 0.72→0.82, `tickMidInnerR`
      0.78→0.86, `tickMinorInnerR` 0.84→0.90 (marcas más cortas, más
      pegadas al borde). `labelR` 0.60→0.72 (números casi tocando la
      marca mayor). Arco de color `strokeWidth` `size*0.05`→`size*0.035`
      (más angosto).
- [x] `CompassGauge`: mismo criterio, `tickMajorInnerR` 0.58→0.68,
      `tickMinorInnerR` 0.70→0.74 (marcas más cortas; los cardinales ya
      estaban afuera desde la ronda anterior, sin cambio ahí).
- Verificado con capturas por elemento (Temperatura, Presión, Dirección)
  y de página completa: notoriamente más espacio libre en el centro de
  cada carátula. `tsc` limpio.

## Sexta ronda: LCD más abajo, Presión más ancho, selector ext/int — 2026-09-09

- [x] **LCD más abajo en todos**: `lcdY` `cy + size*0.05` → `cy + size*0.08`
      (`AnalogGauge` y `CompassGauge`) -- el arco más amplio de la ronda
      anterior dejó margen de sobra debajo del cubo de la aguja.
- [x] **Presión con LCD más ancho**: nuevo prop `lcdWide` en
      `AnalogGaugeProps` (`lcdW` `size*0.30` → `size*0.38` cuando está
      activo) para que quepan los 4 dígitos + decimal (p. ej. "1027.4").
      Solo Presión lo usa por ahora.
- [x] **Selector exterior/interior en Temperatura**: como en la captura de
      referencia (radio buttons «снаружи»/«внутри» = exterior/interior).
      Estado local (`tempSource`) en `InstrumentosPage.tsx`, dos
      `<input type="radio">` reales (no botones-píldora como en otras
      páginas del sitio) debajo del medidor, para parecerse a la
      referencia. Mismo rango/zonas de escala para ambos sensores (no se
      resiembra el gauge al cambiar, solo cambia qué dato alimenta la
      aguja/LCD).
- Verificado con Playwright simulando el clic en "Interior": el selector
  cambia de estado correctamente, sin errores de consola. `tsc` limpio.

## Séptima ronda: selector ext/int también en Humedad — 2026-09-09

Mismo patrón que Temperatura. Se refactorizó a un componente local
`ExtIntToggle({ name, value, onChange })` dentro de `InstrumentosPage.tsx`
para no duplicar el bloque de radios -- `name` único por instancia para
que los dos grupos de radio buttons no se interfieran entre sí.

- [x] Estado local `humSource`, gauge de Humedad usa
      `humSource === 'out' ? data?.humidity_outdoor : data?.humidity_indoor`.
- Verificado con Playwright: 2 selectores encontrados en la página
  (Temperatura + Humedad), ambos cambian a "Interior" correctamente al
  hacer clic, sin errores de consola. `tsc` limpio.

De paso, el usuario compartió otra captura de referencia (gauge de "punto
de rocío" con 5 opciones en ruso: точка росы/по ощущению/с учетом
ветра/по ощущению/индекс влажности -- dew point, sensación térmica,
ajustado por viento, sensación otra vez, índice de humedad). Por ahora
solo se documenta la traducción; no se implementó un selector de 5 vías
para Punto de rocío (pendiente si se pide explícitamente).

## Octava ronda: fix animación de aguja + títulos en negritas — 2026-09-09

**Bug reportado:** "cuando carga la pagina con los instrumentos las agujas
tienen un movimiento fuera de las caratulas y cuando selecciono
interior/exterior la aguja se mueve fuera del centro no teniendo un giro
natural y suave".

**Causa raíz:** la aguja rotaba con el atributo SVG `transform="rotate(a,
cx, cy)"`, animado vía `transition` de CSS. El navegador interpola ese
`transition` descomponiendo la matriz resultante en traslación + rotación
por separado (no como un giro puro alrededor del pivote), así que durante
la animación la aguja se "sale" del centro en vez de barrer limpiamente.

**Fix** (`AnalogGauge.tsx` y `CompassGauge.tsx`): se reemplazó el atributo
SVG por la propiedad CSS `transform: rotate(${angle}deg)` combinada con
`transformOrigin: '${cx}px ${cy}px'` fijo, ambos vía `style` en el `<g>`
que envuelve el polígono de la aguja. Con `transformOrigin` explícito el
navegador interpola un giro puro alrededor del pivote, sin descomposición.

**Verificación:** un primer intento de verificar con capturas de pantalla
(`toggle_0.png` ... `toggle_3.png`) fue engañoso -- por el overhead de
`click()`/`screenshot()` de Playwright, las capturas mostraban la aguja ya
asentada, pareciendo que la transición no ocurría. Se cambió el método a
muestreo directo de `getComputedStyle(needleG).transform` dentro de
`page.evaluate()`, primero con una transición alargada a 3s (para que el
efecto fuera inequívoco) y luego reconfirmando con la duración real de
0.6s: en ambos casos todas las matrices muestreadas fueron giros puros
(sin componente de traslación), asentando limpiamente ~600-630ms después
del clic. Esto confirma que el fix es correcto y que el problema original
era real (no un artefacto de la prueba).

**Títulos en negritas:** por pedido explícito del usuario ("poner todos
los titulos de las caratulas... en negritas igual que texto
interior/exterior"), se cambió `fontWeight` de 600 a 700 en el texto de
título de `AnalogGauge.tsx` y `CompassGauge.tsx`, y la clase de Tailwind
del título en `GaugeFrame.tsx` de `font-semibold` a `font-bold`.

- [x] `tsc --noEmit` limpio tras ambos cambios.
- [x] Verificado visualmente con Playwright contra el dev server
      (mock de `/api/current` y demás endpoints): las 12 carátulas
      muestran su título en negritas y las agujas están correctamente
      centradas en reposo.

## Novena ronda: selector de 4 vías en Punto de rocío — 2026-09-09

Retomando la captura de referencia compartida antes (gauge "точка росы" con
5 radio buttons en ruso), se tradujo el texto: точка росы (punto de rocío),
по ощущению (sensación térmica, aparece DOS veces en la captura -- se trata
como una sola opción real), с учетом ветра (con efecto del viento / wind
chill), индекс влажности (índice de humedad / humidex). Confirmado con el
usuario: son 4 opciones distintas, no 5.

Se implementó `DewPointToggle` en `InstrumentosPage.tsx` (mismo patrón que
`ExtIntToggle` pero en grid 2x2 -- 4 etiquetas en una sola fila no caben en
el ancho de 200px del medidor):

- [x] Estado `dewSource: 'dew' | 'feels' | 'wind' | 'humidex'`, mapeado a
      los campos ya existentes en `WeatherData`: `dew_point`, `feels_like`,
      `wind_chill`, `humidex` respectivamente. El título del medidor se
      queda fijo en "Punto de rocío" (igual que Temperatura/Humedad no
      cambian de título al alternar exterior/interior).
- El campo `heat_index` (índice de calor, "sensación" pero solo por
  humedad, sin viento) queda disponible pero SIN usar -- sería la 5ª
  opción si el duplicado de la captura resultara no ser un error de la
  skin original; no se agregó porque no hay forma de confirmarlo.
- Verificado con Playwright (mock de 4 valores distintos): las 4 opciones
  alternan el valor mostrado en el LCD correctamente (9.2 / 17.0 / 15.5 /
  20.3 para punto de rocío / sensación / con viento / índice de humedad).
  `tsc --noEmit` limpio.

## Décima ronda: promedio de 10 min en Dirección (aguja azul) — 2026-09-09

Otra captura de referencia (gauge ruso de rumbo): letras cardinales С/В/Ю/З
(Norte/Este/Sur/Oeste en ruso -- mismo С/В/Ю/З que N/E/S/O), dos LCD:
"последнее время" ("última lectura", el actual) y "в среднем" ("en
promedio"). El usuario pidió agregar el promedio de 10 min con aguja azul,
dejando la actual en rojo.

**Backend (cálculo del promedio):** Ecowitt no manda un promedio de rumbo
(igual que no manda uno de velocidad -- ver `get_wind_avg10m`). Se agregó
`StorageService.get_wind_dir_avg10m()` en `storage.py`, cableado en
`/api/current` (`main.py`) igual que el de velocidad. Importante: la
dirección es una cantidad CIRCULAR (0°/360° es el mismo rumbo) -- un
promedio aritmético de los grados falla justo donde más importa (350° y
10°, viento casi del norte con una racha, promediarían a 180°, ¡el rumbo
OPUESTO!). Se usa el promedio vectorial estándar: se convierte cada muestra
a (sin, cos), se promedian esas componentes, y el ángulo del vector
resultante (`atan2`) es la dirección media real.

- Bug encontrado y corregido DURANTE la verificación (no llegó a producción):
  `round(mean_deg % 360, 1)` hacía el módulo ANTES de redondear. Cerca de
  0° la suma de senos puede quedar en un negativo minúsculo por error de
  punto flotante (p. ej. `-1.6e-15` en vez de `0.0` exacto), y
  `-1.6e-15 % 360` da `~359.999999999998`, que redondeado a 1 decimal sale
  **"360.0"** en vez de "0.0" -- un rumbo Norte real se habría mostrado
  como "360° N" (visualmente extraño, aunque no incorrecto en sí). Fix:
  redondear primero (`round(mean_deg, 1) % 360`), que colapsa el ruido de
  punto flotante antes de que el módulo lo estire. Verificado con casos de
  prueba: `circ_mean([350, 10]) == 0.0`, `circ_mean([260, 280, 300]) ==
  280.0`, `circ_mean([170, 190]) == 180.0`.
- Nuevo campo `wind_direction_avg10m` en `WeatherData` (dashboard) y en la
  respuesta de `/api/current` (backend).

**Frontend (`CompassGauge.tsx`):** nueva prop `avgBearing`. Cambios:
- Dos LCD apiladas en el mismo alto total que antes ocupaba una sola +
  su caption "rumbo" (que se quitó): la de arriba muestra el rumbo ACTUAL
  con el texto en rojo oscuro (`#7a2420`, a juego con la aguja roja), la
  de abajo el PROMEDIO en azul oscuro (`#1c3a63`, a juego con la aguja
  azul) -- el color hace de etiqueta sin gastar una línea de texto extra
  (el hueco vertical disponible entre el hub y la letra cardinal "S" no
  alcanzaba para dos LCD + dos captions de texto).
- Segunda aguja azul (`#2563eb`), más corta y delgada que la roja (86% del
  largo), dibujada ANTES que la roja para que esta quede visualmente al
  mando cuando ambos rumbos casi coinciden. Mismo patrón de animación
  (`transform` CSS + `transformOrigin`) que la aguja roja.
- Si `avgBearing` es `null`/`undefined` (aún no hay 10 min de historial,
  p. ej. recién arrancado el servidor), la aguja azul no se dibuja y su
  LCD muestra "--".
- `aria-label` del SVG ahora incluye también el promedio cuando está
  disponible.

**Sobre las "tres sombras de color (gris, rojo, violeta)" de la captura
original:** no se implementaron. A diferencia de los dos LCD (que sí
tienen texto legible que se pudo traducir), esas bandas de color no
tienen ninguna etiqueta en la imagen -- es un elemento puramente gráfico
de la librería SteelSeries original, y sin ver el gauge en vivo (con
tooltip o documentación de esa skin) no hay forma de confirmar qué
representa cada una. La hipótesis más plausible es que sean arcos de
variabilidad de rumbo en distintas ventanas de tiempo, semitransparentes
y superpuestos (el violeta saldría de la mezcla óptica de un gris y un
rojo solapados) -- pero es una hipótesis, no algo que se pudiera
implementar con confianza. Pendiente si el usuario quiere definirlo
explícitamente (qué ventanas de tiempo, qué corte de variabilidad).

- [x] `tsc --noEmit` limpio.
- [x] `py_compile` limpio en `storage.py` y `main.py`.
- [x] Verificado con Playwright (mock `wind_direction=30`,
      `wind_direction_avg10m=355`): ambas LCD muestran "30° NNE" (rojo) y
      "355° N" (azul), ambas agujas se dibujan en sus ángulos correctos,
      `aria-label` incluye ambos valores.

## Undécima ronda: quitar título, LCDs arriba, escala al extremo — 2026-09-09

Pedido explícito: quitar el texto "DIRECCIÓN", poner ahí (arriba del
centro) las dos LCD (actual/promedio), mover la escala circular de grados
al extremo de la carátula, y dejar las letras cardinales (N/S/E/O/SO/...)
en su posición actual -- solo se mueve la escala.

- [x] Texto "DIRECCIÓN" eliminado (con su `titleR`).
- [x] Las dos LCD (antes debajo del centro) ahora van ARRIBA, en el hueco
      que dejó el título -- hay de sobra: hueco libre entre el buje
      (`cy ± size*0.038`) y la letra "N" (`labelR = faceR*0.92`, sin
      cambios) es de ~0.30*faceR, y las dos LCD + su separación ocupan
      ~0.18*faceR. `lcd2Y` (promedio, la de abajo de las dos, más cerca
      del buje) se ancla con un margen fijo sobre el buje; `lcd1Y` (actual)
      se apila hacia arriba desde ahí.
- [x] Escala de grados (`tickOuterR/tickMajorInnerR/tickMinorInnerR`)
      movida de 0.78/0.68/0.74 × faceR a 0.97/0.885/0.93 × faceR -- pegada
      al borde de la carátula, cerca del bisel. `labelR` (0.92) NO se tocó,
      como se pidió explícitamente.
- **Cuidado evitado:** con la escala movida al extremo, las letras
  cardinales (0.92) quedan DENTRO del anillo de ticks (0.885-0.97) en vez
  de fuera. Para que la aguja no las tape al pasar exactamente por N/E/S/O,
  se acortó `needleR` de `tickOuterR-1` a `tickMajorInnerR` (0.885×faceR,
  claramente por debajo de 0.92) -- la aguja llega hasta el borde interior
  de la escala pero nunca alcanza el radio de las letras, sin importar el
  ángulo. Los ticks de 5°/10° ya se saltaban las 8 marcas cardinales antes
  de este cambio (`if (m % 45 === 0) return null`), así que tampoco hay
  colisión de líneas de tick contra el texto de las letras.
- [x] `tsc --noEmit` limpio.
- [x] Verificado con Playwright en dos casos: rumbo exactamente Norte
      (0°/0°, el caso más exigente para la colisión aguja-letra) y rumbos
      no cardinales divergentes (130°/165°) -- en ambos las agujas se ven
      completas sin tocar las letras, y las LCD arriba del centro muestran
      los valores correctos en rojo/azul.

## Duodécima ronda: marca de ráfaga máxima en Viento — 2026-09-09

Pedido: en el medidor de Viento (velocidad), agregar una marca triangular
fija en el valor de la ráfaga máxima del día (`wind_gust_max_daily`) --
un valor de referencia aparte de la aguja, que sigue mostrando la
velocidad instantánea.

- [x] Nueva prop `markerValue?: number | null` en `AnalogGauge.tsx`
      (genérica, no solo para Viento -- cualquier gauge podría usarla a
      futuro). Dibuja un triángulo relleno que apunta hacia el centro,
      con el vértice apoyado sobre el anillo de marcas (`tickOuterR`) y la
      base cerca del borde de la carátula (`faceR*0.985`); color oscuro
      (`#1f2937`) con contorno claro para que se distinga sobre cualquier
      color de zona (verde/amarillo/naranja/rojo).
  - Se calcula con la MISMA función `angleOf()` que usa la aguja (mismo
    `START`/`SWEEP`), y se recorta a `[min, max]` igual que el valor de la
    aguja -- si la ráfaga del día superó el máximo de la escala, la marca
    se queda pegada al extremo en vez de desaparecer o salirse.
  - `null`/`undefined` la oculta (p. ej. si `wind_gust_max_daily` no ha
    llegado aún).
- [x] `InstrumentosPage.tsx`: `markerValue={u.windN(data.wind_gust_max_daily)}`
      en el gauge de Viento.
- [x] `tsc --noEmit` limpio.
- [x] Verificado con Playwright (mock `wind_speed=22`,
      `wind_gust_max_daily=58`, escala 0-100): la aguja roja marca 22 km/h
      y el triángulo aparece correctamente cerca de la marca de 60,
      sobre la zona naranja/roja de la escala.

## Decimotercera ronda: correcciones a la ronda 11 + marca de predominante — 2026-09-10

El usuario aclaró que la ronda 11 no había quedado como quería: los 2 LCD
NO debían apilarse juntos arriba -- uno (actual) va arriba del centro y el
otro (promedio) abajo, como estaba el LCD original antes de que hubiera
dos. Además: quitar las líneas de marca propias de cada cardinal (N/S/E/O/
SE/etc, se encimaban con la letra ahora que la escala está en el extremo),
agrandar ambos LCD al tamaño de Presión, agregar una marca roja de
dirección predominante, y poner la marca de ráfaga (ronda 12) también en
rojo y más grande.

**`CompassGauge.tsx`:**
- LCD "actual" (roja) vuelve a ir ARRIBA del centro (`lcd1Y = cy -
  size*0.173`, en el hueco que dejó el título). LCD "promedio" (azul)
  vuelve a su posición ORIGINAL de antes de la ronda 10 (`lcd2Y = cy +
  size*0.075`), no apilada junto a la de arriba.
- Tamaño de ambos LCD: `lcdW = size*0.38`, `lcdH = size*0.115` -- igual
  que Presión con `lcdWide` en `AnalogGauge.tsx`. Antes eran 0.42×0.085.
- Se quitó la `<line>` de marca propia de cada cardinal en `DIRS.map`
  (quedó solo el `<text>`) -- esa línea usaba `tickOuterR`/
  `tickMajorInnerR`, que desde la ronda 11 están pegados al extremo de la
  carátula, cruzando justo por donde está la letra.
- Nueva prop `dominantBearing` (grados): dibuja una marca triangular ROJA
  (`#c0392b`, mismo rojo que la aguja actual) en una banda de radio propia
  (0.68-0.87×faceR) DELIBERADAMENTE por debajo de `labelR` (0.92) -- así
  nunca se puede encimar con una letra cardinal, sin importar qué rumbo
  sea el predominante (a diferencia de la escala general, que si comparte
  radio con las letras aunque ya no tenga colisión de líneas).
- `aria-label` ahora incluye también el predominante cuando está presente.

**`InstrumentosPage.tsx`:** `rose.dominant` es un STRING (p. ej. "SE"), no
un bearing -- se resuelve buscando en `rose.sectors` el que tenga
`label === rose.dominant` y usando su `dir` (grados). Pasado a
`CompassGauge` como `dominantBearing`.

**`AnalogGauge.tsx` (marca de ráfaga, ronda 12):** color cambiado de gris
oscuro (`#1f2937`) a rojo (`#c0392b`, igual que la aguja) y agrandada:
la punta ahora llega hasta el borde interior de la banda de colores
(`zoneR - size*0.0175`, antes `tickOuterR - size*0.01`) y el ancho angular
subió de 3.2° a 5° -- una marca notablemente más grande y visible sobre
cualquier color de zona.

- [x] `tsc --noEmit` limpio.
- [x] Verificado con Playwright: `aria-label` de Dirección resuelve
      correctamente "SE" → 135° (`rose.sectors` mock con `dominant: 'SE'`
      y un sector `{dir: 135, label: 'SE'}`); captura visual confirma LCD
      actual arriba/promedio abajo (tamaño Presión), sin líneas de marca
      cardinal, marca roja de predominante visible sin tocar letras, y
      marca de ráfaga roja y más grande en Viento.
