import { Link } from 'react-router-dom'
import { WeatherData } from '../../types'
import { beaufort, cardinal } from '../../weather'
import { useUnits } from '../../units'

// Color por intensidad (escala Beaufort). Cue de severidad, no serie categórica:
// calma→verde, moderado→amarillo, fuerte→naranja, temporal→rojo.
function windColor(bfScale: number): string {
  if (bfScale >= 8) return '#f87171'
  if (bfScale >= 6) return '#fb923c'
  if (bfScale >= 4) return '#facc15'
  return '#34d399'
}

const LABELS = [
  { deg: 0, t: 'N', major: true }, { deg: 45, t: 'NE', major: false },
  { deg: 90, t: 'E', major: true }, { deg: 135, t: 'SE', major: false },
  { deg: 180, t: 'S', major: true }, { deg: 225, t: 'SO', major: false },
  { deg: 270, t: 'O', major: true }, { deg: 315, t: 'NO', major: false },
]

// Brújula-instrumento: anillo graduado + aguja de compás. La aguja apunta a la
// dirección DESDE la que sopla el viento (convención meteorológica): mitad sólida
// = origen, mitad tenue = hacia dónde va. Tema-aware (tokens CSS).
function Compass({ direction, color }: { direction: number; color: string }) {
  const size = 132
  const c = size / 2
  const R = c - 4
  const ticks = Array.from({ length: 16 }, (_, i) => i * 22.5)
  const pt = (r: number, deg: number) => {
    const t = ((deg - 90) * Math.PI) / 180
    return { x: c + r * Math.cos(t), y: c + r * Math.sin(t) }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Anillo exterior */}
      <circle cx={c} cy={c} r={R} fill="none" stroke="var(--line)" strokeWidth={2} />
      {/* Marcas: cardinales largas, resto cortas */}
      {ticks.map((deg) => {
        const major = deg % 90 === 0
        const a = pt(R - (major ? 12 : 7), deg)
        const b = pt(R - 2, deg)
        return (
          <line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={major ? 'var(--muted)' : 'var(--line)'} strokeWidth={major ? 2 : 1.5} />
        )
      })}
      {/* Etiquetas cardinales e intercardinales */}
      {LABELS.map(({ deg, t, major }) => {
        const p = pt(R - 15, deg)
        return (
          <text key={t} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
            fontSize={major ? 12 : 8.5} fontWeight={major ? 700 : 500}
            fill={major ? 'var(--ink)' : 'var(--muted)'}>{t}</text>
        )
      })}

      {/* Aguja + marcador de borde: giran juntos, con transición suave */}
      <g style={{
        transform: `rotate(${direction}deg)`,
        transformOrigin: `${c}px ${c}px`,
        transformBox: 'view-box',
        transition: 'transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
      }}>
        {/* marcador en el borde: dirección exacta */}
        <circle cx={c} cy={c - (R - 3)} r={3.5} fill={color} />
        {/* origen (desde) — sólido */}
        <polygon points={`${c},${c - (R - 13)} ${c - 6.5},${c} ${c + 6.5},${c}`} fill={color} />
        {/* opuesto (hacia) — tenue */}
        <polygon points={`${c},${c + (R - 26)} ${c - 5},${c} ${c + 5},${c}`}
          fill="var(--muted)" opacity={0.5} />
      </g>

      {/* Cubo central para el número */}
      <circle cx={c} cy={c} r={26} fill="var(--surface)" stroke={color} strokeOpacity={0.55} strokeWidth={1.5} />
    </svg>
  )
}

export function WindCard({ data, onFlip }: { data: WeatherData; onFlip?: () => void }) {
  const u = useUnits()
  const dir = data.wind_direction ?? 0
  const bf = beaufort(data.wind_speed ?? 0)
  const color = windColor(bf.scale)
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="card-title">Viento</p>
        {onFlip
          ? <button onClick={onFlip} className="text-xs text-blue-400 hover:text-blue-300">Rosa de vientos →</button>
          : <Link to="/pro/estadisticas" className="text-xs text-blue-400 hover:text-blue-300">Rosa de vientos →</Link>}
      </div>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <Compass direction={dir} color={color} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-emerald-300 leading-none tabular-nums">
              {u.wind(data.wind_speed)}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5">{u.windU}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">Dirección</span>
            <span className="font-semibold">{cardinal(dir)} <span className="tabular-nums">{dir}°</span></span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">Ráfaga</span>
            <span className="font-semibold">{u.wind(data.wind_gust)} {u.windU}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">Beaufort</span>
            <span className="font-semibold text-right">{bf.scale} · {bf.label}</span>
          </div>
          {/* Escala Beaufort visual (0–12), coloreada por intensidad */}
          <div className="flex gap-0.5 pt-0.5" title={`Beaufort ${bf.scale}`}>
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="h-1.5 flex-1 rounded-sm"
                style={{ backgroundColor: i < bf.scale ? color : 'rgba(255,255,255,0.10)' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
