import { useState, useEffect } from 'react'

interface Planet {
  name: string; rise: string | null; set: string | null
  altitude: number; up: boolean; magnitude: number
}
interface Almanac {
  available: boolean
  sun?: { rise: string | null; set: string | null; noon: string | null; day_length: string | null }
  twilight?: Record<string, string | null>
  moon?: {
    rise: string | null; set: string | null; illumination: number
    phase: string; waxing: boolean; next_new: string | null; next_full: string | null
  }
  planets?: Planet[]
}

const val = (v?: string | null) => v ?? '--'

export function AlmanacCard() {
  const [a, setA] = useState<Almanac | null>(null)

  useEffect(() => {
    fetch('/api/almanac').then((r) => (r.ok ? r.json() : null)).then(setA).catch(() => {})
  }, [])

  if (!a || !a.available) return null
  const t = a.twilight ?? {}

  return (
    <div className="card">
      <p className="card-title">Almanaque</p>

      {/* Sol */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div><p className="text-xs text-slate-400">Amanecer ☀️</p><p className="font-semibold">{val(a.sun?.rise)}</p></div>
        <div><p className="text-xs text-slate-400">Ocaso 🌇</p><p className="font-semibold">{val(a.sun?.set)}</p></div>
        <div><p className="text-xs text-slate-400">Mediodía solar</p><p className="font-semibold">{val(a.sun?.noon)}</p></div>
        <div><p className="text-xs text-slate-400">Duración</p><p className="font-semibold">{val(a.sun?.day_length)}</p></div>
      </div>

      {/* Crepúsculos */}
      <div className="mt-3 pt-3 border-t border-white/10">
        <p className="text-xs text-slate-400 mb-1">Crepúsculos (amanecer · anochecer)</p>
        <div className="grid grid-cols-3 gap-2 text-sm text-center">
          <div><p className="text-[11px] text-slate-500">Civil</p><p>{val(t.civil_dawn)}</p><p className="text-slate-400">{val(t.civil_dusk)}</p></div>
          <div><p className="text-[11px] text-slate-500">Náutico</p><p>{val(t.nautical_dawn)}</p><p className="text-slate-400">{val(t.nautical_dusk)}</p></div>
          <div><p className="text-[11px] text-slate-500">Astronómico</p><p>{val(t.astronomical_dawn)}</p><p className="text-slate-400">{val(t.astronomical_dusk)}</p></div>
        </div>
      </div>

      {/* Luna */}
      {a.moon && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">🌙 {a.moon.phase}</p>
              <p className="text-xs text-slate-400">{a.moon.illumination}% iluminada · {a.moon.waxing ? 'creciente' : 'menguante'}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-slate-400 text-xs">Orto {val(a.moon.rise)} · Ocaso {val(a.moon.set)}</p>
              <p className="text-xs text-slate-500">Nueva {val(a.moon.next_new)} · Llena {val(a.moon.next_full)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Planetas */}
      {a.planets && a.planets.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-xs text-slate-400 mb-1">Planetas visibles</p>
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
