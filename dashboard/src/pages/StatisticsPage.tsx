import { useState, useEffect } from 'react'
import { BarChart3 } from 'lucide-react'
import { WeatherIcon } from '../components/WeatherIcon'
import { WindRoseCard } from '../components/station/WindRoseCard'
import { HistoricalRecords } from '../components/station/HistoricalRecords'
import { PageInfo } from '../components/station/PageInfo'
import { useUnits } from '../units'

interface Stat {
  min: number | null
  max: number | null
  avg: number | null
  min_time?: string | null
  max_time?: string | null
}
type Stats = Record<string, Stat>

interface Rec {
  value: number
  date: string
}
interface MonthRow {
  month: number
  mean_temp?: number | null
  high?: Rec | null
  low?: Rec | null
  rain_total?: number
  rain_days?: number
  gust_max?: Rec | null
}
interface YearSummary {
  days: number
  mean_temp?: number | null
  high?: Rec | null
  low?: Rec | null
  rain_total?: number
  rain_days?: number
  gust_max?: Rec | null
  hdd?: number
  cdd?: number
  et_total?: number | null
}
interface Season {
  warm_days: number
  cool_nights: number
  rain_days: number
  dry_days: number
  warm_threshold: number
  cool_threshold: number
}
interface NoaaYear {
  year: number
  months: MonthRow[]
  summary: YearSummary
  season: Season
}
const MES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const PERIODS = [
  { k: '7d', label: '7 días', start: '-7d' },
  { k: '30d', label: '30 días', start: '-30d' },
  { k: 'year', label: 'Año', start: '-365d' },
  { k: 'all', label: 'Histórico', start: '-3650d' },
]

const NOW_YEAR = new Date().getFullYear()
const YEARS: number[] = []
for (let y = NOW_YEAR; y >= 2026; y--) YEARS.push(y)

function fmtWhen(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtDay(date?: string): string {
  if (!date) return ''
  const d = new Date(date + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function StatisticsPage() {
  const u = useUnits()
  const [year, setYear] = useState(NOW_YEAR)
  const [noaa, setNoaa] = useState<NoaaYear | null>(null)
  const [period, setPeriod] = useState('30d')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  // Reporte anual (resumen, meses, season tracker)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/climate/noaa?year=${year}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setNoaa(j) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [year])

  // Estadísticas por periodo
  useEffect(() => {
    const start = PERIODS.find((p) => p.k === period)!.start
    let cancelled = false
    setLoading(true)
    fetch(`/api/stats/records?start=${start}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) { setStats(j?.stats ?? null); setLoading(false) } })
      .catch(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [period])

  const btn = (active: boolean) =>
    `px-3 py-1 rounded-lg text-sm transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  const sum = noaa?.summary
  const hasYear = !!sum && sum.days > 0

  const metrics: { key: string; label: string; icon: string; unit: string; color: string; fmt: (v: number) => string }[] = [
    { key: 'temperature_outdoor', label: 'Temperatura', icon: 'thermometer', unit: u.tempU, color: 'text-orange-300', fmt: (v) => u.temp(v) },
    { key: 'humidity_outdoor', label: 'Humedad', icon: 'humidity', unit: '%', color: 'text-sky-300', fmt: (v) => v.toFixed(0) },
    { key: 'wind_speed', label: 'Viento', icon: 'windsock', unit: u.windU, color: 'text-emerald-300', fmt: (v) => u.wind(v) },
    { key: 'wind_gust', label: 'Ráfaga', icon: 'windsock', unit: u.windU, color: 'text-emerald-300', fmt: (v) => u.wind(v) },
    { key: 'pressure_relative', label: 'Presión', icon: 'barometer', unit: u.pressU, color: 'text-violet-300', fmt: (v) => u.press(v) },
    { key: 'rain_daily', label: 'Lluvia diaria', icon: 'raindrops', unit: u.rainU, color: 'text-blue-300', fmt: (v) => u.rain(v) },
  ]
  const available = stats ? metrics.filter((m) => stats[m.key]) : []

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><BarChart3 className="w-6 h-6 text-sky-400" /> Estadísticas y récords</h2>
          <p className="text-xs text-slate-400">Resumen del año, récords de siempre y estadísticas por periodo.</p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="bg-white/5 border border-white/10 rounded-lg text-sm px-3 py-1.5 text-slate-200"
        >
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* ── Resumen del año ── */}
      <h3 className="text-lg font-semibold text-slate-300 mb-3">Resumen de {year}</h3>
      {!hasYear ? (
        <div className="card text-slate-400 mb-6">Sin datos para {year} todavía.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <SummaryCard label="Temp. media" color="text-slate-200" value={sum!.mean_temp != null ? `${u.temp(sum!.mean_temp)}` : '--'} unit={u.tempU} />
          <SummaryCard label="Temp. máxima" color="text-orange-300" value={sum!.high ? `${u.temp(sum!.high.value)}` : '--'} unit={u.tempU} note={sum!.high ? fmtDay(sum!.high.date) : ''} />
          <SummaryCard label="Temp. mínima" color="text-sky-300" value={sum!.low ? `${u.temp(sum!.low.value)}` : '--'} unit={u.tempU} note={sum!.low ? fmtDay(sum!.low.date) : ''} />
          <SummaryCard label="Precipitación" color="text-blue-300" value={sum!.rain_total != null ? `${u.rain(sum!.rain_total)}` : '--'} unit={u.rainU} />
          <SummaryCard label="Días de lluvia" color="text-cyan-300" value={`${sum!.rain_days ?? 0}`} unit="días" />
          <SummaryCard label="Ráfaga máxima" color="text-emerald-300" value={sum!.gust_max ? `${u.wind(sum!.gust_max.value)}` : '--'} unit={u.windU} note={sum!.gust_max ? fmtDay(sum!.gust_max.date) : ''} />
        </div>
      )}

      {/* ── Promedios mensuales ── */}
      {hasYear && noaa!.months.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-300 mb-3">Promedios mensuales</h3>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-slate-400 border-b border-white/10 text-left">
                  <th className="py-2 pr-3 font-medium">Mes</th>
                  <th className="py-2 px-3 font-medium text-right">T. media</th>
                  <th className="py-2 px-3 font-medium text-right">T. máx</th>
                  <th className="py-2 px-3 font-medium text-right">T. mín</th>
                  <th className="py-2 px-3 font-medium text-right">Lluvia</th>
                  <th className="py-2 px-3 font-medium text-right">Días lluvia</th>
                  <th className="py-2 pl-3 font-medium text-right">Ráfaga máx</th>
                </tr>
              </thead>
              <tbody>
                {noaa!.months.map((m) => (
                  <tr key={m.month} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-slate-300 font-medium">{MES_ABR[m.month - 1]}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{m.mean_temp != null ? u.temp(m.mean_temp) : '--'}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-orange-300">{m.high ? u.temp(m.high.value) : '--'}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-sky-300">{m.low ? u.temp(m.low.value) : '--'}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-blue-300">{m.rain_total != null ? u.rain(m.rain_total) : '--'}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{m.rain_days ?? 0}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-emerald-300">{m.gust_max ? u.wind(m.gust_max.value) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Contadores de días (season tracker) ── */}
      {hasYear && noaa!.season && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-300 mb-3">Contadores de días · {year}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label={`Días cálidos (máx ≥ ${u.temp(noaa!.season.warm_threshold)}${u.tempU})`} color="text-orange-300" value={`${noaa!.season.warm_days}`} unit="días" />
            <SummaryCard label={`Noches frescas (mín ≤ ${u.temp(noaa!.season.cool_threshold)}${u.tempU})`} color="text-sky-300" value={`${noaa!.season.cool_nights}`} unit="días" />
            <SummaryCard label="Días de lluvia" color="text-blue-300" value={`${noaa!.season.rain_days}`} unit="días" />
            <SummaryCard label="Días secos" color="text-amber-300" value={`${noaa!.season.dry_days}`} unit="días" />
          </div>
        </div>
      )}

      {/* ── Grados-día y evapotranspiración ── */}
      {hasYear && (sum!.cdd != null || sum!.hdd != null || sum!.et_total != null) && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-300 mb-3">Grados-día y evapotranspiración · {year}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryCard label="Grados-día de enfriamiento" color="text-orange-300" value={sum!.cdd != null ? sum!.cdd.toFixed(0) : '--'} unit="°C·día" />
            <SummaryCard label="Grados-día de calefacción" color="text-sky-300" value={sum!.hdd != null ? sum!.hdd.toFixed(0) : '--'} unit="°C·día" />
            <SummaryCard label="Evapotranspiración (ET₀)" color="text-emerald-300" value={sum!.et_total != null ? sum!.et_total.toFixed(0) : '--'} unit="mm" />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Grados-día con base 18.3 °C (estándar NOAA): acumulan cuánto y por cuánto tiempo la temperatura
            media supera (enfriamiento) o queda por debajo (calefacción) de esa base. ET₀ estimada por Hargreaves.
          </p>
        </div>
      )}

      {/* ── Récords históricos ── */}
      <div className="mb-6">
        <HistoricalRecords />
      </div>

      {/* ── Estadísticas por periodo ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="text-lg font-semibold text-slate-300">Estadísticas por periodo</h3>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p.k} className={btn(period === p.k)} onClick={() => setPeriod(p.k)}>{p.label}</button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="h-40 flex items-center justify-center text-slate-400">Cargando…</div>
      ) : available.length === 0 ? (
        <div className="card text-slate-400">No hay datos para este periodo todavía.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {available.map((m) => {
            const s = stats![m.key]
            return (
              <div key={m.key} className="card">
                <p className="card-title"><WeatherIcon name={m.icon} size={20} /> {m.label}</p>
                <div className="flex items-end justify-between">
                  <div>
                    <p className={`text-3xl font-bold ${m.color}`}>{s.avg != null ? m.fmt(s.avg) : '--'}</p>
                    <p className="text-xs text-slate-500">promedio {m.unit}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-red-300">▲ máx {s.max != null ? `${m.fmt(s.max)} ${m.unit}` : '--'}</p>
                    {fmtWhen(s.max_time) && <p className="text-[10px] text-slate-500 -mt-0.5">{fmtWhen(s.max_time)}</p>}
                    <p className="text-sky-300 mt-1">▼ mín {s.min != null ? `${m.fmt(s.min)} ${m.unit}` : '--'}</p>
                    {fmtWhen(s.min_time) && <p className="text-[10px] text-slate-500 -mt-0.5">{fmtWhen(s.min_time)}</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-xs text-slate-500 mt-3">Calculado desde el histórico de la estación (InfluxDB).</p>

      <div className="mt-6">
        <WindRoseCard />
      </div>

      <PageInfo>
        <p>
          Aquí se resume todo el dato de tu estación: el <span className="font-semibold">resumen del año</span>
          {' '}(máximas, mínimas, lluvia y ráfaga), los <span className="font-semibold">promedios mensuales</span>,
          {' '}<span className="font-semibold">contadores de días</span> (cálidos, noches frescas, con y sin lluvia),
          los <span className="font-semibold">grados-día</span> y la <span className="font-semibold">evapotranspiración</span>,
          los <span className="font-semibold">récords históricos</span> por categoría (con su top 5 y fecha), las
          {' '}estadísticas por periodo y la <span className="font-semibold">rosa de vientos</span>. Los grados-día miden
          cuánto y por cuánto tiempo la temperatura se aleja de los 18.3 °C (base NOAA), útil para energía y agricultura.
        </p>
      </PageInfo>
    </div>
  )
}

function SummaryCard({ label, value, unit, color, note }: { label: string; value: string; unit?: string; color: string; note?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}{unit && <span className="text-sm text-slate-500 ml-1">{unit}</span>}</p>
      {note && <p className="text-[11px] text-slate-500 mt-0.5">{note}</p>}
    </div>
  )
}

