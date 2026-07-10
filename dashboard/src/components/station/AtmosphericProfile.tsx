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

// Nubes por cobertura: nº de cúmulos y opacidad (más marcadas = más opacas)
const CLOUD_STYLE: Record<string, { n: number; op: number }> = {
  FEW: { n: 2, op: 0.55 }, SCT: { n: 3, op: 0.72 }, BKN: { n: 5, op: 0.86 },
  OVC: { n: 7, op: 0.95 }, VV: { n: 6, op: 0.85 },
}

// Un cúmulo esponjoso (varios círculos + base), determinista.
function Puff({ cx, cy, s, fill, op }: { cx: number; cy: number; s: number; fill: string; op: number }) {
  return (
    <g fill={fill} opacity={op} filter="url(#cloudBlur)">
      <ellipse cx={cx} cy={cy + 0.2 * s} rx={2.7 * s} ry={0.95 * s} />
      <circle cx={cx - 1.5 * s} cy={cy - 0.1 * s} r={0.95 * s} />
      <circle cx={cx - 0.4 * s} cy={cy - 0.75 * s} r={1.3 * s} />
      <circle cx={cx + 1.0 * s} cy={cy - 0.5 * s} r={1.1 * s} />
      <circle cx={cx + 2.0 * s} cy={cy - 0.05 * s} r={0.85 * s} />
    </g>
  )
}

// Ventanas encendidas de un edificio (deterministas para no parpadear)
function windows(x: number, top: number, w: number, h: number, fill: string, night: boolean, seed: number) {
  const out = []
  const rows = Math.floor((h - 6) / 8)
  const cols = Math.max(1, Math.floor((w - 5) / 7))
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if ((seed + r * 3 + c * 7) % 3 === 0)
        out.push(<rect key={`${r}-${c}`} x={x + 4 + c * 7} y={top + 5 + r * 8} width="2.5" height="3.5" fill={fill} opacity={night ? 0.9 : 0.4} />)
  return out
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
        x: (i * 137.5) % W, y: ((i * 53) % (GROUND - 60)) + 8, r: (i % 3) * 0.4 + 0.5, o: 0.3 + (i % 4) * 0.15,
      }))
    : []

  const wd = typeof m.wind_dir === 'number' ? m.wind_dir : null
  const ws = m.wind_speed_kt ?? 0
  const wdLabel = wd != null ? `${wd}° ${ws}kt` : ws > 0 ? `VRB ${ws}kt` : 'Calma'

  // Colores de la ciudad (silueta CDMX)
  const cityBack = night ? '#1b3352' : '#93a9c7'
  const cityFront = night ? '#0c2137' : '#2a3e56'
  const win = night ? '#ffd27a' : '#b9c9de'
  const cloudFill = night ? '#cbd6e8' : '#ffffff'

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
          <filter id="cloudBlur" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
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

        {/* Capas de nubes (cúmulos marcados) */}
        {(m.clouds ?? []).map((c, ci) => {
          const st = CLOUD_STYLE[c.cover]
          if (!st || c.base == null) return null
          const y = yOf(altFrac(c.base))
          return (
            <g key={ci}>
              {Array.from({ length: st.n }, (_, i) => {
                const cx = (W / (st.n + 1)) * (i + 1) + ((ci * 53 + i * 29) % 60) - 30
                const s = 13 + ((ci * 3 + i * 7) % 5)
                return <Puff key={i} cx={cx} cy={y} s={s} fill={cloudFill} op={st.op} />
              })}
            </g>
          )
        })}

        {/* Cordilleras (Valle de México) */}
        <path d={`M0 ${GROUND} L0 342 L110 316 L210 340 L320 310 L450 340 L560 318 L690 344 L810 320 L930 344 L1000 328 L1000 ${GROUND} Z`}
          fill={night ? '#16273f' : '#7f97ba'} opacity="0.45" />
        <path d={`M0 ${GROUND} L0 366 L90 348 L190 368 L300 346 L420 368 L540 350 L660 370 L790 352 L900 372 L1000 356 L1000 ${GROUND} Z`}
          fill={night ? '#122033' : '#5b7d68'} opacity="0.7" />

        {/* Volcanes (Popocatépetl e Iztaccíhuatl) con nieve */}
        <g opacity={night ? 0.85 : 0.92}>
          {/* Popocatépetl: cono */}
          <polygon points={`115 ${GROUND} 210 282 305 ${GROUND}`} fill={night ? '#15263d' : '#6f88ac'} />
          <polygon points="192 300 210 282 228 300 220 296 210 301 200 296" fill={night ? '#8497b6' : '#eef4fb'} />
          {/* Iztaccíhuatl: cresta alargada ("mujer dormida") */}
          <polygon points={`720 ${GROUND} 800 306 850 314 905 300 985 ${GROUND}`} fill={night ? '#101d30' : '#647f9c'} />
          <polygon points="792 310 800 306 826 313 850 307 872 313 866 316 850 311 828 316 806 311" fill={night ? '#7891b0' : '#e4ecf7'} />
        </g>

        {/* ── Silueta de la Ciudad de México ── */}
        {/* Capa trasera: edificios difusos */}
        <g fill={cityBack} opacity={night ? 0.9 : 0.85}>
          {Array.from({ length: 30 }, (_, i) => {
            const x = i * 34 + 6
            const h = 22 + ((i * 41) % 40)
            return <rect key={i} x={x} y={GROUND - h} width={24} height={h} rx="1" />
          })}
        </g>

        {/* Capa frontal: landmarks + edificios con ventanas */}
        <g fill={cityFront}>
          {/* Edificios de relleno con ventanas */}
          {[[40, 26, 40], [78, 22, 34], [300, 26, 30], [340, 22, 46], [620, 28, 40], [858, 30, 52], [905, 24, 34], [950, 30, 44]].map(([x, w, h], i) => (
            <g key={`b${i}`}>
              <rect x={x} y={GROUND - h} width={w} height={h} rx="1" />
              {windows(x, GROUND - h, w, h, win, night, i + 1)}
            </g>
          ))}

          {/* Catedral Metropolitana (torres gemelas + cúpula) */}
          <g>
            <rect x="120" y={GROUND - 40} width="64" height="40" />
            <rect x="124" y={GROUND - 70} width="14" height="30" />
            <rect x="166" y={GROUND - 70} width="14" height="30" />
            <polygon points={`124,${GROUND - 70} 131,${GROUND - 80} 138,${GROUND - 70}`} />
            <polygon points={`166,${GROUND - 70} 173,${GROUND - 80} 180,${GROUND - 70}`} />
            <path d={`M144 ${GROUND - 40} a12 12 0 0 1 24 0 Z`} />
            <rect x="154" y={GROUND - 60} width="4" height="10" />
          </g>

          {/* Palacio de Bellas Artes (cúpula central) */}
          <g>
            <rect x="210" y={GROUND - 30} width="78" height="30" />
            <path d={`M231 ${GROUND - 30} a18 18 0 0 1 36 0 Z`} />
            <rect x="247" y={GROUND - 56} width="4" height="8" />
          </g>

          {/* Monumento a la Revolución (gran arco con cúpula) */}
          <g>
            <rect x="430" y={GROUND - 44} width="58" height="44" />
            <path d={`M431 ${GROUND - 44} a28 28 0 0 1 56 0 Z`} />
          </g>

          {/* Torre Latinoamericana (torre alta + antena) */}
          <g>
            <rect x="556" y={GROUND - 50} width="26" height="50" />
            <rect x="560" y={GROUND - 96} width="18" height="46" />
            <rect x="565" y={GROUND - 108} width="8" height="12" />
            <line x1="569" y1={GROUND - 108} x2="569" y2={GROUND - 126} stroke={cityFront} strokeWidth="2" />
            <circle cx="569" cy={GROUND - 128} r="2.5" />
            {windows(560, GROUND - 96, 18, 46, win, night, 4)}
          </g>

          {/* Torres modernas (Reforma / Mayor) con tope inclinado */}
          <g>
            <rect x="660" y={GROUND - 92} width="26" height="92" />
            <polygon points={`660,${GROUND - 92} 686,${GROUND - 108} 686,${GROUND - 92}`} />
            {windows(660, GROUND - 92, 26, 92, win, night, 6)}
          </g>
          <g>
            <rect x="700" y={GROUND - 82} width="30" height="82" />
            <polygon points={`700,${GROUND - 82} 700,${GROUND - 98} 730,${GROUND - 82}`} />
            {windows(700, GROUND - 82, 30, 82, win, night, 8)}
          </g>
          <g>
            <rect x="770" y={GROUND - 74} width="26" height="74" rx="3" />
            {windows(770, GROUND - 74, 26, 74, win, night, 2)}
          </g>
        </g>

        {/* Ángel de la Independencia (columna + figura dorada) */}
        <g>
          <rect x="386" y={GROUND - 16} width="22" height="16" fill={cityFront} />
          <rect x="392" y={GROUND - 74} width="10" height="58" fill={cityFront} />
          <circle cx="397" cy={GROUND - 80} r="5" fill="#f5c451" />
          <polygon points={`397,${GROUND - 84} 390,${GROUND - 74} 397,${GROUND - 78}`} fill="#f5c451" />
          <polygon points={`397,${GROUND - 84} 404,${GROUND - 74} 397,${GROUND - 78}`} fill="#f5c451" />
        </g>

        {/* Piso */}
        <rect x="0" y={GROUND} width={W} height={H - GROUND} fill={night ? '#0a1a10' : '#1c3f27'} />
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
