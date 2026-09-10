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
  minorStep?: number
  zones?: GaugeZone[]
  size?: number
  trend?: 'up' | 'down' | 'stable'
}

const START = 225   // bearing del valor mínimo (abajo-izquierda)
const SWEEP = 270   // grados totales de la escala (deja 90° de hueco abajo)

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

export function AnalogGauge({
  title, value, min, max, unit, decimals = 1, majorStep, minorStep, zones = [], size = 200, trend,
}: AnalogGaugeProps) {
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 5              // bisel exterior
  const faceR = R - size * 0.045      // carátula
  // Radios relativos a faceR: el anillo de marcas/números vive pegado al
  // borde (0.68-0.92) para dejar TODO el centro-arriba libre para el título
  // -- si no, el título choca con el número que cae arriba (bearing 0 es
  // siempre el punto medio del rango, así que casi siempre hay un tick ahí).
  const zoneR = faceR * 0.92
  const tickOuterR = faceR * 0.84
  const tickMajorInnerR = faceR * 0.735
  const tickMinorInnerR = faceR * 0.785
  const labelR = faceR * 0.60
  const titleR = faceR * 0.20
  const needleR = zoneR - 1

  const hasValue = value != null && !Number.isNaN(value)
  const v = hasValue ? Math.min(max, Math.max(min, value as number)) : min
  const needleAngle = START + ((v - min) / (max - min)) * SWEEP
  const angleOf = (val: number) => START + ((val - min) / (max - min)) * SWEEP

  const majors = useMemo(() => range(min, max, majorStep), [min, max, majorStep])
  const minors = useMemo(() => range(min, max, minorStep || 0), [min, max, minorStep])
  const uid = useMemo(() => Math.random().toString(36).slice(2, 9), [])

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${hasValue ? value!.toFixed(decimals) : 'sin dato'} ${unit}`}>
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
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`shadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodOpacity="0.45" />
        </filter>
      </defs>

      <circle cx={cx} cy={cy} r={R} fill={`url(#bezel-${uid})`} />
      {/* Ranura entre bisel y carátula -- separación visible del borde metálico */}
      <circle cx={cx} cy={cy} r={faceR + size * 0.012} fill="none" stroke="#00000055" strokeWidth={size * 0.01} />
      <circle cx={cx} cy={cy} r={faceR} fill={`url(#face-${uid})`} stroke="#00000030" strokeWidth={1} />
      {/* Reflejo de cristal (glass) sobre la carátula */}
      <circle cx={cx} cy={cy} r={faceR} fill={`url(#glass-${uid})`} />

      {[45, 135, 225, 315].map((b) => {
        const p = pt(cx, cy, R - size * 0.02, b)
        return <circle key={b} cx={p.x} cy={p.y} r={size * 0.013} fill="#7a7a7a" stroke="#f0f0f0" strokeWidth={0.6} />
      })}

      {zones.map((z, i) => (
        <path key={i}
          d={arcPath(cx, cy, zoneR, angleOf(Math.max(min, z.from)), angleOf(Math.min(max, z.to)))}
          stroke={z.color} strokeWidth={size * 0.025} fill="none" opacity={0.85} />
      ))}

      {minors.map((m) => {
        if (majors.some((M) => Math.abs(M - m) < 1e-6)) return null
        const a = angleOf(m)
        const p0 = pt(cx, cy, tickOuterR, a)
        const p1 = pt(cx, cy, tickMinorInnerR, a)
        return <line key={m} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#4a4a42" strokeWidth={1} />
      })}

      {majors.map((m) => {
        const a = angleOf(m)
        const p0 = pt(cx, cy, tickOuterR, a)
        const p1 = pt(cx, cy, tickMajorInnerR, a)
        const lp = pt(cx, cy, labelR, a)
        return (
          <g key={m}>
            <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#2e2e28" strokeWidth={1.6} />
            <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={size * 0.052} fill="#3a3a32" fontFamily="ui-sans-serif, system-ui">
              {Number.isInteger(m) ? m : m.toFixed(1)}
            </text>
          </g>
        )
      })}

      <text x={cx} y={cy - titleR} textAnchor="middle" fontSize={size * 0.042}
        fill="#5a5545" fontWeight={600} letterSpacing={0.2} fontFamily="ui-sans-serif, system-ui">
        {title.toUpperCase()}
      </text>

      <g style={{ transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)' }}
        transform={`rotate(${needleAngle} ${cx} ${cy})`}>
        <polygon
          points={`${cx - size * 0.014},${cy + size * 0.07} ${cx + size * 0.014},${cy + size * 0.07} ${cx},${cy - needleR}`}
          fill="#c0392b" filter={`url(#shadow-${uid})`} />
      </g>
      <circle cx={cx} cy={cy} r={size * 0.035} fill={`url(#hub-${uid})`} stroke="#3a3a3a" strokeWidth={0.6} />

      {/* Pantalla LCD: marco recesado (sombra interior simulada con un rect
          más oscuro debajo, desplazado) + tinte verdoso clásico de LCD real */}
      <rect x={cx - size * 0.185 - 1} y={cy + faceR * 0.32 - 1} width={size * 0.37 + 2} height={size * 0.135 + 2}
        rx={3} fill="#5c5c50" />
      <rect x={cx - size * 0.185} y={cy + faceR * 0.32} width={size * 0.37} height={size * 0.135}
        rx={3} fill="#cdd9bd" stroke="#7a7a68" strokeWidth={1} />
      <text x={cx} y={cy + faceR * 0.32 + size * 0.0685} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.095} fontWeight={700} fill="#28331f" letterSpacing={0.5}
        fontFamily="ui-monospace, monospace">
        {hasValue ? value!.toFixed(decimals) : '--'}
      </text>

      <text x={cx} y={cy + faceR * 0.32 + size * 0.135 + size * 0.07} textAnchor="middle"
        fontSize={size * 0.05} fill="#6b6656" fontFamily="ui-sans-serif, system-ui">
        {unit}
      </text>

      {trend && (
        <text x={cx - faceR * 0.62} y={cy + faceR * 0.34} textAnchor="middle" fontSize={size * 0.075}
          fill={trend === 'up' ? '#c0392b' : trend === 'down' ? '#2563eb' : '#8a8a78'}>
          {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–'}
        </text>
      )}
    </svg>
  )
}
