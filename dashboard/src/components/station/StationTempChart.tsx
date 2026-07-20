import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
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
  obs: number | null
  fc: number | null
}

export function StationTempChart({ history, forecast }: Props) {
  const u = useUnits()
  const points: Point[] = []

  for (const h of history) {
    if (h.temperature_outdoor === undefined) continue
    points.push({ t: new Date(h._time).getTime(), obs: u.tempN(h.temperature_outdoor), fc: null })
  }
  if (forecast) {
    for (const hr of forecast.hours) {
      points.push({ t: new Date(hr.time).getTime(), obs: null, fc: u.tempN(hr.temp) })
    }
  }
  points.sort((a, b) => a.t - b.t)

  if (points.length < 2) return null

  // Formato de hora (y día si cruza medianoche) para el eje de tiempo real.
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const fmtFull = (t: number) =>
    new Date(t).toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  const nowMs = Date.now()

  return (
    <div className="card">
      <p className="card-title">Temperatura — observado + pronóstico</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={fmt}
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              minTickGap={50}
            />
            <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={['auto', 'auto']} unit="°" />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              labelFormatter={(t) => fmtFull(Number(t))}
              formatter={(v: number, n: string) => [`${v?.toFixed(1)}${u.tempU}`, n === 'obs' ? 'Observado' : 'Pronóstico']}
            />
            <ReferenceLine x={nowMs} stroke="#64748b" strokeDasharray="2 2"
              label={{ value: 'ahora', position: 'insideTopRight', fill: '#94a3b8', fontSize: 10 }} />
            <Legend formatter={(v) => (v === 'obs' ? 'Observado' : 'Pronóstico')} />
            <Line type="monotone" dataKey="obs" stroke="#34d399" strokeWidth={2} dot={false} connectNulls name="obs" />
            <Line type="monotone" dataKey="fc" stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls name="fc" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
