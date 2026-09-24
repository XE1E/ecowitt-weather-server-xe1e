import { WeatherData } from '../../types'
import { ForecastResult } from '../../forecast'
import { OwnForecast } from '../../station-data'
import { useUnits } from '../../units'
import { WeatherIcon } from '../WeatherIcon'
import { ICON, iconLluvia } from '../../theme/icons'
import { useState, useEffect } from 'react'
import { CloudRain } from 'lucide-react'

interface Props {
  data: WeatherData
  forecast: ForecastResult | null
  // Prop, no `useStationData()` propio: la vista clásica (App.tsx) usa esta
  // tarjeta SIN StationDataProvider -- llamar el hook aquí adentro reventaba
  // toda la página en blanco (sin error boundary en la app, cualquier throw
  // de render tumba todo). Opcional: la clásica simplemente no lo pasa.
  ownForecast?: OwnForecast | null
}

interface LastRainInfo {
  date: string | null
}

export function PrecipitationCard({ data, forecast, ownForecast: own = null }: Props) {
  const u = useUnits()
  const [lastRain, setLastRain] = useState<LastRainInfo | null>(null)
  const next = forecast?.hours?.slice(0, 8) ?? []
  const peakProb = next.length ? Math.max(...next.map((h) => h.precipProb ?? 0)) : 0

  useEffect(() => {
    fetch('/api/rain/last')
      .then((r) => (r.ok ? r.json() : null))
      .then(setLastRain)
      .catch(() => {})
  }, [])

  // "Nuestro pronóstico" (estación + cámara + vecinas, ver
  // forecaster.own_forecast) manda sobre Open-Meteo: si alguna fuente
  // propia SÍ tiene señal, es el titular; Open-Meteo se ve abajo, aparte y
  // rotulado. Si no hay señal propia (`source === 'none'`), no se muestra
  // nada aquí -- no hay nada propio que decir, y repetirlo como "todo en
  // calma" en cada carga sería ruido, no señal.
  const ownHasSignal = own && own.source !== 'none'

  // Contradicción visible: Open-Meteo prevé bastante más lluvia de la que
  // nuestras fuentes propias detectan (o al revés) -- se dice, no se oculta.
  const ownVsModelNote = (() => {
    if (!own || next.length === 0) return null
    if (!ownHasSignal && peakProb >= 50) {
      return 'Open-Meteo prevé más probabilidad de lluvia que lo que detectamos aquí (estación/cámara/vecinas).'
    }
    if (own?.storm_likely && peakProb < 30) {
      return 'Open-Meteo todavía no lo refleja en su probabilidad.'
    }
    return null
  })()

  const formatLastRain = (dateStr: string | null) => {
    if (!dateStr) return null
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) +
           ', ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  const getNextRainInfo = () => {
    if (!next.length) return null
    const rainHour = next.find((h) => (h.precipProb ?? 0) > 30)
    if (rainHour) {
      const h = new Date(rainHour.time).getHours()
      return `Lluvia posible ${String(h).padStart(2, '0')}:00`
    }
    // El texto sale de `next.length` y no de un "24h" fijo: la ventana son las
    // horas que se grafican abajo (8), y afirmar 24 h era simplemente falso.
    return `Sin lluvia en ${next.length} h`
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <WeatherIcon name={iconLluvia(data.rain_rate, data.rain_daily)} size={ICON.card} alt="" className="shrink-0" />
          <p className="card-title mb-0">Precipitaciones</p>
        </div>
        {lastRain?.date && (
          <p className="text-xs text-slate-500">
            Última lluvia: <span className="text-slate-400">{formatLastRain(lastRain.date)}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-5 gap-2 text-center">
        <div>
          <p className="text-xl font-bold text-sky-400 tabular-nums">{u.rate(data.rain_rate)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{u.rateU}</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{u.rain(data.rain_2h)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">2h · {u.rainU}</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{u.rain(data.rain_event)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Evento · {u.rainU}</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{u.rain(data.rain_daily)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Hoy · {u.rainU}</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{u.rain(data.rain_monthly)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Mes · {u.rainU}</p>
        </div>
      </div>

      {ownHasSignal && (
        <div className={`mt-3 p-2.5 rounded-lg border flex items-start gap-2 ${
          own!.confidence === 'high' ? 'bg-amber-500/15 border-amber-500/30' : 'bg-sky-500/10 border-sky-500/20'
        }`}>
          <CloudRain className={`w-5 h-5 shrink-0 mt-0.5 ${own!.confidence === 'high' ? 'text-amber-400' : 'text-sky-400'}`} />
          <div>
            <p className="text-sm font-medium text-slate-100">{own!.headline}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Nuestro pronóstico (estación · cámara · vecinas)</p>
          </div>
        </div>
      )}

      {next.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">Según Open-Meteo, próximas horas</p>
            <p className="text-xs text-slate-400">{getNextRainInfo()}</p>
          </div>
          {ownVsModelNote && (
            <p className="text-[11px] text-slate-500 mb-2">{ownVsModelNote}</p>
          )}
          <div className="flex items-end gap-1.5 h-20 rounded-lg chart-well px-2 pt-2">
            {next.map((h) => {
              const prob = h.precipProb ?? 0
              const height = peakProb > 0 ? (prob / Math.max(1, peakProb)) * 100 : 0
              return (
                <div key={h.time} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${Math.max(height, prob > 0 ? 8 : 0)}%`,
                      background: prob > 50
                        ? 'linear-gradient(to top, #0ea5e9, #38bdf8)'
                        : prob > 0
                        ? 'linear-gradient(to top, #0ea5e9aa, #38bdf8aa)'
                        : 'rgba(148,163,184,0.15)',
                    }}
                    title={`${prob}%`}
                  />
                  <span className="text-[9px] text-sky-400 mt-1 tabular-nums">
                    {prob > 0 ? `${prob}%` : '0%'}
                  </span>
                  <span className="text-[9px] text-slate-500">
                    {new Date(h.time).toLocaleTimeString('es-MX', { hour: '2-digit' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
