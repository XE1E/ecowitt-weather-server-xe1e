import { useEffect, useState } from 'react'

interface Cloud { cover: string; base: number | null }
interface Metar {
  station?: string; observed?: string; flight_category?: string | null
  wind_dir?: number | null; wind_speed_kt?: number | null; wind_gust_kt?: number | null
  altimeter_hpa?: number | null; clouds?: Cloud[]; temp_c?: number | null
}

const CAT: Record<string, string> = { VFR: '#34d399', MVFR: '#38bdf8', IFR: '#fb923c', LIFR: '#f87171' }
const MARKS: [number, number][] = [
  [0, 0], [1000, 0.14], [2000, 0.24], [5000, 0.44], [10000, 0.62], [15000, 0.74], [20000, 0.84], [30000, 1.0],
]
function altFrac(ft: number): number {
  for (let i = 1; i < MARKS.length; i++) {
    if (ft <= MARKS[i][0]) {
      const [a, fa] = MARKS[i - 1], [b, fb] = MARKS[i]
      return fa + (fb - fa) * (ft - a) / (b - a)
    }
  }
  return 1
}

const W = 1000, H = 430, GROUND = 392, TOP = 14
const yOf = (f: number) => GROUND - f * (GROUND - TOP)

// Nubes por cobertura: nº de cúmulos y opacidad
const COVER_STYLE: Record<string, { n: number; op: number }> = {
  FEW: { n: 3, op: 0.22 }, SCT: { n: 5, op: 0.4 }, BKN: { n: 9, op: 0.62 }, OVC: { n: 14, op: 0.82 },
  VV: { n: 14, op: 0.7 },
}

export function AtmosphericProfile({ m }: { m: Metar | null }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  if (!m) return null
  const hour = now.getHours()
  const night = hour < 7 || hour >= 19
  const catColor = m.flight_category ? (CAT[m.flight_category] ?? '#94a3b8') : '#94a3b8'

  const clock = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const dateStr = now.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: '2-digit' })
  const ageMin = m.observed ? Math.max(0, Math.round((now.getTime() - new Date(m.observed).getTime()) / 60000)) : null

  const stars = night
    ? Array.from({ length: 60 }, (_, i) => ({
        x: (i * 137.5) % W, y: ((i * 53) % (GROUND - 40)) + 8, r: (i % 3) * 0.4 + 0.5, o: 0.3 + (i % 4) * 0.15,
      }))
    : []

  const wd = typeof m.wind_dir === 'number' ? m.wind_dir : null
  const ws = m.wind_speed_kt ?? 0
  const wdLabel = wd != null ? `${wd}° ${ws}kt` : ws > 0 ? `VRB ${ws}kt` : 'Calma'

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 relative" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            {night ? (
              <>
                <stop offset="0%" stopColor="#0b1220" /><stop offset="70%" stopColor="#15233b" />
                <stop offset="100%" stopColor="#243b57" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#2f86d6" /><stop offset="70%" stopColor="#7dc0f0" />
                <stop offset="100%" stopColor="#cfe8fb" />
              </>
            )}
          </linearGradient>
          <radialGradient id="puff" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#sky)" />
        {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#e2e8f0" opacity={s.o} />)}

        {/* Escala de altitud */}
        {MARKS.slice(1).map(([ft, f]) => (
          <g key={ft}>
            <line x1="0" y1={yOf(f)} x2={W} y2={yOf(f)} stroke="rgba(226,232,240,0.14)" strokeDasharray="3 6" />
            <text x="10" y={yOf(f) - 3} fill="rgba(226,232,240,0.55)" fontSize="12">
              {ft >= 1000 ? `${ft / 1000}k ft` : `${ft} ft`}
            </text>
          </g>
        ))}

        {/* Capas de nubes */}
        {(m.clouds ?? []).map((c, ci) => {
          const style = COVER_STYLE[c.cover]
          if (!style || c.base == null) return null
          const y = yOf(altFrac(c.base))
          return (
            <g key={ci}>
              {Array.from({ length: style.n }, (_, i) => {
                const cx = (W / (style.n + 1)) * (i + 1) + ((i * 37) % 40) - 20
                const rx = 46 + ((i * 17) % 26)
                return <ellipse key={i} cx={cx} cy={y + ((i * 13) % 10) - 5} rx={rx} ry={16} fill="url(#puff)" opacity={style.op} />
              })}
            </g>
          )
        })}

        {/* Suelo con silueta */}
        <rect x="0" y={GROUND} width={W} height={H - GROUND} fill={night ? '#0f2417' : '#1c3a24'} />
        {Array.from({ length: 22 }, (_, i) => {
          const bx = i * 46 + 6, bh = 10 + ((i * 29) % 26)
          return <rect key={i} x={bx} y={GROUND - bh} width={26} height={bh} rx={2} fill={night ? '#16324a' : '#274b6b'} opacity={0.85} />
        })}
      </svg>

      {/* Reloj + categoría (arriba izq.) */}
      <div className="absolute top-3 left-3 flex items-center gap-3">
        <div className="bg-black/45 rounded-lg px-3 py-1.5 backdrop-blur-sm">
          <p className="text-lg font-bold tabular-nums text-white leading-none">{clock}</p>
          <p className="text-[10px] text-slate-300 capitalize">{dateStr} · hora local</p>
        </div>
        {m.flight_category && (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: catColor }} />
            <span className="text-sm font-bold" style={{ color: catColor }}>{m.flight_category}</span>
          </div>
        )}
      </div>
      {ageMin != null && (
        <span className="absolute top-3 right-3 text-[11px] text-slate-300 bg-black/40 rounded px-2 py-0.5">hace {ageMin} min</span>
      )}

      {/* Brújula de viento + QNH (abajo der.) */}
      <div className="absolute bottom-3 right-3 flex items-end gap-2">
        <div className="bg-black/45 rounded-lg px-2 py-1.5 text-center backdrop-blur-sm">
          <p className="text-[9px] text-slate-300">QNH</p>
          <p className="text-sm font-bold text-white tabular-nums leading-none">{m.altimeter_hpa ?? '--'}</p>
          <p className="text-[9px] text-slate-400">hPa</p>
        </div>
        <div className="bg-black/45 rounded-lg p-1.5 backdrop-blur-sm text-center">
          <svg viewBox="0 0 80 80" className="w-16 h-16">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth="1.5" />
            {['N', 'E', 'S', 'O'].map((d, i) => (
              <text key={d} x="40" y="12"
                transform={`rotate(${i * 90} 40 40)`}
                fill="rgba(226,232,240,0.7)" fontSize="9" textAnchor="middle">{d}</text>
            ))}
            {ws > 0 && wd != null && (
              <g transform={`rotate(${wd} 40 40)`}>
                <line x1="40" y1="14" x2="40" y2="40" stroke="#38bdf8" strokeWidth="3" />
                <polygon points="40,10 35,20 45,20" fill="#38bdf8" />
              </g>
            )}
          </svg>
          <p className="text-[10px] text-white -mt-1">{wdLabel}</p>
        </div>
      </div>

      {/* Leyenda de capas */}
      <div className="absolute bottom-3 left-3 bg-black/40 rounded-lg px-2.5 py-1.5 backdrop-blur-sm">
        <p className="text-[9px] text-slate-300 mb-0.5">Capas de nubes</p>
        <div className="flex gap-2 text-[9px] text-slate-200">
          {['FEW', 'SCT', 'BKN', 'OVC'].map((c) => <span key={c}>{c}</span>)}
        </div>
      </div>
    </div>
  )
}
