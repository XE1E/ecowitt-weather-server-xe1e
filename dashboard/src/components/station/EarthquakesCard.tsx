import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Quake, magColor, timeAgo } from './quakes'

export function EarthquakesCard() {
  const [quakes, setQuakes] = useState<Quake[] | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/earthquakes')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setQuakes(d?.quakes ?? []))
        .catch(() => {})
    load()
    const i = setInterval(load, 600000) // 10 min
    return () => clearInterval(i)
  }, [])

  if (!quakes) return null
  const q = quakes[0]

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="card-title">Último sismo</p>
        <Link to="/pro/sismos" className="text-xs text-blue-400 hover:text-blue-300">Ver todos →</Link>
      </div>
      {!q ? (
        <p className="text-sm text-slate-400">Sin sismos relevantes cerca por ahora.</p>
      ) : (
        <div className="flex items-center gap-3">
          <span
            className="w-11 h-11 rounded-lg flex items-center justify-center text-base font-bold shrink-0"
            style={{ backgroundColor: (q.mag != null ? magColor(q.mag) : '#64748b') + '22', color: q.mag != null ? magColor(q.mag) : '#94a3b8' }}
          >
            {q.mag != null ? q.mag.toFixed(1) : '--'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{q.place ?? 'Sismo'}</p>
            <p className="text-[11px] text-slate-500">
              {q.time != null ? timeAgo(q.time) : ''}
              {q.depth_km != null ? ` · ${Math.round(q.depth_km)} km prof.` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
