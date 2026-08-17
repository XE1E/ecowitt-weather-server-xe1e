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

const CRUDOS: Record<string, string> = {
  thermometer, humidity, barometer, raindrops, windsock, 'clear-day': clearDay,
}

/**
 * Caja de la tinta de cada icono dentro de su lienzo de 128×128: `x y ancho alto`.
 * Medida con `svg.getBBox()` sobre la página real, no estimada. Si se agrega un
 * icono nuevo hay que medirlo (scratchpad/tinta.py) o se verá descentrado.
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
  thermometer: (svg) => svg.replace(/V41\.5469H65C.*?H71V71\.8398/, 'V71.8398'),
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
  raindrops: (svg) => svg.replace(
    /(id="Vector(?:_2)?"[^>]*?)fill="black"/g,
    '$1fill="none" stroke="black" stroke-width="6" stroke-linejoin="round"',
  ),
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
