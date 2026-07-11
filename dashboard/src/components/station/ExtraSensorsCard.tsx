import { WeatherData } from '../../types'
import { WeatherIcon } from '../WeatherIcon'
import { useUnits } from '../../units'

// Nombres personalizados por canal (WN31)
const CHANNEL_NAMES: Record<number, string> = {
  1: 'Jardín',
}

export function ExtraSensorsCard({ data }: { data: WeatherData }) {
  const u = useUnits()
  const channels = Array.from({ length: 8 }, (_, i) => i + 1)
    .map((ch) => ({
      ch,
      temp: data[`temperature_ch${ch}` as keyof WeatherData] as number | undefined,
      humidity: data[`humidity_ch${ch}` as keyof WeatherData] as number | undefined,
      batteryLow: (data[`battery_ch${ch}` as keyof WeatherData] as boolean | undefined) === false,
    }))
    .filter((c) => c.temp !== undefined || c.humidity !== undefined)

  if (channels.length === 0) return null

  return (
    <div className="card">
      <p className="card-title">Sensores adicionales (WN31)</p>
      <div className="space-y-3">
        {channels.map((c) => (
          <div key={c.ch}>
            <p className="text-xs text-slate-400 mb-1">
              Canal {c.ch}{CHANNEL_NAMES[c.ch] ? ` · ${CHANNEL_NAMES[c.ch]}` : ''}
              {c.batteryLow && <span className="text-red-300"> · ⚠ batería</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white/5 px-3 py-2 flex items-center gap-3">
                <WeatherIcon name="thermometer" size={32} />
                <div>
                  <p className="text-xl font-bold text-amber-300">{c.temp !== undefined ? `${u.temp(c.temp)}${u.tempU}` : '--'}</p>
                  <p className="text-xs text-slate-400">Temperatura</p>
                </div>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2 flex items-center gap-3">
                <WeatherIcon name="humidity" size={32} />
                <div>
                  <p className="text-xl font-bold text-cyan-300">{c.humidity !== undefined ? `${Math.round(c.humidity)}%` : '--'}</p>
                  <p className="text-xs text-slate-400">Humedad</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
