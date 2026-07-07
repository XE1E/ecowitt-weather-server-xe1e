import { DailyStats } from '../types'
import { WeatherIcon } from './WeatherIcon'

interface StatsSummaryProps {
  stats: DailyStats['stats'] | null
}

interface Metric {
  key: string
  label: string
  unit: string
  icon: string
  color: string
}

const METRICS: Metric[] = [
  { key: 'temperature_outdoor', label: 'Temperatura', unit: '°C', icon: 'thermometer', color: 'text-orange-300' },
  { key: 'humidity_outdoor', label: 'Humedad', unit: '%', icon: 'humidity', color: 'text-sky-300' },
  { key: 'wind_speed', label: 'Viento', unit: 'km/h', icon: 'windsock', color: 'text-emerald-300' },
  { key: 'wind_gust', label: 'Ráfaga', unit: 'km/h', icon: 'windsock', color: 'text-emerald-300' },
  { key: 'pressure_relative', label: 'Presión', unit: 'hPa', icon: 'barometer', color: 'text-violet-300' },
  { key: 'rain_daily', label: 'Lluvia', unit: 'mm', icon: 'raindrops', color: 'text-blue-300' },
]

const fmt = (v: number | null | undefined, unit: string) =>
  v === null || v === undefined ? '--' : `${v.toFixed(1)}${unit}`

export function StatsSummary({ stats }: StatsSummaryProps) {
  if (!stats) return null

  const available = METRICS.filter((m) => stats[m.key])
  if (available.length === 0) return null

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-slate-300 mb-4">Resumen de hoy (24h)</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {available.map((m) => {
          const s = stats[m.key]
          return (
            <div key={m.key} className="card">
              <p className="card-title">
                <WeatherIcon name={m.icon} size={20} /> {m.label}
              </p>
              <div className="flex items-end justify-between">
                <div>
                  <p className={`text-3xl font-bold ${m.color}`}>{fmt(s.avg, '')}</p>
                  <p className="text-xs text-slate-500">promedio {m.unit}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-red-300">▲ {fmt(s.max, m.unit)}</p>
                  <p className="text-sky-300">▼ {fmt(s.min, m.unit)}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
