import { WeatherData, HistoryRow } from '../../types'
import { WeatherIcon } from '../WeatherIcon'
import { useUnits } from '../../units'
import { historicValue } from '../../weather'
import { TrendArrow, getTrend } from '../TrendArrow'

// Nombres personalizados por canal (WN31)
const CHANNEL_NAMES: Record<number, string> = {
  1: 'Jardín',
}

// `history` NO es opcional: ver la nota en CurrentConditions. Sin el, las flechas
// de tendencia por canal quedan todas en "estable" sin que nada avise.
export function ExtraSensorsCard({ data, history }: { data: WeatherData; history: HistoryRow[] }) {
  const u = useUnits()

  const channels = Array.from({ length: 8 }, (_, i) => i + 1)
    .map((ch) => {
      const temp = data[`temperature_ch${ch}` as keyof WeatherData] as number | undefined
      const humidity = data[`humidity_ch${ch}` as keyof WeatherData] as number | undefined
      // El campo se arma por nombre calculado; HistoryRow declara el indice.
      const tempPrev = historicValue(history, (h) => h[`temperature_ch${ch}`], 1)
      const humPrev = historicValue(history, (h) => h[`humidity_ch${ch}`], 1)
      return {
        ch,
        temp,
        humidity,
        batteryLow: (data[`battery_ch${ch}` as keyof WeatherData] as boolean | undefined) === false,
        tempTrend: getTrend(temp, tempPrev, 0.5),
        humTrend: getTrend(humidity, humPrev, 3),
      }
    })
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
                  <div className="flex items-center gap-1">
                    <p className="text-xl font-bold text-amber-300">{c.temp !== undefined ? `${u.temp(c.temp)}${u.tempU}` : '--'}</p>
                    <TrendArrow trend={c.tempTrend} size={20} />
                  </div>
                  <p className="text-xs text-slate-400">Temperatura</p>
                </div>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2 flex items-center gap-3">
                <WeatherIcon name="humidity" size={32} />
                <div>
                  <div className="flex items-center gap-1">
                    <p className="text-xl font-bold text-cyan-300">{c.humidity !== undefined ? `${Math.round(c.humidity)}%` : '--'}</p>
                    <TrendArrow trend={c.humTrend} size={20} />
                  </div>
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
