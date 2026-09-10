// Simulación de dígitos LCD de 7 segmentos, SVG puro. Cada segmento es un
// <line> grueso con extremos redondeados (más simple y liviano que dibujar
// hexágonos, y da el mismo aspecto). Los segmentos APAGADOS se dibujan
// también, en un color "fantasma" apenas visible -- así se ve como una
// pantalla LCD real, no como texto que aparece y desaparece.
const SEGMENTS: Record<string, string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
}

function DigitCell({ x, y, w, h, ch, on, off }: {
  x: number; y: number; w: number; h: number; ch: string; on: string; off: string
}) {
  const xl = x + w * 0.22
  const xr = x + w * 0.78
  const yt = y + h * 0.08
  const ym = y + h * 0.5
  const yb = y + h * 0.92
  const segs: Record<string, [number, number, number, number]> = {
    a: [xl, yt, xr, yt],
    b: [xr, yt, xr, ym],
    c: [xr, ym, xr, yb],
    d: [xl, yb, xr, yb],
    e: [xl, ym, xl, yb],
    f: [xl, yt, xl, ym],
    g: [xl, ym, xr, ym],
  }
  const lit = new Set(SEGMENTS[ch] || [])
  const sw = w * 0.24
  return (
    <>
      {Object.entries(segs).map(([k, [x1, y1, x2, y2]]) => (
        <line key={k} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={lit.has(k) ? on : off} strokeWidth={sw} strokeLinecap="round" />
      ))}
    </>
  )
}

/**
 * Dibuja `text` (dígitos, `.`, `-`, espacios) como un display de 7 segmentos,
 * dentro del rectángulo (x, y, width, height). El punto decimal no ocupa
 * celda propia -- se dibuja pegado a la celda anterior, como en un LCD real.
 */
export function SevenSegmentDisplay({ text, x, y, width, height, on = '#16321f', off = '#a9b89b' }: {
  text: string; x: number; y: number; width: number; height: number; on?: string; off?: string
}) {
  const chars = text.split('')
  const cellCount = Math.max(1, chars.filter((c) => c !== '.').length)
  const cellW = width / cellCount
  let i = 0
  const dot = width * 0.045
  return (
    <>
      {chars.map((c, idx) => {
        if (c === '.') {
          const px = x + i * cellW - cellW * 0.06
          return <circle key={idx} cx={px} cy={y + height * 0.92} r={dot} fill={on} />
        }
        const cellX = x + i * cellW
        i += 1
        return <DigitCell key={idx} x={cellX} y={y} w={cellW} h={height} ch={c} on={on} off={off} />
      })}
    </>
  )
}
