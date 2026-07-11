import { WeatherData } from '../../types'
import { WeatherIcon } from '../WeatherIcon'
import { useUnits } from '../../units'

export function InteriorCard({ data }: { data: WeatherData }) {
  const u = useUnits()
  const t = data.temperature_indoor
  const h = data.humidity_indoor
  if (t == null && h == null) return null

  return (
    <div className="card">
      <p className="card-title">Interior</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/5 px-3 py-2 flex items-center gap-3">
          <WeatherIcon name="thermometer" size={36} />
          <div>
            <p className="text-2xl font-bold text-amber-300">{t != null ? `${u.temp(t)}${u.tempU}` : '--'}</p>
            <p className="text-xs text-slate-400">Temperatura</p>
          </div>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2 flex items-center gap-3">
          <WeatherIcon name="humidity" size={36} />
          <div>
            <p className="text-2xl font-bold text-cyan-300">{h != null ? `${Math.round(h)}%` : '--'}</p>
            <p className="text-xs text-slate-400">Humedad</p>
          </div>
        </div>
      </div>
    </div>
  )
}
