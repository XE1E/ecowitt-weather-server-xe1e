import { Link } from 'react-router-dom'
import { WeatherData } from '../../types'
import { beaufort, cardinal } from '../../weather'
import { useUnits } from '../../units'

// Brújula-instrumento: anillo graduado + aguja de compás. La aguja apunta a la
// dirección DESDE la que sopla el viento (convención meteorológica): mitad sólida
// = origen, mitad tenue = hacia dónde va. Tema-aware (usa tokens CSS).
function Compass({ direction }: { direction: number }) {
  const size = 132
  const c = size / 2
  const R = c - 4
  const ticks = Array.from({ length: 16 }, (_, i) => i * 22.5)
  const pt = (r: number, deg: number) => {
    const t = ((deg - 90) * Math.PI) / 180
    return { x: c + r * Math.cos(t), y: c + r * Math.sin(t) }
  }
  const marker = pt(R - 3, direction)

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
      {/* Etiquetas cardinales */}
      <text x={c} y={16} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">N</text>
      <text x={size - 9} y={c + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">E</text>
      <text x={c} y={size - 5} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">S</text>
      <text x={9} y={c + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">O</text>

      {/* Marcador en el borde: dirección exacta */}
      <circle cx={marker.x} cy={marker.y} r={3.5} fill="#34d399" />

      {/* Aguja de compás */}
      <g transform={`rotate(${direction} ${c} ${c})`}>
        {/* origen (desde) — sólido */}
        <polygon points={`${c},${c - (R - 13)} ${c - 6.5},${c} ${c + 6.5},${c}`} fill="#34d399" />
        {/* opuesto (hacia) — tenue */}
        <polygon points={`${c},${c + (R - 26)} ${c - 5},${c} ${c + 5},${c}`}
          fill="var(--muted)" opacity={0.5} />
      </g>

      {/* Cubo central para el número */}
      <circle cx={c} cy={c} r={26} fill="var(--surface)" stroke="rgba(52,211,153,0.55)" strokeWidth={1.5} />
    </svg>
  )
}

export function WindCard({ data, onFlip }: { data: WeatherData; onFlip?: () => void }) {
  const u = useUnits()
  const dir = data.wind_direction ?? 0
  const bf = beaufort(data.wind_speed ?? 0)
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
          <Compass direction={dir} />
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
          {/* Escala Beaufort visual (0–12) */}
          <div className="flex gap-0.5 pt-0.5" title={`Beaufort ${bf.scale}`}>
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < bf.scale ? 'bg-emerald-400' : 'bg-white/10'}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
