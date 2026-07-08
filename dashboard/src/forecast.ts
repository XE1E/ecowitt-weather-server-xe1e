import { LOCATION } from './config'

export interface ForecastDay {
  date: string      // ISO date
  icon: string      // meteocons icon
  label: string
  tempMax: number
  tempMin: number
  precipProb: number
}

export interface AstroData {
  sunrise: string   // ISO
  sunset: string    // ISO
  moonIcon: string
  moonLabel: string
}

export interface ForecastHour {
  time: string       // ISO
  temp: number
  precipProb: number
  icon: string
}

export interface ForecastResult {
  days: ForecastDay[]
  hours: ForecastHour[]
  astro: AstroData
}

// WMO weather code -> meteocons (day variant) + Spanish label
function wmoToIcon(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: 'clear-day', label: 'Despejado' }
  if (code === 1 || code === 2) return { icon: 'partly-cloudy-day', label: 'Parcialmente nublado' }
  if (code === 3) return { icon: 'overcast-day', label: 'Nublado' }
  if (code === 45 || code === 48) return { icon: 'fog-day', label: 'Niebla' }
  if (code >= 51 && code <= 57) return { icon: 'partly-cloudy-day-drizzle', label: 'Llovizna' }
  if (code >= 61 && code <= 65) return { icon: 'overcast-day-rain', label: 'Lluvia' }
  if (code === 66 || code === 67) return { icon: 'overcast-day-sleet', label: 'Lluvia helada' }
  if (code >= 71 && code <= 77) return { icon: 'overcast-day-snow', label: 'Nieve' }
  if (code >= 80 && code <= 82) return { icon: 'partly-cloudy-day-rain', label: 'Chubascos' }
  if (code === 85 || code === 86) return { icon: 'overcast-day-snow', label: 'Chubascos de nieve' }
  if (code >= 95) return { icon: 'thunderstorms-day-rain', label: 'Tormenta' }
  return { icon: 'clear-day', label: '—' }
}

// Moon phase from date (synodic month approximation)
export function moonPhase(date: Date): { icon: string; label: string } {
  const synodic = 29.530588853
  const knownNew = Date.UTC(2000, 0, 6, 18, 14, 0)
  let age = ((date.getTime() - knownNew) / 86400000) % synodic
  if (age < 0) age += synodic
  const f = age / synodic
  const phases: [number, string, string][] = [
    [0.0625, 'moon-new', 'Luna nueva'],
    [0.1875, 'moon-waxing-crescent', 'Creciente iluminante'],
    [0.3125, 'moon-first-quarter', 'Cuarto creciente'],
    [0.4375, 'moon-waxing-gibbous', 'Gibosa creciente'],
    [0.5625, 'moon-full', 'Luna llena'],
    [0.6875, 'moon-waning-gibbous', 'Gibosa menguante'],
    [0.8125, 'moon-last-quarter', 'Cuarto menguante'],
    [0.9375, 'moon-waning-crescent', 'Creciente menguante'],
  ]
  for (const [limit, icon, label] of phases) {
    if (f < limit) return { icon, label }
  }
  return { icon: 'moon-new', label: 'Luna nueva' }
}

export async function fetchForecast(): Promise<ForecastResult> {
  const { latitude, longitude } = LOCATION
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
    `&hourly=weather_code,temperature_2m,precipitation_probability` +
    `&timezone=auto&forecast_days=7`

  const res = await fetch(url)
  if (!res.ok) throw new Error('Error al obtener el pronóstico')
  const j = await res.json()
  const d = j.daily

  const days: ForecastDay[] = d.time.map((date: string, i: number) => {
    const { icon, label } = wmoToIcon(d.weather_code[i])
    return {
      date,
      icon,
      label,
      tempMax: d.temperature_2m_max[i],
      tempMin: d.temperature_2m_min[i],
      precipProb: d.precipitation_probability_max?.[i] ?? 0,
    }
  })

  // Horario: desde "ahora" hacia adelante (próximas ~24 h)
  const h = j.hourly
  const nowMs = Date.now()
  const hours: ForecastHour[] = []
  for (let i = 0; i < h.time.length && hours.length < 24; i++) {
    if (new Date(h.time[i]).getTime() < nowMs - 3600000) continue
    hours.push({
      time: h.time[i],
      temp: h.temperature_2m[i],
      precipProb: h.precipitation_probability?.[i] ?? 0,
      icon: wmoToIcon(h.weather_code[i]).icon,
    })
  }

  const astro: AstroData = {
    sunrise: d.sunrise[0],
    sunset: d.sunset[0],
    ...moonPhaseFields(),
  }

  return { days, hours, astro }
}

function moonPhaseFields() {
  const { icon, label } = moonPhase(new Date())
  return { moonIcon: icon, moonLabel: label }
}
