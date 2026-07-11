import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { WeatherCard } from './components/WeatherCard'
import { WeatherIcon } from './components/WeatherIcon'
import { WeatherFX } from './components/WeatherFX'
import { WindFlipCard } from './components/station/WindFlipCard'
import { InteriorCard } from './components/station/InteriorCard'
import { ExtraSensorsCard } from './components/station/ExtraSensorsCard'
import { TemperatureChart } from './components/TemperatureChart'
import { StatsSummary } from './components/StatsSummary'
import { Forecast } from './components/Forecast'
import { Astronomy } from './components/Astronomy'
import { WeatherData, DailyStats } from './types'
import { deriveCondition, relativeTime, isStale } from './weather'
import { fetchForecast, ForecastResult } from './forecast'

const API_URL = '/api/current'
const STATS_URL = '/api/stats/daily'
const REFRESH_INTERVAL = 60000 // 60 seconds
const FORECAST_INTERVAL = 30 * 60000 // 30 minutes

function App() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [stats, setStats] = useState<DailyStats | null>(null)
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      const response = await fetch(API_URL)
      if (!response.ok) {
        throw new Error('Error al obtener datos')
      }
      const json = await response.json()
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
    // Daily stats are best-effort; don't fail the whole dashboard if unavailable
    try {
      const res = await fetch(STATS_URL)
      if (res.ok) setStats(await res.json())
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const load = () => fetchForecast().then(setForecast).catch(() => {})
    load()
    const interval = setInterval(load, FORECAST_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 transition"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const cond = deriveCondition(data)
  const offline = isStale(data.received_at)
  const tempStats = stats?.stats?.temperature_outdoor

  return (
    <>
      <WeatherFX type={cond.fx} intensity={cond.intensity} />
      <div className="min-h-screen p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <header className="mb-6 flex items-center justify-between flex-wrap gap-2">
            <h1 className="text-3xl font-bold">Estación Clima XE1E en CDMX</h1>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span className={`badge ${offline ? 'badge-offline' : 'badge-live'}`}>
                {offline ? 'sin conexión' : 'en vivo'}
              </span>
              <span>Actualizado {relativeTime(data.received_at)}</span>
              <button onClick={fetchData} className="text-blue-400 hover:text-blue-300">
                <RefreshCw className="w-4 h-4" />
              </button>
              <a href="/pro" className="text-blue-400 hover:text-blue-300 text-xs border border-white/10 rounded-lg px-2 py-1">
                App completa →
              </a>
            </div>
          </header>

          {/* Hero: current condition */}
          <div className="card mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="card-title">{cond.label}</p>
                <div className="flex items-end gap-1">
                  <span className="text-6xl md:text-7xl font-bold tracking-tight">
                    {data.temperature_outdoor?.toFixed(1) ?? '--'}
                  </span>
                  <span className="text-3xl text-slate-400 mb-2">°C</span>
                </div>
                <p className="text-slate-400 mt-1">
                  Sensación {data.feels_like?.toFixed(1)}°C · Punto rocío {data.dew_point?.toFixed(1)}°C
                </p>
                {tempStats && (
                  <p className="text-sm mt-1">
                    <span className="text-red-300">▲ {tempStats.max?.toFixed(1)}°C</span>
                    <span className="text-slate-500"> · </span>
                    <span className="text-sky-300">▼ {tempStats.min?.toFixed(1)}°C</span>
                    <span className="text-slate-500"> hoy</span>
                  </p>
                )}
              </div>
              <WeatherIcon name={cond.icon} size={140} alt={cond.label} />
            </div>
          </div>

          {/* Metric row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <WeatherCard
              title="Humedad" value={data.humidity_outdoor} unit="%"
              iconName="humidity" color="text-sky-400" offline={offline}
              subtitle={`Punto rocío: ${data.dew_point?.toFixed(1)}°C`}
            />
            <WeatherCard
              title="Presión" value={data.pressure_relative} unit="hPa"
              iconName="barometer" color="text-violet-400" offline={offline}
            />
            <WeatherCard
              title="Índice UV" value={data.uv_index} unit=""
              iconName="uv-index" offline={offline}
              color={data.uv_index >= 8 ? 'text-red-400' : data.uv_index >= 6 ? 'text-orange-400' : 'text-yellow-400'}
              subtitle={`Radiación: ${data.solar_radiation} W/m²`}
            />
            <WeatherCard
              title="Lluvia hoy" value={data.rain_daily} unit="mm"
              iconName="raindrops" color="text-blue-400" offline={offline}
              subtitle={`Tasa: ${data.rain_rate?.toFixed(1)} mm/h`}
            />
          </div>

          {/* Viento · Interior · Sensores adicionales (mismo estilo que /pro) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 items-start">
            <WindFlipCard data={data} />
            <InteriorCard data={data} />
            <ExtraSensorsCard data={data} />
          </div>

          {/* 7-day forecast */}
          {forecast && <Forecast days={forecast.days} />}

          {/* Astronomy */}
          {forecast && <Astronomy astro={forecast.astro} />}

          {/* Daily stats summary */}
          <StatsSummary stats={stats?.stats ?? null} />

          {/* Historical chart */}
          <div className="card">
            <p className="card-title">Histórico 24h</p>
            <TemperatureChart />
          </div>

          {/* Footer */}
          <footer className="mt-8 text-center text-slate-500 text-sm">
            <p>Ecowitt WS2910 + WS69 | Estación: {data.station_type}</p>
          </footer>
        </div>
      </div>
    </>
  )
}

export default App
