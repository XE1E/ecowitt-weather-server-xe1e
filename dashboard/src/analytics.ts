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

export { posthog }
