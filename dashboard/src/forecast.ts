import { LOCATION } from './config'

export interface ForecastDay {
  date: string      // ISO date
  icon: string      // meteocons icon
  label: string
  tempMax: number
  tempMin: number
  precipProb: number
  windMax?: number  // km/h (viento máx del día)
  windDir?: number  // grados (dirección dominante)
  code?: number     // código WMO (para la descripción)
  summary?: string  // descripción en prosa (cielo + lluvia + viento), sin temperaturas
  tempMorning?: number   // °C aprox. por la mañana (~09h)
  tempAfternoon?: number // °C aprox. por la tarde (~15h)
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

export interface SkyEvent {
  date: string
  icon: string
  label: string
}

/** Próximas fases lunares principales (nueva, cuartos, llena). */
export function upcomingMoonEvents(count = 4): SkyEvent[] {
  const targets: [number, string, string][] = [
    [0, 'moon-new', 'Luna nueva'],
    [0.25, 'moon-first-quarter', 'Cuarto creciente'],
    [0.5, 'moon-full', 'Luna llena'],
    [0.75, 'moon-last-quarter', 'Cuarto menguante'],
  ]
  const synodic = 29.530588853
  const knownNew = Date.UTC(2000, 0, 6, 18, 14, 0)
  const frac = (d: Date) => {
    let age = ((d.getTime() - knownNew) / 86400000) % synodic
    if (age < 0) age += synodic
    return age / synodic
  }
  const events: SkyEvent[] = []
  const start = new Date()
  let prev = frac(start)
  for (let day = 1; day <= 45 && events.length < count; day++) {
    const d = new Date(start.getTime() + day * 86400000)
    const f = frac(d)
    for (const [t, icon, label] of targets) {
      const crossed = prev <= f ? t > prev && t <= f : t > prev || t <= f
      if (crossed) events.push({ date: d.toISOString().slice(0, 10), icon, label })
    }
    prev = f
  }
  return events.slice(0, count)
}

// --- Generación de descripción en prosa por día ---
function skyWord(code: number): string {
  if (code === 0) return 'cielos despejados'
  if (code === 1) return 'cielos mayormente despejados'
  if (code === 2) return 'cielos parcialmente nublados'
  if (code === 3) return 'cielos nublados'
  if (code === 45 || code === 48) return 'niebla'
  if (code >= 51 && code <= 57) return 'llovizna'
  if (code >= 61 && code <= 67) return 'lluvia'
  if (code >= 71 && code <= 77) return 'nieve'
  if (code >= 80 && code <= 82) return 'chubascos'
  if (code >= 85 && code <= 86) return 'chubascos de nieve'
  if (code >= 95) return 'tormentas'
  return 'condiciones variables'
}
// Ranking de "nubosidad/severidad" para saber si el cielo empeora o mejora
function cloudRank(code: number): number {
  if (code >= 95) return 6
  if (code >= 61) return 5
  if (code >= 51) return 4
  if (code === 3 || code === 45 || code === 48) return 3
  if (code === 2) return 2
  if (code === 1) return 1
  return 0
}
function dominantCode(codes: number[]): number {
  if (!codes.length) return 0
  return codes.reduce((a, b) => (cloudRank(b) > cloudRank(a) ? b : a))
}
function cardinalWord(deg: number): string {
  const dirs = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste']
  return dirs[Math.round(deg / 45) % 8]
}
function windDescriptor(kmh: number): string {
  if (kmh < 2) return 'calma'
  if (kmh < 12) return 'una brisa suave'
  if (kmh < 20) return 'una brisa moderada'
  if (kmh < 30) return 'viento moderado'
  if (kmh < 45) return 'viento fuerte'
  return 'viento muy fuerte'
}

/** Descripción completa del día, con las temperaturas formateadas por `ft`. */
export function describeDay(d: ForecastDay, ft: (c: number) => string): string {
  const base = d.summary ?? d.label
  if (d.tempMorning != null && d.tempAfternoon != null) {
    return `${base} Las temperaturas oscilarán entre ${ft(d.tempMorning)} por la mañana y ${ft(d.tempAfternoon)} por la tarde.`
  }
  return `${base} Máxima de ${ft(d.tempMax)} y mínima de ${ft(d.tempMin)}.`
}

export async function fetchForecast(): Promise<ForecastResult> {
  const { latitude, longitude } = LOCATION
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset` +
    `&hourly=weather_code,temperature_2m,precipitation_probability` +
    `&timezone=auto&forecast_days=7`

  const res = await fetch(url)
  if (!res.ok) throw new Error('Error al obtener el pronóstico')
  const j = await res.json()
  const d = j.daily
  const H = j.hourly

  const days: ForecastDay[] = d.time.map((date: string, i: number) => {
    const { icon, label } = wmoToIcon(d.weather_code[i])

    // Índices horarios de ESTE día y helper de hora local
    const idxs: number[] = H.time
      .map((t: string, k: number) => (String(t).startsWith(date) ? k : -1))
      .filter((k: number) => k >= 0)
    const hourAt = (k: number) => new Date(H.time[k]).getHours()
    const dayCodes = idxs.filter((k) => hourAt(k) >= 6 && hourAt(k) < 18).map((k) => H.weather_code[k])
    const nightCodes = idxs.filter((k) => hourAt(k) >= 18).map((k) => H.weather_code[k])

    const skyDay = dominantCode(dayCodes.length ? dayCodes : [d.weather_code[i]])
    const skyNight = dominantCode(nightCodes.length ? nightCodes : [skyDay])

    // Cielo (con evolución día -> noche)
    let skyText = `Se esperan ${skyWord(skyDay)}`
    const rDay = cloudRank(skyDay), rNight = cloudRank(skyNight)
    if (rNight > rDay) skyText += `, volviéndose ${skyWord(skyNight)} por la noche`
    else if (rNight < rDay && rDay >= 2) skyText += ', despejando por la noche'
    skyText += '.'

    // Lluvia (¿seco? / probabilidad y periodo)
    const probAt = (k: number) => H.precipitation_probability?.[k] ?? 0
    const periodMax = (a: number, b: number) =>
      Math.max(0, ...idxs.filter((k) => hourAt(k) >= a && hourAt(k) < b).map(probAt))
    const pMorning = periodMax(6, 12), pAfternoon = periodMax(12, 18), pNight = periodMax(18, 24)
    const maxP = Math.max(pMorning, pAfternoon, pNight, d.precipitation_probability_max?.[i] ?? 0)
    let precipText: string
    if (maxP < 15) {
      precipText = 'Permanecerá seco durante todo el día.'
    } else {
      const periodo = maxP === pAfternoon ? 'por la tarde' : maxP === pNight ? 'por la noche' : 'por la mañana'
      const verbo = maxP >= 60 ? 'Se esperan lluvias' : 'Posibilidad de lluvia'
      precipText = `${verbo} ${periodo} (${maxP}%).`
    }

    // Viento
    const windMax = d.wind_speed_10m_max?.[i]
    const windDir = d.wind_direction_10m_dominant?.[i]
    let windText = ''
    if (windMax != null) {
      const desc = windDescriptor(windMax)
      windText = desc === 'calma'
        ? 'El aire estará prácticamente en calma.'
        : `El viento será ${desc}${windDir != null ? ' desde el ' + cardinalWord(windDir) : ''}.`
    }

    // Temperaturas por la mañana (~09h) y por la tarde (~15h)
    const tempAtHour = (hh: number) => {
      const k = idxs.find((k) => hourAt(k) === hh)
      return k != null ? H.temperature_2m[k] : undefined
    }
    const tempMorning = tempAtHour(9) ?? d.temperature_2m_min[i]
    const tempAfternoon = tempAtHour(15) ?? d.temperature_2m_max[i]

    return {
      date,
      icon,
      label,
      tempMax: d.temperature_2m_max[i],
      tempMin: d.temperature_2m_min[i],
      precipProb: d.precipitation_probability_max?.[i] ?? 0,
      windMax,
      windDir,
      code: d.weather_code[i],
      summary: [skyText, precipText, windText].filter(Boolean).join(' '),
      tempMorning,
      tempAfternoon,
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
