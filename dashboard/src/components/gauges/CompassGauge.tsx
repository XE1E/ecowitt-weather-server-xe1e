import { useMemo } from 'react'

// Variante de AnalogGauge para dirección de viento: brújula de 360° completos
// (sin hueco), rótulos cardinales N/E/S/O en vez de números, misma convención
// de bearing (0 = arriba, horario) que AnalogGauge y WindRose.
const DIRS = [
  ['N', 0], ['NE', 45], ['E', 90], ['SE', 135],
  ['S', 180], ['SO', 225], ['O', 270], ['NO', 315],
] as const

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}
function pt(cx: number, cy: number, r: number, bearing: number) {
  const t = toRad(bearing)
  return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) }
}

function rumbo(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
  return dirs[Math.round(((deg % 360) / 22.5)) % 16]
}

export function CompassGauge({ value, avgBearing, size = 200 }: {
  value: number | null | undefined
  /** Dirección media circular de los últimos 10 min (`wind_direction_avg10m`). */
  avgBearing?: number | null
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 5
  const faceR = R - size * 0.075
  // Los puntos cardinales van AFUERA del anillo de marcas (cerca del borde),
  // no adentro -- así se leen como en una brújula real, separados de las
  // marcas finas de grado.
  const tickOuterR = faceR * 0.78
  const tickMajorInnerR = faceR * 0.68
  const tickMinorInnerR = faceR * 0.74
  const labelR = faceR * 0.92
  const titleR = faceR * 0.20
  const needleR = tickOuterR - 1
  // Aguja de promedio: más corta y delgada que la actual, para que la roja
  // (actual) quede visualmente al mando cuando ambas casi coinciden.
  const avgNeedleR = needleR * 0.86

  // Igual que en AnalogGauge: LCD pegado al centro, no a media carátula --
  // "259° SSO" (hasta 8 caracteres) necesita más ancho que un número normal.
  // Dos filas (actual/promedio) en el mismo alto total que antes ocupaba una
  // sola -- el color del texto (rojo/azul) hace de etiqueta, a juego con la
  // aguja de cada uno, sin gastar espacio vertical en captions.
  const lcdW = size * 0.42
  const lcdH = size * 0.085
  const lcdGap = size * 0.012
  const lcdX = cx - lcdW / 2
  const lcd1Y = cy + size * 0.075
  const lcd2Y = lcd1Y + lcdH + lcdGap

  const hasValue = value != null && !Number.isNaN(value)
  const bearing = hasValue ? ((value as number) % 360 + 360) % 360 : 0
  const hasAvg = avgBearing != null && !Number.isNaN(avgBearing)
  const avgBrg = hasAvg ? ((avgBearing as number) % 360 + 360) % 360 : 0
  const uid = useMemo(() => Math.random().toString(36).slice(2, 9), [])

  const minors = useMemo(() => Array.from({ length: 72 }, (_, i) => i * 5), [])

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={`Dirección del viento: ${hasValue ? `${Math.round(bearing)}° (${rumbo(bearing)})` : 'sin dato'}`
        + (hasAvg ? `, promedio 10 min: ${Math.round(avgBrg)}° (${rumbo(avgBrg)})` : '')}>
      <defs>
        <radialGradient id={`cface-${uid}`} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#fbf8ee" />
          <stop offset="55%" stopColor="#f0ead6" />
          <stop offset="100%" stopColor="#d5cdb2" />
        </radialGradient>
        <linearGradient id={`cbezel-${uid}`} x1="12%" y1="8%" x2="88%" y2="92%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="20%" stopColor="#c9c9c9" />
          <stop offset="40%" stopColor="#8a8a8a" />
          <stop offset="50%" stopColor="#4a4a4a" />
          <stop offset="62%" stopColor="#8a8a8a" />
          <stop offset="82%" stopColor="#d8d8d8" />
          <stop offset="100%" stopColor="#f2f2f2" />
        </linearGradient>
        <radialGradient id={`chub-${uid}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#f5f5f5" />
          <stop offset="60%" stopColor="#999" />
          <stop offset="100%" stopColor="#444" />
        </radialGradient>
        <radialGradient id={`cglass-${uid}`} cx="32%" cy="24%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`cshadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodOpacity="0.45" />
        </filter>
        <filter id={`ctextshadow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.6" stdDeviation="0.5" floodColor="#000000" floodOpacity="0.5" />
        </filter>
      </defs>

      <circle cx={cx} cy={cy} r={R} fill={`url(#cbezel-${uid})`} />
      <circle cx={cx} cy={cy} r={faceR + size * 0.012} fill="none" stroke="#00000055" strokeWidth={size * 0.01} />
      <circle cx={cx} cy={cy} r={faceR} fill={`url(#cface-${uid})`} stroke="#00000030" strokeWidth={1} />

      {[45, 135, 225, 315].map((b) => {
        const p = pt(cx, cy, R - size * 0.025, b)
        return <circle key={b} cx={p.x} cy={p.y} r={size * 0.015} fill="#7a7a7a" stroke="#f0f0f0" strokeWidth={0.6} />
      })}

      {minors.map((m) => {
        if (m % 45 === 0) return null
        const a = pt(cx, cy, tickOuterR, m)
        const b = pt(cx, cy, m % 10 === 0 ? tickMajorInnerR : tickMinorInnerR, m)
        return <line key={m} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4a4a42" strokeWidth={m % 10 === 0 ? 1.2 : 0.7} opacity={m % 10 === 0 ? 0.85 : 0.6} />
      })}

      {DIRS.map(([label, b]) => {
        const p0 = pt(cx, cy, tickOuterR, b)
        const p1 = pt(cx, cy, tickMajorInnerR, b)
        const lp = pt(cx, cy, labelR, b)
        return (
          <g key={label}>
            <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#1c1c18" strokeWidth={1.8} />
            <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={size * 0.062} fontWeight={700} fill="#3a3a32" fontFamily="ui-sans-serif, system-ui">
              {label}
            </text>
          </g>
        )
      })}

      <text x={cx} y={cy - titleR} textAnchor="middle" fontSize={size * 0.042}
        fill="#5a5545" fontWeight={700} letterSpacing={0.2} fontFamily="ui-sans-serif, system-ui">
        DIRECCIÓN
      </text>

      {/* LCD de arriba: dirección ACTUAL (aguja roja) -- el color del texto,
          a juego con la aguja, hace de etiqueta sin gastar una línea aparte. */}
      <rect x={lcdX - 1} y={lcd1Y - 1} width={lcdW + 2} height={lcdH + 2} rx={3} fill="#5c5c50" />
      <rect x={lcdX} y={lcd1Y} width={lcdW} height={lcdH} rx={3} fill="#cdd9bd" stroke="#7a7a68" strokeWidth={1} />
      <text x={cx} y={lcd1Y + lcdH * 0.58} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.058} fontWeight={700} fill="#7a2420" letterSpacing={0.2}
        fontFamily="ui-monospace, monospace" filter={`url(#ctextshadow-${uid})`}>
        {hasValue ? `${Math.round(bearing)}° ${rumbo(bearing)}` : '--'}
      </text>

      {/* LCD de abajo: PROMEDIO de 10 min (aguja azul) */}
      <rect x={lcdX - 1} y={lcd2Y - 1} width={lcdW + 2} height={lcdH + 2} rx={3} fill="#5c5c50" />
      <rect x={lcdX} y={lcd2Y} width={lcdW} height={lcdH} rx={3} fill="#cdd9bd" stroke="#7a7a68" strokeWidth={1} />
      <text x={cx} y={lcd2Y + lcdH * 0.58} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.058} fontWeight={700} fill="#1c3a63" letterSpacing={0.2}
        fontFamily="ui-monospace, monospace" filter={`url(#ctextshadow-${uid})`}>
        {hasAvg ? `${Math.round(avgBrg)}° ${rumbo(avgBrg)}` : '--'}
      </text>

      {/* Aguja de promedio (azul): va DEBAJO de la actual (roja) para que esta
          se vea al mando cuando casi coinciden. Ver comentario en
          AnalogGauge.tsx sobre por qué el giro se anima con `transform` CSS +
          `transformOrigin`, no con `rotate(a, cx, cy)` en el atributo SVG. */}
      {hasAvg && (
        <g style={{
          transformOrigin: `${cx}px ${cy}px`,
          transform: `rotate(${avgBrg}deg)`,
          transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <polygon
            points={`${cx - size * 0.02},${cy + size * 0.06} ${cx + size * 0.02},${cy + size * 0.06} ${cx},${cy - avgNeedleR}`}
            fill="#2563eb" filter={`url(#cshadow-${uid})`} />
        </g>
      )}

      <g style={{
        transformOrigin: `${cx}px ${cy}px`,
        transform: `rotate(${bearing}deg)`,
        transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <polygon
          points={`${cx - size * 0.026},${cy + size * 0.08} ${cx + size * 0.026},${cy + size * 0.08} ${cx},${cy - needleR}`}
          fill="#c0392b" filter={`url(#cshadow-${uid})`} />
      </g>
      <circle cx={cx} cy={cy} r={size * 0.038} fill={`url(#chub-${uid})`} stroke="#3a3a3a" strokeWidth={0.6} />

      <circle cx={cx} cy={cy} r={faceR} fill={`url(#cglass-${uid})`} />
    </svg>
  )
}
