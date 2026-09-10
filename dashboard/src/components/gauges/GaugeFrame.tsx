import { useMemo, type ReactNode } from 'react'

// Marco circular con el mismo bisel metálico que AnalogGauge/CompassGauge,
// para instrumentos que no son un dial de aguja (p. ej. la rosa de vientos).
// El bisel es un <circle> SVG con el MISMO linearGradient (mismos stops,
// mismo x1/y1/x2/y2) que esos dos -- un CSS `linear-gradient` con los
// mismos colores/ángulo se ve distinto (el navegador no reparte las bandas
// igual sobre un <div> que sobre el bounding box de un <circle> SVG), así
// que en vez de aproximar con CSS se usa el mismo SVG real.
// Misma carátula crema que los demás medidores (antes usaba var(--surface)/
// var(--ink), el tema normal de la app). El título es opcional y va
// flotando ARRIBA en vez de apilado en el flujo (para cuando lo hay), así
// el contenido queda centrado de verdad en el círculo, no desplazado hacia
// abajo por el alto del título.
export function GaugeFrame({ title, size = 200, children }: { title?: string; size?: number; children: ReactNode }) {
  const cx = size / 2
  const cy = size / 2
  // Mismas proporciones bisel/carátula que AnalogGauge/CompassGauge (R y
  // faceR ahí se calculan igual), para que el anillo metálico tenga el
  // mismo grosor relativo en los tres.
  const R = size / 2 - 5
  const faceR = R - size * 0.075
  const uid = useMemo(() => Math.random().toString(36).slice(2, 9), [])
  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0"
        style={{ filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.5))' }}>
        <defs>
          <linearGradient id={`gfbezel-${uid}`} x1="12%" y1="8%" x2="88%" y2="92%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="20%" stopColor="#c9c9c9" />
            <stop offset="40%" stopColor="#8a8a8a" />
            <stop offset="50%" stopColor="#4a4a4a" />
            <stop offset="62%" stopColor="#8a8a8a" />
            <stop offset="82%" stopColor="#d8d8d8" />
            <stop offset="100%" stopColor="#f2f2f2" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={R} fill={`url(#gfbezel-${uid})`} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
        {/* Mismos 4 tornillos decorativos que AnalogGauge/CompassGauge. */}
        {[45, 135, 225, 315].map((b) => {
          const t = (b * Math.PI) / 180
          const r = R - size * 0.025
          return (
            <circle key={b} cx={cx + r * Math.sin(t)} cy={cy - r * Math.cos(t)} r={size * 0.015}
              fill="#7a7a7a" stroke="#f0f0f0" strokeWidth={0.6} />
          )
        })}
      </svg>
      <div className="absolute rounded-full flex items-center justify-center"
        style={{
          left: cx - faceR, top: cy - faceR, width: faceR * 2, height: faceR * 2,
          background: 'radial-gradient(at 35% 28%, #fbf8ee 0%, #f0ead6 55%, #d5cdb2 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15), inset 0 0 0 3px rgba(0,0,0,0.35)',
        }}>
        {title && (
          <p className="absolute top-[5%] text-[11px] font-bold tracking-wide"
            style={{ color: '#5a5545' }}>{title.toUpperCase()}</p>
        )}
        {children}
      </div>
    </div>
  )
}
