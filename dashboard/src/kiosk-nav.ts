/**
 * Mapa de páginas del kiosco: la FUENTE ÚNICA de qué pantallas existen, cómo se
 * llaman, de quién cuelgan y cuánto vale su imagen.
 *
 * De aquí salen cuatro cosas que antes había que mantener a mano y sincronizadas:
 *  1. El enrutado de `KioskPage` (qué componente pinta cada `?page=`).
 *  2. Los botones de la barra inferior de cada pantalla.
 *  3. El TTL que la página le declara al renderer (`data-kiosk-ttl`), que es la
 *     palanca de CPU del VPS: no cuesta lo mismo redibujar la consola que un
 *     resumen mensual que sólo cambia una vez al día.
 *  4. La lista de slugs válidos, que el renderer valida con `PAGE_RE`.
 *
 * El FIRMWARE ya no sabe nada de esto. Antes tenía que coincidir con el array de
 * pestañas del dashboard ("el orden y el número deben coincidir en ambos lados", y
 * cada cambio de layout era un reflasheo); ahora recibe con cada imagen las zonas
 * táctiles que le tocan, medidas del DOM real. Añadir una pantalla es añadir una
 * fila aquí y desplegar.
 */

/**
 * Variables con página de detalle. El orden es el de la rejilla de la consola.
 *
 * NO hay una variable "sensores" (interior, jardín, remota) aunque la consola les
 * dedique cuatro celdas: el rollup diario sólo guarda los campos de la estación
 * principal --temp_*, hum_*, wind_*, gust_max, rain_*, press_*, uv_max, solar_max--
 * y ninguno por canal, así que sus periodos de 7 y 30 días saldrían vacíos. Esas
 * celdas llevan a la página 3, que ya enseña exactamente eso con el dato de ahora.
 */
export type VarKey = 'temp' | 'hum' | 'press' | 'wind' | 'rain' | 'sun'

/**
 * Periodos de la plantilla de detalle.
 *
 * `12m` son los últimos doce meses, ventana móvil, y NO el año en curso: en enero el
 * año en curso sería una sola columna. Sale de agrupar por año-mes los 365 días de
 * `/api/summaries/daily` --agrupar sólo por el número de mes juntaría agosto de este
 * año con el del anterior en la misma columna--.
 *
 * Las estadísticas sí usan el año calendario (`stats-ano`), que ahí es lo que se
 * espera de un "resumen del año".
 */
export type PeriodKey = '24h' | '7d' | '30d' | '12m'

/** Vistas de la página de estadísticas. */
export type StatsKey = 'hoy' | 'mes' | 'ano' | 'siempre'

export interface VarDef {
  /** Rótulo de la cabecera, en mayúsculas como el resto de la consola. */
  label: string
  /** Color de la variable. Es el MISMO en la web y en la consola. */
  color: string
  /** Clase de glow de la consola (arrastra DSEG7: sólo para cifras). */
  glow: string
  /** Qué celdas de la consola llevan a esta página (sólo documentación). */
  celdas: string
}

/**
 * La paleta no se inventa aquí: son los mismos colores que ya usan la consola y las
 * tarjetas de la web para cada variable, que es lo que permite que las pantallas
 * nuevas se sientan parte de lo mismo sin copiar ningún layout.
 */
export const VARIABLES: Record<VarKey, VarDef> = {
  temp:  { label: 'TEMPERATURA', color: '#f97316', glow: 'gt', celdas: 'EXT · ROCÍO/SENSACIÓN/HUMIDEX' },
  hum:   { label: 'HUMEDAD',     color: '#3b82f6', glow: 'gh', celdas: 'HUMEDAD' },
  press: { label: 'PRESIÓN',     color: '#8b5cf6', glow: 'gp', celdas: 'PRES · PRESIÓN REMOTA' },
  wind:  { label: 'VIENTO',      color: '#22c55e', glow: 'gv', celdas: 'compás · velocidad/rumbo' },
  rain:  { label: 'LLUVIA',      color: '#38bdf8', glow: 'gr', celdas: 'LLUVIA' },
  sun:   { label: 'SOL Y UV',    color: '#ffcf19', glow: 'gy', celdas: 'SOLAR/UV/ICA' },
}

export interface PeriodDef {
  /** Texto del botón. */
  label: string
  /** Segundos que el renderer puede reusar la imagen (ver `data-kiosk-ttl`). */
  ttl: number
}

/**
 * TTL creciente con el periodo, y ésa es toda la política de caché.
 *
 * Las 24 h se mueven con cada lectura, pero de 7 días en adelante lo que se dibuja
 * son RESÚMENES DIARIOS, que el rollup escribe una vez al terminar el día: volver a
 * renderizar el mensual cada 45 s sería quemar los 2 vCPU del VPS para redibujar
 * exactamente lo mismo. El único que cambia dentro del día es el último punto de la
 * serie, y a 15-30 min de retraso nadie lo nota en una pantalla de pared.
 */
export const PERIODOS: Record<PeriodKey, PeriodDef> = {
  '24h': { label: '24 H',  ttl: 300 },
  '7d':  { label: '7 DÍAS', ttl: 900 },
  '30d': { label: '30 DÍAS', ttl: 1800 },
  '12m': { label: '12 MESES', ttl: 3600 },
}

export const STATS_VIEWS: Record<StatsKey, { label: string; ttl: number }> = {
  hoy:     { label: 'HOY',     ttl: 300 },
  mes:     { label: 'MES',     ttl: 1800 },
  ano:     { label: 'AÑO',     ttl: 3600 },
  siempre: { label: 'SIEMPRE', ttl: 3600 },
}

/**
 * Cámara del exterior (Tapo C325WB, ver `docs/internal/PLAN-CAMARA-EXTERIOR.md`).
 *
 * El slug se reserva ya aunque la cámara todavía no esté instalada, y la página
 * degrada con gracia mientras tanto. Aquel plan daba por hecho que meter la cámara
 * en el kiosco sería "la 7ª pestaña" y que obligaba a tocar el firmware, subiendo
 * `NUM_PAGES` en el otro repo y reflasheando; con el mapa de zonas eso ya no aplica:
 * es una fila más en esta tabla. El propio documento apuntaba a esta salida --"conviene
 * decidir si se generaliza el mapeo en el firmware en vez de acumular casos
 * particulares"--.
 *
 * TTL de 5 min porque la captura se acordó cada 5-10: pedirla más seguido sólo
 * redibuja la misma foto.
 */
export const CAMARA_TTL = 300

/** Las cinco páginas clásicas, que se conservan tal cual y cuelgan del menú. */
export const CLASICAS = [
  { page: '1', label: 'ESTACIÓN', desc: 'Resumen y pronóstico de 6 h' },
  { page: '2', label: 'LOCAL',    desc: 'BME280 de este display' },
  { page: '3', label: 'SENSORES', desc: 'Interior, jardín y remota' },
  { page: '4', label: '7 DÍAS',   desc: 'Pronóstico de la semana' },
  { page: '5', label: '48 H',     desc: 'Resumen multivariable' },
] as const

export const VAR_KEYS = Object.keys(VARIABLES) as VarKey[]
export const PERIOD_KEYS = Object.keys(PERIODOS) as PeriodKey[]
export const STATS_KEYS = Object.keys(STATS_VIEWS) as StatsKey[]

export const detSlug = (v: VarKey, p: PeriodKey) => `det-${v}-${p}`
export const statsSlug = (s: StatsKey) => `stats-${s}`

/**
 * Regex de slugs válidos. La usa el renderer para no abrir Chromium con cualquier
 * cosa que llegue por la query (antes era una lista fija de seis entradas, que con
 * 33 pantallas ya no se puede mantener a mano).
 *
 * Se construye desde las tablas de arriba para que no pueda quedarse desfasada, y se
 * exporta también como texto: `renderer/app.py` la lee de `/kiosk/pages.json`, que
 * publica esta misma función.
 */
export const PAGE_RE = new RegExp(
  `^(consola|menu|camara|[1-5]`
  + `|det-(${VAR_KEYS.join('|')})-(${PERIOD_KEYS.join('|')})`
  + `|stats-(${STATS_KEYS.join('|')}))$`
)

/** Todos los slugs existentes. Lo usa el script de captura masiva y la validación. */
export function allSlugs(): string[] {
  const out = ['consola', 'menu', 'camara', '1', '2', '3', '4', '5']
  for (const v of VAR_KEYS) for (const p of PERIOD_KEYS) out.push(detSlug(v, p))
  for (const s of STATS_KEYS) out.push(statsSlug(s))
  return out
}

export type Parsed =
  | { kind: 'consola' }
  | { kind: 'menu' }
  | { kind: 'camara' }
  | { kind: 'clasica'; page: string }
  | { kind: 'det'; v: VarKey; p: PeriodKey }
  | { kind: 'stats'; s: StatsKey }

/** Slug → qué hay que pintar. Devuelve la consola ante cualquier cosa rara. */
export function parseSlug(slug: string): Parsed {
  if (slug === 'menu') return { kind: 'menu' }
  if (slug === 'camara') return { kind: 'camara' }
  if (/^[1-5]$/.test(slug)) return { kind: 'clasica', page: slug }
  const d = /^det-([a-z]+)-([a-z0-9]+)$/.exec(slug)
  if (d && d[1] in VARIABLES && d[2] in PERIODOS) {
    return { kind: 'det', v: d[1] as VarKey, p: d[2] as PeriodKey }
  }
  const s = /^stats-([a-z]+)$/.exec(slug)
  if (s && s[1] in STATS_VIEWS) return { kind: 'stats', s: s[1] as StatsKey }
  return { kind: 'consola' }
}

/**
 * Destino del toque FUERA de cualquier botón, o sea el padre lógico.
 *
 * Detalle y estadísticas devuelven la CONSOLA, no el periodo o la vista anterior:
 * dentro de esas pantallas los periodos y las vistas ya se alcanzan entre sí con sus
 * propios botones, así que lo que hace falta del toque fuera es la salida a la pantalla
 * de inicio, de un solo toque y sin apuntar.
 *
 * OJO: hoy esto es sólo el respaldo. El firmware lleva su propia pila de navegación y
 * al tocar fuera hace `pop`, así que vuelve por donde vino de verdad; este `back` se usa
 * cuando la pila está vacía —por ejemplo si el display arranca directamente en una
 * subpágina tras un reinicio— para que nunca quede atrapado sin salida. Para que el
 * toque fuera lleve SIEMPRE a la consola hay que hacer que el firmware prefiera este
 * campo a su pila (repo `ecowitt-display-kiosk-xe1e`, `nav_pop` en `src/nav.h`).
 */
export function parentOf(slug: string): string {
  const p = parseSlug(slug)
  switch (p.kind) {
    case 'consola': return 'consola'
    case 'menu':    return 'consola'
    case 'camara':  return 'menu'
    case 'clasica': return 'menu'
    case 'stats':   return 'consola'
    case 'det':     return 'consola'
  }
}

/**
 * Segundos que vale la imagen de esta página. La consola y las páginas clásicas se
 * quedan en los 45 s de siempre: son el dato vivo.
 */
export function ttlOf(slug: string): number {
  const p = parseSlug(slug)
  switch (p.kind) {
    case 'det':     return PERIODOS[p.p].ttl
    case 'stats':   return STATS_VIEWS[p.s].ttl
    case 'camara':  return CAMARA_TTL
    case 'menu':    return 3600
    case 'clasica': return p.page === '4' ? 900 : p.page === '5' ? 300 : 45
    default:        return 45
  }
}

/**
 * Zonas táctiles de la CONSOLA: qué celda lleva a qué pantalla.
 *
 * No hay coordenadas aquí a propósito. La clave se pone como `data-nav` en la celda
 * de `ConsoleReplica` y el rectángulo se mide del DOM ya renderizado, así que si una
 * celda se mueve o cambia de tamaño, su zona la sigue sola. Escribir las
 * coordenadas a mano es justo lo que haría que esto se pudriera al primer retoque
 * de layout.
 */
export const CONSOLA_NAV = {
  ext:      detSlug('temp', '24h'),
  humedad:  detSlug('hum', '24h'),
  presion:  detSlug('press', '24h'),
  viento:   detSlug('wind', '24h'),
  lluvia:   detSlug('rain', '24h'),
  derivadas: detSlug('temp', '24h'),   // ROCÍO / SENSACIÓN / HUMIDEX
  solar:    detSlug('sun', '24h'),     // SOLAR + UV + ICA
  // Las cuatro celdas de sensores van a la página 3, que ya los muestra juntos con
  // el dato de ahora. No tienen detalle histórico propio porque el rollup no guarda
  // los canales; ver el comentario de VarKey.
  interior: '3',
  jardin:   '3',
  remota:   '3',
  remotaP:  '3',
  cielo:    '4',                        // condición y luna → pronóstico de 7 días
  reloj:    'menu',                     // el reloj abre el menú de las clásicas
} as const
