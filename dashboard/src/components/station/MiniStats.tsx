import { WeatherData, DailyStats } from '../../types'
import { ForecastResult } from '../../forecast'
import { Comparison } from '../../station-data'
import { useUnits } from '../../units'

interface Props {
  data: WeatherData
  stats: DailyStats['stats'] | null
  forecast: ForecastResult | null
  compare: Comparison | null
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

export function MiniStats({ data, stats, forecast, compare }: Props) {
  const u = useUnits()
  const t = stats?.temperature_outdoor
  const g = stats?.wind_gust
  const today = forecast?.days?.[0]
  const uv = data.uv_index ?? 0

  // Delta de temperatura vs 24h previas (conversión de diferencia: °F = °C*9/5)
  const dRaw = compare?.temperature_outdoor?.delta
  const dDisp = dRaw != null ? (u.system === 'imperial' ? dRaw * 9 / 5 : dRaw) : null

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      <Tile
        label="Hoy"
        value={t?.max != null ? `${u.temp(t.max)}${u.tempU}` : '--'}
        sub={t?.min != null ? `mín ${u.temp(t.min)}${u.tempU}` : undefined}
        color="text-orange-300"
      />
      <Tile
        label="Viento máx"
        value={g?.max != null ? `${u.wind(g.max, 0)} ${u.windU}` : '--'}
        color="text-emerald-300"
      />
      <Tile label="Precipitación" value={`${u.rain(data.rain_daily)} ${u.rainU}`} sub="hoy" color="text-blue-300" />
      <Tile
        label="Índice UV"
        value={`${uv}`}
        color={uv >= 8 ? 'text-red-300' : uv >= 6 ? 'text-orange-300' : 'text-yellow-300'}
      />
      <Tile label="Sensación" value={`${u.temp(data.feels_like)}${u.tempU}`} />
      <Tile label="Presión" value={u.press(data.pressure_relative, 0)} sub={u.pressU} color="text-violet-300" />
      <Tile
        label="Prob. lluvia"
        value={today ? `${today.precipProb}%` : '--'}
        sub="hoy"
        color="text-sky-300"
      />
      <Tile label="Humedad" value={`${(data.humidity_outdoor ?? 0).toFixed(0)}%`} color="text-cyan-300" />
      {dDisp != null && (
        <Tile
          label="vs ayer"
          value={`${dDisp > 0 ? '+' : ''}${dDisp.toFixed(1)}°`}
          sub={dDisp > 0.1 ? 'más cálido' : dDisp < -0.1 ? 'más frío' : 'similar'}
          color={dDisp > 0.1 ? 'text-red-300' : dDisp < -0.1 ? 'text-sky-300' : 'text-slate-300'}
        />
      )}
    </div>
  )
}
