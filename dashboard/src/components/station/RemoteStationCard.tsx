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

  // Prefiere exterior (secundaria "a la intemperie"); cae a interior si no.
  const t = data.temperature_outdoor ?? data.temperature_indoor
  const h = data.humidity_outdoor ?? data.humidity_indoor
  const dew = dewPointC(t, h)
  const offline = data.received_at ? isStale(data.received_at) : false
  const tTrend = trendOver(history, 'temperature_outdoor', 3) ?? trendOver(history, 'temperature_indoor', 3)
  const pTrend = trendOver(history, 'pressure_relative', 3)
  const tDelta = tTrend == null ? null : tempDeltaDisp(u.system, tTrend)
  const pDelta = pTrend == null ? null : pressDeltaDisp(u.system, pTrend)

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="card-title mb-0">{REMOTE_LABEL}</p>
        <span className={`badge ${offline ? 'badge-offline' : 'badge-live'}`}>
          {offline ? 'sin conexión' : 'en vivo'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="thermometer" size={30} />
          <p className="text-2xl font-bold text-amber-300 mt-1">{t != null ? `${u.temp(t)}${u.tempU}` : '--'}</p>
          <p className="text-xs text-slate-400">Temperatura</p>
          <TrendBadge delta={tDelta} unit={u.tempU} threshold={0.2} />
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="humidity" size={30} />
          <p className="text-2xl font-bold text-cyan-300 mt-1">{h != null ? `${Math.round(h)}%` : '--'}</p>
          <p className="text-xs text-slate-400">Humedad</p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="thermometer" size={30} />
          <p className="text-2xl font-bold text-emerald-300 mt-1">{dew != null ? `${u.temp(dew)}${u.tempU}` : '--'}</p>
          <p className="text-xs text-slate-400">Punto de rocío</p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2 flex flex-col items-center text-center">
          <WeatherIcon name="barometer" size={30} />
          <p className="text-2xl font-bold text-violet-300 mt-1">
            {data.pressure_relative != null ? u.press(data.pressure_relative) : '--'}
            <span className="text-xs font-normal text-slate-400"> {u.pressU}</span>
          </p>
          <p className="text-xs text-slate-400">Presión</p>
          <TrendBadge delta={pDelta} unit={u.pressU} threshold={u.system === 'imperial' ? 0.02 : 0.3} />
        </div>
      </div>
      {data.received_at && (
        <p className="text-xs text-slate-500 mt-2">Actualizado {relativeTime(data.received_at)}</p>
      )}
    </div>
  )
}
