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
import { RefreshCw, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { WeatherData, DailyStats } from '../types'
import { WeatherIcon } from '../components/WeatherIcon'
import { useUnits } from '../units'
import { relativeTime, isStale } from '../weather'

// Estación secundaria (GW1100). Debe coincidir con el nombre configurado en
// SECONDARY_STATIONS del backend (p. ej. "<passkey>:gw1100").
const STATION = 'gw1100'
const STATION_LABEL = 'Estación remota'
const REFRESH = 60000 // 1 min, como el resto del dashboard

type Period = '24h' | '7d' | '30d'
const PERIODS: { key: Period; label: string; start: string }[] = [
  { key: '24h', label: '24 h', start: '-24h' },
  { key: '7d', label: '7 d', start: '-7d' },
  { key: '30d', label: '30 d', start: '-30d' },
]

type ChartMetric = 'th' | 'pressure'

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
  pressure: number | null
}

// Punto de rocío (Magnus) a partir de temperatura (°C) y humedad relativa (%).
function dewPointC(t?: number, rh?: number): number | null {
  if (t == null || rh == null || rh <= 0) return null
  const a = 17.625
  const b = 243.04
  const g = Math.log(rh / 100) + (a * t) / (b + t)
  return (b * g) / (a - g)
}

// Cambio de un campo respecto a ~`hours` horas antes (tendencia). Valor métrico.
function trendOver(history: HistRow[], field: keyof HistRow, hours: number): number | null {
  const withVal = history.filter((r) => r[field] != null)
  if (withVal.length < 2) return null
  const last = withVal[withVal.length - 1]
  const target = new Date(last._time).getTime() - hours * 3600 * 1000
  let best: HistRow | null = null
  let bestDiff = Infinity
  for (const r of withVal) {
    const diff = Math.abs(new Date(r._time).getTime() - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = r
    }
  }
  if (!best || best === last) return null
  return (last[field] as number) - (best[field] as number)
}

function TrendBadge({ delta, unit, threshold }: { delta: number | null; unit: string; threshold: number }) {
  if (delta == null) return null
  const up = delta > threshold
  const down = delta < -threshold
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus
  const color = up ? 'text-amber-300' : down ? 'text-sky-300' : 'text-slate-400'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`} title="Cambio en las últimas 3 h">
      <Icon className="w-3.5 h-3.5" />
      {sign}{delta.toFixed(1)}{unit} / 3 h
    </span>
  )
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
  const [metric, setMetric] = useState<ChartMetric>('th')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const start = PERIODS.find((p) => p.key === period)!.start

  const load = useCallback(async () => {
    try {
      const [cur, st, hist] = await Promise.all([
        fetch(`/api/current?station=${STATION}`),
        fetch(`/api/stats/daily?station=${STATION}&start=${start}`).then((r) => (r.ok ? r.json() : null)),
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
    pressure: r.pressure_relative != null ? Number(u.pressN(r.pressure_relative).toFixed(u.system === 'imperial' ? 2 : 1)) : null,
  }))

  const offline = data?.received_at ? isStale(data.received_at) : false
  const s = stats ?? {}

  const t = data?.temperature_indoor
  const h = data?.humidity_indoor
  const dew = dewPointC(t, h)

  // Tendencias (últimas ~3 h) en unidades métricas -> se convierten para mostrar.
  const tempTrendC = trendOver(history, 'temperature_indoor', 3)
  const pressTrend = trendOver(history, 'pressure_relative', 3)
  const tempDelta = tempTrendC == null ? null : (u.system === 'imperial' ? tempTrendC * 9 / 5 : tempTrendC)
  const pressDelta = pressTrend == null ? null : (u.system === 'imperial' ? pressTrend * 0.0295299830714 : pressTrend)

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
          <h2 className="text-xl font-bold">{STATION_LABEL}</h2>
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
            No se han recibido lecturas de la estación <code>{STATION}</code>. Verifica que esté
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
                    <XAxis dataKey="time" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} interval="preserveStartEnd" />
                    {metric === 'th' ? (
                      <>
                        <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={u.tempU} />
                        <YAxis yAxisId="humidity" orientation="right" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={[0, 100]} unit="%" />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#f59e0b" strokeWidth={2} dot={false} name={`Temperatura (${u.tempU})`} />
                        <Line yAxisId="humidity" type="monotone" dataKey="humidity" stroke="#38bdf8" strokeWidth={2} dot={false} name="Humedad (%)" />
                      </>
                    ) : (
                      <>
                        <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['auto', 'auto']} unit={` ${u.pressU}`} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} />
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
