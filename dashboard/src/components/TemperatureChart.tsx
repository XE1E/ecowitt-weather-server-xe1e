import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { HistoryData } from '../types'

interface ChartData {
  time: string
  temperature: number | null
  humidity: number | null
}

const REFRESH_INTERVAL = 60000 // 60 seconds, matches the rest of the dashboard

export function TemperatureChart() {
  const [data, setData] = useState<ChartData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await fetch('/api/history?start=-24h')
        if (response.ok) {
          const json = await response.json()
          const chartData = json.data.map((item: HistoryData) => ({
            time: new Date(item._time).toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit'
            }),
            temperature: item.temperature_outdoor ?? null,
            humidity: item.humidity_outdoor ?? null
          }))
          setData(chartData)
        }
      } catch (error) {
        console.error('Error fetching history:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchHistory()
    const interval = setInterval(fetchHistory, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400">
        Cargando histórico...
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400">
        No hay datos históricos disponibles
      </div>
    )
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="time"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="temp"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            domain={['auto', 'auto']}
            unit="°C"
          />
          <YAxis
            yAxisId="humidity"
            orientation="right"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            domain={[0, 100]}
            unit="%"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px'
            }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend />
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temperature"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            name="Temperatura (°C)"
          />
          <Line
            yAxisId="humidity"
            type="monotone"
            dataKey="humidity"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={false}
            name="Humedad (%)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
