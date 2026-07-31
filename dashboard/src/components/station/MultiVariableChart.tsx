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

const nf = (v: number) => Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })

export function MultiVariableChart({ mode }: Props) {
  const u = useUnits()
  const [data, setData] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
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
        const grouped = mode === 'day' ? groupByHour(points) : groupByDay(points)
        setData(grouped)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [mode])

  if (loading) {
    return <div className="h-60 flex items-center justify-center text-slate-400">Cargando...</div>
  }

  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
  }
  const cursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
  const xax = <XAxis dataKey="x" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={12} />

  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 50, left: -8, bottom: 0 }}>
          {grid}
          {xax}

          {/* Eje izquierdo: Temperatura */}
          <YAxis
            yAxisId="temp"
            orientation="left"
            domain={['auto', 'auto']}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(v) => `${v}°`}
            width={44}
          />

          {/* Eje derecho: Humedad % */}
          <YAxis
            yAxisId="hum"
            orientation="right"
            domain={[0, 100]}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            width={40}
          />

          <Tooltip
            cursor={cursor}
            {...tip}
            formatter={(v: number, name: string) => {
              const unit = getUnit(name, u)
              return [`${nf(v)} ${unit}`, name]
            }}
          />

          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />

          {/* Barras de precipitación */}
          <Bar
            yAxisId="temp"
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
            yAxisId="temp"
            type="monotone"
            dataKey="pressure"
            name="Presión"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            connectNulls
          />

          {/* Línea de viento */}
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="wind"
            name="Viento"
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
  )
}

function getUnit(name: string, u: any): string {
  switch (name) {
    case 'Temperatura': return u.tempU
    case 'Presión': return u.pressU
    case 'Precipitación': return 'mm/h'
    case 'Viento': return u.windU
    case 'Humedad': return '%'
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
