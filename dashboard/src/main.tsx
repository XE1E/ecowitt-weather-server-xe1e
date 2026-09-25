import React, { type ComponentType } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// Registrar el service worker (PWA instalable + offline del app shell)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Cada vista es su propio paquete y sólo se descarga la que toca: el widget /embed
// (incrustado en sitios ajenos) ya no carga el Admin ni las gráficas, ni el Admin
// carga el sitio. PostHog sólo va en las vistas públicas (sitio y clásica) -- ver
// analytics.ts para por qué se excluyen admin/kiosko/embed.
//   /embed  -> widget compacto
//   /admin  -> panel de administración
//   /kiosko -> display del kiosco
//   /basica -> vista clásica
//   /       -> app de la estación (todo lo demás, catch-all)
const path = window.location.pathname
const load: () => Promise<{ default: ComponentType }> =
  path.startsWith('/embed') ? () => import('./entries/EmbedApp')
    : path.startsWith('/admin') ? () => import('./entries/AdminApp')
      : path.startsWith('/kiosko') ? () => import('./entries/KioskApp')
        : path.startsWith('/basica') ? () => import('./entries/ClassicApp')
          : () => import('./entries/StationApp')

load().then(({ default: View }) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <View />
    </React.StrictMode>,
  )
})
