import { WeatherData, DailyStats } from '../../types'
import { ForecastResult } from '../../forecast'

interface Props {
  data: WeatherData
  stats: DailyStats['stats'] | null
  forecast: ForecastResult | null
}

function Tile({ label, value, sub, color = 'text-slate-100' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 min-w-[110px]">
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

export function MiniStats({ data, stats, forecast }: Props) {
  const t = stats?.temperature_outdoor
  const g = stats?.wind_gust
  const today = forecast?.days?.[0]
  const uv = data.uv_index ?? 0

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      <Tile
        label="Hoy"
        value={t?.max != null ? `${t.max.toFixed(1)}°` : '--'}
        sub={t?.min != null ? `mín ${t.min.toFixed(1)}°` : undefined}
        color="text-orange-300"
      />
      <Tile
        label="Viento máx"
        value={g?.max != null ? `${g.max.toFixed(0)} km/h` : '--'}
        color="text-emerald-300"
      />
      <Tile label="Precipitación" value={`${(data.rain_daily ?? 0).toFixed(1)} mm`} sub="hoy" color="text-blue-300" />
      <Tile
        label="Índice UV"
        value={`${uv}`}
        color={uv >= 8 ? 'text-red-300' : uv >= 6 ? 'text-orange-300' : 'text-yellow-300'}
      />
      <Tile label="Sensación" value={data.feels_like !== undefined ? `${data.feels_like.toFixed(1)}°` : '--'} />
      <Tile label="Presión" value={`${(data.pressure_relative ?? 0).toFixed(0)}`} sub="hPa" color="text-violet-300" />
      <Tile
        label="Prob. lluvia"
        value={today ? `${today.precipProb}%` : '--'}
        sub="hoy"
        color="text-sky-300"
      />
      <Tile label="Humedad" value={`${(data.humidity_outdoor ?? 0).toFixed(0)}%`} color="text-cyan-300" />
    </div>
  )
}
