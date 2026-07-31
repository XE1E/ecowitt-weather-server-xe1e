import { WeatherData } from '../../types'
import { ForecastResult } from '../../forecast'
import { useUnits } from '../../units'
import { useState, useEffect } from 'react'

interface Props {
  data: WeatherData
  forecast: ForecastResult | null
}

interface LastRainInfo {
  date: string | null
}

export function PrecipitationCard({ data, forecast }: Props) {
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
      return `Lluvia posible ${h}:00`
    }
    return '24h sin lluvia'
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <p className="card-title mb-0">Precipitaciones</p>
        {lastRain?.date && (
          <p className="text-xs text-slate-500">
            Última lluvia: <span className="text-slate-400">{formatLastRain(lastRain.date)}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 text-center">
        <div>
          <p className="text-2xl font-bold text-sky-400 tabular-nums">{u.rate(data.rain_rate)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{u.rateU}</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{u.rain(data.rain_daily)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Hoy</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{u.rain(data.rain_monthly)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Mes</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{u.rain(data.rain_yearly)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Año</p>
        </div>
      </div>

      {next.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">Probabilidad de precipitaciones en las próximas horas</p>
            <p className="text-xs text-slate-400">{getNextRainInfo()}</p>
          </div>
          <div className="flex items-end gap-1.5 h-20 rounded-lg bg-gradient-to-t from-slate-800/50 to-transparent px-2 pt-2">
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
