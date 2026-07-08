import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { WeatherData, DailyStats, HistoryData } from '../types'
import { deriveCondition } from '../weather'
import { fetchForecast, ForecastResult } from '../forecast'
import { WeatherFX } from '../components/WeatherFX'
import { MiniStats } from '../components/station/MiniStats'
import { CurrentConditions } from '../components/station/CurrentConditions'
import { WindCard } from '../components/station/WindCard'
import { PressureCard } from '../components/station/PressureCard'
import { LOCATION } from '../config'

const REFRESH = 60000 // 1 min (los datos no necesitan ser instantáneos)
const FORECAST_REFRESH = 30 * 60000

export function StationPage() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [stats, setStats] = useState<DailyStats['stats'] | null>(null)
  const [history, setHistory] = useState<HistoryData[]>([])
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const [cur, st, hist] = await Promise.all([
        fetch('/api/current').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/stats/daily').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/history?start=-24h').then((r) => (r.ok ? r.json() : { data: [] })),
      ])
      if (cur) setData(cur)
      setStats(st?.stats ?? null)
      setHistory(hist?.data ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const i = setInterval(load, REFRESH)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const go = () => fetchForecast().then(setForecast).catch(() => {})
    go()
    const i = setInterval(go, FORECAST_REFRESH)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    )
  }

  const cond = data ? deriveCondition(data) : { fx: 'none' as const, intensity: 0, icon: '', label: '' }

  return (
    <>
      <WeatherFX type={cond.fx} intensity={cond.intensity} />
      <div className="min-h-screen p-3 md:p-6">
        <div className="max-w-[1400px] mx-auto">
          {/* Header */}
          <header className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold">El clima local en {LOCATION.name}</h1>
              <p className="text-xs text-slate-400">Estación XE1E · Ecowitt WS2910 + WS69</p>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <span className="font-mono">
                {now.toLocaleTimeString('es-MX')} · {now.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })}
              </span>
              <a href="/" className="text-blue-400 hover:text-blue-300 text-xs border border-white/10 rounded-lg px-2 py-1">
                Vista clásica
              </a>
            </div>
          </header>

          {data && (
            <>
              {/* Franja de mini-stats */}
              <div className="mb-4">
                <MiniStats data={data} stats={stats} forecast={forecast} />
              </div>

              {/* Rejilla principal (se completará en las siguientes fases) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-4">
                  <CurrentConditions data={data} />
                  <WindCard data={data} />
                  <PressureCard data={data} stats={stats} history={history} />
                </div>
                <div className="space-y-4">
                  {/* Fase 2: pronóstico, gráfico temp, precipitación, UV/solar */}
                </div>
                <div className="space-y-4">
                  {/* Fase 3: sol/luna, sky events, sensores extra, radar, alertas */}
                </div>
              </div>
            </>
          )}

          <footer className="mt-8 text-center text-slate-500 text-xs">
            <p>Estación XE1E · {LOCATION.name} · datos vía Ecowitt · pronóstico Open-Meteo</p>
          </footer>
        </div>
      </div>
    </>
  )
}
