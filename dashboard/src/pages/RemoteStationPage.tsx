import { useState, useEffect, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { RefreshCw } from 'lucide-react'
import { WeatherData, DailyStats } from '../types'
import { InteriorCard } from '../components/station/InteriorCard'
import { useUnits } from '../units'
import { relativeTime, isStale } from '../weather'

// Estación secundaria (GW1100). Debe coincidir con el nombre configurado en
// SECONDARY_STATIONS del backend (p. ej. "<passkey>:gw1100").
const STATION = 'gw1100'
const STATION_LABEL = 'Estación remota · GW1100 (interior)'
const REFRESH = 60000 // 1 min, como el resto del dashboard

type Period = '24h' | '7d' | '30d'
const PERIODS: { key: Period; label: string; start: string }[] = [
  { key: '24h', label: '24 h', start: '-24h' },
  { key: '7d', label: '7 d', start: '-7d' },
  { key: '30d', label: '30 d', start: '-30d' },
]

interface HistRow {
  _time: string
  temperature_indoor?: number
  humidity_indoor?: number
  pressure_relative?: number
}

interface ChartPoint {
  time: string
  temp: number | null
  humidity: number | null
}

function StatTile({ label, min, avg, max, unit }: {
  label: string
  min: number | null
  avg: number | null
  max: number | null
  unit: string
}) {
  const fmt = (v: number | null) => (v == null ? '--' : v)
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <div className="flex items-baseline gap-3 text-sm">
        <span className="text-sky-300">mín {fmt(min)}{unit}</span>
        <span className="font-semibold">prom {fmt(avg)}{unit}</span>
        <span className="text-amber-300">máx {fmt(max)}{unit}</span>
      </div>
    </div>
  )
}

export function RemoteStationPage() {
  const u = useUnits()
  const [data, setData] = useState<WeatherData | null>(null)
  const [stats, setStats] = useState<DailyStats['stats'] | null>(null)
  const [history, setHistory] = useState<HistRow[]>([])
  const [period, setPeriod] = useState<Period>('24h')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const start = PERIODS.find((p) => p.key === period)!.start

  const load = useCallback(async () => {
    try {
      const [cur, st, hist] = await Promise.all([
        fetch(`/api/current?station=${STATION}`),
        fetch(`/api/stats/daily?station=${STATION}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/history?start=${start}&station=${STATION}`).then((r) => (r.ok ? r.json() : { data: [] })),
      ])
      if (cur.ok) {
        setData(await cur.json())
        setNotFound(false)
      } else if (cur.status === 404) {
        setData(null)
        setNotFound(true)
      }
      setStats(st?.stats ?? null)
      setHistory(hist?.data ?? [])
    } catch {
      /* best-effort */
    } finally {
      setLoading(false)
    }
  }, [start])

  useEffect(() => {
    setLoading(true)
    load()
    const i = setInterval(load, REFRESH)
    return () => clearInterval(i)
  }, [load])

  const longRange = period !== '24h'
  const chart: ChartPoint[] = history.map((r) => ({
    time: new Date(r._time).toLocaleString('es-MX', longRange
      ? { day: '2-digit', month: '2-digit', hour: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' }),
    temp: r.temperature_indoor != null ? Number(u.tempN(r.temperature_indoor).toFixed(1)) : null,
    humidity: r.humidity_indoor ?? null,
  }))

  const offline = data?.received_at ? isStale(data.received_at) : false
  const s = stats ?? {}

  return (
    <div>
      {/* Encabezado de la página */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold">{STATION_LABEL}</h2>
          <p className="text-sm text-slate-400">
            Solo lectura · sensor interconstruido (temperatura, humedad y presión). Sin alertas.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          {data && (
            <>
              <span className={`badge ${offline ? 'badge-offline' : 'badge-live'}`}>
                {offline ? 'sin conexión' : 'en vivo'}
              </span>
              <span>Actualizado {relativeTime(data.received_at)}</span>
            </>
          )}
          <button onClick={load} className="text-blue-400 hover:text-blue-300" title="Refrescar">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading && !data && !notFound ? (
        <div className="h-64 flex items-center justify-center text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
        </div>
      ) : notFound ? (
        <div className="card">
          <p className="card-title">Sin datos todavía</p>
          <p className="text-sm text-slate-400">
            No se han recibido lecturas de la estación <code>{STATION}</code>. Verifica que el GW1100
            esté configurado (Customized → Ecowitt → path <code>/data/report</code>) apuntando a este
            servidor, y que su passkey esté en <code>SECONDARY_STATIONS</code>.
          </p>
        </div>
      ) : (
        <>
          {/* Condiciones actuales */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 items-start">
            {data && <InteriorCard data={data} />}
            <div className="card">
              <p className="card-title">Presión</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/5 px-3 py-2">
                  <p className="text-2xl font-bold text-violet-300">
                    {data?.pressure_relative != null ? `${u.press(data.pressure_relative)}` : '--'}
                    <span className="text-sm font-normal text-slate-400"> {u.pressU}</span>
                  </p>
                  <p className="text-xs text-slate-400">Relativa</p>
                </div>
                <div className="rounded-lg bg-white/5 px-3 py-2">
                  <p className="text-2xl font-bold text-slate-300">
                    {data?.pressure_absolute != null ? `${u.press(data.pressure_absolute)}` : '--'}
                    <span className="text-sm font-normal text-slate-400"> {u.pressU}</span>
                  </p>
                  <p className="text-xs text-slate-400">Absoluta</p>
                </div>
              </div>
            </div>
          </div>

          {/* Estadística del periodo (24 h por defecto para stats/daily) */}
          <div className="card mb-6">
            <p className="card-title">Estadística (24 h)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <StatTile
                label="Temperatura interior"
                min={s.temperature_indoor?.min ?? null}
                avg={s.temperature_indoor?.avg ?? null}
                max={s.temperature_indoor?.max ?? null}
                unit={u.tempU}
              />
              <StatTile
                label="Humedad interior"
                min={s.humidity_indoor?.min ?? null}
                avg={s.humidity_indoor?.avg ?? null}
                max={s.humidity_indoor?.max ?? null}
                unit="%"
              />
            </div>
          </div>

          {/* Histórico */}
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <p className="card-title mb-0">Histórico interior</p>
              <div className="flex gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={`px-3 py-1 rounded-lg text-sm transition ${
                      period === p.key ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {chart.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-slate-400">
                No hay datos históricos disponibles
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={u.tempU} />
                    <YAxis yAxisId="humidity" orientation="right" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={[0, 100]} unit="%" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#f59e0b" strokeWidth={2} dot={false} name={`Temperatura (${u.tempU})`} />
                    <Line yAxisId="humidity" type="monotone" dataKey="humidity" stroke="#38bdf8" strokeWidth={2} dot={false} name="Humedad (%)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
