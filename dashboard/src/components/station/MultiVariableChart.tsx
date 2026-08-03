import { useState, useEffect, useMemo } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useUnits } from '../../units'

interface DataPoint {
  x: string
  k?: string          // clave de agrupacion (puede diferir de la etiqueta visible)
  temp?: number | null
  pressure?: number | null
  rain?: number | null
  wind?: number | null
  humidity?: number | null
}

interface Props {
  /** Ventana de datos: 'day' = 24 h, '2day' = 48 h, 'week' = 7 d. */
  mode: 'day' | '2day' | 'week'
  /**
   * Modo kiosco (pagina 5 del display de 1024x600, que el servidor captura como
   * JPEG): sin scroll horizontal ni tooltip, y con fuentes mas grandes para que
   * se lea a distancia.
   */
  kiosk?: boolean
  /** Alto en px. Solo se usa con kiosk; si no, manda la clase h-96/md:h-80. */
  height?: number
  /** Se llama al terminar de cargar (bien o mal). El kiosco lo usa para avisar
   *  al renderer que ya puede capturar la pantalla. */
  onLoaded?: () => void
}

const nf = (v: number) => Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })

// Colores
const COL = {
  temp: '#f97316',    // naranja
  press: '#a78bfa',   // morado
  rain: '#38bdf8',    // azul claro
  wind: '#22c55e',    // verde
  hum: '#3b82f6',     // azul oscuro
}

export function MultiVariableChart({ mode, kiosk = false, height = 400, onLoaded }: Props) {
  const u = useUnits()
  const [data, setData] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const start = mode === 'day' ? '-24h' : mode === '2day' ? '-48h' : '-7d'
    fetch(`/api/history?start=${start}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((json) => {
        const raw = json.data || []
        const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

        const points: DataPoint[] = raw.map((p: any) => {
          const d = new Date(p._time)
          let label: string
          let key: string
          if (mode === 'week') {
            label = `${d.getDate()} ${MES[d.getMonth()]}`
            key = label
          } else {
            label = `${d.getHours().toString().padStart(2, '0')}:00`
            // En 48 h la misma hora aparece dos veces (ayer y hoy). Si se agrupa
            // por la etiqueta, ambos puntos colapsan en uno y la grafica sale
            // con la mitad de los datos: la clave incluye el dia.
            key = mode === '2day' ? `${d.getMonth()}-${d.getDate()} ${label}` : label
          }
          return {
            x: label,
            k: key,
            temp: p.temperature_outdoor ?? null,
            pressure: p.pressure_relative ?? null,
            rain: p.rain_rate ?? 0,
            wind: p.wind_speed ?? null,
            humidity: p.humidity_outdoor ?? null,
          }
        })

        const grouped = mode === 'week' ? groupByDay(points) : groupByHour(points)
        setData(grouped)
        setLoading(false)
        onLoaded?.()
      })
      .catch(() => { setLoading(false); onLoaded?.() })
    // onLoaded queda fuera de las deps a proposito: si el padre la recrea en
    // cada render, incluirla dispararia un fetch en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return kiosk
      ? <div style={{ height }} className="flex items-center justify-center text-slate-400 text-[20px]">Cargando...</div>
      : <div className="h-96 md:h-80 flex items-center justify-center text-slate-400">Cargando...</div>
  }

  // Tamaños: en el kiosco la imagen se ve a distancia en una pantalla de 7", y
  // los ejes van mas anchos porque las fuentes mas grandes necesitan sitio.
  const fsX = kiosk ? 14 : 10
  const fsY = kiosk ? 13 : 9
  const fsL = kiosk ? 13 : 10
  const w = (base: number, k: number) => (kiosk ? k : base)
  // 48 barras en ~880 px: si son de 12 px se empastan.
  const barSize = mode === 'week' ? 8 : kiosk ? 7 : 12
  // Con 48 puntos hay que saltarse etiquetas o el eje X queda ilegible.
  const xInterval = kiosk ? (mode === '2day' ? 3 : 1) : undefined

  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
  }
  const cursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }

  // Ancho mínimo para scroll horizontal (CSS anula en desktop)
  const minW = data.length > 12 ? `${Math.max(600, data.length * 40)}px` : '600px'

  const chart = (
        <ComposedChart data={data} margin={{ top: 20, right: kiosk ? 20 : 70, left: kiosk ? 10 : 70, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />

          <XAxis
            dataKey="x"
            interval={xInterval}
            tick={{ fill: '#94a3b8', fontSize: fsX }}
            axisLine={{ stroke: 'rgba(148,163,184,0.3)' }}
            tickLine={{ stroke: 'rgba(148,163,184,0.3)' }}
          />

          {/* Eje izquierdo 1: Temperatura °C (naranja) */}
          <YAxis
            yAxisId="temp"
            orientation="left"
            domain={domains.temp}
            ticks={genTicks(domains.temp, 6)}
            tick={{ fill: COL.temp, fontSize: fsY }}
            axisLine={{ stroke: COL.temp }}
            tickLine={{ stroke: COL.temp }}
            label={{ value: '°C', position: 'top', offset: 12, fill: COL.temp, fontSize: fsL }}
            width={w(25, 34)}
          />

          {/* Eje izquierdo 2: Presión hPa (morado) */}
          <YAxis
            yAxisId="press"
            orientation="left"
            domain={domains.press}
            ticks={genTicks(domains.press, 5)}
            tick={{ fill: COL.press, fontSize: fsY }}
            axisLine={{ stroke: COL.press }}
            tickLine={{ stroke: COL.press }}
            label={{ value: 'hPa', position: 'top', offset: 12, fill: COL.press, fontSize: fsL }}
            width={w(32, 46)}
          />

          {/* Eje izquierdo 3: Precipitación mm (azul claro) */}
          <YAxis
            yAxisId="rain"
            orientation="left"
            domain={domains.rain}
            ticks={genTicks(domains.rain, 6)}
            tick={{ fill: COL.rain, fontSize: fsY }}
            axisLine={{ stroke: COL.rain }}
            tickLine={{ stroke: COL.rain }}
            label={{ value: 'mm', position: 'top', offset: 12, fill: COL.rain, fontSize: fsL }}
            width={w(20, 28)}
          />

          {/* Eje derecho 1: Viento km/h (verde) */}
          <YAxis
            yAxisId="wind"
            orientation="right"
            domain={domains.wind}
            ticks={genTicks(domains.wind, 6)}
            tick={{ fill: COL.wind, fontSize: fsY }}
            axisLine={{ stroke: COL.wind }}
            tickLine={{ stroke: COL.wind }}
            label={{ value: 'km/h', position: 'top', offset: 12, fill: COL.wind, fontSize: fsL }}
            width={w(28, 40)}
          />

          {/* Eje derecho 2: Humedad % (azul oscuro) */}
          <YAxis
            yAxisId="hum"
            orientation="right"
            domain={domains.hum}
            ticks={genTicks(domains.hum, 6)}
            tick={{ fill: COL.hum, fontSize: fsY }}
            axisLine={{ stroke: COL.hum }}
            tickLine={{ stroke: COL.hum }}
            label={{ value: '%', position: 'top', offset: 12, fill: COL.hum, fontSize: fsL }}
            width={w(28, 36)}
          />

          {/* El tooltip no aporta nada en el kiosco: es una captura, nadie pasa
              el cursor por encima. */}
          {!kiosk && (
            <Tooltip
              cursor={cursor}
              {...tip}
              formatter={(v: number, name: string) => {
                const unit = getUnit(name, u)
                return [`${nf(v)} ${unit}`, name]
              }}
            />
          )}

          <Legend
            verticalAlign="bottom"
            height={kiosk ? 34 : 28}
            wrapperStyle={{ fontSize: kiosk ? 15 : 11, paddingTop: 5 }}
            iconType="circle"
            iconSize={kiosk ? 11 : 8}
          />

          {/* Barras de precipitación (azul claro) */}
          <Bar
            yAxisId="rain"
            dataKey="rain"
            name="Precipitación"
            fill={COL.rain}
            opacity={0.85}
            radius={[2, 2, 0, 0]}
            barSize={barSize}
          />

          {/* Línea de temperatura (naranja) */}
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            name="Temperatura"
            stroke={COL.temp}
            strokeWidth={2.5}
            dot={false}
            connectNulls
          />

          {/* Línea de presión (morado) */}
          <Line
            yAxisId="press"
            type="monotone"
            dataKey="pressure"
            name="Presión atmosférica"
            stroke={COL.press}
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
            stroke={COL.wind}
            strokeWidth={2}
            dot={false}
            connectNulls
          />

          {/* Línea de humedad (azul oscuro) */}
          <Line
            yAxisId="hum"
            type="monotone"
            dataKey="humidity"
            name="Humedad"
            stroke={COL.hum}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
  )

  // Kiosco: caja de alto fijo, sin scroll (el JPEG no se puede desplazar).
  if (kiosk) {
    return (
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-96 md:h-80 overflow-x-auto chart-scroll">
      <div style={{ minWidth: minW, height: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
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
    const key = p.k ?? p.x
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(p)
  }
  return order.map((key) => {
    const pts = map.get(key)!
    return {
      // La etiqueta visible viene del punto, NO de la clave: en 48 h la clave
      // lleva el dia ("6-15 14:00") y en el eje solo debe salir "14:00".
      x: pts[0].x,
      k: key,
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
    const key = p.k ?? p.x
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(p)
  }
  return order.map((key) => {
    const pts = map.get(key)!
    return {
      x: pts[0].x,
      k: key,
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
