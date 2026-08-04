import { WeatherData } from '../../types'
import { deriveCondition, wetBulb, historicValue } from '../../weather'
import { WeatherIcon } from '../WeatherIcon'
import { useUnits } from '../../units'
import { TrendArrow, getTrend } from '../TrendArrow'

interface HistoryPoint {
  _time: string
  temperature_outdoor?: number
  humidity_outdoor?: number
  pressure_relative?: number
}

// `history` NO es opcional a proposito: es de donde salen las flechas de
// tendencia, y cuando era opcional Mi Tablero lo omitio sin que nada fallara
// --las flechas simplemente quedaban todas en "estable"--. Obligandolo, olvidarlo
// es un error de compilacion en vez de un bug silencioso.
export function CurrentConditions({ data, history }: { data: WeatherData; history: HistoryPoint[] }) {
  const u = useUnits()
  const cond = deriveCondition(data)
  const temp = data.temperature_outdoor
  const wb =
    temp !== undefined && data.humidity_outdoor !== undefined
      ? wetBulb(temp, data.humidity_outdoor)
      : undefined

  const tempPrev = historicValue(history, (h) => h.temperature_outdoor, 1)
  const humPrev = historicValue(history, (h) => h.humidity_outdoor, 1)
  const pressPrev = historicValue(history, (h) => h.pressure_relative, 3)

  const tempTrend = getTrend(data.temperature_outdoor, tempPrev, 0.5)
  const humTrend = getTrend(data.humidity_outdoor, humPrev, 3)
  const pressTrend = getTrend(data.pressure_relative, pressPrev, 1)

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-6xl font-bold tracking-tight text-orange-500">{u.temp(temp)}</span>
            <span className="text-2xl text-slate-400">{u.tempU}</span>
            <TrendArrow trend={tempTrend} size={32} />
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
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-cyan-300">
              {data.humidity_outdoor != null ? `${data.humidity_outdoor.toFixed(0)}%` : '--'}
            </p>
            <TrendArrow trend={humTrend} size={20} />
          </div>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Índice UV</p>
          <p className="text-xl font-bold text-yellow-300">{data.uv_index ?? '--'}</p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Presión</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-violet-300">{u.press(data.pressure_relative)}</p>
            <TrendArrow trend={pressTrend} size={20} />
          </div>
        </div>
      </div>
    </div>
  )
}
