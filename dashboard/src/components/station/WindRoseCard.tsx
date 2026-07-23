import { useEffect, useState } from 'react'
import { WindRose, Rose } from './WindRose'

const PERIODS = [
  { k: '7d', label: '7 días', start: '-7d' },
  { k: '30d', label: '30 días', start: '-30d' },
  { k: 'year', label: 'Año', start: '-365d' },
]

export function WindRoseCard() {
  const [period, setPeriod] = useState('30d')
  const [rose, setRose] = useState<Rose | null>(null)

  useEffect(() => {
    const start = PERIODS.find((p) => p.k === period)!.start
    let cancel = false
    fetch(`/api/wind/rose?start=${start}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancel && setRose(j))
      .catch(() => {})
    return () => { cancel = true }
  }, [period])

  const btn = (active: boolean) =>
    `px-2 py-1 rounded-lg text-xs transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <p className="card-title">Rosa de vientos</p>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p.k} className={btn(period === p.k)} onClick={() => setPeriod(p.k)}>{p.label}</button>
          ))}
        </div>
      </div>

      {!rose || rose.total === 0 ? (
        <p className="text-slate-400 text-sm py-8 text-center">Sin datos de viento en el periodo.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
          <WindRose rose={rose} size={280} />
          <div className="text-sm space-y-1 min-w-0">
            <p>Dirección dominante: <strong className="text-emerald-300">{rose.dominant ?? '--'}</strong></p>
            <p className="text-slate-400">Calma: {rose.calm_pct}% · {rose.total.toLocaleString('es-MX')} lecturas</p>
            <p className="text-[11px] text-slate-500 mt-2 max-w-[26ch]">
              Cada pétalo apila la frecuencia por dirección, dividida por bandas de velocidad
              (más oscuro = más fuerte). Pasa el cursor sobre un sector para ver el detalle.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
