import { useState, useEffect } from 'react'
import {
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  Sun,
  CloudRain,
  RefreshCw
} from 'lucide-react'
import { WeatherCard } from './components/WeatherCard'
import { WindCompass } from './components/WindCompass'
import { TemperatureChart } from './components/TemperatureChart'
import { WeatherData } from './types'

const API_URL = '/api/current'
const REFRESH_INTERVAL = 60000 // 60 seconds

function App() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchData = async () => {
    try {
      const response = await fetch(API_URL)
      if (!response.ok) {
        throw new Error('Error al obtener datos')
      }
      const json = await response.json()
      setData(json)
      setLastUpdate(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
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

  // Build the list of WN31 channels (1-8) that actually reported data.
  const WN31_COLORS = [
    'text-amber-400', 'text-lime-400', 'text-teal-400', 'text-indigo-400',
    'text-pink-400', 'text-cyan-400', 'text-emerald-400', 'text-fuchsia-400',
  ]
  const wn31Channels = Array.from({ length: 8 }, (_, i) => i + 1)
    .map((ch) => {
      const temp = data[`temperature_ch${ch}` as keyof WeatherData] as number | undefined
      const humidity = data[`humidity_ch${ch}` as keyof WeatherData] as number | undefined
      const battery = data[`battery_ch${ch}` as keyof WeatherData] as boolean | undefined
      return {
        ch,
        temp,
        humidity,
        batteryLow: battery === false,
        color: WN31_COLORS[ch - 1],
      }
    })
    .filter((c) => c.temp !== undefined || c.humidity !== undefined)

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Weather Station XE1E</h1>
          <p className="text-slate-400">
            Última actualización: {lastUpdate?.toLocaleTimeString()}
            <button
              onClick={fetchData}
              className="ml-4 text-blue-400 hover:text-blue-300"
            >
              <RefreshCw className="w-4 h-4 inline" />
            </button>
          </p>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Temperature */}
          <WeatherCard
            title="Temperatura"
            value={data.temperature_outdoor}
            unit="°C"
            icon={<Thermometer className="w-6 h-6" />}
            color={data.temperature_outdoor > 30 ? 'text-red-400' :
                   data.temperature_outdoor < 10 ? 'text-blue-400' : 'text-green-400'}
            subtitle={`Sensación: ${data.feels_like?.toFixed(1)}°C`}
          />

          {/* Humidity */}
          <WeatherCard
            title="Humedad"
            value={data.humidity_outdoor}
            unit="%"
            icon={<Droplets className="w-6 h-6" />}
            color="text-blue-400"
            subtitle={`Punto rocío: ${data.dew_point?.toFixed(1)}°C`}
          />

          {/* Pressure */}
          <WeatherCard
            title="Presión"
            value={data.pressure_relative}
            unit="hPa"
            icon={<Gauge className="w-6 h-6" />}
            color="text-purple-400"
          />

          {/* UV Index */}
          <WeatherCard
            title="Índice UV"
            value={data.uv_index}
            unit=""
            icon={<Sun className="w-6 h-6" />}
            color={data.uv_index >= 8 ? 'text-red-400' :
                   data.uv_index >= 6 ? 'text-orange-400' : 'text-yellow-400'}
            subtitle={`Radiación: ${data.solar_radiation} W/m²`}
          />
        </div>

        {/* Wind and Rain Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {/* Wind */}
          <div className="card col-span-1 lg:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="card-title flex items-center gap-2">
                  <Wind className="w-5 h-5" />
                  Viento
                </p>
                <p className="card-value text-green-400">
                  {data.wind_speed?.toFixed(1)}
                  <span className="card-unit">km/h</span>
                </p>
                <p className="text-slate-400 mt-2">
                  Ráfaga: {data.wind_gust?.toFixed(1)} km/h
                </p>
              </div>
              <WindCompass direction={data.wind_direction || 0} />
            </div>
          </div>

          {/* Rain */}
          <div className="card">
            <p className="card-title flex items-center gap-2">
              <CloudRain className="w-5 h-5" />
              Lluvia
            </p>
            <p className="card-value text-blue-400">
              {data.rain_daily?.toFixed(1)}
              <span className="card-unit">mm</span>
            </p>
            <div className="mt-4 space-y-1 text-sm text-slate-400">
              <p>Rate: {data.rain_rate?.toFixed(1)} mm/h</p>
              <p>Semanal: {data.rain_weekly?.toFixed(1)} mm</p>
              <p>Mensual: {data.rain_monthly?.toFixed(1)} mm</p>
            </div>
          </div>
        </div>

        {/* Indoor Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <WeatherCard
            title="Temperatura Interior"
            value={data.temperature_indoor}
            unit="°C"
            icon={<Thermometer className="w-6 h-6" />}
            color="text-orange-400"
          />
          <WeatherCard
            title="Humedad Interior"
            value={data.humidity_indoor}
            unit="%"
            icon={<Droplets className="w-6 h-6" />}
            color="text-cyan-400"
          />
        </div>

        {/* WN31 Extra Sensors (up to 8 channels) - Only show channels with data */}
        {wn31Channels.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-slate-300 mb-4">Sensores Adicionales (WN31)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {wn31Channels.map(({ ch, temp, humidity, batteryLow, color }) => {
                const subtitleParts: string[] = []
                if (humidity !== undefined) subtitleParts.push(`Humedad: ${humidity}%`)
                if (batteryLow) subtitleParts.push('⚠ Batería baja')
                return (
                  <WeatherCard
                    key={ch}
                    title={`Canal ${ch}`}
                    value={temp}
                    unit="°C"
                    icon={<Thermometer className="w-6 h-6" />}
                    color={color}
                    subtitle={subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Chart placeholder */}
        <div className="card">
          <p className="card-title">Histórico 24h</p>
          <TemperatureChart />
        </div>

        {/* Footer */}
        <footer className="mt-8 text-center text-slate-500 text-sm">
          <p>Ecowitt WS2910 + WS69 | Station: {data.station_type}</p>
        </footer>
      </div>
    </div>
  )
}

export default App
