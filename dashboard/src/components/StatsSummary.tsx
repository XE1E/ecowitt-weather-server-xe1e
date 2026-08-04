import { DailyStats } from '../types'
import { WeatherIcon } from './WeatherIcon'
import { useUnits, type Units } from '../units'

interface StatsSummaryProps {
  stats: DailyStats['stats'] | null
}

interface Metric {
  key: string
  label: string
  icon: string
  color: string
  /** Unidad y formato salen del sistema activo, no de un literal. */
  unit: (u: Units) => string
  fmt: (u: Units, v: number) => string
}

const METRICS: Metric[] = [
  { key: 'temperature_outdoor', label: 'Temperatura', icon: 'thermometer', color: 'text-orange-300',
    unit: (u) => u.tempU, fmt: (u, v) => u.temp(v) },
  { key: 'humidity_outdoor', label: 'Humedad', icon: 'humidity', color: 'text-sky-300',
    unit: () => '%', fmt: (_u, v) => v.toFixed(0) },
  { key: 'wind_speed', label: 'Viento', icon: 'windsock', color: 'text-emerald-300',
    unit: (u) => u.windU, fmt: (u, v) => u.wind(v) },
  { key: 'wind_gust', label: 'Ráfaga', icon: 'windsock', color: 'text-emerald-300',
    unit: (u) => u.windU, fmt: (u, v) => u.wind(v) },
  { key: 'pressure_relative', label: 'Presión', icon: 'pressure-high', color: 'text-violet-300',
    unit: (u) => u.pressU, fmt: (u, v) => u.press(v) },
  { key: 'rain_daily', label: 'Lluvia', icon: 'raindrops', color: 'text-blue-300',
    unit: (u) => u.rainU, fmt: (u, v) => u.rain(v) },
]

export function StatsSummary({ stats }: StatsSummaryProps) {
  const u = useUnits()
  if (!stats) return null

  const available = METRICS.filter((m) => stats[m.key])
  if (available.length === 0) return null

  const fmt = (v: number | null | undefined, unit: string, m: Metric) =>
    v === null || v === undefined ? '--' : `${m.fmt(u, v)}${unit}`

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-slate-300 mb-4">Resumen de hoy (24h)</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {available.map((m) => {
          const s = stats[m.key]
          const unit = m.unit(u)
          return (
            <div key={m.key} className="card">
              <p className="card-title flex items-center gap-2">
                <WeatherIcon name={m.icon} size={28} /> {m.label}
              </p>
              <div className="flex items-end justify-between">
                <div>
                  <p className={`text-3xl font-bold ${m.color}`}>{fmt(s.avg, '', m)}</p>
                  <p className="text-xs text-slate-500">promedio {unit}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-red-300">▲ {fmt(s.max, unit, m)}</p>
                  <p className="text-sky-300">▼ {fmt(s.min, unit, m)}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
