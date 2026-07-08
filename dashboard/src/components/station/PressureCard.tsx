import { BarChart, Bar, ResponsiveContainer, YAxis, Tooltip } from 'recharts'
import { WeatherData, DailyStats, HistoryData } from '../../types'
import { useUnits } from '../../units'

interface Props {
  data: WeatherData
  stats: DailyStats['stats'] | null
  history: HistoryData[]
}

export function PressureCard({ data, stats, history }: Props) {
  const u = useUnits()
  const p = data.pressure_relative
  const s = stats?.pressure_relative
  const series = history
    .filter((h) => h.pressure_relative !== undefined)
    .map((h) => ({ t: h._time, p: u.pressN(h.pressure_relative as number) }))

  // Tendencia: sobre valores MÉTRICOS crudos (hPa), comparar con ~3h atrás
  const rawP = history
    .filter((h) => h.pressure_relative !== undefined)
    .map((h) => h.pressure_relative as number)
  let trend = 'Estable'
  let trendColor = 'text-slate-300'
  if (rawP.length > 6) {
    const d = rawP[rawP.length - 1] - rawP[Math.max(0, rawP.length - 7)]
    if (d > 0.6) { trend = 'Subiendo'; trendColor = 'text-emerald-300' }
    else if (d < -0.6) { trend = 'Bajando'; trendColor = 'text-red-300' }
  }

  return (
    <div className="card">
      <p className="card-title">Presión</p>
      <div className="flex items-end gap-2">
        <span className="text-4xl font-bold text-violet-300">{u.press(p)}</span>
        <span className="text-slate-400 mb-1">{u.pressU}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
        <div>
          <p className="text-xs text-slate-400">Mín</p>
          <p className="font-semibold">{s?.min != null ? u.press(s.min) : '--'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Máx</p>
          <p className="font-semibold">{s?.max != null ? u.press(s.max) : '--'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Tendencia</p>
          <p className={`font-semibold ${trendColor}`}>{trend}</p>
        </div>
      </div>

      {series.length > 1 && (
        <div className="mt-3">
          <p className="text-xs text-slate-500 mb-1">Últimas 24 h</p>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ display: 'none' }}
                  formatter={(v: number) => [`${v.toFixed(u.system === 'imperial' ? 2 : 1)} ${u.pressU}`, 'Presión']}
                />
                <Bar dataKey="p" fill="#a78bfa" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
