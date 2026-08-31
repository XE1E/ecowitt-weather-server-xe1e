/**
 * Glifo de Meteocons TEÑIBLE y RECORTADO, para la réplica de consola.
 *
 * Por qué no vale `<WeatherIcon>` aquí: ése carga el SVG como `<img>`, y una
 * imagen no se puede recolorear. La consola necesita cada icono del color de su
 * variable (naranja temperatura, azul humedad, morado presión…) igual que sus
 * números de 7 segmentos, porque ese código de color es lo que la hace legible.
 *
 * Y no vale la variante `fill` de Meteocons porque trae sus propios colores (el
 * termómetro viene rojo `#DC2626`), ni la `monochrome` tal cual porque trae
 * `fill="black"` fijo —negro sobre la consola negra es invisible—.
 *
 * Se hacen dos cosas:
 *  1. TEÑIR: se importa el SVG `monochrome` en crudo, se cambia su negro por
 *     `currentColor` y se inyecta inline, así hereda el `color` del contenedor.
 *  2. RECORTAR: los archivos traen mucho relleno vacío dentro de su lienzo de
 *     128×128 —el termómetro son 26 px de ancho de 128—, así que el dibujo salía
 *     pequeño y, sobre todo, MUY metido hacia la derecha: un icono "pegado a la
 *     izquierda" aparecía a 33 px del borde. Se sustituye el viewBox por la caja
 *     real de la tinta, medida con `getBBox()` en el navegador.
 */
import { useId, useMemo } from 'react'

import thermometer from '@meteocons/svg/monochrome/thermometer.svg?raw'
import humidity from '@meteocons/svg/monochrome/humidity.svg?raw'
import barometer from '@meteocons/svg/monochrome/barometer.svg?raw'
import raindrops from '@meteocons/svg/monochrome/raindrops.svg?raw'
import windsock from '@meteocons/svg/monochrome/windsock.svg?raw'
import clearDay from '@meteocons/svg/monochrome/clear-day.svg?raw'

// Familias GRADUADAS: el icono cambia con el valor (grado Beaufort, nivel de presión,
// rumbo). Van por aquí y no por `<WeatherIcon>` porque las variantes `fill` y `line` de
// Meteocons están pintadas para fondo CLARO --el número del Beaufort es `#202939` y la
// carátula del barómetro `#475569`, invisibles sobre este panel-- mientras la
// `monochrome` es negro puro y aquí se tiñe. Ver la nota de `theme/icons.ts`.
import windBeaufort0 from '@meteocons/svg/monochrome/wind-beaufort-0.svg?raw'
import windBeaufort1 from '@meteocons/svg/monochrome/wind-beaufort-1.svg?raw'
import windBeaufort2 from '@meteocons/svg/monochrome/wind-beaufort-2.svg?raw'
import windBeaufort3 from '@meteocons/svg/monochrome/wind-beaufort-3.svg?raw'
import windBeaufort4 from '@meteocons/svg/monochrome/wind-beaufort-4.svg?raw'
import windBeaufort5 from '@meteocons/svg/monochrome/wind-beaufort-5.svg?raw'
import windBeaufort6 from '@meteocons/svg/monochrome/wind-beaufort-6.svg?raw'
import windBeaufort7 from '@meteocons/svg/monochrome/wind-beaufort-7.svg?raw'
import windBeaufort8 from '@meteocons/svg/monochrome/wind-beaufort-8.svg?raw'
import windBeaufort9 from '@meteocons/svg/monochrome/wind-beaufort-9.svg?raw'
import windBeaufort10 from '@meteocons/svg/monochrome/wind-beaufort-10.svg?raw'
import windBeaufort11 from '@meteocons/svg/monochrome/wind-beaufort-11.svg?raw'
import windBeaufort12 from '@meteocons/svg/monochrome/wind-beaufort-12.svg?raw'
import barometerLow from '@meteocons/svg/monochrome/barometer-low.svg?raw'
import barometerModerate from '@meteocons/svg/monochrome/barometer-moderate.svg?raw'
import barometerHigh from '@meteocons/svg/monochrome/barometer-high.svg?raw'
import barometerVerryHigh from '@meteocons/svg/monochrome/barometer-verry-high.svg?raw'
import barometerExtreme from '@meteocons/svg/monochrome/barometer-extreme.svg?raw'
import compassN from '@meteocons/svg/monochrome/compass-n.svg?raw'
import compassNe from '@meteocons/svg/monochrome/compass-ne.svg?raw'
import compassE from '@meteocons/svg/monochrome/compass-e.svg?raw'
import compassSe from '@meteocons/svg/monochrome/compass-se.svg?raw'
import compassS from '@meteocons/svg/monochrome/compass-s.svg?raw'
import compassSw from '@meteocons/svg/monochrome/compass-sw.svg?raw'
import compassW from '@meteocons/svg/monochrome/compass-w.svg?raw'
import compassNw from '@meteocons/svg/monochrome/compass-nw.svg?raw'
import thermometerWarmer from '@meteocons/svg/monochrome/thermometer-warmer.svg?raw'
import thermometerColder from '@meteocons/svg/monochrome/thermometer-colder.svg?raw'
import thermometerRaindrop from '@meteocons/svg/monochrome/thermometer-raindrop.svg?raw'
import uvIndex from '@meteocons/svg/monochrome/uv-index.svg?raw'
import dust from '@meteocons/svg/monochrome/dust.svg?raw'

const CRUDOS: Record<string, string> = {
  thermometer, humidity, barometer, raindrops, windsock, 'clear-day': clearDay,
  'wind-beaufort-0': windBeaufort0, 'wind-beaufort-1': windBeaufort1, 'wind-beaufort-2': windBeaufort2, 'wind-beaufort-3': windBeaufort3,
  'wind-beaufort-4': windBeaufort4, 'wind-beaufort-5': windBeaufort5, 'wind-beaufort-6': windBeaufort6, 'wind-beaufort-7': windBeaufort7,
  'wind-beaufort-8': windBeaufort8, 'wind-beaufort-9': windBeaufort9, 'wind-beaufort-10': windBeaufort10, 'wind-beaufort-11': windBeaufort11,
  'wind-beaufort-12': windBeaufort12, 'barometer-low': barometerLow, 'barometer-moderate': barometerModerate, 'barometer-high': barometerHigh,
  'barometer-verry-high': barometerVerryHigh, 'barometer-extreme': barometerExtreme, 'compass-n': compassN, 'compass-ne': compassNe,
  'compass-e': compassE, 'compass-se': compassSe, 'compass-s': compassS, 'compass-sw': compassSw,
  'compass-w': compassW, 'compass-nw': compassNw, 'thermometer-warmer': thermometerWarmer, 'thermometer-colder': thermometerColder,
  'thermometer-raindrop': thermometerRaindrop, 'uv-index': uvIndex, 'dust': dust,
}

/**
 * Caja de la tinta de cada icono dentro de su lienzo de 128×128: `x y ancho alto`.
 * Medida con `svg.getBBox()` sobre la página real, no estimada. Si se agrega un
 * icono nuevo hay que medirlo o se verá descentrado:
 *
 *     python scripts/tinta-meteocons.py <icono>
 *
 * Esa herramienta calcula la misma caja sin navegador y está validada contra las cuatro
 * filas de aquí que se midieron a mano (reproduce `thermometer` y `barometer` exactas).
 * Ojo con una cosa que documenta ella y conviene saber aquí: varios iconos LATEN con un
 * `animateTransform type="scale"` de hasta 1.1x, así que la caja tiene que cubrir el
 * máximo del latido --si no, el glifo se recorta justo en el pico--; es lo que explica
 * que la caja de `humidity` sea mayor que su geometría en reposo.
 *
 * Las cajas llevan sumada la MITAD DEL TRAZO, que `getBBox()` no cuenta: devuelve
 * la caja de la geometría, y un contorno la desborda media anchura de trazo por
 * cada lado. Recortando a la medida cruda, el icono salía con las orillas comidas
 * --se veía en el barómetro, cuyo aro es un `stroke-width="3"` en el borde mismo
 * de su caja: el viewBox 26..103 cortaba 1.5 px de aro arriba, abajo y a los dos
 * lados, así que el círculo aparecía achatado por los cuatro costados--.
 *   · barometer   aro de 3 → r=38.5 en (64,64) llega a 24..104
 *   · thermometer cristal de 2 → 50..78 y 31..97
 *   · windsock    trazo de 1 (el de por defecto) → medio píxel
 *   · humidity es macizo, sin trazo: su caja no cambia
 *   · raindrops YA NO es sólo macizo. En modo `outline` lleva un trazo de 6, que se
 *     sale 3 unidades por cada lado de la geometría, así que su caja pasa de la
 *     medida cruda (34,32,62,65) a llevar esos 3 sumados: (31,29,68,71). Se deja
 *     igual en las dos variantes para que el icono no dé un salto de tamaño al
 *     conmutar entre hueco y macizo; al macizo sólo le añade un poco de aire.
 *     Sin esto, el contorno salía recortado por la izquierda y por abajo --visible
 *     en el render, no teórico--.
 */
const TINTA: Record<string, [number, number, number, number]> = {
  thermometer: [50, 31, 28, 66],
  humidity: [44, 32, 42, 65],
  raindrops: [31, 29, 68, 71],
  barometer: [24, 24, 80, 80],
  windsock: [41.5, 29.5, 47, 67],
  'clear-day': [0, 0, 128, 128],   // este ya llena su lienzo
  // Beaufort: la familia entera comparte caja --la MAYOR de los trece, la de los
  // grados de dos cifras-- a propósito. Con la caja justa de cada uno, el glifo
  // cambiaría de tamaño al cambiar el viento, que se lee como un fallo de dibujo.
  // Es un icono ANCHO (89x58), no cuadrado: a 28 px de alto ocupa 43 de ancho.
  'wind-beaufort-0': [22, 35, 89, 58],
  'wind-beaufort-1': [22, 35, 89, 58],
  'wind-beaufort-2': [22, 35, 89, 58],
  'wind-beaufort-3': [22, 35, 89, 58],
  'wind-beaufort-4': [22, 35, 89, 58],
  'wind-beaufort-5': [22, 35, 89, 58],
  'wind-beaufort-6': [22, 35, 89, 58],
  'wind-beaufort-7': [22, 35, 89, 58],
  'wind-beaufort-8': [22, 35, 89, 58],
  'wind-beaufort-9': [22, 35, 89, 58],
  'wind-beaufort-10': [22, 35, 89, 58],
  'wind-beaufort-11': [22, 35, 89, 58],
  'wind-beaufort-12': [22, 35, 89, 58],
  // Barómetros y brújulas: los catorce miden exactamente lo mismo que el
  // `barometer` de arriba, que es la caja ya probada en la consola.
  'barometer-low': [24, 24, 80, 80],
  'barometer-moderate': [24, 24, 80, 80],
  'barometer-high': [24, 24, 80, 80],
  'barometer-verry-high': [24, 24, 80, 80],
  'barometer-extreme': [24, 24, 80, 80],
  'compass-n': [24, 24, 80, 80],
  'compass-ne': [24, 24, 80, 80],
  'compass-e': [24, 24, 80, 80],
  'compass-se': [24, 24, 80, 80],
  'compass-s': [24, 24, 80, 80],
  'compass-sw': [24, 24, 80, 80],
  'compass-w': [24, 24, 80, 80],
  'compass-nw': [24, 24, 80, 80],
  'thermometer-warmer': [50, 31, 44, 66],
  'thermometer-colder': [50, 31, 44, 66],
  'thermometer-raindrop': [47.2, 28.4, 44, 72.6],
  'uv-index': [16, 16, 96, 96],
  'dust': [24, 39, 87, 51],
}

/**
 * Retoques al dibujo del paquete, aparte del teñido.
 *
 * El termómetro de Meteocons trae la ESCALA grabada en el propio contorno del
 * cristal: cuatro marquitas de 6 px que salen del tubo hacia dentro. A 46 px de
 * alto --el tamaño al que va en la consola-- esas marcas miden 2 px, caen sobre el
 * mercurio y con el antialiasing del render a JPEG quedan como manchas: el icono
 * no se lee como un termómetro sino como un dibujo sucio. Se quita la escala y se
 * deja el tubo liso con su columna de mercurio, que es el dato que el glifo tiene
 * que contar. El corte es limpio porque las marcas son un tramo contiguo del path,
 * entre el arranque del lado derecho (`V41.5469`) y el punto donde vuelve a bajar
 * (`V71.8398`): sustituirlo por la vertical entera deja el mismo contorno sin
 * ellas.
 */
const RETOQUES: Record<string, (svg: string) => string> = {
  thermometer: (svg) => svg
    .replace(/V41\.5469H65C.*?H71V71\.8398/, 'V71.8398')
    // El mercurio (bulbo "Reservoir" + columna "Value") en rojo FIJO y no en
    // currentColor: así se lee como un termómetro real sin importar el color
    // de la celda (naranja de EXT, azul si fuera otra variable). El cristal
    // ("Glass", más abajo) sigue tiñéndose normal. Mismo rojo que trae de
    // fábrica la variante `fill` de Meteocons (ver cabecera de este archivo),
    // no uno de los `--red`/`--alarma` de la consola: esos ya tienen su propio
    // significado (contorno del reloj / aviso) y reusarlos aquí mezclaría dos
    // cosas distintas en un mismo color, el mismo error que describe
    // console-css.ts sobre por qué se separaron esos dos.
    .replace(/(id="Reservoir"[^>]*?)fill="black"/, '$1fill="#DC2626"')
    .replace(/(id="Value"[^>]*?)fill="black"/, '$1fill="#DC2626"'),
  // La carátula de Meteocons no trae relleno: el aro ("Housing") es sólo
  // contorno y las marcas son líneas, así que hoy se ve el negro de la
  // consola A TRAVÉS del reloj. Se le agrega un disco blanco FIJO detrás de
  // todo -- aro, marcas y aguja se siguen tiñendo con currentColor como
  // siempre, sólo el fondo cambia--. r=37 y no 38.5 (el radio del aro): el
  // aro lleva stroke-width 3, así que su borde interior cae en ~37; con el
  // disco al mismo radio que el aro se asomaría por fuera de su propio trazo.
  barometer: (svg) => svg.replace(
    '<g id="Barometer">',
    '<circle cx="64" cy="64" r="37" fill="#fff"/><g id="Barometer">',
  ),
}

/** Nombres disponibles como glifo teñible. */
export type GlyphName = keyof typeof CRUDOS

/**
 * Animaciones por tipo de glifo. Cada icono tiene su movimiento característico:
 * - thermometer: pulso suave (escala)
 * - humidity: rebote vertical (gota cayendo)
 * - barometer: balanceo sutil (como aguja)
 * - raindrops: rebote con escala (gotas salpicando)
 */
const ANIMACIONES: Record<string, string> = {
  thermometer: 'glyph-pulse 2.5s ease-in-out infinite',
  humidity: 'glyph-bounce 2s ease-in-out infinite',
  barometer: 'glyph-swing 3s ease-in-out infinite',
  raindrops: 'glyph-drip 1.8s ease-in-out infinite',
}

// Inyectar keyframes una sola vez en el documento
if (typeof document !== 'undefined' && !document.getElementById('meteo-glyph-animations')) {
  const style = document.createElement('style')
  style.id = 'meteo-glyph-animations'
  style.textContent = `
    @keyframes glyph-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }
    @keyframes glyph-bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    @keyframes glyph-swing {
      0%, 100% { transform: rotate(0deg); }
      25% { transform: rotate(3deg); }
      75% { transform: rotate(-3deg); }
    }
    @keyframes glyph-drip {
      0%, 100% { transform: scale(1) translateY(0); }
      30% { transform: scale(1.06) translateY(-3px); }
      60% { transform: scale(0.97) translateY(2px); }
    }
  `
  document.head.appendChild(style)
}

/**
 * Convierte un glifo macizo en su versión de CONTORNO.
 *
 * No vale un `fill="black"` → `fill="none"` a lo bruto: en `raindrops` la gota de
 * atrás va recortada por una `<mask>`, y esa máscara define su alfa con un path que
 * TAMBIÉN lleva `fill="black"`. Vaciarlo dejaría la máscara en nada y la gota
 * trasera desaparecería del todo. Por eso se apunta sólo a los dos paths de las
 * gotas por su `id`, que en el SVG del paquete son `Vector` y `Vector_2`.
 *
 * El `stroke="black"` se pone a propósito en negro y no en `currentColor`: la
 * sustitución de más abajo lo tiñe junto con el resto, y así hay un solo sitio que
 * decida el color.
 */
const CONTORNO: Record<string, (svg: string) => string> = {
  raindrops: (svg) => svg
    .replace(
      /(id="Vector(?:_2)?"[^>]*?)fill="black"/g,
      '$1fill="none" stroke="black" stroke-width="6" stroke-linejoin="round"',
    )
    // La MÁSCARA también hay que agrandarla, y es lo que costó ver: recorta la gota
    // de atrás y su región declarada empieza justo en `x="35"`, que es exactamente
    // donde arranca la geometría. Al gotear el trazo 3 unidades hacia fuera, esas 3
    // caían fuera de la máscara y se perdían: el resultado no era una curva comida
    // sino un CORTE RECTO vertical --medido sobre el render, 25 píxeles azules de
    // golpe en una sola columna donde una curva habría dado 2 o 3--.
    // Se abren los cuatro lados: la región (x/y/width/height) y el path que la
    // dibuja, cuyos bordes rectos están en H35, V94 y el arranque en y=34.
    .replace(
      /x="35" y="34" width="35" height="60"/,
      'x="31" y="30" width="43" height="68"',
    )
    .replace(/M69\.6509 34H35V94H61\.466/, 'M69.6509 30H31V98H61.466'),
}

interface Props {
  name: GlyphName | string
  /** ALTO del glifo en px. El ancho sale de la proporción real de la tinta. */
  size: number
  /** Color del glifo. Se aplica por `color`, que el SVG hereda. */
  color: string
  title?: string
  /**
   * Dibuja sólo el contorno en vez del glifo macizo. Sirve para que un mismo icono
   * diga dos estados sin cambiar de dibujo: en la celda de LLUVIA, hueco = no llueve
   * y relleno = está lloviendo. Sólo lo soportan los glifos listados en `CONTORNO`;
   * en el resto se ignora y se dibuja macizo.
   */
  outline?: boolean
}

export function MeteoGlyph({ name, size, color, title, outline = false }: Props) {
  // Los `id` de los SVG del paquete son fijos ("clip0_2038_25542"), y la consola
  // pinta el mismo glifo más de una vez: dos barómetros (PRES y REMOTA GW1100) y
  // varios termómetros. Con ids repetidos en el documento, el `clip-path` de todas
  // las copias apunta a la PRIMERA, así que al desmontarse esa celda las demás se
  // quedan sin recorte --la aguja del barómetro se saldría de su ventana--. Se le
  // pone a cada instancia un prefijo propio; los dos puntos que trae `useId` no
  // valen dentro de `url(#...)` sin escapar, y se quitan.
  const uid = useId().replace(/:/g, '')
  const prep = useMemo(() => {
    const crudo = CRUDOS[name]
    if (!crudo) return null
    const caja = TINTA[name] ?? [0, 0, 128, 128]
    const [, , w, h] = caja
    const retoque = RETOQUES[name]
    const hueco = outline ? CONTORNO[name] : undefined
    let base = retoque ? retoque(crudo) : crudo
    if (hueco) base = hueco(base)
    const svg = base
      // el negro fijo del paquete pasa a heredar el color del contenedor
      .replace(/fill="black"/g, 'fill="currentColor"')
      .replace(/stroke="black"/g, 'stroke="currentColor"')
      // ids únicos por instancia, definición y referencia a la vez
      .replace(/id="([^"]*)"/g, `id="${uid}-$1"`)
      .replace(/url\(#([^)]*)\)/g, `url(#${uid}-$1)`)
      // viewBox recortado a la tinta + el tamaño lo manda el contenedor
      .replace(/<svg[^>]*?viewBox="[^"]*"/, `<svg width="100%" height="100%" viewBox="${caja.join(' ')}"`)
    return { svg, ratio: w / h }
    // `outline` va en las dependencias: sin él el memo se quedaría con la primera
    // versión y el icono no cambiaría nunca al empezar o parar de llover.
  }, [name, uid, outline])

  if (!prep) return null
  const anim = ANIMACIONES[name]
  return (
    <span
      role="img"
      aria-label={title ?? String(name)}
      // `block` y no `inline-block`: en inline el elemento se asienta sobre la
      // línea base y deja unos 3 px de hueco abajo, lo que descentraba los iconos
      // que van absolutos con translateY(-50%).
      style={{
        display: 'block',
        height: size,
        width: Math.round(size * prep.ratio),
        color,
        lineHeight: 0,
        transformOrigin: 'center center',
        animation: anim,
      }}
      // Contenido estático de un paquete npm, no entrada de usuario.
      dangerouslySetInnerHTML={{ __html: prep.svg }}
    />
  )
}
