import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { WeatherData, DailyStats, HistoryRow } from './types'
import { fetchForecast, ForecastResult } from './forecast'
import { pollWhileVisible } from './poll'

export interface Comparison {
  [field: string]: { today: number | null; yesterday: number | null; delta: number | null }
}

export interface LocalForecast {
  available: boolean
  pressure?: number
  delta_3h?: number | null
  trend?: { code: string; label: string; arrow: string }
  level?: string
  forecast?: string
}

export interface ConsensusForecast {
  current?: {
    code: number
    label: string
    source: string
    rain_now: boolean
    storm_approaching: boolean
  }
  pressure?: {
    trend: string
    delta_3h: number | null
    delta_1h: number | null
    storm_likely: boolean
    hours_to_rain: number | null
    confidence: string
    message: string
  }
  hourly: Array<{
    time: string
    code: number
    temperature: number | null
    precip_prob: number
    consensus: string
  }>
  daily: Array<{
    date: string
    code: number
    temp_max: number | null
    temp_min: number | null
    precip_prob: number
    // WeatherAPI, sólo en los días que cubre su plan gratuito (3): por separado,
    // no fundido con Open-Meteo -- ver forecast_consensus.py::_merge_daily.
    wa_code?: number | null
    wa_temp_max?: number | null
    wa_temp_min?: number | null
    wa_precip_prob?: number | null
  }>
  alerts: Array<{
    type: string
    severity: string
    title: string
    message: string
  }>
  sources: string[]
}

export interface OwnForecast {
  headline: string
  source: 'station' | 'camera' | 'camera_trend' | 'pressure' | 'pressure+nearby' | 'nearby' | 'none'
  rain_now: boolean
  storm_likely: boolean
  confidence: 'high' | 'medium' | 'low'
}

interface StationData {
  data: WeatherData | null
  stats: DailyStats['stats'] | null
  // HistoryRow y no HistoryData: /api/history trae ademas los sensores por
  // canal, que ExtraSensorsCard lee por nombre calculado.
  history: HistoryRow[]
  forecast: ForecastResult | null
  /** Ya se intentó cargar el pronóstico (bien o mal): la consola lo usa para
   *  saber cuándo terminó de cargar, también si Open-Meteo falla. */
  forecastTried: boolean
  compare: Comparison | null
  localForecast: LocalForecast | null
  consensus: ConsensusForecast | null
  // "Nuestro pronóstico" (estación + cámara + vecinas, ver
  // forecaster.own_forecast) -- manda sobre `consensus`/Open-Meteo cuando
  // hay señal propia. Ver docs de PrecipitationCard.tsx y ConsoleReplica.
  ownForecast: OwnForecast | null
  loading: boolean
}

const Ctx = createContext<StationData | null>(null)

const REFRESH = 60000 // 1 min (los datos no necesitan ser instantáneos)
const FORECAST_REFRESH = 30 * 60000

export function StationDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WeatherData | null>(null)
  const [stats, setStats] = useState<DailyStats['stats'] | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [forecastTried, setForecastTried] = useState(false)
  const [compare, setCompare] = useState<Comparison | null>(null)
  const [localForecast, setLocalForecast] = useState<LocalForecast | null>(null)
  const [consensus, setConsensus] = useState<ConsensusForecast | null>(null)
  const [ownForecast, setOwnForecast] = useState<OwnForecast | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [cur, st, hist, cmp, lf] = await Promise.all([
          fetch('/api/current').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/stats/daily').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/history?start=-24h').then((r) => (r.ok ? r.json() : { data: [] })),
          fetch('/api/compare').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/forecast/local').then((r) => (r.ok ? r.json() : null)),
        ])
        if (cur) setData(cur)
        setStats(st?.stats ?? null)
        setHistory(hist?.data ?? [])
        if (cmp) setCompare(cmp)
        if (lf) setLocalForecast(lf)
      } catch {
        /* ignore */
      } finally {
        setLoading(false)
      }
    }
    return pollWhileVisible(load, REFRESH)
  }, [])

  useEffect(() => {
    const go = () => fetchForecast().then(setForecast).catch(() => {}).finally(() => setForecastTried(true))
    return pollWhileVisible(go, FORECAST_REFRESH)
  }, [])

  // Pronóstico de consenso (combina estación + presión + Open-Meteo + WeatherAPI)
  useEffect(() => {
    const load = () =>
      fetch('/api/forecast/consensus')
        .then((r) => (r.ok ? r.json() : null))
        .then(setConsensus)
        .catch(() => {})
    return pollWhileVisible(load, 5 * 60000) // Cada 5 min
  }, [])

  // "Nuestro pronóstico" -- estación + cámara + vecinas (ver
  // forecaster.own_forecast). Reemplaza a consensus.current.storm_approaching
  // como fuente de la señal de tormenta en ConsoleReplica: NO depende de
  // Open-Meteo/WeatherAPI, es la voz propia de la estación.
  useEffect(() => {
    const load = () =>
      fetch('/api/forecast/own')
        .then((r) => (r.ok ? r.json() : null))
        .then(setOwnForecast)
        .catch(() => {})
    return pollWhileVisible(load, 5 * 60000) // Cada 5 min
  }, [])

  return (
    <Ctx.Provider value={{ data, stats, history, forecast, forecastTried, compare, localForecast, consensus, ownForecast, loading }}>{children}</Ctx.Provider>
  )
}

export function useStationData(): StationData {
  const c = useContext(Ctx)
  if (!c) throw new Error('useStationData must be used within StationDataProvider')
  return c
}
