import { WeatherData } from '../../types'
import { useUnits } from '../../units'

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
      <div className="space-y-2">
        {channels.map((c) => (
          <div key={c.ch} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
            <span className="text-sm text-slate-300">Canal {c.ch}</span>
            <span className="text-sm">
              <span className="font-bold text-amber-300">{u.temp(c.temp)}{u.tempU}</span>
              {c.humidity !== undefined && <span className="text-slate-400"> · {c.humidity}%</span>}
              {c.batteryLow && <span className="text-red-300"> · ⚠ batería</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
