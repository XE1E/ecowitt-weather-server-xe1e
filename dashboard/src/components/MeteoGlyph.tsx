/**
 * Glifo de Meteocons TEÑIBLE, para la réplica de consola.
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
 * Solución: se importa el SVG `monochrome` en crudo, se cambia su negro por
 * `currentColor` y se inyecta inline, así hereda el `color` del contenedor.
 */
import { useMemo } from 'react'

import thermometer from '@meteocons/svg/monochrome/thermometer.svg?raw'
import humidity from '@meteocons/svg/monochrome/humidity.svg?raw'
import barometer from '@meteocons/svg/monochrome/barometer.svg?raw'
import raindrops from '@meteocons/svg/monochrome/raindrops.svg?raw'
import windsock from '@meteocons/svg/monochrome/windsock.svg?raw'
import clearDay from '@meteocons/svg/monochrome/clear-day.svg?raw'

const CRUDOS: Record<string, string> = {
  thermometer, humidity, barometer, raindrops, windsock, 'clear-day': clearDay,
}

/** Nombres disponibles como glifo teñible. */
export type GlyphName = keyof typeof CRUDOS

interface Props {
  name: GlyphName | string
  size: number
  /** Color del glifo. Se aplica por `color`, que el SVG hereda. */
  color: string
  title?: string
}

export function MeteoGlyph({ name, size, color, title }: Props) {
  const svg = useMemo(() => {
    const crudo = CRUDOS[name]
    if (!crudo) return null
    return crudo
      // el negro fijo del paquete pasa a heredar el color del contenedor
      .replace(/fill="black"/g, 'fill="currentColor"')
      .replace(/stroke="black"/g, 'stroke="currentColor"')
      // el tamaño lo manda el contenedor, no el atributo del archivo
      .replace(/<svg /, '<svg width="100%" height="100%" ')
  }, [name])

  if (!svg) return null
  return (
    <span
      role="img"
      aria-label={title ?? String(name)}
      // `block` y no `inline-block`: en inline el elemento se asienta sobre la
      // línea base y deja unos 3 px de hueco abajo, lo que descentraba los iconos
      // que van absolutos con translateY(-50%) en la consola.
      style={{ display: 'block', width: size, height: size, color, lineHeight: 0 }}
      // Contenido estático de un paquete npm, no entrada de usuario.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
