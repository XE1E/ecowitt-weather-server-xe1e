import { WeatherData } from '../../types'
import { beaufort, cardinal } from '../../weather'

function Rose({ direction }: { direction: number }) {
  // SVG wind rose, 120x120, arrow points FROM where the wind comes (meteorological)
  const size = 120
  const c = size / 2
  const ticks = Array.from({ length: 8 }, (_, i) => i * 45)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={c - 8} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
      {ticks.map((deg) => {
        const rad = (deg - 90) * (Math.PI / 180)
        const x1 = c + (c - 10) * Math.cos(rad)
        const y1 = c + (c - 10) * Math.sin(rad)
        const x2 = c + (c - 4) * Math.cos(rad)
        const y2 = c + (c - 4) * Math.sin(rad)
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      })}
      <text x={c} y="14" textAnchor="middle" fontSize="11" fill="#94a3b8">N</text>
      <text x={size - 7} y={c + 4} textAnchor="middle" fontSize="11" fill="#94a3b8">E</text>
      <text x={c} y={size - 4} textAnchor="middle" fontSize="11" fill="#94a3b8">S</text>
      <text x="7" y={c + 4} textAnchor="middle" fontSize="11" fill="#94a3b8">O</text>
      <g transform={`rotate(${direction} ${c} ${c})`}>
        <polygon points={`${c},16 ${c - 8},${c} ${c + 8},${c}`} fill="#34d399" />
        <polygon points={`${c},${size - 16} ${c - 8},${c} ${c + 8},${c}`} fill="rgba(255,255,255,0.2)" />
      </g>
      {/* Cubo central sólido para que el número no se encime con la aguja */}
      <circle cx={c} cy={c} r="21" fill="#0e1626" stroke="rgba(52,211,153,0.6)" strokeWidth="1.5" />
    </svg>
  )
}

export function WindCard({ data }: { data: WeatherData }) {
  const dir = data.wind_direction ?? 0
  const bf = beaufort(data.wind_speed ?? 0)
  return (
    <div className="card">
      <p className="card-title">Viento</p>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Rose direction={dir} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-emerald-300 leading-none">
              {(data.wind_speed ?? 0).toFixed(1)}
            </span>
            <span className="text-[10px] text-slate-400">km/h</span>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <p className="text-slate-400">Dirección</p>
            <p className="font-semibold">{cardinal(dir)} {dir}°</p>
          </div>
          <div>
            <p className="text-slate-400">Ráfaga</p>
            <p className="font-semibold">{(data.wind_gust ?? 0).toFixed(1)} km/h</p>
          </div>
          <div>
            <p className="text-slate-400">Beaufort</p>
            <p className="font-semibold">{bf.scale} · {bf.label}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
