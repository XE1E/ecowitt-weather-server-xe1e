/**
 * Iconografía: escala de tamaños y familias graduadas.
 *
 * ÚNICA fuente de verdad para "qué icono va con este valor". Antes cada tarjeta
 * elegía (o no elegía) su icono a mano y había 12 tamaños distintos en uso; aquí
 * quedan 5 y las familias que cambian con el dato viven en un solo lugar.
 *
 * Todos los nombres son de `@meteocons/svg` (MIT) y se pasan a <WeatherIcon>.
 * Ver docs/CONVENCIONES.md, que documenta esta misma escala.
 */

/**
 * Escala de tamaños. Cinco pasos, no doce. El 48 es el tamaño de tarjeta
 * estándar y es donde los iconos con número dentro (la familia Beaufort) se
 * vuelven legibles; por debajo de eso no se leen.
 */
export const ICON = {
  /** Inline en texto, celdas de tabla, chips. */
  inline: 32,
  /** Tarjetas compactas y tiras de resumen. */
  compact: 48,
  /** Tarjeta estándar: el tamaño por defecto de una tarjeta del dashboard. */
  card: 64,
  /** Destacados: condiciones actuales, encabezados de página. */
  hero: 96,
  /** Kiosco y pantalla completa. */
  kiosk: 140,
} as const

// ── Familias graduadas: el icono cambia con el valor, así que informa ──────────

/**
 * Presión: se usa la TENDENCIA, no el nivel, y con los chevrones —no con la
 * carátula de barómetro—.
 *
 * Dos razones, las dos comprobadas renderizando sobre el color real de la
 * tarjeta:
 *  1. Contraste. La familia `barometer-*` tiene la carátula gris oscuro sobre
 *     fondo oscuro: es un borrón del que solo se distingue la aguja, incluso a
 *     96 px. Un icono que no se lee al tamaño en que se usa no vale la pena.
 *     `pressure-high`/`pressure-low` son chevrones rojo y azul, legibles desde 48.
 *  2. Sentido. En presión lo que informa es hacia dónde va, no el valor absoluto
 *     (1015 estable no dice nada; 1015 cayendo desde 1020 sí).
 *
 * Devuelve null cuando está estable: mejor sin icono que uno que no aporta.
 */
export function iconTendenciaPresion(deltaHpa?: number | null): string | null {
  if (deltaHpa == null) return null
  if (deltaHpa > 1) return 'pressure-high'
  if (deltaHpa < -1) return 'pressure-low'
  return null
}

/**
 * Grado Beaufort (0-12) a partir de la velocidad en km/h. Los cortes son los de
 * la escala oficial; la tarjeta de viento ya muestra el grado en texto, así que
 * el icono y el número tienen que coincidir por construcción.
 */
export function gradoBeaufort(kmh?: number | null): number | null {
  if (kmh == null) return null
  const cortes = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]
  let g = 0
  for (const c of cortes) if (kmh >= c) g++
  return Math.min(g, 12)
}

/**
 * Icono de viento: manga normalmente, aviso cuando hay temporal (Beaufort ≥ 8).
 *
 * NO se usa la familia `wind-beaufort-0..12` aunque exista y calce 1 a 1 con el
 * grado: se probó renderizada y es un trazo blanco muy fino con un número gris
 * diminuto que NO se lee ni a 72 px. La manga se lee bien desde 32. Además
 * WindCard ya dibuja la escala Beaufort completa en segmentos de color, que
 * comunica el grado mucho mejor que el glifo.
 */
export function iconViento(kmh?: number | null): string {
  const g = gradoBeaufort(kmh)
  return g != null && g >= 8 ? 'wind-alert' : 'windsock'
}

/**
 * Nivel de aviso por índice de calidad del aire. Sirve para AQI y para IMECA:
 * los dos usan los mismos cortes de categoría (bueno / regular / mala / muy
 * mala / extremadamente mala) aunque las escalas difieran en el número.
 */
export function iconAire(indice?: number | null): string {
  if (indice == null) return 'dust'
  if (indice > 200) return 'code-purple'
  if (indice > 150) return 'code-red'
  if (indice > 100) return 'code-orange'
  if (indice > 50) return 'code-yellow'
  return 'code-green'
}

/** Índice UV: el icono numerado del propio paquete, con aviso arriba de 10. */
export function iconUv(uv?: number | null): string {
  if (uv == null) return 'uv-index'
  const n = Math.round(uv)
  if (n >= 11) return 'uv-index-alert'
  return n <= 0 ? 'uv-index' : `uv-index-${Math.min(n, 11)}`
}

/** Lluvia: distingue "está lloviendo ahora" de "hay acumulado". */
export function iconLluvia(tasaMmH?: number | null, acumuladoMm?: number | null): string {
  if (tasaMmH != null && tasaMmH > 0) {
    if (tasaMmH >= 10) return 'rain'          // intensa
    return 'drizzle'
  }
  return (acumuladoMm ?? 0) > 0 ? 'raindrops' : 'raindrop'
}

/**
 * Icono para una alerta activa, según su clave (`temp_high`, `pressure_drop`,
 * `gw1100:humidity_high`…). Se elige por VARIABLE y no un triángulo genérico:
 * así de un vistazo se sabe de qué es la alerta, no solo que hay una.
 * Las claves son las de receiver/app/services/alerts.py.
 */
export function iconAlerta(clave: string): string {
  const k = clave.includes(':') ? clave.split(':')[1] : clave   // quita la estación
  if (k === 'temp_drop' || k === 'temp_rise') return 'thermometer'
  if (k.startsWith('temp_') || k.startsWith('feels_')) return 'thermometer-warmer'
  if (k.startsWith('dew_')) return 'humidity'
  if (k.startsWith('humidity_')) return 'humidity'
  if (k === 'wind_high') return 'windsock'
  if (k === 'gust_high') return 'wind-alert'
  if (k.startsWith('rain_')) return 'raindrops'
  if (k === 'pressure_drop') return 'pressure-low'
  if (k === 'pressure_rise') return 'pressure-high'
  if (k.startsWith('pressure_')) return 'pressure-high'
  if (k === 'uv_high') return 'uv-index-alert'
  if (k === 'solar_high') return 'clear-day'
  if (k.startsWith('station_offline')) return 'not-available'
  if (k.startsWith('battery_')) return 'code-orange'
  if (k.startsWith('sensor_')) return 'not-available'
  if (k === 'aqi_high' || k === 'imeca_high') return 'dust'
  return 'code-orange'
}

/** Fase lunar → icono. `fase` es 0..1 (0 = luna nueva). */
export function iconLuna(fase: number): string {
  const f = ((fase % 1) + 1) % 1
  const nombres = [
    'moon-new', 'moon-waxing-crescent', 'moon-first-quarter', 'moon-waxing-gibbous',
    'moon-full', 'moon-waning-gibbous', 'moon-last-quarter', 'moon-waning-crescent',
  ]
  // 8 sectores centrados en cada fase (nueva abarca de -1/16 a +1/16).
  return nombres[Math.round(f * 8) % 8]
}
