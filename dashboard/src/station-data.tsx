import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { WeatherData, DailyStats, HistoryData } from './types'
import { fetchForecast, ForecastResult } from './forecast'

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

interface StationData {
  data: WeatherData | null
  stats: DailyStats['stats'] | null
  history: HistoryData[]
  forecast: ForecastResult | null
  compare: Comparison | null
  localForecast: LocalForecast | null
  loading: boolean
}

const Ctx = createContext<StationData | null>(null)

const REFRESH = 60000 // 1 min (los datos no necesitan ser instantáneos)
const FORECAST_REFRESH = 30 * 60000

export function StationDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WeatherData | null>(null)
  const [stats, setStats] = useState<DailyStats['stats'] | null>(null)
  const [history, setHistory] = useState<HistoryData[]>([])
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [compare, setCompare] = useState<Comparison | null>(null)
  const [localForecast, setLocalForecast] = useState<LocalForecast | null>(null)
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

  return (
    <Ctx.Provider value={{ data, stats, history, forecast, compare, localForecast, loading }}>{children}</Ctx.Provider>
  )
}

export function useStationData(): StationData {
  const c = useContext(Ctx)
  if (!c) throw new Error('useStationData must be used within StationDataProvider')
  return c
}
