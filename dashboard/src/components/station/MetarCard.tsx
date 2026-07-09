import { useState, useEffect } from 'react'

interface MetarData {
  station?: string
  raw?: string
  temp_c?: number | null
  dewpoint_c?: number | null
  wind_dir?: number | null
  wind_speed_kt?: number | null
  altimeter_hpa?: number | null
  flight_category?: string | null
  visibility?: number | string | null
  clouds?: string[]
}

export function MetarCard() {
  const [m, setM] = useState<MetarData | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/metar')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setM(d))
        .catch(() => {})
    load()
    const i = setInterval(load, 600000) // 10 min
    return () => clearInterval(i)
  }, [])

  if (!m || !m.raw) return null

  const cat = m.flight_category
  const catColor =
    cat === 'VFR' ? 'text-emerald-300'
      : cat === 'MVFR' ? 'text-sky-300'
      : cat === 'IFR' ? 'text-orange-300'
      : cat === 'LIFR' ? 'text-red-300'
      : 'text-slate-300'

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="card-title">METAR · {m.station}</p>
        <span className={`text-xs font-semibold ${catColor}`}>{cat ?? ''}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
        <span><span className="text-slate-400">Temp</span> {m.temp_c != null ? `${m.temp_c}°C` : '--'}</span>
        <span><span className="text-slate-400">Viento</span> {m.wind_dir != null ? `${m.wind_dir}°/${m.wind_speed_kt}kt` : '--'}</span>
        <span><span className="text-slate-400">Presión</span> {m.altimeter_hpa != null ? `${m.altimeter_hpa} hPa` : '--'}</span>
      </div>
      <p className="text-[10px] text-slate-500 mt-1 font-mono truncate" title={m.raw}>{m.raw}</p>
    </div>
  )
}
