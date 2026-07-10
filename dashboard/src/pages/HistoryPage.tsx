import { useState, useEffect } from 'react'
import {
  LineChart, Line, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useUnits } from '../units'
import { LOCATION } from '../config'
import { HistoryDayDetail } from '../components/station/HistoryDayDetail'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

interface NoaaDay {
  date: string
  mean_temp?: number | null; high?: number | null; low?: number | null
  rain?: number | null; wind_avg?: number | null; gust_max?: number | null
  hum_min?: number | null; hum_max?: number | null; hum_avg?: number | null
  press_min?: number | null; press_max?: number | null; press_avg?: number | null
  dew_avg?: number | null; uv_max?: number | null; solar_max?: number | null
}
interface Rec { value: number; date: string }
interface NoaaMonth {
  year: number; month: number; days: NoaaDay[]
  summary: {
    days: number; mean_temp?: number | null; high?: Rec | null; low?: Rec | null
    rain_total?: number; rain_days?: number; wind_max?: Rec | null; gust_max?: Rec | null
  }
}

export function HistoryPage() {
  const u = useUnits()
  const now = new Date()
  const [pMonth, setPMonth] = useState(now.getMonth() + 1)
  const [pYear, setPYear] = useState(now.getFullYear())
  const [sel, setSel] = useState({ month: now.getMonth() + 1, year: now.getFullYear() })
  const [data, setData] = useState<NoaaMonth | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailDate, setDetailDate] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    fetch(`/api/climate/noaa?year=${sel.year}&month=${sel.month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancel) { setData(j); setLoading(false) } })
      .catch(() => !cancel && setLoading(false))
    return () => { cancel = true }
  }, [sel])

  const s = data?.summary
  const hasData = !!s && s.days > 0
  const days = data?.days ?? []

  const tN = (v?: number | null) => (v == null ? null : Math.round(u.tempN(v) * 10) / 10)
  const wN = (v?: number | null) => (v == null ? null : +u.wind(v))
  const pN = (v?: number | null) => (v == null ? null : +u.press(v))
  const rN = (v?: number | null) => (v == null ? 0 : +u.rain(v))

  const chartData = days.map((d) => ({
    dia: d.date.slice(8),
    max: tN(d.high), min: tN(d.low), prom: tN(d.mean_temp),
    vmed: wN(d.wind_avg), vmax: wN(d.gust_max),
    hum: d.hum_avg ?? null, dew: tN(d.dew_avg),
    uv: d.uv_max ?? null, solar: d.solar_max ?? null,
    pprom: pN(d.press_avg),
    lluvia: rN(d.rain),
  }))

  const nf = (v: number) => Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })
  const tipCommon = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
    labelFormatter: (l: string) => `${l} de ${MESES[sel.month - 1].toLowerCase()} ${sel.year}`,
  }
  const lineCursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }

  // Tarjeta de gráfica de líneas reutilizable
  const LineCard = ({ title, unit, series }: {
    title: string; unit: string; series: { key: string; name: string; color: string; dash?: string }[]
  }) => (
    <div className="card">
      <p className="card-title">{title}</p>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={12} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
            <Tooltip cursor={lineCursor} {...tipCommon} formatter={(v: number, n: string) => [`${nf(v)} ${unit}`, n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            {series.map((se) => (
              <Line key={se.key} type="monotone" dataKey={se.key} name={se.name}
                stroke={se.color} strokeWidth={2} strokeDasharray={se.dash} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  const downloadCsv = () => {
    if (!days.length) return
    const header = 'fecha,temp_max,temp_min,temp_prom,hum_prom,lluvia_mm,viento_med,viento_max,presion_prom'
    const body = days.map((d) => [d.date, d.high ?? '', d.low ?? '', d.mean_temp ?? '', d.hum_avg ?? '', d.rain ?? '', d.wind_avg ?? '', d.gust_max ?? '', d.press_avg ?? ''].join(','))
    const csv = [header, ...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `historia_xe1e_${sel.year}-${String(sel.month).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const stat = (label: string, value: string, cls: string) => (
    <div className="card text-center py-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
    </div>
  )

  if (detailDate) return <HistoryDayDetail date={detailDate} onBack={() => setDetailDate(null)} />

  return (
    <div className="space-y-4">
      {/* Cabecera (estilo del modelo) */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-300">Historia</h2>
          <p className="text-xs text-slate-400">Historial meteorológico para {LOCATION.label}. Datos de {sel.year}.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm px-3 py-1.5 rounded-lg bg-white/10 text-slate-300">Mes</span>
          <select value={pMonth} onChange={(e) => setPMonth(Number(e.target.value))}
            className="bg-white/5 border border-white/10 rounded-lg text-sm px-2 py-1.5 text-slate-200">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={pYear} min={2020} max={now.getFullYear()}
            onChange={(e) => setPYear(Number(e.target.value))}
            className="w-20 bg-white/5 border border-white/10 rounded-lg text-sm px-2 py-1.5 text-slate-200" />
          <button onClick={() => setSel({ month: pMonth, year: pYear })}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">Ver</button>
        </div>
      </div>

      <div className="card"><p className="text-lg font-semibold">{MESES[sel.month - 1]} {sel.year}</p></div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-slate-400">Cargando…</div>
      ) : !hasData ? (
        <div className="card text-slate-400">
          No hay datos registrados para {MESES[sel.month - 1]} {sel.year}. El histórico se irá llenando
          conforme la estación acumule lecturas.
        </div>
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {stat('Temperatura máxima', s!.high ? `${u.temp(s!.high.value)} ${u.tempU}` : '--', 'text-orange-300')}
            {stat('Temperatura mínima', s!.low ? `${u.temp(s!.low.value)} ${u.tempU}` : '--', 'text-sky-300')}
            {stat('Promedio', s!.mean_temp != null ? `${u.temp(s!.mean_temp)} ${u.tempU}` : '--', 'text-slate-100')}
            {stat('Precipitación total', s!.rain_total != null ? `${u.rain(s!.rain_total)} ${u.rainU}` : '--', 'text-violet-300')}
            {stat('Viento máximo', (s!.gust_max ?? s!.wind_max) ? `${u.wind((s!.gust_max ?? s!.wind_max)!.value)} ${u.windU}` : '--', 'text-emerald-300')}
            {stat('Días lluviosos', String(s!.rain_days ?? 0), 'text-blue-300')}
          </div>

          {/* Gráficas por tema (mismas que el modelo; hover para ver valores) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LineCard title="Temperatura" unit={u.tempU} series={[
              { key: 'max', name: 'Máxima', color: '#f97316' },
              { key: 'prom', name: 'Promedio', color: '#94a3b8' },
              { key: 'min', name: 'Mínima', color: '#38bdf8' },
            ]} />
            <LineCard title="Viento" unit={u.windU} series={[
              { key: 'vmed', name: 'Viento medio', color: '#38bdf8' },
              { key: 'vmax', name: 'Viento máximo', color: '#f97316' },
            ]} />

            {/* Humedad y punto de rocío (doble eje) */}
            <div className="card">
              <p className="card-title">Humedad y punto de rocío</p>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={12} />
                    <YAxis yAxisId="h" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
                    <YAxis yAxisId="d" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
                    <Tooltip cursor={lineCursor} {...tipCommon} formatter={(v: number, n: string) => [n === 'Humedad' ? `${nf(v)} %` : `${nf(v)} ${u.tempU}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Line yAxisId="h" type="monotone" dataKey="hum" name="Humedad" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="d" type="monotone" dataKey="dew" name="Punto de rocío" stroke="#22d3ee" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Radiación UV y solar (doble eje) */}
            <div className="card">
              <p className="card-title">Radiación UV y solar</p>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={12} />
                    <YAxis yAxisId="s" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
                    <YAxis yAxisId="u" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={30} />
                    <Tooltip cursor={lineCursor} {...tipCommon} formatter={(v: number, n: string) => [n === 'Radiación solar' ? `${nf(v)} W/m²` : `${nf(v)}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Line yAxisId="s" type="monotone" dataKey="solar" name="Radiación solar" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="u" type="monotone" dataKey="uv" name="Índice UV" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Precipitación y presión (doble eje) */}
            <div className="card lg:col-span-2">
              <div className="flex items-center justify-between">
                <p className="card-title mb-0">Precipitación y presión</p>
                <button onClick={downloadCsv} className="px-3 py-1 rounded-lg text-xs bg-white/5 text-slate-300 hover:bg-white/10">⬇ CSV</button>
              </div>
              <div className="h-64 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={12} />
                    <YAxis yAxisId="r" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
                    <YAxis yAxisId="p" orientation="right" domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} {...tipCommon} formatter={(v: number, n: string) => [n === 'Presión' ? `${nf(v)} ${u.pressU}` : `${nf(v)} ${u.rainU}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Bar yAxisId="r" dataKey="lluvia" name="Precipitación" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="p" type="monotone" dataKey="pprom" name="Presión" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Tabla diaria */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[520px] tabular-nums">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-white/10">
                  <th className="text-left py-1.5">Día</th>
                  <th className="text-right">Máx</th><th className="text-right">Mín</th><th className="text-right">Prom</th>
                  <th className="text-right">Humedad</th><th className="text-right">Lluvia</th><th className="text-right">Viento máx</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date} onClick={() => setDetailDate(d.date)}
                    className="border-b border-white/5 cursor-pointer hover:bg-white/5">
                    <td className="py-1.5 text-slate-300">{d.date.slice(8)} ›</td>
                    <td className="text-right text-orange-300">{d.high != null ? u.temp(d.high) : '--'}</td>
                    <td className="text-right text-sky-300">{d.low != null ? u.temp(d.low) : '--'}</td>
                    <td className="text-right">{d.mean_temp != null ? u.temp(d.mean_temp) : '--'}</td>
                    <td className="text-right text-cyan-300">{d.hum_avg != null ? `${Math.round(d.hum_avg)}%` : '--'}</td>
                    <td className="text-right text-blue-300">{d.rain != null ? u.rain(d.rain) : '--'}</td>
                    <td className="text-right text-emerald-300">{d.gust_max != null ? u.wind(d.gust_max) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-xs text-slate-500">Datos de la estación (InfluxDB) · temperaturas en {u.tempU}. Pasa el cursor sobre las gráficas para ver los valores de cada día.</p>
    </div>
  )
}
