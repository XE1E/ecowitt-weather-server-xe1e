import { WeatherData } from '../../types'
import { deriveCondition, wetBulb } from '../../weather'
import { WeatherIcon } from '../WeatherIcon'

export function CurrentConditions({ data }: { data: WeatherData }) {
  const cond = deriveCondition(data)
  const temp = data.temperature_outdoor
  const wb =
    temp !== undefined && data.humidity_outdoor !== undefined
      ? wetBulb(temp, data.humidity_outdoor)
      : undefined

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-end gap-1">
            <span className="text-6xl font-bold tracking-tight">
              {temp?.toFixed(1) ?? '--'}
            </span>
            <span className="text-2xl text-slate-400 mb-2">°C</span>
          </div>
          <p className="text-slate-300 mt-1">{cond.label}</p>
        </div>
        <WeatherIcon name={cond.icon} size={96} alt={cond.label} />
      </div>

      <div className="mt-2 space-y-0.5 text-sm text-slate-400">
        <p>Sensación <span className="text-slate-200">{data.feels_like?.toFixed(1)}°C</span></p>
        <p>Punto de rocío <span className="text-slate-200">{data.dew_point?.toFixed(1)}°C</span></p>
        {wb !== undefined && <p>Bulbo húmedo <span className="text-slate-200">{wb.toFixed(1)}°C</span></p>}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/10">
        <div>
          <p className="text-xs text-slate-400">Humedad</p>
          <p className="text-xl font-bold text-cyan-300">{(data.humidity_outdoor ?? 0).toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Índice UV</p>
          <p className="text-xl font-bold text-yellow-300">{data.uv_index ?? 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Presión</p>
          <p className="text-xl font-bold text-violet-300">{(data.pressure_relative ?? 0).toFixed(1)}</p>
        </div>
      </div>
    </div>
  )
}
