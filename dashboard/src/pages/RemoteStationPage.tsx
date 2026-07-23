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
import { WeatherIcon } from '../components/WeatherIcon'
import { TrendBadge } from '../components/station/TrendBadge'
import { useUnits } from '../units'
import { relativeTime, isStale } from '../weather'
import {
  REMOTE_STATION, REMOTE_LABEL, RemoteHistRow, dewPointC, trendOver,
  tempDeltaDisp, pressDeltaDisp,
} from '../remote'

const REFRESH = 60000 // 1 min, como el resto del dashboard

type Period = '24h' | '7d' | '30d'
const PERIODS: { key: Period; label: string; start: string }[] = [
  { key: '24h', label: '24 h', start: '-24h' },
  { key: '7d', label: '7 d', start: '-7d' },
  { key: '30d', label: '30 d', start: '-30d' },
]

type ChartMetric = 'th' | 'pressure'

interface ChartPoint {
  t: number
  temp: number | null
  humidity: number | null
  pressure: number | null
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
  const [history, setHistory] = useState<RemoteHistRow[]>([])
  const [period, setPeriod] = useState<Period>('24h')
  const [metric, setMetric] = useState<ChartMetric>('th')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const start = PERIODS.find((p) => p.key === period)!.start

  const load = useCallback(async () => {
    try {
      const [cur, st, hist] = await Promise.all([
        fetch(`/api/current?station=${REMOTE_STATION}`),
        fetch(`/api/stats/daily?station=${REMOTE_STATION}&start=${start}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/history?start=${start}&station=${REMOTE_STATION}`).then((r) => (r.ok ? r.json() : { data: [] })),
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
  const fmtTick = (t: number) => new Date(t).toLocaleString('es-MX', longRange
    ? { day: '2-digit', month: '2-digit', hour: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' })
  const chart: ChartPoint[] = history
    .map((r) => {
      const rt = r.temperature_outdoor ?? r.temperature_indoor
      const rh = r.humidity_outdoor ?? r.humidity_indoor
      return {
        t: new Date(r._time).getTime(),
        temp: rt != null ? Number(u.tempN(rt).toFixed(1)) : null,
        humidity: rh ?? null,
        pressure: r.pressure_relative != null ? Number(u.pressN(r.pressure_relative).toFixed(u.system === 'imperial' ? 2 : 1)) : null,
      }
    })
    .sort((a, b) => a.t - b.t)

  const offline = data?.received_at ? isStale(data.received_at) : false
  const s = stats ?? {}

  const t = data?.temperature_outdoor ?? data?.temperature_indoor
  const h = data?.humidity_outdoor ?? data?.humidity_indoor
  const dew = dewPointC(t, h)

  // Tendencias (últimas ~3 h) en unidades métricas -> se convierten para mostrar.
  // Prefiere exterior; cae a interior si la estación no está "a la intemperie".
  const tempTrendC = trendOver(history, 'temperature_outdoor', 3) ?? trendOver(history, 'temperature_indoor', 3)
  const pressTrend = trendOver(history, 'pressure_relative', 3)
  const tempDelta = tempTrendC == null ? null : tempDeltaDisp(u.system, tempTrendC)
  const pressDelta = pressTrend == null ? null : pressDeltaDisp(u.system, pressTrend)

  const periodLabel = PERIODS.find((p) => p.key === period)!.label

  const periodBtns = (
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
  )

  return (
    <div>
      {/* Encabezado de la página */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold">{REMOTE_LABEL}</h2>
          <p className="text-sm text-slate-400">Solo lectura · sin alertas.</p>
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
            No se han recibido lecturas de la estación <code>{REMOTE_STATION}</code>. Verifica que esté
            configurada (Customized → Ecowitt → path <code>/data/report</code>) apuntando a este
            servidor, y que su passkey esté en <code>SECONDARY_STATIONS</code>.
          </p>
        </div>
      ) : (
        <>
          {/* Condiciones actuales */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 items-start">
            <div className="card">
              <p className="card-title">Condiciones actuales</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                  <WeatherIcon name="thermometer" size={34} />
                  <p className="text-2xl font-bold text-amber-300 mt-1">{t != null ? `${u.temp(t)}${u.tempU}` : '--'}</p>
                  <p className="text-xs text-slate-400">Temperatura</p>
                  <TrendBadge delta={tempDelta} unit={u.tempU} threshold={0.2} />
                </div>
                <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                  <WeatherIcon name="humidity" size={34} />
                  <p className="text-2xl font-bold text-cyan-300 mt-1">{h != null ? `${Math.round(h)}%` : '--'}</p>
                  <p className="text-xs text-slate-400">Humedad</p>
                </div>
                <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                  <WeatherIcon name="thermometer" size={34} />
                  <p className="text-2xl font-bold text-emerald-300 mt-1">{dew != null ? `${u.temp(dew)}${u.tempU}` : '--'}</p>
                  <p className="text-xs text-slate-400">Punto de rocío</p>
                </div>
              </div>
            </div>
            <div className="card">
              <p className="card-title">Presión</p>
              <div className="rounded-lg bg-white/5 px-3 py-3 flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-violet-300">
                    {data?.pressure_relative != null ? `${u.press(data.pressure_relative)}` : '--'}
                    <span className="text-base font-normal text-slate-400"> {u.pressU}</span>
                  </p>
                  <p className="text-xs text-slate-400">Relativa</p>
                </div>
                <TrendBadge delta={pressDelta} unit={u.pressU} threshold={u.system === 'imperial' ? 0.02 : 0.3} />
              </div>
            </div>
          </div>

          {/* Estadística del periodo */}
          <div className="card mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="card-title mb-0">Estadística ({periodLabel})</p>
              {periodBtns}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <StatTile
                label="Temperatura"
                min={(s.temperature_outdoor ?? s.temperature_indoor)?.min ?? null}
                avg={(s.temperature_outdoor ?? s.temperature_indoor)?.avg ?? null}
                max={(s.temperature_outdoor ?? s.temperature_indoor)?.max ?? null}
                unit={u.tempU}
              />
              <StatTile
                label="Humedad"
                min={(s.humidity_outdoor ?? s.humidity_indoor)?.min ?? null}
                avg={(s.humidity_outdoor ?? s.humidity_indoor)?.avg ?? null}
                max={(s.humidity_outdoor ?? s.humidity_indoor)?.max ?? null}
                unit="%"
              />
              <StatTile
                label="Presión"
                min={s.pressure_relative?.min ?? null}
                avg={s.pressure_relative?.avg ?? null}
                max={s.pressure_relative?.max ?? null}
                unit={` ${u.pressU}`}
              />
            </div>
          </div>

          {/* Histórico */}
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex gap-1">
                <button
                  onClick={() => setMetric('th')}
                  className={`px-3 py-1 rounded-lg text-sm transition ${
                    metric === 'th' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  Temp y humedad
                </button>
                <button
                  onClick={() => setMetric('pressure')}
                  className={`px-3 py-1 rounded-lg text-sm transition ${
                    metric === 'pressure' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  Presión
                </button>
              </div>
              {periodBtns}
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
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} minTickGap={40} />
                    {metric === 'th' ? (
                      <>
                        <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={u.tempU} />
                        <YAxis yAxisId="humidity" orientation="right" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={[0, 100]} unit="%" />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} labelFormatter={(l) => fmtTick(Number(l))} />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#f59e0b" strokeWidth={2} dot={false} name={`Temperatura (${u.tempU})`} />
                        <Line yAxisId="humidity" type="monotone" dataKey="humidity" stroke="#38bdf8" strokeWidth={2} dot={false} name="Humedad (%)" />
                      </>
                    ) : (
                      <>
                        <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={` ${u.pressU}`} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} labelFormatter={(l) => fmtTick(Number(l))} />
                        <Legend />
                        <Line type="monotone" dataKey="pressure" stroke="#a78bfa" strokeWidth={2} dot={false} name={`Presión (${u.pressU})`} />
                      </>
                    )}
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
