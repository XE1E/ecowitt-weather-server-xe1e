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
      <p className="card-title">METAR — {m.station} (AICM)</p>
      <div className="grid grid-cols-2 gap-y-1 text-sm">
        <div><span className="text-slate-400">Temp</span> {m.temp_c != null ? `${m.temp_c}°C` : '--'}</div>
        <div><span className="text-slate-400">Viento</span> {m.wind_dir != null ? `${m.wind_dir}° / ${m.wind_speed_kt} kt` : '--'}</div>
        <div><span className="text-slate-400">Presión</span> {m.altimeter_hpa != null ? `${m.altimeter_hpa} hPa` : '--'}</div>
        <div><span className="text-slate-400">Categoría</span> <span className={catColor}>{cat ?? '--'}</span></div>
      </div>
      {m.clouds && m.clouds.length > 0 && (
        <p className="text-xs text-slate-400 mt-2">Nubes: {m.clouds.join(', ')}</p>
      )}
      <p className="text-[11px] text-slate-500 mt-2 font-mono break-all">{m.raw}</p>
    </div>
  )
}
