import { useState, useEffect } from 'react'
import { Quake, magColor, timeAgo } from '../components/station/quakes'

function fmtWhen(sec: number): string {
  const d = new Date(sec * 1000)
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function EarthquakesPage() {
  const [quakes, setQuakes] = useState<Quake[] | null>(null)
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/earthquakes')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { setQuakes(d?.quakes ?? []); setSource(d?.source ?? null) })
        .catch(() => setQuakes([]))
    load()
    const i = setInterval(load, 600000)
    return () => clearInterval(i)
  }, [])

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-slate-100 mb-1">Sismos recientes</h2>
      <p className="text-sm text-slate-400 mb-4">
        Sismos recientes cerca de la estación, más recientes primero
        {source === 'SSN' ? ' (fuente oficial SSN)' : source === 'USGS' ? ' (magnitud ≥ 4, ~800 km — fuente USGS)' : ''}.
      </p>

      {!quakes ? (
        <div className="card text-slate-400">Cargando…</div>
      ) : quakes.length === 0 ? (
        <div className="card text-slate-400">Sin sismos relevantes cerca por ahora.</div>
      ) : (
        <div className="card">
          <ul className="divide-y divide-white/5">
            {quakes.map((q, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <span
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-base font-bold shrink-0"
                  style={{ backgroundColor: (q.mag != null ? magColor(q.mag) : '#64748b') + '22', color: q.mag != null ? magColor(q.mag) : '#94a3b8' }}
                >
                  {q.mag != null ? q.mag.toFixed(1) : '--'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{q.place ?? 'Sismo'}</p>
                  <p className="text-xs text-slate-500">
                    {q.time != null ? `${fmtWhen(q.time)} · ${timeAgo(q.time)}` : ''}
                    {q.depth_km != null ? ` · ${Math.round(q.depth_km)} km prof.` : ''}
                  </p>
                </div>
                {q.url && (
                  <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 shrink-0">
                    USGS ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-4">
        Fuente: {source === 'SSN'
          ? <a href="http://www.ssn.unam.mx" target="_blank" rel="noopener noreferrer" className="text-blue-400">SSN (UNAM)</a>
          : <a href="https://earthquake.usgs.gov" target="_blank" rel="noopener noreferrer" className="text-blue-400">USGS</a>}
        {' '}· dato externo, no medido por esta estación. La profundidad y magnitud son estimaciones preliminares.
      </p>
    </div>
  )
}
