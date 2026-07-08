import { WeatherData } from '../../types'
import { ForecastResult } from '../../forecast'

interface Props {
  data: WeatherData
  forecast: ForecastResult | null
}

export function PrecipitationCard({ data, forecast }: Props) {
  const next = forecast?.hours?.slice(0, 8) ?? []
  const maxProb = Math.max(1, ...next.map((h) => h.precipProb))

  return (
    <div className="card">
      <p className="card-title">Precipitación</p>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-blue-300">{(data.rain_rate ?? 0).toFixed(1)}</p>
          <p className="text-[10px] text-slate-400">mm/h</p>
        </div>
        <div>
          <p className="text-lg font-bold">{(data.rain_daily ?? 0).toFixed(1)}</p>
          <p className="text-[10px] text-slate-400">Hoy</p>
        </div>
        <div>
          <p className="text-lg font-bold">{(data.rain_monthly ?? 0).toFixed(1)}</p>
          <p className="text-[10px] text-slate-400">Mes</p>
        </div>
        <div>
          <p className="text-lg font-bold">{(data.rain_yearly ?? 0).toFixed(1)}</p>
          <p className="text-[10px] text-slate-400">Año</p>
        </div>
      </div>

      {next.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-slate-500 mb-2">Prob. de lluvia próximas horas</p>
          <div className="flex items-end gap-1 h-16">
            {next.map((h) => (
              <div key={h.time} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className="w-full rounded-t bg-sky-500/70"
                  style={{ height: `${(h.precipProb / maxProb) * 100}%`, minHeight: h.precipProb > 0 ? 2 : 0 }}
                  title={`${h.precipProb}%`}
                />
                <span className="text-[9px] text-slate-500 mt-1">
                  {new Date(h.time).toLocaleTimeString('es-MX', { hour: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
