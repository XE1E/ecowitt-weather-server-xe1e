import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useUnits } from '../../units'

interface DataPoint {
  x: string
  temp?: number | null
  pressure?: number | null
  rain?: number | null
  wind?: number | null
  humidity?: number | null
}

interface Props {
  mode: 'day' | 'week'
}

export function MultiVariableChart({ mode }: Props) {
  const u = useUnits()
  const [data, setData] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const start = mode === 'day' ? '-24h' : '-7d'
    fetch(`/api/history?start=${start}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((json) => {
        const raw = json.data || []
        const points: DataPoint[] = raw.map((p: any) => {
          const d = new Date(p._time)
          const label = mode === 'day'
            ? `${d.getHours().toString().padStart(2, '0')}:00`
            : `${d.getDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()]}`
          return {
            x: label,
            temp: p.temperature_outdoor ?? null,
            pressure: p.pressure_relative ?? null,
            rain: p.rain_rate ?? 0,
            wind: p.wind_speed ?? null,
            humidity: p.humidity_outdoor ?? null,
          }
        })
        // Reducir puntos si hay muchos (agrupar por hora/día)
        const grouped = mode === 'day' ? groupByHour(points) : groupByDay(points)
        setData(grouped)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [mode])

  if (loading) {
    return <div className="h-80 flex items-center justify-center text-slate-400">Cargando...</div>
  }

  const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ backgroundColor: '#0f1a2a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px' }}>
        <p style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color, fontSize: 12 }}>
            {p.name}: {p.value != null ? `${p.value.toFixed(1)} ${getUnit(p.dataKey, u)}` : '--'}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 20, right: 60, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="x" tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={20} />

            {/* Eje izquierdo: Temperatura */}
            <YAxis
              yAxisId="temp"
              orientation="left"
              domain={['auto', 'auto']}
              tick={{ fill: '#ef4444', fontSize: 10 }}
              tickFormatter={(v) => `${v}°`}
              width={35}
            />

            {/* Eje izquierdo 2: Presión */}
            <YAxis
              yAxisId="press"
              orientation="left"
              domain={['auto', 'auto']}
              tick={{ fill: '#f97316', fontSize: 10 }}
              tickFormatter={(v) => `${v}`}
              width={40}
              axisLine={false}
              tickLine={false}
            />

            {/* Eje derecho: Viento */}
            <YAxis
              yAxisId="wind"
              orientation="right"
              domain={[0, 'auto']}
              tick={{ fill: '#22c55e', fontSize: 10 }}
              tickFormatter={(v) => `${v}`}
              width={30}
            />

            {/* Eje derecho 2: Humedad % */}
            <YAxis
              yAxisId="hum"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: '#38bdf8', fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
              width={35}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip content={<CustomTooltip />} />

            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="circle"
              formatter={(value: string, entry: any) => {
                const color = entry.color
                return <span style={{ color }}>{value}</span>
              }}
            />

            {/* Barras de precipitación */}
            <Bar
              yAxisId="wind"
              dataKey="rain"
              name="Precipitación"
              fill="#60a5fa"
              opacity={0.7}
              radius={[2, 2, 0, 0]}
            />

            {/* Línea de temperatura */}
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="temp"
              name="Temperatura"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              connectNulls
            />

            {/* Línea de presión */}
            <Line
              yAxisId="press"
              type="monotone"
              dataKey="pressure"
              name="Presión atmosférica"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              connectNulls
            />

            {/* Línea de viento */}
            <Line
              yAxisId="wind"
              type="monotone"
              dataKey="wind"
              name="Velocidad del viento"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              connectNulls
            />

            {/* Línea de humedad */}
            <Line
              yAxisId="hum"
              type="monotone"
              dataKey="humidity"
              name="Humedad"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 mt-2">
        <span>°C / hPa / mm</span>
        <span>km/h / %</span>
      </div>
    </div>
  )
}

function getUnit(key: string, u: any): string {
  switch (key) {
    case 'temp': return u.tempU
    case 'pressure': return u.pressU
    case 'rain': return 'mm/h'
    case 'wind': return u.windU
    case 'humidity': return '%'
    default: return ''
  }
}

function groupByHour(points: DataPoint[]): DataPoint[] {
  const map = new Map<string, DataPoint[]>()
  for (const p of points) {
    const key = p.x
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  const result: DataPoint[] = []
  for (const [x, pts] of map) {
    result.push({
      x,
      temp: avg(pts.map((p) => p.temp)),
      pressure: avg(pts.map((p) => p.pressure)),
      rain: Math.max(...pts.map((p) => p.rain ?? 0)),
      wind: avg(pts.map((p) => p.wind)),
      humidity: avg(pts.map((p) => p.humidity)),
    })
  }
  return result
}

function groupByDay(points: DataPoint[]): DataPoint[] {
  const map = new Map<string, DataPoint[]>()
  for (const p of points) {
    const key = p.x
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  const result: DataPoint[] = []
  for (const [x, pts] of map) {
    result.push({
      x,
      temp: avg(pts.map((p) => p.temp)),
      pressure: avg(pts.map((p) => p.pressure)),
      rain: sum(pts.map((p) => p.rain ?? 0)),
      wind: avg(pts.map((p) => p.wind)),
      humidity: avg(pts.map((p) => p.humidity)),
    })
  }
  return result
}

function avg(arr: (number | null | undefined)[]): number | null {
  const valid = arr.filter((v): v is number => v != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0)
}
