import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'

interface SunData {
  rise: string | null; set: string | null; noon: string | null
  day_length: string | null; day_length_change: string | null
  altitude?: number | null; azimuth?: number | null
}
interface MoonData {
  rise: string | null; set: string | null; illumination: number; phase: string; waxing: boolean
  altitude?: number | null; age_days?: number | null; distance_km?: number | null
  next_new: string | null; next_first_quarter: string | null
  next_full: string | null; next_last_quarter: string | null
}
interface Almanac { available: boolean; sun?: SunData; moon?: MoonData }

const CARD16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const dir16 = (d: number) => CARD16[Math.round(d / 22.5) % 16]
const val = (v?: string | null) => v ?? '--'

function toMin(hhmm?: string | null): number | null {
  if (!hhmm) return null
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Punto sobre una curva de Bézier cuadrática (arco del cielo). */
function bez(t: number, a: number, b: number, c: number) {
  const u = 1 - t
  return u * u * a + 2 * u * t * b + t * t * c
}

function SkyArc({ rise, set, up, color }: { rise: string | null; set: string | null; up: boolean; color: string }) {
  const r = toMin(rise), s = toMin(set)
  const now = new Date().getHours() * 60 + new Date().getMinutes()
  let f: number | null = null
  if (r != null && s != null && s > r) f = Math.min(1, Math.max(0, (now - r) / (s - r)))
  const showDot = up && f != null
  const x = f != null ? bez(f, 12, 150, 288) : 150
  const y = f != null ? bez(f, 92, 6, 92) : 6
  return (
    <svg viewBox="0 0 300 100" className="w-full" style={{ height: 92 }} preserveAspectRatio="none">
      <line x1="0" y1="92" x2="300" y2="92" stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
      <path d="M12 92 Q150 6 288 92" fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="2" />
      {showDot && (
        <>
          <line x1={x} y1={y} x2={x} y2="92" stroke={color} strokeOpacity="0.35" strokeWidth="1" />
          <circle cx={x} cy={y} r="7" fill={color} />
        </>
      )}
    </svg>
  )
}

function Stat({ label, value, color = 'text-slate-100' }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function TimeBox({ label, time, icon }: { label: string; time: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2 text-center">
      <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1">{icon}{label}</p>
      <p className="text-xl font-bold tabular-nums">{time}</p>
    </div>
  )
}

export function SunMoonDetailCard() {
  const [a, setA] = useState<Almanac | null>(null)
  useEffect(() => {
    fetch('/api/almanac').then((r) => (r.ok ? r.json() : null)).then(setA).catch(() => {})
  }, [])
  if (!a || !a.available || !a.sun || !a.moon) return null
  const s = a.sun, m = a.moon
  const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const phases = [
    { label: 'Luna nueva', date: m.next_new, icon: '🌑' },
    { label: 'Cuarto creciente', date: m.next_first_quarter, icon: '🌓' },
    { label: 'Luna llena', date: m.next_full, icon: '🌕' },
    { label: 'Cuarto menguante', date: m.next_last_quarter, icon: '🌗' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Sol ── */}
        <div className="card">
          <div className="flex items-center gap-2">
            <Sun className="w-6 h-6 text-amber-400" />
            <div>
              <p className="text-base font-bold text-slate-100">Sol</p>
              <p className="text-xs text-slate-400 first-letter:uppercase">{today}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <TimeBox label="Salida del sol" time={val(s.rise)} icon={<Sun className="w-3 h-3 text-amber-400" />} />
            <TimeBox label="Puesta del sol" time={val(s.set)} icon={<Sun className="w-3 h-3 text-orange-400" />} />
          </div>
          <div className="relative mt-3">
            {s.noon && <p className="text-[11px] text-slate-500 text-center absolute inset-x-0 -top-1">☀ {s.noon}</p>}
            <SkyArc rise={s.rise} set={s.set} up={(s.altitude ?? -1) > 0} color="#f59e0b" />
            <div className="flex justify-between text-[10px] text-slate-500 -mt-1 px-1">
              <span>{val(s.rise)}</span><span>{val(s.set)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/10">
            <Stat label="Luz del día" value={val(s.day_length)} color="text-amber-300" />
            <Stat label="Cambiar" value={val(s.day_length_change)} color="text-orange-300" />
            <Stat label="Elevación" value={s.altitude != null ? `${s.altitude}°` : '--'} />
            <Stat label="Azimut" value={s.azimuth != null ? `${s.azimuth}° ${dir16(s.azimuth)}` : '--'} />
          </div>
        </div>

        {/* ── Luna ── */}
        <div className="card">
          <div className="flex items-center gap-2">
            <Moon className="w-6 h-6 text-slate-300" />
            <div>
              <p className="text-base font-bold text-slate-100">Luna</p>
              <p className="text-xs text-slate-400">{m.phase}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <TimeBox label="Salida de la luna" time={val(m.rise)} icon={<Moon className="w-3 h-3 text-sky-300" />} />
            <TimeBox label="Puesta de la luna" time={val(m.set)} icon={<Moon className="w-3 h-3 text-slate-400" />} />
          </div>
          <div className="relative mt-3">
            <SkyArc rise={m.rise} set={m.set} up={(m.altitude ?? -1) > 0} color="#e2e8f0" />
            <div className="flex justify-between text-[10px] text-slate-500 -mt-1 px-1">
              <span>{val(m.rise)}</span><span>{val(m.set)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/10">
            <Stat label="Iluminación" value={`${m.illumination}%`} color="text-sky-300" />
            <Stat label="Edad" value={m.age_days != null ? `${m.age_days} días` : '--'} />
            <Stat label="Distancia" value={m.distance_km != null ? `${m.distance_km.toLocaleString('es-MX')} km` : '--'} />
            <Stat label="Elevación" value={m.altitude != null ? `${m.altitude}°` : '--'} />
          </div>
        </div>
      </div>

      {/* ── Fases lunares ── */}
      <div className="card">
        <p className="card-title flex items-center gap-2"><Moon className="w-4 h-4 text-sky-300" /> Fases lunares</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
          {phases.map((p) => (
            <div key={p.label} className="rounded-xl bg-white/5 px-3 py-3 text-center">
              <div className="text-2xl">{p.icon}</div>
              <p className="text-[11px] text-slate-400 mt-1">{p.label}</p>
              <p className="font-semibold tabular-nums">{val(p.date)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
