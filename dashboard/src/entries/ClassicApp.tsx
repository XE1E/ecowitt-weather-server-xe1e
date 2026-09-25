import App from '../App'
import { initAnalytics, trackEvent } from '../analytics'
import { UnitsProvider } from '../units'

// La clásica es página única sin router -- no hay `<RouteTracker>` que dispare el
// pageview de la app de la estación, así que se manda una sola vez aquí.
initAnalytics()
trackEvent('$pageview')

export default function ClassicApp() {
  return (
    <UnitsProvider>
      <App />
    </UnitsProvider>
  )
}
