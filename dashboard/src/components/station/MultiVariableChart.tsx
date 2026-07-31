import { useState, useEffect, useMemo } from 'react'
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
        const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

        const points: DataPoint[] = raw.map((p: any) => {
          const d = new Date(p._time)
          let label: string
          if (mode === 'day') {
            label = `${d.getHours().toString().padStart(2, '0')}:00`
          } else {
            label = `${d.getDate()} ${MES[d.getMonth()]}`
          }
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

  // Calcular dominios dinámicos basados en los datos
  const domains = useMemo(() => {
    if (data.length === 0) {
      return {
        temp: [0, 30],
        press: [1000, 1030],
        rain: [0, 5],
        wind: [0, 15],
        hum: [0, 100],
      }
    }

    const calcDomain = (values: (number | null | undefined)[], padding = 0.1, minRange = 5) => {
      const valid = values.filter((v): v is number => v != null)
      if (valid.length === 0) return [0, 10]
      const min = Math.min(...valid)
      const max = Math.max(...valid)
      const range = Math.max(max - min, minRange)
      const pad = range * padding
      return [Math.floor(min - pad), Math.ceil(max + pad)]
    }

    const calcDomainPress = (values: (number | null | undefined)[]) => {
      const valid = values.filter((v): v is number => v != null)
      if (valid.length === 0) return [1000, 1030]
      const min = Math.min(...valid)
      const max = Math.max(...valid)
      const range = Math.max(max - min, 5)
      return [Math.floor(min - range * 0.2), Math.ceil(max + range * 0.2)]
    }

    return {
      temp: calcDomain(data.map((d) => d.temp), 0.15, 5),
      press: calcDomainPress(data.map((d) => d.pressure)),
      rain: [0, Math.max(2, Math.ceil(Math.max(...data.map((d) => d.rain ?? 0)) * 1.3))],
      wind: [0, Math.max(3, Math.ceil(Math.max(...data.map((d) => d.wind ?? 0)) * 1.3))],
      hum: calcDomain(data.map((d) => d.humidity), 0.1, 20),
    }
  }, [data])

  // Generar ticks dinámicos
  const genTicks = (domain: number[], count: number) => {
    const [min, max] = domain
    const step = (max - min) / (count - 1)
    return Array.from({ length: count }, (_, i) => Math.round(min + step * i))
  }

  if (loading) {
    return <div className="h-80 flex items-center justify-center text-slate-400">Cargando...</div>
  }

  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
  }
  const cursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }

  return (
    <div className="h-80 relative">
      {/* Etiquetas de unidades arriba de los ejes */}
      <div className="absolute top-0 left-0 right-0 flex justify-between text-[10px] font-medium px-2 z-10">
        <span className="flex gap-2">
          <span style={{ color: '#ef4444' }}>°C</span>
          <span style={{ color: '#f97316' }}>hPa</span>
          <span style={{ color: '#3b82f6' }}>mm</span>
        </span>
        <span className="flex gap-2">
          <span style={{ color: '#22c55e' }}>km/h</span>
          <span style={{ color: '#38bdf8' }}>%</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 18, right: 70, left: 70, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />

          <XAxis
            dataKey="x"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(148,163,184,0.3)' }}
            tickLine={{ stroke: 'rgba(148,163,184,0.3)' }}
          />

          {/* Eje izquierdo 1: Temperatura °C (rojo) - más a la izquierda */}
          <YAxis
            yAxisId="temp"
            orientation="left"
            domain={domains.temp}
            ticks={genTicks(domains.temp, 6)}
            tick={{ fill: '#ef4444', fontSize: 9 }}
            axisLine={{ stroke: '#ef4444' }}
            tickLine={{ stroke: '#ef4444' }}
            width={25}
          />

          {/* Eje izquierdo 2: Presión hPa (naranja) - centro izq */}
          <YAxis
            yAxisId="press"
            orientation="left"
            domain={domains.press}
            ticks={genTicks(domains.press, 5)}
            tick={{ fill: '#f97316', fontSize: 9 }}
            axisLine={{ stroke: '#f97316' }}
            tickLine={{ stroke: '#f97316' }}
            width={32}
          />

          {/* Eje izquierdo 3: Precipitación mm (azul) - más cerca del gráfico */}
          <YAxis
            yAxisId="rain"
            orientation="left"
            domain={domains.rain}
            ticks={genTicks(domains.rain, 6)}
            tick={{ fill: '#3b82f6', fontSize: 9 }}
            axisLine={{ stroke: '#3b82f6' }}
            tickLine={{ stroke: '#3b82f6' }}
            width={20}
          />

          {/* Eje derecho 1: Viento km/h (verde) */}
          <YAxis
            yAxisId="wind"
            orientation="right"
            domain={domains.wind}
            ticks={genTicks(domains.wind, 6)}
            tick={{ fill: '#22c55e', fontSize: 9 }}
            axisLine={{ stroke: '#22c55e' }}
            tickLine={{ stroke: '#22c55e' }}
            width={28}
          />

          {/* Eje derecho 2: Humedad % (azul claro) */}
          <YAxis
            yAxisId="hum"
            orientation="right"
            domain={domains.hum}
            ticks={genTicks(domains.hum, 6)}
            tick={{ fill: '#38bdf8', fontSize: 9 }}
            axisLine={{ stroke: '#38bdf8' }}
            tickLine={{ stroke: '#38bdf8' }}
            width={28}
          />

          <Tooltip
            cursor={cursor}
            {...tip}
            formatter={(v: number, name: string) => {
              const unit = getUnit(name, u)
              return [`${nf(v)} ${unit}`, name]
            }}
          />

          <Legend
            verticalAlign="top"
            height={28}
            wrapperStyle={{ fontSize: 11, paddingBottom: 5 }}
            iconType="circle"
            iconSize={8}
          />

          {/* Barras de precipitación (azul) */}
          <Bar
            yAxisId="rain"
            dataKey="rain"
            name="Precipitación"
            fill="#3b82f6"
            opacity={0.85}
            radius={[2, 2, 0, 0]}
            barSize={mode === 'day' ? 12 : 8}
          />

          {/* Línea de temperatura (rojo) */}
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            name="Temperatura"
            stroke="#ef4444"
            strokeWidth={2.5}
            dot={false}
            connectNulls
          />

          {/* Línea de presión (naranja) */}
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

          {/* Línea de viento (verde) */}
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

          {/* Línea de humedad (azul claro) */}
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
    case 'Presión atmosférica': return u.pressU
    case 'Precipitación': return 'mm/h'
    case 'Velocidad del viento': return u.windU
    case 'Humedad': return '%'
    default: return ''
  }
}

function groupByHour(points: DataPoint[]): DataPoint[] {
  const map = new Map<string, DataPoint[]>()
  const order: string[] = []
  for (const p of points) {
    const key = p.x
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(p)
  }
  return order.map((x) => {
    const pts = map.get(x)!
    return {
      x,
      temp: avg(pts.map((p) => p.temp)),
      pressure: avg(pts.map((p) => p.pressure)),
      rain: Math.max(...pts.map((p) => p.rain ?? 0)),
      wind: avg(pts.map((p) => p.wind)),
      humidity: avg(pts.map((p) => p.humidity)),
    }
  })
}

function groupByDay(points: DataPoint[]): DataPoint[] {
  const map = new Map<string, DataPoint[]>()
  const order: string[] = []
  for (const p of points) {
    const key = p.x
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(p)
  }
  return order.map((x) => {
    const pts = map.get(x)!
    return {
      x,
      temp: avg(pts.map((p) => p.temp)),
      pressure: avg(pts.map((p) => p.pressure)),
      rain: sum(pts.map((p) => p.rain ?? 0)),
      wind: avg(pts.map((p) => p.wind)),
      humidity: avg(pts.map((p) => p.humidity)),
    }
  })
}

function avg(arr: (number | null | undefined)[]): number | null {
  const valid = arr.filter((v): v is number => v != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0)
}
