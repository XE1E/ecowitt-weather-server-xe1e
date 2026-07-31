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

const REFRESH = 60000

type Period = '24h' | '7d' | '30d'
const PERIODS: { key: Period; label: string; start: string }[] = [
  { key: '24h', label: '24 h', start: '-24h' },
  { key: '7d', label: '7 d', start: '-7d' },
  { key: '30d', label: '30 d', start: '-30d' },
]

type ChartMetric = 'outdoor' | 'indoor' | 'pressure'

interface ChartPoint {
  t: number
  tempOut: number | null
  humOut: number | null
  tempIn: number | null
  humIn: number | null
  pressure: number | null
}

function StatTile({ label, min, avg, max, unit }: {
  label: string; min: number | null; avg: number | null; max: number | null; unit: string
}) {
  const fmt = (v: number | null) => (v != null ? v.toFixed(1) : '--')
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
  const [metric, setMetric] = useState<ChartMetric>('outdoor')
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
    .map((r) => ({
      t: new Date(r._time).getTime(),
      tempOut: r.temperature_outdoor != null ? Number(u.tempN(r.temperature_outdoor).toFixed(1)) : null,
      humOut: r.humidity_outdoor ?? null,
      tempIn: r.temperature_indoor != null ? Number(u.tempN(r.temperature_indoor).toFixed(1)) : null,
      humIn: r.humidity_indoor ?? null,
      pressure: r.pressure_relative != null ? Number(u.pressN(r.pressure_relative).toFixed(u.system === 'imperial' ? 2 : 1)) : null,
    }))
    .sort((a, b) => a.t - b.t)

  const offline = data?.received_at ? isStale(data.received_at) : false
  const s = stats ?? {}

  // Exterior (WN32) - puede no existir aún
  const tOut = data?.temperature_outdoor
  const hOut = data?.humidity_outdoor
  const dewOut = dewPointC(tOut, hOut)
  const hasOutdoor = tOut != null || hOut != null

  // Interior (sensor integrado GW1100)
  const tIn = data?.temperature_indoor
  const hIn = data?.humidity_indoor
  const dewIn = dewPointC(tIn, hIn)

  // Tendencias
  const tempOutTrend = trendOver(history, 'temperature_outdoor', 3)
  const tempInTrend = trendOver(history, 'temperature_indoor', 3)
  const pressTrend = trendOver(history, 'pressure_relative', 3)

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
      {/* Encabezado */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold">{REMOTE_LABEL}</h2>
          <p className="text-sm text-slate-400">GW1100 + WN32 (exterior)</p>
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* Exterior (WN32) */}
            <div className="card">
              <p className="card-title flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Exterior (WN32)
              </p>
              {hasOutdoor ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                    <WeatherIcon name="thermometer" size={28} />
                    <p className="text-xl font-bold text-amber-300 mt-1">{tOut != null ? `${u.temp(tOut)}${u.tempU}` : '--'}</p>
                    <p className="text-xs text-slate-400">Temp</p>
                    {tempOutTrend != null && <TrendBadge delta={tempDeltaDisp(u.system, tempOutTrend)} unit={u.tempU} threshold={0.2} />}
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                    <WeatherIcon name="humidity" size={28} />
                    <p className="text-xl font-bold text-cyan-300 mt-1">{hOut != null ? `${Math.round(hOut)}%` : '--'}</p>
                    <p className="text-xs text-slate-400">Humedad</p>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                    <WeatherIcon name="thermometer" size={28} />
                    <p className="text-xl font-bold text-emerald-300 mt-1">{dewOut != null ? `${u.temp(dewOut)}${u.tempU}` : '--'}</p>
                    <p className="text-xs text-slate-400">Rocío</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-slate-500">
                  <p className="text-sm">Sensor WN32 no detectado</p>
                  <p className="text-xs mt-1">Se mostrará cuando esté conectado</p>
                </div>
              )}
            </div>

            {/* Interior (GW1100) */}
            <div className="card">
              <p className="card-title flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                Interior (GW1100)
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                  <WeatherIcon name="thermometer" size={28} />
                  <p className="text-xl font-bold text-amber-300 mt-1">{tIn != null ? `${u.temp(tIn)}${u.tempU}` : '--'}</p>
                  <p className="text-xs text-slate-400">Temp</p>
                  {tempInTrend != null && <TrendBadge delta={tempDeltaDisp(u.system, tempInTrend)} unit={u.tempU} threshold={0.2} />}
                </div>
                <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                  <WeatherIcon name="humidity" size={28} />
                  <p className="text-xl font-bold text-cyan-300 mt-1">{hIn != null ? `${Math.round(hIn)}%` : '--'}</p>
                  <p className="text-xs text-slate-400">Humedad</p>
                </div>
                <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
                  <WeatherIcon name="thermometer" size={28} />
                  <p className="text-xl font-bold text-emerald-300 mt-1">{dewIn != null ? `${u.temp(dewIn)}${u.tempU}` : '--'}</p>
                  <p className="text-xs text-slate-400">Rocío</p>
                </div>
              </div>
            </div>

            {/* Presión */}
            <div className="card">
              <p className="card-title">Presión</p>
              <div className="rounded-lg bg-white/5 px-3 py-3 flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-violet-300">
                    {data?.pressure_relative != null ? `${u.press(data.pressure_relative)}` : '--'}
                    <span className="text-base font-normal text-slate-400"> {u.pressU}</span>
                  </p>
                  <p className="text-xs text-slate-400">Relativa (nivel del mar)</p>
                </div>
                {pressTrend != null && <TrendBadge delta={pressDeltaDisp(u.system, pressTrend)} unit={u.pressU} threshold={u.system === 'imperial' ? 0.02 : 0.3} />}
              </div>
            </div>
          </div>

          {/* Estadísticas */}
          <div className="card mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="card-title mb-0">Estadísticas ({periodLabel})</p>
              {periodBtns}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Stats Exterior */}
              {hasOutdoor && (
                <div>
                  <p className="text-xs text-amber-400 font-medium mb-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    Exterior (WN32)
                  </p>
                  <div className="grid gap-2">
                    <StatTile
                      label="Temperatura"
                      min={s.temperature_outdoor?.min ?? null}
                      avg={s.temperature_outdoor?.avg ?? null}
                      max={s.temperature_outdoor?.max ?? null}
                      unit={u.tempU}
                    />
                    <StatTile
                      label="Humedad"
                      min={s.humidity_outdoor?.min ?? null}
                      avg={s.humidity_outdoor?.avg ?? null}
                      max={s.humidity_outdoor?.max ?? null}
                      unit="%"
                    />
                  </div>
                </div>
              )}
              {/* Stats Interior */}
              <div>
                <p className="text-xs text-sky-400 font-medium mb-2 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                  Interior (GW1100)
                </p>
                <div className="grid gap-2">
                  <StatTile
                    label="Temperatura"
                    min={s.temperature_indoor?.min ?? null}
                    avg={s.temperature_indoor?.avg ?? null}
                    max={s.temperature_indoor?.max ?? null}
                    unit={u.tempU}
                  />
                  <StatTile
                    label="Humedad"
                    min={s.humidity_indoor?.min ?? null}
                    avg={s.humidity_indoor?.avg ?? null}
                    max={s.humidity_indoor?.max ?? null}
                    unit="%"
                  />
                </div>
              </div>
              {/* Stats Presión */}
              <div className="md:col-span-2">
                <StatTile
                  label="Presión"
                  min={s.pressure_relative?.min ?? null}
                  avg={s.pressure_relative?.avg ?? null}
                  max={s.pressure_relative?.max ?? null}
                  unit={` ${u.pressU}`}
                />
              </div>
            </div>
          </div>

          {/* Gráfica histórica */}
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex gap-1">
                <button
                  onClick={() => setMetric('outdoor')}
                  className={`px-3 py-1 rounded-lg text-sm transition ${
                    metric === 'outdoor' ? 'bg-amber-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  Exterior (WN32)
                </button>
                <button
                  onClick={() => setMetric('indoor')}
                  className={`px-3 py-1 rounded-lg text-sm transition ${
                    metric === 'indoor' ? 'bg-sky-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  Interior (GW1100)
                </button>
                <button
                  onClick={() => setMetric('pressure')}
                  className={`px-3 py-1 rounded-lg text-sm transition ${
                    metric === 'pressure' ? 'bg-violet-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
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
              <div className="h-80 md:h-64 overflow-x-auto">
                <div style={{ minWidth: chart.length > 50 ? `${Math.max(500, chart.length * 4)}px` : '500px', height: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chart} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} minTickGap={40} />
                      {metric === 'outdoor' && (
                        <>
                          <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={u.tempU} />
                          <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={[0, 100]} unit="%" />
                          <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} labelFormatter={(v) => new Date(v).toLocaleString('es-MX')} />
                          <Legend />
                          <Line yAxisId="left" type="monotone" dataKey="tempOut" name={`Temp ${u.tempU}`} stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
                          <Line yAxisId="right" type="monotone" dataKey="humOut" name="Humedad %" stroke="#22d3ee" dot={false} strokeWidth={2} connectNulls />
                        </>
                      )}
                      {metric === 'indoor' && (
                        <>
                          <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={u.tempU} />
                          <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={[0, 100]} unit="%" />
                          <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} labelFormatter={(v) => new Date(v).toLocaleString('es-MX')} />
                          <Legend />
                          <Line yAxisId="left" type="monotone" dataKey="tempIn" name={`Temp ${u.tempU}`} stroke="#38bdf8" dot={false} strokeWidth={2} connectNulls />
                          <Line yAxisId="right" type="monotone" dataKey="humIn" name="Humedad %" stroke="#22d3ee" dot={false} strokeWidth={2} connectNulls />
                        </>
                      )}
                      {metric === 'pressure' && (
                        <>
                          <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={` ${u.pressU}`} />
                          <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} labelFormatter={(v) => new Date(v).toLocaleString('es-MX')} />
                          <Legend />
                          <Line type="monotone" dataKey="pressure" name={`Presión ${u.pressU}`} stroke="#a78bfa" dot={false} strokeWidth={2} connectNulls />
                        </>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
