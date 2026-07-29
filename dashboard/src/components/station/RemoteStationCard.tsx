import { useState, useEffect } from 'react'
import { WeatherData } from '../../types'
import { WeatherIcon } from '../WeatherIcon'
import { useUnits } from '../../units'
import { relativeTime, isStale } from '../../weather'
import { TrendBadge } from './TrendBadge'
import {
  REMOTE_STATION, REMOTE_LABEL, RemoteHistRow, dewPointC, trendOver,
  tempDeltaDisp, pressDeltaDisp,
} from '../../remote'

const REFRESH = 60000 // 1 min

// Tarjeta compacta de la estación remota para "Mi tablero". Se auto-consulta
// (no depende del proveedor de la principal). Detalle completo en /pro/remota.
export function RemoteStationCard() {
  const u = useUnits()
  const [data, setData] = useState<WeatherData | null>(null)
  const [history, setHistory] = useState<RemoteHistRow[]>([])
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [cur, hist] = await Promise.all([
          fetch(`/api/current?station=${REMOTE_STATION}`),
          fetch(`/api/history?start=-3h&station=${REMOTE_STATION}`).then((r) => (r.ok ? r.json() : { data: [] })),
        ])
        if (cur.ok) {
          setData(await cur.json())
          setNotFound(false)
        } else if (cur.status === 404) {
          setData(null)
          setNotFound(true)
        }
        setHistory(hist?.data ?? [])
      } catch {
        /* best-effort */
      }
    }
    load()
    const i = setInterval(load, REFRESH)
    return () => clearInterval(i)
  }, [])

  if (notFound) {
    return (
      <div className="card">
        <p className="card-title">{REMOTE_LABEL}</p>
        <p className="text-sm text-slate-400">Sin datos todavía.</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="card">
        <p className="card-title">{REMOTE_LABEL}</p>
        <p className="text-sm text-slate-400">Cargando…</p>
      </div>
    )
  }

  const offline = data.received_at ? isStale(data.received_at) : false

  // Exterior (WN32)
  const tOut = data.temperature_outdoor
  const hOut = data.humidity_outdoor
  const dewOut = dewPointC(tOut, hOut)
  const tOutTrend = trendOver(history, 'temperature_outdoor', 3)
  const tOutDelta = tOutTrend == null ? null : tempDeltaDisp(u.system, tOutTrend)

  // Interior (GW1100)
  const tIn = data.temperature_indoor
  const hIn = data.humidity_indoor
  const pTrend = trendOver(history, 'pressure_relative', 3)
  const pDelta = pTrend == null ? null : pressDeltaDisp(u.system, pTrend)

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="card-title mb-0">{REMOTE_LABEL}</p>
        <span className={`badge ${offline ? 'badge-offline' : 'badge-live'}`}>
          {offline ? 'sin conexión' : 'en vivo'}
        </span>
      </div>

      {/* Exterior - WN32 */}
      <p className="text-xs text-slate-400 mb-1">Exterior (WN32)</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="thermometer" size={24} />
          <p className="text-xl font-bold text-amber-300 mt-1">{tOut != null ? `${u.temp(tOut)}${u.tempU}` : '--'}</p>
          <p className="text-xs text-slate-400">Temp</p>
          <TrendBadge delta={tOutDelta} unit={u.tempU} threshold={0.2} />
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="humidity" size={24} />
          <p className="text-xl font-bold text-cyan-300 mt-1">{hOut != null ? `${Math.round(hOut)}%` : '--'}</p>
          <p className="text-xs text-slate-400">Humedad</p>
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="thermometer" size={24} />
          <p className="text-xl font-bold text-emerald-300 mt-1">{dewOut != null ? `${u.temp(dewOut)}${u.tempU}` : '--'}</p>
          <p className="text-xs text-slate-400">Rocío</p>
        </div>
      </div>

      {/* Interior - GW1100 */}
      <p className="text-xs text-slate-400 mb-1">Interior (GW1100)</p>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="thermometer" size={24} />
          <p className="text-xl font-bold text-orange-300 mt-1">{tIn != null ? `${u.temp(tIn)}${u.tempU}` : '--'}</p>
          <p className="text-xs text-slate-400">Temp</p>
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="humidity" size={24} />
          <p className="text-xl font-bold text-sky-300 mt-1">{hIn != null ? `${Math.round(hIn)}%` : '--'}</p>
          <p className="text-xs text-slate-400">Humedad</p>
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="barometer" size={24} />
          <p className="text-xl font-bold text-violet-300 mt-1">
            {data.pressure_relative != null ? u.press(data.pressure_relative) : '--'}
          </p>
          <p className="text-xs text-slate-400">{u.pressU}</p>
          <TrendBadge delta={pDelta} unit={u.pressU} threshold={u.system === 'imperial' ? 0.02 : 0.3} />
        </div>
      </div>

      {data.received_at && (
        <p className="text-xs text-slate-500 mt-2">Actualizado {relativeTime(data.received_at)}</p>
      )}
    </div>
  )
}
