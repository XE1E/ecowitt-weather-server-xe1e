import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { HistoryData } from '../../types'
import { ForecastResult } from '../../forecast'
import { useUnits } from '../../units'

interface Props {
  history: HistoryData[]
  forecast: ForecastResult | null
}

interface Point {
  t: number
  label: string
  obs: number | null
  fc: number | null
}

export function StationTempChart({ history, forecast }: Props) {
  const u = useUnits()
  const points: Point[] = []

  for (const h of history) {
    if (h.temperature_outdoor === undefined) continue
    const t = new Date(h._time).getTime()
    points.push({
      t,
      label: new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      obs: u.tempN(h.temperature_outdoor),
      fc: null,
    })
  }
  if (forecast) {
    for (const hr of forecast.hours) {
      const t = new Date(hr.time).getTime()
      points.push({
        t,
        label: new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        obs: null,
        fc: u.tempN(hr.temp),
      })
    }
  }
  points.sort((a, b) => a.t - b.t)

  if (points.length < 2) return null

  return (
    <div className="card">
      <p className="card-title">Temperatura — observado + pronóstico</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={['auto', 'auto']} unit="°" />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              formatter={(v: number, n: string) => [`${v?.toFixed(1)}${u.tempU}`, n === 'obs' ? 'Observado' : 'Pronóstico']}
            />
            <Legend formatter={(v) => (v === 'obs' ? 'Observado' : 'Pronóstico')} />
            <Line type="monotone" dataKey="obs" stroke="#34d399" strokeWidth={2} dot={false} connectNulls name="obs" />
            <Line type="monotone" dataKey="fc" stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls name="fc" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
