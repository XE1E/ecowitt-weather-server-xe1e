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
import { ForecastCard } from '../components/station/ForecastCard'
import { StationTempChart } from '../components/station/StationTempChart'
import { PrecipitationCard } from '../components/station/PrecipitationCard'
import { UvSolarCard } from '../components/station/UvSolarCard'
import { SunMoonCard } from '../components/station/SunMoonCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { ExtraSensorsCard } from '../components/station/ExtraSensorsCard'
import { AlertsPanel } from '../components/station/AlertsPanel'
import { RadarCard } from '../components/station/RadarCard'
import { MetarCard } from '../components/station/MetarCard'
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
              <h1 className="text-xl md:text-2xl font-bold">Estación Clima XE1E en {LOCATION.name}</h1>
              <p className="text-xs text-slate-400">{LOCATION.label}</p>
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
                  <ForecastCard forecast={forecast} />
                  <StationTempChart history={history} forecast={forecast} />
                  <PrecipitationCard data={data} forecast={forecast} />
                  <UvSolarCard data={data} />
                </div>
                <div className="space-y-4">
                  <SunMoonCard astro={forecast?.astro ?? null} />
                  <AlertsPanel />
                  <SkyEventsCard />
                  <ExtraSensorsCard data={data} />
                </div>
              </div>

              {/* Radar + METAR (ancho completo) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <RadarCard />
                <MetarCard />
              </div>
            </>
          )}

          <footer className="mt-10 pt-6 border-t border-white/10 text-slate-400 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="font-semibold text-slate-300 mb-1">Estación</p>
                <p>Hardware: Ecowitt WS2910 + WS69 + WN31</p>
                <p>Ubicación: {LOCATION.label}</p>
                <p>Coordenadas: {LOCATION.latitude}, {LOCATION.longitude}</p>
                <p>Datos desde: 2026</p>
              </div>
              <div>
                <p className="font-semibold text-slate-300 mb-1">Datos</p>
                <p>Estación vía protocolo Ecowitt</p>
                <p>Pronóstico y astronomía: Open-Meteo</p>
                <p>METAR: aviationweather.gov (MMMX)</p>
                <p>Radar: Windy</p>
              </div>
              <div>
                <p className="font-semibold text-slate-300 mb-1">Proyecto</p>
                <p>
                  <a href="https://github.com/XE1E/ecowitt-weather-server-xe1e" className="text-blue-400 hover:text-blue-300">
                    GitHub — ecowitt-weather-server-xe1e
                  </a>
                </p>
                <p>Stack propio (FastAPI + InfluxDB + React)</p>
              </div>
            </div>
            <p className="text-center text-slate-600 mt-6">© 2026 Estación XE1E · {LOCATION.name}</p>
          </footer>
        </div>
      </div>
    </>
  )
}
