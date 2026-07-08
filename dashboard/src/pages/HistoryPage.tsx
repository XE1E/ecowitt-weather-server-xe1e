import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { HistoryData } from '../types'
import { useUnits } from '../units'

type Period = '24h' | '7d' | '30d'
type MetricKey = 'temp' | 'humidity' | 'wind' | 'pressure' | 'rain'

const PERIODS: { k: Period; label: string; start: string }[] = [
  { k: '24h', label: '24 h', start: '-24h' },
  { k: '7d', label: '7 días', start: '-7d' },
  { k: '30d', label: '30 días', start: '-30d' },
]

const REFRESH = 5 * 60000 // 5 min

export function HistoryPage() {
  const u = useUnits()
  const [period, setPeriod] = useState<Period>('24h')
  const [metric, setMetric] = useState<MetricKey>('temp')
  const [rows, setRows] = useState<HistoryData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const start = PERIODS.find((p) => p.k === period)!.start
    let cancelled = false
    const load = () => {
      fetch(`/api/history?start=${start}`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((j) => {
          if (!cancelled) {
            setRows(j.data ?? [])
            setLoading(false)
          }
        })
        .catch(() => !cancelled && setLoading(false))
    }
    setLoading(true)
    load()
    const i = setInterval(load, REFRESH)
    return () => {
      cancelled = true
      clearInterval(i)
    }
  }, [period])

  const metrics: Record<
    MetricKey,
    { label: string; field: keyof HistoryData; unit: string; color: string; conv: (v: number) => number }
  > = {
    temp: { label: 'Temperatura', field: 'temperature_outdoor', unit: u.tempU, color: '#f97316', conv: u.tempN },
    humidity: { label: 'Humedad', field: 'humidity_outdoor', unit: '%', color: '#38bdf8', conv: (v) => v },
    wind: { label: 'Viento', field: 'wind_speed', unit: u.windU, color: '#34d399', conv: u.windN },
    pressure: { label: 'Presión', field: 'pressure_relative', unit: u.pressU, color: '#a78bfa', conv: u.pressN },
    rain: { label: 'Lluvia', field: 'rain_rate', unit: u.rateU, color: '#60a5fa', conv: (v) => (u.system === 'imperial' ? v / 25.4 : v) },
  }
  const m = metrics[metric]
  const longRange = period !== '24h'
  const isRain = metric === 'rain'

  const data = rows
    .filter((r) => r[m.field] !== undefined)
    .map((r) => ({
      label: new Date(r._time).toLocaleString('es-MX', longRange
        ? { day: '2-digit', month: '2-digit', hour: '2-digit' }
        : { hour: '2-digit', minute: '2-digit' }),
      v: m.conv(r[m.field] as number),
    }))

  // Lluvia: acumulado diario (máx de rain_daily por día) en barras
  const rainByDay: Record<string, number> = {}
  if (isRain) {
    for (const r of rows) {
      if (r.rain_daily == null) continue
      const day = new Date(r._time).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
      rainByDay[day] = Math.max(rainByDay[day] ?? 0, r.rain_daily as number)
    }
  }
  const rainBars = Object.entries(rainByDay).map(([label, mm]) => ({
    label,
    v: u.system === 'imperial' ? mm / 25.4 : mm,
  }))
  const rainUnit = u.system === 'imperial' ? 'in' : 'mm'

  const downloadCsv = () => {
    if (rows.length === 0) return
    const cols = ['_time', 'temperature_outdoor', 'humidity_outdoor', 'wind_speed', 'wind_gust', 'pressure_relative', 'rain_rate', 'rain_daily']
    const header = cols.join(',')
    const body = rows.map((r) => cols.map((c) => {
      const v = (r as unknown as Record<string, unknown>)[c]
      return v == null ? '' : v
    }).join(','))
    const csv = [header, ...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `historia_xe1e_${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const btn = (active: boolean) =>
    `px-3 py-1 rounded-lg text-sm transition ${
      active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
    }`

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-300 mb-3">Historia</h2>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(metrics) as MetricKey[]).map((k) => (
            <button key={k} className={btn(metric === k)} onClick={() => setMetric(k)}>
              {metrics[k].label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 items-center">
          {PERIODS.map((p) => (
            <button key={p.k} className={btn(period === p.k)} onClick={() => setPeriod(p.k)}>
              {p.label}
            </button>
          ))}
          <button
            onClick={downloadCsv}
            title="Descargar CSV del periodo"
            className="ml-2 px-3 py-1 rounded-lg text-sm bg-white/5 text-slate-300 hover:bg-white/10 transition"
          >
            ⬇ CSV
          </button>
        </div>
      </div>

      <div className="card">
        <p className="card-title">
          {isRain
            ? `Lluvia acumulada diaria (${rainUnit}) — últimas ${PERIODS.find((p) => p.k === period)!.label}`
            : `${m.label} (${m.unit}) — últimas ${PERIODS.find((p) => p.k === period)!.label}`}
        </p>
        {loading ? (
          <div className="h-80 flex items-center justify-center text-slate-400">Cargando…</div>
        ) : (isRain ? rainBars.length === 0 : data.length === 0) ? (
          <div className="h-80 flex items-center justify-center text-slate-400">
            No hay datos para este periodo
          </div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              {isRain ? (
                <BarChart data={rainBars} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(val: number) => [`${val.toFixed(1)} ${rainUnit}`, 'Lluvia']}
                  />
                  <Bar dataKey="v" fill="#60a5fa" radius={[3, 3, 0, 0]} name="Lluvia" />
                </BarChart>
              ) : (
                <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(val: number) => [`${val.toFixed(1)} ${m.unit}`, m.label]}
                  />
                  <Line type="monotone" dataKey="v" stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-2">Datos de la estación almacenados en InfluxDB.</p>
    </div>
  )
}
