import { useState, useEffect } from 'react'
import { Sunrise } from 'lucide-react'

interface Planet {
  name: string; rise: string | null; set: string | null
  altitude: number; up: boolean; magnitude: number
}
interface Almanac {
  available: boolean
  sun?: { rise: string | null; set: string | null; noon: string | null; day_length: string | null }
  twilight?: Record<string, string | null>
  planets?: Planet[]
}

const val = (v?: string | null) => v ?? '--:--'

export function AlmanacCard() {
  const [a, setA] = useState<Almanac | null>(null)

  useEffect(() => {
    fetch('/api/almanac').then((r) => (r.ok ? r.json() : null)).then(setA).catch(() => {})
  }, [])

  if (!a || !a.available) return null
  const t = a.twilight ?? {}
  const s = a.sun

  const events: { label: string; time: string | null; desc: string; color?: string }[] = [
    { label: 'Amanecer astronómico', time: t.astronomical_dawn, desc: 'sol −18° bajo el horizonte' },
    { label: 'Amanecer náutico', time: t.nautical_dawn, desc: 'sol −12° bajo el horizonte' },
    { label: 'Amanecer civil', time: t.civil_dawn, desc: 'sol −6° bajo el horizonte' },
    { label: 'Salida del sol', time: s?.rise ?? null, desc: 'sol sobre el horizonte', color: 'text-amber-300' },
    { label: 'Puesta del sol', time: s?.set ?? null, desc: 'sol bajo el horizonte', color: 'text-orange-300' },
    { label: 'Crepúsculo civil', time: t.civil_dusk, desc: 'sol −6° bajo el horizonte' },
    { label: 'Crepúsculo náutico', time: t.nautical_dusk, desc: 'sol −12° bajo el horizonte' },
    { label: 'Crepúsculo astronómico', time: t.astronomical_dusk, desc: 'oscuridad total' },
  ]

  return (
    <div className="space-y-4">
      {/* Amanecer y atardecer (línea de tiempo de crepúsculos) */}
      <div className="card">
        <p className="card-title flex items-center gap-2"><Sunrise className="w-4 h-4 text-amber-400" /> Amanecer y atardecer</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
          {events.map((e) => (
            <div key={e.label} className="rounded-xl bg-white/5 px-3 py-3 text-center">
              <p className="text-[11px] text-slate-400">{e.label}</p>
              <p className={`text-xl font-bold tabular-nums ${e.color ?? 'text-slate-100'}`}>{val(e.time)}</p>
              <p className="text-[10px] text-slate-500">{e.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Planetas visibles */}
      {a.planets && a.planets.length > 0 && (
        <div className="card">
          <p className="card-title">Planetas visibles</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[380px]">
              <thead>
                <tr className="text-[11px] text-slate-500">
                  <th className="text-left font-normal">Planeta</th>
                  <th className="text-right font-normal">Orto</th>
                  <th className="text-right font-normal">Ocaso</th>
                  <th className="text-right font-normal">Altitud</th>
                  <th className="text-right font-normal">Mag.</th>
                </tr>
              </thead>
              <tbody>
                {a.planets.map((p) => (
                  <tr key={p.name} className="border-t border-white/5">
                    <td className="py-1">
                      <span className={p.up ? 'text-emerald-300' : 'text-slate-400'}>{p.up ? '● ' : '○ '}</span>{p.name}
                    </td>
                    <td className="text-right">{val(p.rise)}</td>
                    <td className="text-right">{val(p.set)}</td>
                    <td className="text-right">{p.up ? `${p.altitude}°` : '—'}</td>
                    <td className="text-right text-slate-400">{p.magnitude}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-600 mt-1">● sobre el horizonte ahora · ○ bajo el horizonte</p>
        </div>
      )}
    </div>
  )
}
