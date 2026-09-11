import { useEffect, useMemo, useState } from 'react'

// Reloj analógico con el mismo bisel/carátula que AnalogGauge/CompassGauge --
// no muestra ningún dato de la estación, es decorativo (hora del navegador),
// pero comparte look para que encaje en el panel de Instrumentos.
const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}
function pt(cx: number, cy: number, r: number, bearing: number) {
  const t = toRad(bearing)
  return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) }
}

export function ClockGauge({ size = 200 }: { size?: number }) {
  const [now, setNow] = useState(() => new Date())
  // IDs únicos por instancia (mismo motivo que en AnalogGauge/CompassGauge):
  // dos relojes en la misma página no deben compartir `id` de gradiente/filtro.
  const uid = useMemo(() => Math.random().toString(36).slice(2, 9), [])

  // Un `setTimeout` que se reprograma en cada vuelta (en vez de `setInterval`
  // fijo a 1000ms) para que el segundero quede alineado al segundo real del
  // reloj, no a cuando se montó el componente.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    }
    timer = setTimeout(tick, 1000 - (Date.now() % 1000))
    return () => clearTimeout(timer)
  }, [])

  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 5
  const faceR = R - size * 0.075
  const tickOuterR = faceR * 0.94
  const tickMajorInnerR = faceR * 0.82
  const tickMinorInnerR = faceR * 0.90
  const labelR = faceR * 0.68
  const titleR = faceR * 0.34

  const lcdW = size * 0.30
  const lcdH = size * 0.115
  const lcdX = cx - lcdW / 2
  const lcdY = cy + size * 0.08

  const h = now.getHours() % 12
  const m = now.getMinutes()
  const s = now.getSeconds()
  const hourAngle = (h + m / 60) * 30
  const minuteAngle = (m + s / 60) * 6
  const secondAngle = s * 6
  const dateLabel = `${now.getDate()} ${MESES[now.getMonth()]}`

  const minors = Array.from({ length: 60 }, (_, i) => i * 6)   // grados, uno por minuto

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={`Reloj: ${now.toLocaleTimeString('es-MX')}, ${dateLabel}`}>
      <defs>
        <radialGradient id={`clk-face-${uid}`} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#fbf8ee" />
          <stop offset="55%" stopColor="#f0ead6" />
          <stop offset="100%" stopColor="#d5cdb2" />
        </radialGradient>
        <linearGradient id={`clk-bezel-${uid}`} x1="12%" y1="8%" x2="88%" y2="92%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="20%" stopColor="#c9c9c9" />
          <stop offset="40%" stopColor="#8a8a8a" />
          <stop offset="50%" stopColor="#4a4a4a" />
          <stop offset="62%" stopColor="#8a8a8a" />
          <stop offset="82%" stopColor="#d8d8d8" />
          <stop offset="100%" stopColor="#f2f2f2" />
        </linearGradient>
        <radialGradient id={`clk-hub-${uid}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#f5f5f5" />
          <stop offset="60%" stopColor="#999" />
          <stop offset="100%" stopColor="#444" />
        </radialGradient>
        <radialGradient id={`clk-glass-${uid}`} cx="32%" cy="24%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`clk-shadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodOpacity="0.45" />
        </filter>
        <filter id={`clk-textshadow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.1" stdDeviation="0.8" floodColor="#000000" floodOpacity="0.75" />
        </filter>
        <filter id={`clk-lcdshadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.6" floodColor="#000000" floodOpacity="0.6" />
        </filter>
      </defs>

      <circle cx={cx} cy={cy} r={R} fill={`url(#clk-bezel-${uid})`} />
      <circle cx={cx} cy={cy} r={faceR + size * 0.012} fill="none" stroke="#00000055" strokeWidth={size * 0.01} />
      <circle cx={cx} cy={cy} r={faceR} fill={`url(#clk-face-${uid})`} stroke="#00000030" strokeWidth={1} />

      {[45, 135, 225, 315].map((b) => {
        const p = pt(cx, cy, R - size * 0.025, b)
        return <circle key={b} cx={p.x} cy={p.y} r={size * 0.015} fill="#7a7a7a" stroke="#f0f0f0" strokeWidth={0.6} />
      })}

      {/* Marcas: 60, una por minuto -- gruesa cada 5 (hora), fina el resto. */}
      {minors.map((deg) => {
        const isHour = deg % 30 === 0
        const a = pt(cx, cy, tickOuterR, deg)
        const b = pt(cx, cy, isHour ? tickMajorInnerR : tickMinorInnerR, deg)
        return <line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2e2e28"
          strokeWidth={isHour ? 1.8 : 0.8} opacity={isHour ? 1 : 0.6} />
      })}

      {/* Números de 1 a 12. */}
      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
        const lp = pt(cx, cy, labelR, n * 30)
        return (
          <text key={n} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
            fontSize={size * 0.062} fontWeight={700} fill="#3a3a32" fontFamily="ui-sans-serif, system-ui">
            {n}
          </text>
        )
      })}

      <text x={cx} y={cy - titleR} textAnchor="middle" fontSize={size * 0.046}
        fill="#5a5545" fontWeight={700} letterSpacing={0.2} fontFamily="ui-sans-serif, system-ui">
        RELOJ
      </text>

      {/* Pantalla LCD: fecha (día + mes abreviado, p. ej. "10 SEP"). */}
      <rect x={lcdX - 1} y={lcdY - 1} width={lcdW + 2} height={lcdH + 2} rx={3} fill="#45453a" filter={`url(#clk-lcdshadow-${uid})`} />
      <rect x={lcdX} y={lcdY} width={lcdW} height={lcdH} rx={3} fill="#cdd9bd" stroke="#7a7a68" strokeWidth={1} />
      <text x={cx} y={lcdY + lcdH * 0.58} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.078} fontWeight={700} fill="#28331f" letterSpacing={0.5}
        fontFamily="ui-monospace, monospace" filter={`url(#clk-textshadow-${uid})`}>
        {dateLabel}
      </text>

      {/* Horario y minutero: giro animado (mismo motivo que en AnalogGauge/
          CompassGauge -- `transform` CSS + `transformOrigin`, no `rotate()`
          en el atributo SVG). El segundero NO anima: un reloj real "tica",
          no desliza de un segundo a otro. */}
      <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${hourAngle}deg)`, transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)' }}>
        <polygon points={`${cx - size * 0.022},${cy + size * 0.05} ${cx + size * 0.022},${cy + size * 0.05} ${cx},${cy - faceR * 0.45}`}
          fill="#2e2e28" filter={`url(#clk-shadow-${uid})`} />
      </g>
      <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${minuteAngle}deg)`, transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)' }}>
        <polygon points={`${cx - size * 0.016},${cy + size * 0.06} ${cx + size * 0.016},${cy + size * 0.06} ${cx},${cy - faceR * 0.68}`}
          fill="#2e2e28" filter={`url(#clk-shadow-${uid})`} />
      </g>
      <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${secondAngle}deg)` }}>
        <line x1={cx} y1={cy + faceR * 0.16} x2={cx} y2={cy - faceR * 0.80}
          stroke="#c0392b" strokeWidth={size * 0.008} strokeLinecap="round" filter={`url(#clk-shadow-${uid})`} />
      </g>
      <circle cx={cx} cy={cy} r={size * 0.032} fill={`url(#clk-hub-${uid})`} stroke="#3a3a3a" strokeWidth={0.6} />

      <circle cx={cx} cy={cy} r={faceR} fill={`url(#clk-glass-${uid})`} />
    </svg>
  )
}
