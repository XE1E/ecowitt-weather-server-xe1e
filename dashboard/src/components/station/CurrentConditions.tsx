import { WeatherData } from '../../types'
import { deriveCondition, wetBulb } from '../../weather'
import { WeatherIcon } from '../WeatherIcon'
import { useUnits } from '../../units'

export function CurrentConditions({ data }: { data: WeatherData }) {
  const u = useUnits()
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
            <span className="text-6xl font-bold tracking-tight">{u.temp(temp)}</span>
            <span className="text-2xl text-slate-400 mb-2">{u.tempU}</span>
          </div>
          <p className="text-slate-300 mt-1">{cond.label}</p>
        </div>
        <WeatherIcon name={cond.icon} size={96} alt={cond.label} />
      </div>

      <div className="mt-2 space-y-0.5 text-sm text-slate-400">
        <p>Sensación <span className="text-slate-200">{u.temp(data.feels_like)}{u.tempU}</span></p>
        <p>Punto de rocío <span className="text-slate-200">{u.temp(data.dew_point)}{u.tempU}</span></p>
        {wb !== undefined && <p>Bulbo húmedo <span className="text-slate-200">{u.temp(wb)}{u.tempU}</span></p>}
        {data.humidex !== undefined && (
          <p>Humidex <span className="text-slate-200">{u.temp(data.humidex)}{u.tempU}</span></p>
        )}
        {data.cloud_base !== undefined && (
          <p>Base de nubes <span className="text-slate-200">≈ {Math.round(data.cloud_base).toLocaleString('es-MX')} m</span></p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Humedad</p>
          <p className="text-xl font-bold text-cyan-300">{(data.humidity_outdoor ?? 0).toFixed(0)}%</p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Índice UV</p>
          <p className="text-xl font-bold text-yellow-300">{data.uv_index ?? 0}</p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Presión</p>
          <p className="text-xl font-bold text-violet-300">{u.press(data.pressure_relative)}</p>
        </div>
      </div>
    </div>
  )
}
