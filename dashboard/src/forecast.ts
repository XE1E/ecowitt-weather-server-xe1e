import { LOCATION } from './config'
import { moonIllumination, moonPhaseName } from './weather'

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
  precipSum?: number     // mm de precipitación acumulada del día
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

/**
 * Código WMO -> icono meteocons + etiqueta en español.
 *
 * `isDay` elige la variante: antes se devolvía SIEMPRE la diurna, y como también
 * se usa para el pronóstico HORARIO, a las 3 de la madrugada se mostraba un sol.
 * Todos estos iconos tienen pareja `-night` en la galería.
 */
function wmoToIcon(code: number, isDay = true): { icon: string; label: string } {
  const s = isDay ? 'day' : 'night'
  if (code === 0) return { icon: `clear-${s}`, label: 'Despejado' }
  if (code === 1 || code === 2) return { icon: `partly-cloudy-${s}`, label: 'Parcialmente nublado' }
  if (code === 3) return { icon: `overcast-${s}`, label: 'Nublado' }
  if (code === 45 || code === 48) return { icon: `fog-${s}`, label: 'Niebla' }
  if (code >= 51 && code <= 57) return { icon: `partly-cloudy-${s}-drizzle`, label: 'Llovizna' }
  if (code >= 61 && code <= 65) return { icon: `overcast-${s}-rain`, label: 'Lluvia' }
  if (code === 66 || code === 67) return { icon: `overcast-${s}-sleet`, label: 'Lluvia helada' }
  if (code >= 71 && code <= 77) return { icon: `overcast-${s}-snow`, label: 'Nieve' }
  if (code >= 80 && code <= 82) return { icon: `partly-cloudy-${s}-rain`, label: 'Chubascos' }
  if (code === 85 || code === 86) return { icon: `overcast-${s}-snow`, label: 'Chubascos de nieve' }
  if (code >= 95) return { icon: `thunderstorms-${s}-rain`, label: 'Tormenta' }
  return { icon: `clear-${s}`, label: '—' }
}

/**
 * Fase lunar para una fecha.
 *
 * Clasifica por ILUMINACIÓN con el mismo criterio que el backend (pyephem), no
 * por fracción de ciclo como antes. Ese era el desacuerdo: con la luna al 59-62 %
 * la página de Astronomía decía "Gibosa menguante" y el pronóstico "Cuarto
 * menguante" el mismo día, porque cada uno cortaba el ciclo por su lado.
 *
 * La iluminación sigue siendo una estimación local (mes sinódico lineal); la
 * fuente exacta es `/api/almanac`.
 */
export function moonPhase(date: Date): { icon: string; label: string } {
  const { illum, waxing } = moonIllumination(date)
  return moonPhaseName(illum, waxing)
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
  // Misma fórmula que el resto del sitio, no una copia local.
  const frac = (d: Date) => moonIllumination(d).phase
  // Fecha LOCAL: con toISOString() (UTC) una fase de la tarde en México se
  // anunciaba un día después.
  const p2 = (n: number) => String(n).padStart(2, '0')
  const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  const events: SkyEvent[] = []
  const start = new Date()
  let prev = frac(start)
  for (let day = 1; day <= 45 && events.length < count; day++) {
    const d = new Date(start.getTime() + day * 86400000)
    const f = frac(d)
    for (const [t, icon, label] of targets) {
      const crossed = prev <= f ? t > prev && t <= f : t > prev || t <= f
      if (crossed) events.push({ date: localDay(d), icon, label })
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
/**
 * Código que MÁS HORAS ocupa en el periodo (moda). Antes esta función devolvía
 * el de mayor severidad, así que una sola hora con tormenta hacía que el día
 * entero se describiera como "tormentas". Lo severo no se pierde: se menciona
 * aparte con `severeCode`.
 *
 * Los empates se rompen por severidad, para no describir como despejado un día
 * que estuvo mitad y mitad.
 */
function dominantCode(codes: number[]): number {
  if (!codes.length) return 0
  const freq = new Map<number, number>()
  for (const c of codes) freq.set(c, (freq.get(c) ?? 0) + 1)
  let best = codes[0]
  let bestN = 0
  for (const [c, n] of freq) {
    if (n > bestN || (n === bestN && cloudRank(c) > cloudRank(best))) {
      best = c
      bestN = n
    }
  }
  return best
}

/**
 * Código severo (tormenta o lluvia fuerte) presente en el periodo, si lo hay y
 * no es ya el dominante. Sirve para mencionarlo sin dejar que se coma el resumen.
 */
function severeCode(codes: number[], dominant: number): number | null {
  const severe = codes.filter((c) => cloudRank(c) >= 5)
  if (!severe.length) return null
  const worst = severe.reduce((a, b) => (cloudRank(b) > cloudRank(a) ? b : a))
  return cloudRank(worst) > cloudRank(dominant) ? worst : null
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
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset` +
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

    // Lo severo (tormenta / lluvia fuerte) se menciona aparte cuando no es lo
    // dominante, con la franja en que aparece: así no se pierde el aviso, pero
    // tampoco describe el día entero por una hora suelta.
    const allCodes = idxs.map((k) => H.weather_code[k])
    const severe = severeCode(allCodes, skyDay)
    let severeText = ''
    if (severe != null) {
      const hrs = idxs.filter((k) => cloudRank(H.weather_code[k]) >= 5).map(hourAt)
      const franja = hrs.some((x) => x >= 12 && x < 18) ? 'por la tarde'
        : hrs.some((x) => x >= 18) ? 'por la noche'
        : 'por la mañana'
      severeText = `Puede haber ${skyWord(severe)} ${franja}.`
    }

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
      summary: [skyText, severeText, precipText, windText].filter(Boolean).join(' '),
      tempMorning,
      tempAfternoon,
      precipSum: d.precipitation_sum?.[i],
    }
  })

  // Amanecer/atardecer por día, para saber si cada hora del pronóstico es diurna
  // y elegir el icono correcto (antes todas usaban la variante de día).
  const sunByDay: Record<string, [number, number]> = {}
  d.time.forEach((date: string, i: number) => {
    const sr = d.sunrise?.[i], ss = d.sunset?.[i]
    if (sr && ss) sunByDay[date] = [new Date(sr).getTime(), new Date(ss).getTime()]
  })
  const isDayAt = (t: string): boolean => {
    const r = sunByDay[String(t).slice(0, 10)]
    if (!r) return true
    const ms = new Date(t).getTime()
    return ms >= r[0] && ms < r[1]
  }

  // Horario: desde "ahora" hacia adelante (próximas ~24 h)
  const h = j.hourly
  const nowMs = Date.now()
  const hours: ForecastHour[] = []
  for (let i = 0; i < h.time.length && hours.length < 48; i++) {
    if (new Date(h.time[i]).getTime() < nowMs - 3600000) continue
    hours.push({
      time: h.time[i],
      temp: h.temperature_2m[i],
      precipProb: h.precipitation_probability?.[i] ?? 0,
      icon: wmoToIcon(h.weather_code[i], isDayAt(h.time[i])).icon,
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
