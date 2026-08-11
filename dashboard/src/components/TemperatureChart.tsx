import { useState, useEffect, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { HistoryData } from '../types'
import { useUnits, type Units } from '../units'

const REFRESH_INTERVAL = 60000 // 60 seconds, matches the rest of the dashboard

type Period = '24h' | '7d' | '30d'
type MetricKey = 'temp' | 'pressure' | 'wind'

const PERIODS: { key: Period; label: string; start: string }[] = [
  { key: '24h', label: '24 h', start: '-24h' },
  { key: '7d', label: '7 d', start: '-7d' },
  { key: '30d', label: '30 d', start: '-30d' },
]

// Unidad y conversión salen del sistema activo, no de un literal: esta gráfica
// vive en la vista clásica, que también tiene selector métrico/imperial.
const METRICS: Record<MetricKey, {
  label: string; color: string; field: keyof HistoryData
  unit: (u: Units) => string; conv: (u: Units, v: number) => number
}> = {
  temp: { label: 'Temperatura', color: '#f97316', field: 'temperature_outdoor',
    unit: (u) => u.tempU, conv: (u, v) => u.tempN(v) },
  pressure: { label: 'Presión', color: '#8b5cf6', field: 'pressure_relative',
    unit: (u) => u.pressU, conv: (u, v) => u.pressN(v) },
  wind: { label: 'Viento', color: '#22c55e', field: 'wind_speed',
    unit: (u) => u.windU, conv: (u, v) => u.windN(v) },
}

interface ChartPoint {
  time: string
  value: number | null
  humidity: number | null
}

export function TemperatureChart() {
  const u = useUnits()
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('24h')
  const [metric, setMetric] = useState<MetricKey>('temp')

  useEffect(() => {
    const start = PERIODS.find((p) => p.key === period)!.start
    const field = METRICS[metric].field
    let cancelled = false

    const fetchHistory = async () => {
      try {
        const response = await fetch(`/api/history?start=${start}`)
        if (response.ok) {
          const json = await response.json()
          const longRange = period !== '24h'
          const chartData: ChartPoint[] = json.data.map((item: HistoryData) => ({
            time: new Date(item._time).toLocaleString('es-MX', longRange
              ? { day: '2-digit', month: '2-digit', hour: '2-digit' }
              : { hour: '2-digit', minute: '2-digit' }),
            value: (item[field] as number | undefined) ?? null,
            humidity: item.humidity_outdoor ?? null,
          }))
          if (!cancelled) setData(chartData)
        }
      } catch (error) {
        console.error('Error fetching history:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setLoading(true)
    fetchHistory()
    const interval = setInterval(fetchHistory, REFRESH_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [period, metric])

  const m = METRICS[metric]
  const unit = m.unit(u)

  // `data` guarda los valores MÉTRICOS que llegan del API; la conversión ocurre
  // aquí, así que cambiar de unidades no vuelve a pedir el histórico.
  const shown = useMemo(
    () => data.map((p) => ({ ...p, value: p.value == null ? null : m.conv(u, p.value) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, u.system, metric]
  )

  const btn = (active: boolean) =>
    `px-3 py-1 rounded-lg text-sm transition ${
      active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
    }`

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex gap-1">
          {(Object.keys(METRICS) as MetricKey[]).map((k) => (
            <button key={k} className={btn(metric === k)} onClick={() => setMetric(k)}>
              {METRICS[k].label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p.key} className={btn(period === p.key)} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-80 md:h-64 flex items-center justify-center text-slate-400">Cargando histórico...</div>
      ) : data.length === 0 ? (
        <div className="h-80 md:h-64 flex items-center justify-center text-slate-400">
          No hay datos históricos disponibles
        </div>
      ) : (
        <div className="h-80 md:h-64 overflow-x-auto chart-scroll">
          <div style={{ minWidth: data.length > 30 ? `${Math.max(500, data.length * 10)}px` : '500px', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={shown} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={unit} />
              <YAxis yAxisId="humidity" orientation="right" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={[0, 100]} unit="%" />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
                cursor={{ stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }}
              />
              <Legend />
                <Line yAxisId="left" type="monotone" dataKey="value" stroke={m.color} strokeWidth={2} dot={false} name={`${m.label} (${unit})`} />
                <Line yAxisId="humidity" type="monotone" dataKey="humidity" stroke="#2563eb" strokeWidth={2} dot={false} name="Humedad (%)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
