import {
  LineChart, Line, Bar, ComposedChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useUnits } from '../../units'

export interface HistPoint {
  x: string
  max?: number | null; min?: number | null; prom?: number | null
  vmed?: number | null; vmax?: number | null; dir?: number | null
  hum?: number | null; dew?: number | null
  uv?: number | null; solar?: number | null
  pprom?: number | null; lluvia?: number
}

const CARDINAL = ['N', 'E', 'S', 'O', 'N']
const CARD16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const dir16 = (d: number) => CARD16[Math.round(d / 22.5) % 16]
const nf = (v: number) => Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })

export function HistoryCharts({ data, labelFormatter, onCsv }: {
  data: HistPoint[]
  labelFormatter?: (l: string) => string
  onCsv?: () => void
}) {
  const u = useUnits()
  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
    labelFormatter,
  }
  const cursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
  const xax = <XAxis dataKey="x" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={12} />

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Temperatura */}
      <div className="card">
        <p className="card-title">Temperatura</p>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
              {grid}{xax}
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
              <Tooltip cursor={cursor} {...tip} formatter={(v: number, n: string) => [`${nf(v)} ${u.tempU}`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Line type="monotone" dataKey="max" name="Máxima" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="prom" name="Promedio" stroke="#94a3b8" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="min" name="Mínima" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Viento + dirección */}
      <div className="card">
        <p className="card-title">Viento</p>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
              {grid}{xax}
              <YAxis yAxisId="v" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
              <YAxis yAxisId="dir" orientation="right" domain={[0, 360]} ticks={[0, 90, 180, 270, 360]}
                tickFormatter={(t: number) => CARDINAL[t / 90]} tick={{ fill: '#84cc16', fontSize: 10 }} width={28} />
              <Tooltip cursor={cursor} {...tip} formatter={(v: number, n: string) => [n === 'Dirección' ? `${Math.round(v)}° (${dir16(v)})` : `${nf(v)} ${u.windU}`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Line yAxisId="v" type="monotone" dataKey="vmed" name="Viento medio" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="v" type="monotone" dataKey="vmax" name="Viento máximo" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />
              <Scatter yAxisId="dir" dataKey="dir" name="Dirección" fill="#84cc16" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Humedad y punto de rocío */}
      <div className="card">
        <p className="card-title">Humedad y punto de rocío</p>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
              {grid}{xax}
              <YAxis yAxisId="h" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
              <YAxis yAxisId="d" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
              <Tooltip cursor={cursor} {...tip} formatter={(v: number, n: string) => [n === 'Humedad' ? `${nf(v)} %` : `${nf(v)} ${u.tempU}`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Line yAxisId="h" type="monotone" dataKey="hum" name="Humedad" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="d" type="monotone" dataKey="dew" name="Punto de rocío" stroke="#22d3ee" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Radiación UV y solar */}
      <div className="card">
        <p className="card-title">Radiación UV y solar</p>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
              {grid}{xax}
              <YAxis yAxisId="s" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
              <YAxis yAxisId="u" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={30} />
              <Tooltip cursor={cursor} {...tip} formatter={(v: number, n: string) => [n === 'Radiación solar' ? `${nf(v)} W/m²` : `${nf(v)}`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Line yAxisId="s" type="monotone" dataKey="solar" name="Radiación solar" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="u" type="monotone" dataKey="uv" name="Índice UV" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Precipitación y presión */}
      <div className="card lg:col-span-2">
        <div className="flex items-center justify-between">
          <p className="card-title mb-0">Precipitación y presión</p>
          {onCsv && <button onClick={onCsv} className="px-3 py-1 rounded-lg text-xs bg-white/5 text-slate-300 hover:bg-white/10">⬇ CSV</button>}
        </div>
        <div className="h-64 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
              {grid}{xax}
              <YAxis yAxisId="r" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
              <YAxis yAxisId="p" orientation="right" domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} {...tip} formatter={(v: number, n: string) => [n === 'Presión' ? `${nf(v)} ${u.pressU}` : `${nf(v)} ${u.rainU}`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Bar yAxisId="r" dataKey="lluvia" name="Precipitación" fill="#60a5fa" radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" type="monotone" dataKey="pprom" name="Presión" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
