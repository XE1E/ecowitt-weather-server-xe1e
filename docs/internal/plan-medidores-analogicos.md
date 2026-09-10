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

## Notas

- Usar SVG nativo, no librerías externas (mantener bundle pequeño)
- Responsive: tamaños sm/md/lg con escalado proporcional
- Tema: Adaptar colores a dark/light mode
- Accesibilidad: Incluir aria-labels con valores actuales
