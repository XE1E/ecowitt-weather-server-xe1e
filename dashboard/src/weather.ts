import { WeatherData } from './types'
import { LOCATION } from './config'

/**
 * Elevación del sol en grados, aproximada (declinación + ángulo horario, con la
 * corrección de longitud pero sin la ecuación del tiempo: el error de ±15 min no
 * cambia una clasificación de nubosidad).
 */
export function solarElevation(d: Date, latDeg: number, lonDeg: number): number {
  const rad = Math.PI / 180
  const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000)
  const decl = 23.45 * Math.sin(rad * 360 * (284 + doy) / 365)
  const solarH = d.getUTCHours() + d.getUTCMinutes() / 60 + lonDeg / 15
  const H = 15 * (solarH - 12)
  const s =
    Math.sin(rad * latDeg) * Math.sin(rad * decl) +
    Math.cos(rad * latDeg) * Math.cos(rad * decl) * Math.cos(rad * H)
  return Math.asin(Math.max(-1, Math.min(1, s))) / rad
}

/**
 * Índice de claridad: radiación medida ÷ la que habría con cielo despejado a esa
 * altura del sol. Es lo que permite juzgar la nubosidad sin depender de la hora.
 *
 * Con umbrales ABSOLUTOS de W/m², un amanecer perfectamente despejado (~100 W/m²)
 * se clasificaba como "Nublado" y un mediodía cubierto (~450) como "Despejado".
 *
 * Devuelve null con el sol bajo (< 5°), donde la medida no es concluyente.
 */
export function clearnessIndex(solarWm2: number, elevationDeg: number): number | null {
  if (elevationDeg < 5) return null
  const clearSky = 1361 * Math.sin(elevationDeg * Math.PI / 180)
  return clearSky > 0 ? solarWm2 / clearSky : null
}

export type FxType = 'rain' | 'snow' | 'storm' | 'fog' | 'clear' | 'cloudy' | 'partly-cloudy' | 'none'

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
      return { icon: 'thunderstorms-rain', label: 'Tormenta', fx: 'storm', intensity: 1 }
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

  // Nubosidad por índice de claridad, no por W/m² absolutos: así el juicio no
  // depende de la hora (ver clearnessIndex). Los cortes 0.65/0.35 son los que se
  // usan habitualmente para separar cielo despejado / parcial / cubierto.
  if (isDay) {
    const elev = solarElevation(new Date(), LOCATION.latitude, LOCATION.longitude)
    const kt = clearnessIndex(solar, elev)
    if (kt === null) {
      // Sol demasiado bajo para juzgar: no se afirma nubosidad.
      return { icon: 'partly-cloudy-day', label: 'Parcialmente nublado', fx: 'partly-cloudy', intensity: 0.5 }
    }
    if (kt > 0.65) return { icon: 'clear-day', label: 'Despejado', fx: 'clear', intensity: 0.7 }
    if (kt > 0.35) return { icon: 'partly-cloudy-day', label: 'Parcialmente nublado', fx: 'partly-cloudy', intensity: 0.5 }
    return { icon: 'overcast-day', label: 'Nublado', fx: 'cloudy', intensity: 0.6 }
  }
  // Night: stars effect for clear night
  if (humidity < 70) return { icon: 'clear-night', label: 'Noche despejada', fx: 'clear', intensity: 0.5 }
  return { icon: 'partly-cloudy-night', label: 'Noche nublada', fx: 'cloudy', intensity: 0.4 }
}

/**
 * Nombre e icono de la fase lunar a partir del % iluminado y de si crece.
 *
 * Réplica EXACTA del criterio de `_moon_phase_name` (almanac.py), que es la
 * fuente de verdad: el backend calcula la fase con pyephem y la página de
 * Astronomía muestra eso. Aquí sólo se replica la CLASIFICACIÓN, para que el
 * pronóstico y la consola —que estiman la iluminación con una aproximación
 * lineal del mes sinódico— no acaben dando otro nombre.
 *
 * Antes clasificaban por fracción de ciclo y el desacuerdo era visible: con la
 * luna al 59-62 % Astronomía decía "Gibosa menguante" y las otras dos "Cuarto
 * menguante", el mismo día.
 */
export function moonPhaseName(illum: number, waxing: boolean): { icon: string; label: string } {
  if (illum < 1) return { icon: 'moon-new', label: 'Luna nueva' }
  if (illum > 99) return { icon: 'moon-full', label: 'Luna llena' }
  if (illum >= 45 && illum <= 55) {
    return waxing
      ? { icon: 'moon-first-quarter', label: 'Cuarto creciente' }
      : { icon: 'moon-last-quarter', label: 'Cuarto menguante' }
  }
  if (illum < 45) {
    return waxing
      ? { icon: 'moon-waxing-crescent', label: 'Luna creciente' }
      : { icon: 'moon-waning-crescent', label: 'Luna menguante' }
  }
  return waxing
    ? { icon: 'moon-waxing-gibbous', label: 'Gibosa creciente' }
    : { icon: 'moon-waning-gibbous', label: 'Gibosa menguante' }
}

/**
 * Estado de la luna para una fecha, por aproximación lineal del mes sinódico.
 * Es una estimación: la fuente exacta es `/api/almanac` (pyephem). Se usa donde
 * no se quiere depender de una llamada al servidor.
 *
 *  - `phase`: fracción del ciclo 0..1 (0 = luna nueva). La necesita quien DIBUJA
 *    la luna, para el ancho del terminador.
 *  - `illum`: porcentaje iluminado, que es lo que clasifica `moonPhaseName`.
 *  - `waxing`: si crece.
 */
export function moonIllumination(d: Date): { phase: number; illum: number; waxing: boolean } {
  const syn = 29.530588853
  const ref = Date.UTC(2000, 0, 6, 18, 14)
  let age = ((d.getTime() - ref) / 86400000) % syn
  if (age < 0) age += syn
  const phase = age / syn
  return { phase, illum: ((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100, waxing: phase <= 0.5 }
}

/** Wet-bulb temperature (°C) from temp (°C) and RH (%), Stull's approximation. */
export function wetBulb(tempC: number, rh: number): number {
  const t = tempC
  return (
    t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(t + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  )
}

/** Beaufort scale from wind speed in km/h. */
export function beaufort(kmh: number): { scale: number; label: string } {
  const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]
  const labels = [
    'Calma', 'Ventolina', 'Brisa muy débil', 'Brisa débil', 'Brisa moderada',
    'Brisa fresca', 'Brisa fuerte', 'Viento fuerte', 'Temporal', 'Temporal fuerte',
    'Temporal duro', 'Temporal muy duro', 'Huracán',
  ]
  let scale = 0
  for (const l of limits) {
    if (kmh >= l) scale++
    else break
  }
  return { scale, label: labels[scale] }
}

/** Cardinal direction (Spanish) from degrees. */
export function cardinal(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

/**
 * El backend emite timestamps (received_at, etc.) como UTC SIN zona, p. ej.
 * "2026-07-20T00:54:41.9". `new Date()` interpretaría eso como hora LOCAL, lo
 * que en México (UTC-6) mete un desfase de 6 h. Añadimos 'Z' si el string no
 * trae zona para parsearlo correctamente como UTC.
 */
export function parseServerDate(iso: string): number {
  // Algunas fuentes separan fecha y hora con ESPACIO en vez de 'T' (p. ej. el
  // reportTime de aviationweather: "2026-08-04 21:00:00"). Sin normalizarlo, el
  // 'Z' que añadimos abajo produce un string que Date no parsea de forma fiable.
  const withT = iso.includes('T') ? iso : iso.replace(' ', 'T')
  const s = /[zZ]$|[+-]\d\d:?\d\d$/.test(withT) ? withT : withT + 'Z'
  return new Date(s).getTime()
}

/**
 * Valor de un histórico lo más cerca posible de hace `hoursAgo` horas, para
 * calcular tendencias. Devuelve null si el punto más cercano se aleja más de
 * 30 min del objetivo, de modo que tras un arranque o un hueco de datos no se
 * invente una tendencia con lo primero que haya.
 *
 * `pick` elige el campo en vez de indexar por string, así cada histórico
 * conserva su propio tipo. Si el campo no es numérico se devuelve null.
 *
 * Ojo con la alternativa tentadora de "restar N posiciones del arreglo"
 * (`rows[len-1] - rows[len-7]`): /api/history devuelve UN PUNTO POR MINUTO, así
 * que eso compara con 6 minutos atrás, no con 3 horas, y la tendencia sale
 * "estable" siempre. Este helper razona con TIEMPO, no con índices.
 */
export function historicValue<T extends { _time: string }>(
  rows: T[] | undefined,
  pick: (row: T) => number | string | null | undefined,
  hoursAgo: number,
): number | null {
  if (!rows || rows.length === 0) return null
  const target = Date.now() - hoursAgo * 60 * 60 * 1000
  let closest: T | null = null
  let closestDiff = Infinity
  for (const r of rows) {
    const diff = Math.abs(parseServerDate(r._time) - target)
    if (diff < closestDiff) { closestDiff = diff; closest = r }
  }
  if (!closest || closestDiff > 30 * 60 * 1000) return null
  const v = pick(closest)
  return typeof v === 'number' ? v : null
}

/** Human-friendly relative time, e.g. "hace 12 s" / "hace 3 min". */
export function relativeTime(iso?: string): string {
  if (!iso) return '—'
  const then = parseServerDate(iso)
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
  const then = parseServerDate(iso)
  if (Number.isNaN(then)) return false
  return (Date.now() - then) / 1000 > OFFLINE_AFTER_SECONDS
}
