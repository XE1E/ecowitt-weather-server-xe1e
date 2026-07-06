import { WeatherData } from './types'

export type FxType = 'rain' | 'snow' | 'lightning' | 'fog' | 'none'

export interface Condition {
  icon: string        // meteocons icon name
  label: string       // Spanish label
  fx: FxType
  intensity: number   // 0..1, drives FX density
}

/**
 * Ecowitt stations don't send a "weather condition" code, so we derive one from
 * the available measurements (rain rate, solar radiation, UV, temperature,
 * humidity, wind) plus day/night. Good enough for the hero icon and FX theme.
 */
export function deriveCondition(d: WeatherData): Condition {
  const hour = new Date().getHours()
  const solar = d.solar_radiation ?? 0
  const isDay = solar > 5 || (hour >= 7 && hour < 19)
  const suffix = isDay ? 'day' : 'night'

  const rain = d.rain_rate ?? 0
  const temp = d.temperature_outdoor ?? 15
  const humidity = d.humidity_outdoor ?? 50
  const wind = d.wind_speed ?? 0
  const lightning = d.rain_event // not real lightning; placeholder, see below

  // Precipitation
  if (rain > 0) {
    const snowing = temp <= 1
    const heavy = rain >= 7.6
    const moderate = rain >= 2.5
    if (snowing) {
      return { icon: 'snow', label: 'Nieve', fx: 'snow', intensity: heavy ? 1 : moderate ? 0.6 : 0.35 }
    }
    // Heavy rain with lightning sensor activity -> thunderstorm
    if (heavy && lightning) {
      return { icon: 'thunderstorms-rain', label: 'Tormenta', fx: 'lightning', intensity: 1 }
    }
    if (heavy) return { icon: `overcast-${suffix}-rain`, label: 'Lluvia fuerte', fx: 'rain', intensity: 1 }
    if (moderate) return { icon: `overcast-${suffix}-rain`, label: 'Lluvia', fx: 'rain', intensity: 0.7 }
    return { icon: 'drizzle', label: 'Llovizna', fx: 'rain', intensity: 0.35 }
  }

  // Fog / mist: very humid and calm
  if (humidity >= 95 && wind < 8) {
    return { icon: isDay ? 'fog-day' : 'fog-night', label: 'Niebla', fx: 'fog', intensity: 0.7 }
  }
  if (humidity >= 90 && wind < 10) {
    return { icon: 'mist', label: 'Neblina', fx: 'fog', intensity: 0.4 }
  }

  // Clear / cloudy inferred from solar radiation during the day
  if (isDay) {
    if (solar > 450) return { icon: 'clear-day', label: 'Despejado', fx: 'none', intensity: 0 }
    if (solar > 120) return { icon: 'partly-cloudy-day', label: 'Parcialmente nublado', fx: 'none', intensity: 0 }
    return { icon: 'overcast-day', label: 'Nublado', fx: 'none', intensity: 0 }
  }
  // Night: cannot detect clouds without more data
  return { icon: 'clear-night', label: 'Noche despejada', fx: 'none', intensity: 0 }
}

/** Human-friendly relative time, e.g. "hace 12 s" / "hace 3 min". */
export function relativeTime(iso?: string): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `hace ${secs} s`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.round(mins / 60)
  return `hace ${hrs} h`
}

/** A reading is considered stale/offline if older than this many seconds. */
export const OFFLINE_AFTER_SECONDS = 5 * 60

export function isStale(iso?: string): boolean {
  if (!iso) return false
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return false
  return (Date.now() - then) / 1000 > OFFLINE_AFTER_SECONDS
}
