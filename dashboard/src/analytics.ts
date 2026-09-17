import posthog from 'posthog-js'

// Project key de PostHog: es pública por diseño (se embebe en el cliente,
// igual que un ID de Google Analytics) -- no es un secreto de servidor, así
// que no necesita vivir en settings.json/Admin como las claves de las redes
// de publicación.
const POSTHOG_KEY = 'phc_twZYc4mKkWZYKjQqK7MbNnGEBicxQaod7im4aJEEk7GK'
const POSTHOG_HOST = 'https://us.i.posthog.com'

let initialized = false

/**
 * Arranca PostHog. Se llama solo desde las vistas PÚBLICAS (clásica y /pro)
 * -- deliberadamente NO desde /admin (panel privado, rastrearlo no aporta y
 * mezclaría acciones del dueño con visitas reales), /kiosko (un solo
 * dispositivo físico en loop infinito, no un "visitante") ni /embed (widget
 * incrustado en OTROS sitios -- medir eso sería medir tráfico ajeno).
 *
 * `capture_pageview: false` porque las páginas con router (`/pro`) navegan
 * sin recargar -- el pageview de cada ruta lo dispara `<RouteTracker>` (ver
 * abajo), incluido el de la carga inicial, para no duplicarlo entre el
 * autocapture de `init()` y el primer render de `<RouteTracker>`.
 */
export function initAnalytics(): void {
  if (initialized) return
  initialized = true
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false,
  })
}

/**
 * Evento propio, más allá del `$pageview` y el autocapture de clics de
 * PostHog (que sí sigue activo, pero da nombres de evento genéricos --
 * "clicked <button>" sin contexto de negocio). Antes de esto no había NADA
 * con nombre propio: imposible saber, por ejemplo, si alguien usa el
 * radar o el historial de alertas sin adivinar a partir de autocapture.
 *
 * No-op fuera de las vistas donde corre `initAnalytics()` (admin/kiosko/embed)
 * -- varios de los componentes que llaman esto (UnitsProvider, RadarCard) se
 * comparten con esas vistas -- y nunca debe tumbar la interacción real que
 * lo dispara si PostHog fallara por lo que sea.
 */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!initialized) return
  try {
    posthog.capture(name, props)
  } catch {
    // intencional: la analítica nunca debe romper la app
  }
}

export { posthog }
