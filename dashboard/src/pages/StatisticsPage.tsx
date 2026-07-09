import { useState, useEffect } from 'react'
import { WeatherIcon } from '../components/WeatherIcon'
import { WindRoseCard } from '../components/station/WindRoseCard'
import { useUnits } from '../units'

interface Stat {
  min: number | null
  max: number | null
  avg: number | null
  min_time?: string | null
  max_time?: string | null
}
type Stats = Record<string, Stat>

function fmtWhen(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const PERIODS = [
  { k: '7d', label: '7 días', start: '-7d' },
  { k: '30d', label: '30 días', start: '-30d' },
  { k: 'year', label: 'Año', start: '-365d' },
  { k: 'all', label: 'Histórico', start: '-3650d' },
]

interface ClimateRecord {
  value: number
  date: string
}
interface AllTime {
  temp_max?: ClimateRecord | null
  temp_min?: ClimateRecord | null
  gust_max?: ClimateRecord | null
  rain_max_day?: ClimateRecord | null
  press_max?: ClimateRecord | null
  press_min?: ClimateRecord | null
  days: number
}

function fmtDay(date?: string): string {
  if (!date) return ''
  const d = new Date(date + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function StatisticsPage() {
  const u = useUnits()
  const [period, setPeriod] = useState('30d')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [allTime, setAllTime] = useState<AllTime | null>(null)

  useEffect(() => {
    fetch('/api/climate/records')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setAllTime(j?.all_time ?? null))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const start = PERIODS.find((p) => p.k === period)!.start
    let cancelled = false
    setLoading(true)
    fetch(`/api/stats/records?start=${start}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) {
          setStats(j?.stats ?? null)
          setLoading(false)
        }
      })
      .catch(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [period])

  const metrics: { key: string; label: string; icon: string; unit: string; color: string; fmt: (v: number) => string }[] = [
    { key: 'temperature_outdoor', label: 'Temperatura', icon: 'thermometer', unit: u.tempU, color: 'text-orange-300', fmt: (v) => u.temp(v) },
    { key: 'humidity_outdoor', label: 'Humedad', icon: 'humidity', unit: '%', color: 'text-sky-300', fmt: (v) => v.toFixed(0) },
    { key: 'wind_speed', label: 'Viento', icon: 'windsock', unit: u.windU, color: 'text-emerald-300', fmt: (v) => u.wind(v) },
    { key: 'wind_gust', label: 'Ráfaga', icon: 'windsock', unit: u.windU, color: 'text-emerald-300', fmt: (v) => u.wind(v) },
    { key: 'pressure_relative', label: 'Presión', icon: 'barometer', unit: u.pressU, color: 'text-violet-300', fmt: (v) => u.press(v) },
    { key: 'rain_daily', label: 'Lluvia diaria', icon: 'raindrops', unit: u.rainU, color: 'text-blue-300', fmt: (v) => u.rain(v) },
  ]

  const btn = (active: boolean) =>
    `px-3 py-1 rounded-lg text-sm transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  const available = stats ? metrics.filter((m) => stats[m.key]) : []

  const records: { label: string; rec?: ClimateRecord | null; color: string; fmt: (v: number) => string; unit: string }[] = [
    { label: 'Temperatura máxima', rec: allTime?.temp_max, color: 'text-orange-300', fmt: (v) => u.temp(v), unit: u.tempU },
    { label: 'Temperatura mínima', rec: allTime?.temp_min, color: 'text-sky-300', fmt: (v) => u.temp(v), unit: u.tempU },
    { label: 'Ráfaga máxima', rec: allTime?.gust_max, color: 'text-emerald-300', fmt: (v) => u.wind(v), unit: u.windU },
    { label: 'Día más lluvioso', rec: allTime?.rain_max_day, color: 'text-blue-300', fmt: (v) => u.rain(v), unit: u.rainU },
    { label: 'Presión máxima', rec: allTime?.press_max, color: 'text-violet-300', fmt: (v) => u.press(v), unit: u.pressU },
    { label: 'Presión mínima', rec: allTime?.press_min, color: 'text-violet-300', fmt: (v) => u.press(v), unit: u.pressU },
  ]

  return (
    <div>
      {allTime && allTime.days > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-300 mb-3">
            Récords de siempre <span className="text-xs text-slate-500 font-normal">({allTime.days} días registrados)</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {records.filter((r) => r.rec).map((r) => (
              <div key={r.label} className="card">
                <p className="text-xs text-slate-400">{r.label}</p>
                <p className={`text-2xl font-bold ${r.color}`}>{r.fmt(r.rec!.value)}<span className="text-sm text-slate-500 ml-1">{r.unit}</span></p>
                <p className="text-[11px] text-slate-500 mt-0.5">{fmtDay(r.rec!.date)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold text-slate-300">Estadísticas por periodo</h2>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p.k} className={btn(period === p.k)} onClick={() => setPeriod(p.k)}>
              {p.label}
            </button>
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
                <p className="card-title">
                  <WeatherIcon name={m.icon} size={20} /> {m.label}
                </p>
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
    </div>
  )
}
