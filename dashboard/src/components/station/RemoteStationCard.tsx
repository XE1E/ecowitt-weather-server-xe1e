import { useState, useEffect } from 'react'
import { WeatherData } from '../../types'
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

  const t = data.temperature_indoor
  const h = data.humidity_indoor
  const dew = dewPointC(t, h)
  const offline = data.received_at ? isStale(data.received_at) : false
  const tTrend = trendOver(history, 'temperature_indoor', 3)
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
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-4xl font-bold text-amber-300 leading-none">
            {t != null ? `${u.temp(t)}${u.tempU}` : '--'}
          </p>
          <div className="mt-1"><TrendBadge delta={tDelta} unit={u.tempU} threshold={0.2} /></div>
        </div>
        <div className="text-right text-sm space-y-0.5">
          <p className="text-slate-400">Humedad <span className="font-semibold text-cyan-300">{h != null ? `${Math.round(h)}%` : '--'}</span></p>
          <p className="text-slate-400">Rocío <span className="font-semibold text-emerald-300">{dew != null ? `${u.temp(dew)}${u.tempU}` : '--'}</span></p>
          <p className="text-slate-400">Presión <span className="font-semibold text-violet-300">{data.pressure_relative != null ? `${u.press(data.pressure_relative)} ${u.pressU}` : '--'}</span></p>
          <div className="flex justify-end"><TrendBadge delta={pDelta} unit={u.pressU} threshold={u.system === 'imperial' ? 0.02 : 0.3} /></div>
        </div>
      </div>
      {data.received_at && (
        <p className="text-xs text-slate-500 mt-2">Actualizado {relativeTime(data.received_at)}</p>
      )}
    </div>
  )
}
