import { useMemo } from 'react'

// Variante de AnalogGauge para dirección de viento: brújula de 360° completos
// (sin hueco), rótulos SOLO en los 4 cardinales (N/E/S/O -- ya no los 8
// intercardinales, que se apiñaban con las marcas de 5°), misma convención
// de bearing (0 = arriba, horario) que AnalogGauge y WindRose.
const DIRS = [
  ['N', 0], ['E', 90], ['S', 180], ['O', 270],
] as const
const CARDINALS = [0, 90, 180, 270]

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}
function pt(cx: number, cy: number, r: number, bearing: number) {
  const t = toRad(bearing)
  return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) }
}
// Distancia angular más corta entre dos bearings (0-180°, cruzando 0°/360°
// cuando corresponde) -- para saber si una marca de la escala cae cerca de
// un cardinal, sin importar de qué lado.
function angDist(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function rumbo(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
  return dirs[Math.round(((deg % 360) / 22.5)) % 16]
}

export function CompassGauge({ value, avgBearing, dominantBearing, size = 200 }: {
  value: number | null | undefined
  /** Dirección media circular de los últimos 10 min (`wind_direction_avg10m`). */
  avgBearing?: number | null
  /** Rumbo predominante (p. ej. `rose.dominant` resuelto a grados vía `sectors[].dir`). */
  dominantBearing?: number | null
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 5
  const faceR = R - size * 0.075
  // La escala de grados (ticks) a la MISMA distancia relativa que en
  // AnalogGauge (tickOuterR/tickMajorInnerR/tickMidInnerR/tickMinorInnerR
  // ahí también son 0.94/0.82/0.86/0.90×faceR) para que los medidores se
  // vean consistentes entre sí -- las letras cardinales se quedan en su
  // radio de siempre (labelR, SIN cambios).
  const tickOuterR = faceR * 0.94
  const tickMajorInnerR = faceR * 0.82
  const tickMidInnerR = faceR * 0.86
  const tickMinorInnerR = faceR * 0.90
  const labelR = faceR * 0.92
  // La aguja se queda corta del radio de las letras a propósito (ver arriba).
  const needleR = tickMajorInnerR
  // Aguja de promedio: mismo largo que la actual (roja) -- a pedido del
  // usuario, antes era más corta y delgada.
  const avgNeedleR = needleR

  // Mismo tamaño de LCD que en Presión (AnalogGauge con `lcdWide`): ancho
  // 0.38 y alto 0.115. La de ACTUAL va ARRIBA del centro (donde antes iba
  // el título "DIRECCIÓN", quitado) y la de PROMEDIO va ABAJO (posición
  // del LCD original, antes de que hubiera dos) -- el color del texto
  // (rojo/azul) hace de etiqueta, a juego con la aguja de cada uno.
  const lcdW = size * 0.44
  const lcdH = size * 0.115
  const lcdX = cx - lcdW / 2
  const lcd1Y = cy - size * 0.173
  const lcd2Y = cy + size * 0.075

  const hasValue = value != null && !Number.isNaN(value)
  const bearing = hasValue ? ((value as number) % 360 + 360) % 360 : 0
  const hasAvg = avgBearing != null && !Number.isNaN(avgBearing)
  const avgBrg = hasAvg ? ((avgBearing as number) % 360 + 360) % 360 : 0
  const hasDominant = dominantBearing != null && !Number.isNaN(dominantBearing)
  const dominantBrg = hasDominant ? ((dominantBearing as number) % 360 + 360) % 360 : 0
  const uid = useMemo(() => Math.random().toString(36).slice(2, 9), [])

  // Escala nueva: marca cada 5°, mayor cada 20°, media cada 10° (impar) y
  // menor cada 5° (impar) -- pero se salta cualquier marca a ±10° o menos de
  // un cardinal (N/E/S/O), así nunca choca con esas letras ni con la que le
  // sigue. El primer/último tramo visible queda entonces en 15°, no en 0°.
  const minors = useMemo(
    () => Array.from({ length: 72 }, (_, i) => i * 5).filter((m) => !CARDINALS.some((c) => angDist(m, c) <= 10)),
    [])

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={`Dirección del viento: ${hasValue ? `${Math.round(bearing)}° (${rumbo(bearing)})` : 'sin dato'}`
        + (hasAvg ? `, promedio 10 min: ${Math.round(avgBrg)}° (${rumbo(avgBrg)})` : '')
        + (hasDominant ? `, predominante: ${Math.round(dominantBrg)}° (${rumbo(dominantBrg)})` : '')}>
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
        <filter id={`clcdshadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.6" floodColor="#000000" floodOpacity="0.6" />
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
        const isMajor = m % 20 === 0    // muy marcada
        const isMid = !isMajor && m % 10 === 0   // marcada
        const innerR = isMajor ? tickMajorInnerR : isMid ? tickMidInnerR : tickMinorInnerR
        const a = pt(cx, cy, tickOuterR, m)
        const b = pt(cx, cy, innerR, m)
        return <line key={m} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2e2e28"
          strokeWidth={isMajor ? 1.8 : isMid ? 1.1 : 0.8} opacity={isMajor ? 1 : isMid ? 0.8 : 0.65} />
      })}

      {/* Sin línea de marca propia por cada cardinal (se quitó -- con la
          escala de grados pegada al extremo, esa línea se encimaba con la
          letra). Solo el texto, en su radio de siempre. */}
      {DIRS.map(([label, b]) => {
        const lp = pt(cx, cy, labelR, b)
        return (
          <text key={label} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
            fontSize={size * 0.078} fontWeight={700} fill="#3a3a32" fontFamily="ui-sans-serif, system-ui">
            {label}
          </text>
        )
      })}

      {/* Marca roja de dirección predominante (rose.dominant, resuelto a
          grados por el llamador): banda propia de radio (0.68-0.87×faceR),
          bien por debajo de labelR (0.92) para no encimarse NUNCA con las
          letras cardinales, sin importar el rumbo. */}
      {hasDominant && (() => {
        const tipR = faceR * 0.68
        const baseR = faceR * 0.87
        const halfW = 6
        const tip = pt(cx, cy, tipR, dominantBrg)
        const b0 = pt(cx, cy, baseR, dominantBrg - halfW)
        const b1 = pt(cx, cy, baseR, dominantBrg + halfW)
        return (
          <polygon points={`${tip.x},${tip.y} ${b0.x},${b0.y} ${b1.x},${b1.y}`}
            fill="#c0392b" stroke="#f0ead6" strokeWidth={0.7} />
        )
      })()}

      {/* LCD de arriba: dirección ACTUAL (aguja roja) -- el color del texto,
          a juego con la aguja, hace de etiqueta sin gastar una línea aparte. */}
      <rect x={lcdX - 1} y={lcd1Y - 1} width={lcdW + 2} height={lcdH + 2} rx={3} fill="#45453a" filter={`url(#clcdshadow-${uid})`} />
      <rect x={lcdX} y={lcd1Y} width={lcdW} height={lcdH} rx={3} fill="#cdd9bd" stroke="#7a7a68" strokeWidth={1} />
      <text x={cx} y={lcd1Y + lcdH * 0.58} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.095} fontWeight={700} fill="#7a2420" letterSpacing={0.2}
        fontFamily="ui-monospace, monospace" filter={`url(#ctextshadow-${uid})`}>
        {hasValue ? `${Math.round(bearing)}° ${rumbo(bearing)}` : '--'}
      </text>

      {/* LCD de abajo: PROMEDIO de 10 min (aguja azul) */}
      <rect x={lcdX - 1} y={lcd2Y - 1} width={lcdW + 2} height={lcdH + 2} rx={3} fill="#45453a" filter={`url(#clcdshadow-${uid})`} />
      <rect x={lcdX} y={lcd2Y} width={lcdW} height={lcdH} rx={3} fill="#cdd9bd" stroke="#7a7a68" strokeWidth={1} />
      <text x={cx} y={lcd2Y + lcdH * 0.58} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.095} fontWeight={700} fill="#1c3a63" letterSpacing={0.2}
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
            points={`${cx - size * 0.026},${cy + size * 0.08} ${cx + size * 0.026},${cy + size * 0.08} ${cx},${cy - avgNeedleR}`}
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
