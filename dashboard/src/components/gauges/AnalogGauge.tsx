import { useMemo } from 'react'

// Medidor analógico estilo "instrumento físico" (bisel metálico, carátula crema,
// zonas de color, aguja, pantalla LCD) -- inspirado en el aspecto clásico de los
// gauges de instrumentación meteorológica (WeeWX SteelSeries, AWEKAS y similares),
// pero es SVG propio de cero: no vendoriza ningún asset/código de terceros.
// Ver docs/internal/plan-medidores-analogicos.md.
//
// Convención angular: bearing 0 = arriba (12 en punto), sentido horario positivo
// -- misma convención que WindRose.tsx (pt()), así el hueco de 90° queda abajo.
export interface GaugeZone { from: number; to: number; color: string }

export interface AnalogGaugeProps {
  title: string
  value: number | null | undefined
  min: number
  max: number
  unit: string
  decimals?: number
  majorStep: number
  /** Marca media SIN número, entre dos marcas mayores (p. ej. el "5" entre 0 y 10). */
  midStep?: number
  /** Subdivisión más fina, sin número (p. ej. de 1 en 1). */
  minorStep?: number
  zones?: GaugeZone[]
  size?: number
  trend?: 'up' | 'down' | 'stable'
  /** LCD más ancho (p. ej. Presión, que necesita 4 dígitos + decimal). */
  lcdWide?: boolean
  /**
   * Marca triangular fija en la escala (p. ej. la ráfaga máxima del día en
   * el medidor de Viento) -- un valor de referencia aparte de la aguja, que
   * sigue mostrando la lectura instantánea. `null`/`undefined` la oculta.
   */
  markerValue?: number | null
  /** Marca del mínimo del día (triángulo azul). `null`/`undefined` la oculta. */
  minMarkerValue?: number | null
  /** Marca del máximo del día (triángulo rojo). `null`/`undefined` la oculta. */
  maxMarkerValue?: number | null
  /** Marca de un promedio (p. ej. viento medio de 10 min, triángulo azul). */
  avgMarkerValue?: number | null
}

// Arco más amplio que antes (hueco de 60° en vez de 90°): el primer y
// último valor quedan más abajo, dejando más espacio libre arriba para
// el recuadro LCD -- pedido explícito del usuario con una captura de
// referencia (gauge WeeWX SteelSeries).
const START = 210   // bearing del valor mínimo (abajo-izquierda, más abajo que antes)
const SWEEP = 300   // grados totales de la escala (deja 60° de hueco abajo)

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}
function pt(cx: number, cy: number, r: number, bearing: number) {
  const t = toRad(bearing)
  return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) }
}
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = pt(cx, cy, r, a0)
  const p1 = pt(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
}
function range(min: number, max: number, step: number): number[] {
  if (!step || step <= 0) return []
  const out: number[] = []
  for (let x = min; x <= max + 1e-6; x += step) out.push(Math.round(x * 1000) / 1000)
  return out
}
function hasAny(list: number[], v: number) {
  return list.some((x) => Math.abs(x - v) < 1e-6)
}
// Triángulo apuntando al centro desde el borde de la carátula, sobre el
// anillo de marcas -- valor de referencia fijo, no la aguja. Compartido por
// la marca de ráfaga (Viento) y las de mín/máx del día (Temperatura, Presión,
// Humedad), que solo cambian de color.
function triMarker(cx: number, cy: number, faceR: number, zoneR: number, size: number, angle: number, color: string) {
  const tipR = zoneR - size * 0.0175   // borde interior de la banda de colores
  const baseR = faceR * 0.985
  const halfW = 5
  const tip = pt(cx, cy, tipR, angle)
  const b0 = pt(cx, cy, baseR, angle - halfW)
  const b1 = pt(cx, cy, baseR, angle + halfW)
  return (
    <polygon points={`${tip.x},${tip.y} ${b0.x},${b0.y} ${b1.x},${b1.y}`}
      fill={color} stroke="#f0ead6" strokeWidth={0.8} />
  )
}

export function AnalogGauge({
  title, value, min, max, unit, decimals = 1, majorStep, midStep, minorStep, zones = [], size = 200, trend, lcdWide,
  markerValue, minMarkerValue, maxMarkerValue, avgMarkerValue,
}: AnalogGaugeProps) {
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 5              // bisel exterior
  const faceR = R - size * 0.075      // carátula

  // Las marcas y el arco de colores comparten la MISMA banda exterior (en
  // vez de un arco de color afuera y un anillo de marcas más adentro, como
  // antes) -- así se libera toda la zona central para el título/LCD/aguja.
  // Marcas cortas y arco angosto, pegados al borde; los números casi tocan
  // el extremo interior de la marca mayor -- deja más espacio libre al centro.
  const tickOuterR = faceR * 0.94
  const zoneR = faceR * 0.88
  const tickMajorInnerR = faceR * 0.82
  const tickMidInnerR = faceR * 0.86
  const tickMinorInnerR = faceR * 0.90
  // 0.72 dejaba los números de 4 cifras (970, 1030, 1200, 2500...) casi
  // tocando la marca mayor y la franja de colores, sobre todo cerca de los
  // 90°/270° (izquierda/derecha): ahí el ANCHO del texto (no el alto) compite
  // por el mismo hueco radial contra la marca, y un número de 4 dígitos es
  // más ancho que alto. Un poco más adentro (0.68) da margen de sobra sin
  // acercarse al título ni al hueco central.
  const labelR = faceR * 0.68
  // "Radiación solar", "Base de nubes" y "Calidad del aire" chocaban con los
  // números vecinos de la escala si el título iba a la altura normal -- van
  // un poco más abajo (más cerca del centro) que los demás. La FUENTE sí es
  // la misma en los tres casos (uniformada a pedido del usuario): a 0.24 el
  // título queda tan lejos del anillo de números que ya no hace falta
  // achicarla para evitar el choque, sólo bajarla.
  const LOWERED_TITLES = ['Radiación solar', 'Base de nubes', 'Calidad del aire\nIMECA']
  const isLoweredTitle = LOWERED_TITLES.includes(title)
  const titleR = faceR * (isLoweredTitle ? 0.24 : 0.34)
  const titleFontScale = 0.046
  const titleLines = title.split('\n')
  const needleR = tickOuterR - 1

  // Pantalla LCD: pegada al centro (justo debajo del cubo de la aguja), NO a
  // media carátula -- si no, choca con los números de las esquinas inferiores
  // (bearing 135°/225°, los más próximos al hueco de abajo).
  const lcdW = size * (lcdWide ? 0.38 : 0.30)
  const lcdH = size * 0.115
  const lcdX = cx - lcdW / 2
  const lcdY = cy + size * 0.08

  const hasValue = value != null && !Number.isNaN(value)
  const v = hasValue ? Math.min(max, Math.max(min, value as number)) : min
  const needleAngle = START + ((v - min) / (max - min)) * SWEEP
  const angleOf = (val: number) => START + ((val - min) / (max - min)) * SWEEP

  const hasMarker = markerValue != null && !Number.isNaN(markerValue)
  const markerAngle = hasMarker ? angleOf(Math.min(max, Math.max(min, markerValue as number))) : 0

  const hasMinMarker = minMarkerValue != null && !Number.isNaN(minMarkerValue)
  const minMarkerAngle = hasMinMarker ? angleOf(Math.min(max, Math.max(min, minMarkerValue as number))) : 0
  const hasMaxMarker = maxMarkerValue != null && !Number.isNaN(maxMarkerValue)
  const maxMarkerAngle = hasMaxMarker ? angleOf(Math.min(max, Math.max(min, maxMarkerValue as number))) : 0
  const hasAvgMarker = avgMarkerValue != null && !Number.isNaN(avgMarkerValue)
  const avgMarkerAngle = hasAvgMarker ? angleOf(Math.min(max, Math.max(min, avgMarkerValue as number))) : 0

  const majors = useMemo(() => range(min, max, majorStep), [min, max, majorStep])
  const mids = useMemo(
    () => range(min, max, midStep || 0).filter((m) => !hasAny(majors, m)),
    [min, max, midStep, majors])
  const minors = useMemo(
    () => range(min, max, minorStep || 0).filter((m) => !hasAny(majors, m) && !hasAny(mids, m)),
    [min, max, minorStep, majors, mids])
  const uid = useMemo(() => Math.random().toString(36).slice(2, 9), [])

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title.replace('\n', ' ')}: ${hasValue ? value!.toFixed(decimals) : 'sin dato'} ${unit}`}>
      <defs>
        <radialGradient id={`face-${uid}`} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#fbf8ee" />
          <stop offset="55%" stopColor="#f0ead6" />
          <stop offset="100%" stopColor="#d5cdb2" />
        </radialGradient>
        <linearGradient id={`bezel-${uid}`} x1="12%" y1="8%" x2="88%" y2="92%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="20%" stopColor="#c9c9c9" />
          <stop offset="40%" stopColor="#8a8a8a" />
          <stop offset="50%" stopColor="#4a4a4a" />
          <stop offset="62%" stopColor="#8a8a8a" />
          <stop offset="82%" stopColor="#d8d8d8" />
          <stop offset="100%" stopColor="#f2f2f2" />
        </linearGradient>
        <radialGradient id={`hub-${uid}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#f5f5f5" />
          <stop offset="60%" stopColor="#999" />
          <stop offset="100%" stopColor="#444" />
        </radialGradient>
        <radialGradient id={`glass-${uid}`} cx="32%" cy="24%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`shadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodOpacity="0.45" />
        </filter>
        <filter id={`textshadow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.1" stdDeviation="0.8" floodColor="#000000" floodOpacity="0.75" />
        </filter>
        {/* Sombra INTERIOR del recuadro del LCD -- `feDropShadow` sólo hace
            sombra hacia AFUERA (por eso el LCD se veía "sobrepuesto",
            flotando sobre la carátula, en vez de hundido en ella). Receta
            estándar de sombra interna: se recorta un blur desplazado con la
            máscara alfa del propio rect (dos `feComposite operator="in"`),
            y se junta con el dibujo original -- así la sombra cae DENTRO
            del borde del rect, simulando profundidad hacia adentro. */}
        <filter id={`lcdshadow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feComponentTransfer in="SourceAlpha"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
          <feGaussianBlur stdDeviation={size * 0.012} />
          <feOffset dx="0" dy={size * 0.008} result="offsetblur" />
          <feFlood floodColor="#000000" floodOpacity="0.7" />
          <feComposite in2="offsetblur" operator="in" />
          <feComposite in2="SourceAlpha" operator="in" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode />
          </feMerge>
        </filter>
      </defs>

      <circle cx={cx} cy={cy} r={R} fill={`url(#bezel-${uid})`} />
      {/* Ranura entre bisel y carátula -- separación visible del borde metálico */}
      <circle cx={cx} cy={cy} r={faceR + size * 0.012} fill="none" stroke="#00000055" strokeWidth={size * 0.01} />
      <circle cx={cx} cy={cy} r={faceR} fill={`url(#face-${uid})`} stroke="#00000030" strokeWidth={1} />

      {[45, 135, 225, 315].map((b) => {
        const p = pt(cx, cy, R - size * 0.025, b)
        return <circle key={b} cx={p.x} cy={p.y} r={size * 0.015} fill="#7a7a7a" stroke="#f0f0f0" strokeWidth={0.6} />
      })}

      {zones.map((z, i) => (
        <path key={i}
          d={arcPath(cx, cy, zoneR, angleOf(Math.max(min, z.from)), angleOf(Math.min(max, z.to)))}
          stroke={z.color} strokeWidth={size * 0.035} fill="none" opacity={0.8} />
      ))}

      {minors.map((m) => {
        const a = angleOf(m)
        const p0 = pt(cx, cy, tickOuterR, a)
        const p1 = pt(cx, cy, tickMinorInnerR, a)
        return <line key={`mn${m}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#2e2e28" strokeWidth={0.8} opacity={0.65} />
      })}

      {mids.map((m) => {
        const a = angleOf(m)
        const p0 = pt(cx, cy, tickOuterR, a)
        const p1 = pt(cx, cy, tickMidInnerR, a)
        return <line key={`md${m}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#2e2e28" strokeWidth={1.1} opacity={0.8} />
      })}

      {majors.map((m) => {
        const a = angleOf(m)
        const p0 = pt(cx, cy, tickOuterR, a)
        const p1 = pt(cx, cy, tickMajorInnerR, a)
        const lp = pt(cx, cy, labelR, a)
        return (
          <g key={m}>
            <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#1c1c18" strokeWidth={1.8} />
            <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={size * 0.052} fill="#3a3a32" fontFamily="ui-sans-serif, system-ui">
              {Number.isInteger(m) ? m : m.toFixed(1)}
            </text>
          </g>
        )
      })}

      {/* Marca triangular fija (p. ej. ráfaga máxima del día): apunta hacia el
          centro desde el borde de la carátula, sobre el anillo de marcas --
          un valor de referencia aparte de la aguja, que no se mueve con ella.
          Roja (mismo rojo que la aguja) y grande a propósito para que
          destaque sobre cualquier color de zona. */}
      {hasMarker && triMarker(cx, cy, faceR, zoneR, size, markerAngle, '#c0392b')}
      {/* Mín/máx del día (Temperatura, Presión, Humedad): mismo triángulo que
          la ráfaga de arriba, en azul/rojo para no confundirse con la aguja. */}
      {hasMinMarker && triMarker(cx, cy, faceR, zoneR, size, minMarkerAngle, '#2563eb')}
      {hasMaxMarker && triMarker(cx, cy, faceR, zoneR, size, maxMarkerAngle, '#c0392b')}
      {/* Promedio (p. ej. viento medio de 10 min en Viento): mismo triángulo, azul. */}
      {hasAvgMarker && triMarker(cx, cy, faceR, zoneR, size, avgMarkerAngle, '#2563eb')}

      <text x={cx} y={cy - titleR} textAnchor="middle" fontSize={size * titleFontScale}
        fill="#5a5545" fontWeight={700} letterSpacing={0.2} fontFamily="ui-sans-serif, system-ui">
        {/* Segunda línea (subtítulo -- selección activa: Exterior/Interior,
            periodo de Lluvia, IMECA...): MISMO tamaño que la primera (a
            pedido del usuario, antes iba achicada al 68%), sólo con el
            interlineado justo para no encimarse. */}
        {titleLines.map((line, i) => (
          <tspan key={i} x={cx} dy={i === 0 ? 0 : size * titleFontScale * 1.05}>
            {line.toUpperCase()}
          </tspan>
        ))}
      </text>

      {/* Pantalla LCD: texto monoespaciado con sombra tenue (no dígitos de 7
          segmentos -- no se veían bien en el navegador real). Va ANTES que
          la aguja para que esta pinte por encima. */}
      <rect x={lcdX - 1} y={lcdY - 1} width={lcdW + 2} height={lcdH + 2} rx={3} fill="#45453a" />
      <rect x={lcdX} y={lcdY} width={lcdW} height={lcdH} rx={3} fill="#cdd9bd" stroke="#7a7a68" strokeWidth={1}
        filter={`url(#lcdshadow-${uid})`} />
      <text x={cx} y={lcdY + lcdH * 0.56} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.095} fontWeight={700} fill="#28331f" letterSpacing={0.5}
        fontFamily="ui-monospace, monospace" filter={`url(#textshadow-${uid})`}>
        {hasValue ? value!.toFixed(decimals) : '--'}
      </text>

      <text x={cx} y={lcdY + lcdH + size * 0.065} textAnchor="middle"
        fontSize={size * 0.05} fill="#6b6656" fontFamily="ui-sans-serif, system-ui">
        {unit}
      </text>

      {/* Tendencia: a la izquierda de la aguja, a nivel del centro -- mismos
          path/colores que TrendGlyph en ConsoleReplica.tsx (consola/kiosco):
          flecha con cola en vez de glifo ▲/▼, y la barra de "estable" más
          gruesa que el guion "–" que había antes. Los paths están definidos
          en un viewBox de 20×24 centrado en (10,12); se reescalan con
          `scale(s)` y se trasladan para que ese centro caiga en (px, cy).
          Radio chico (0.40×faceR) a propósito: a 0.62 coincidía con el
          número "970" de Presión (bearing 270° = puro-izquierda, igual que
          este punto) -- más cerca del centro queda lejos del anillo de
          números (0.68). */}
      {trend && (() => {
        const s = size * 0.006
        const px = cx - faceR * 0.40
        return (
          <g transform={`translate(${px - 10 * s}, ${cy - 12 * s}) scale(${s})`}>
            {trend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
            {trend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
            {trend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
          </g>
        )
      })()}

      {/* Aguja: gruesa, forma ancha->angosta (base 0.05*size, punta en cero).
          Va DESPUÉS del LCD para pintarse por encima.
          El giro se anima como propiedad CSS `transform` con `transformOrigin`
          fijo en el pivote -- NO como `rotate(a, cx, cy)` en el atributo SVG
          con `transition`: eso hace que el navegador interpole la matriz ya
          descompuesta (traslación y rotación por separado) en vez de un
          pivote limpio, y la aguja "se sale" del centro durante el giro. */}
      <g style={{
        transformOrigin: `${cx}px ${cy}px`,
        transform: `rotate(${needleAngle}deg)`,
        transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <polygon
          points={`${cx - size * 0.026},${cy + size * 0.08} ${cx + size * 0.026},${cy + size * 0.08} ${cx},${cy - needleR}`}
          fill="#c0392b" filter={`url(#shadow-${uid})`} />
      </g>
      <circle cx={cx} cy={cy} r={size * 0.038} fill={`url(#hub-${uid})`} stroke="#3a3a3a" strokeWidth={0.6} />

      {/* Reflejo de cristal: va AL FINAL, por encima de todo (aguja incluida)
          -- es el vidrio que cubre el instrumento completo. */}
      <circle cx={cx} cy={cy} r={faceR} fill={`url(#glass-${uid})`} />
    </svg>
  )
}
