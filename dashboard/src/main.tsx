import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { initAnalytics, posthog } from './analytics'
import App from './App'
import { StationLayout } from './pages/StationLayout'
import { HomePage } from './pages/HomePage'
import { MiTableroPage } from './pages/MiTableroPage'
import { ForecastPage } from './pages/ForecastPage'
import { HistoryPage } from './pages/HistoryPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { RadarPage } from './pages/RadarPage'
import { CameraPage } from './pages/CameraPage'
import { AstronomyPage } from './pages/AstronomyPage'
import { AirQualityPage } from './pages/AirQualityPage'
import { AeronauticaPage } from './pages/AeronauticaPage'
import { ClimatePage } from './pages/ClimatePage'
import { EarthquakesPage } from './pages/EarthquakesPage'
import { RemoteStationPage } from './pages/RemoteStationPage'
import { TablesPage } from './pages/TablesPage'
import { ShareEmbedPage } from './pages/ShareEmbedPage'
import { EmbedWidget } from './pages/EmbedWidget'
import { KioskPage } from './pages/KioskPage'
import { ConsolePage } from './pages/ConsolePage'
import { InstrumentosPage } from './pages/InstrumentosPage'
import { DisclaimerPage } from './pages/DisclaimerPage'
import {
  AdminLayout,
  AdminDashboard,
  AdminEstaciones,
  AdminEstacionConfig,
  AdminAlertas,
  AdminCalibracion,
  AdminPublicacion,
  AdminNotificaciones,
  AdminIntegraciones,
  AdminCamara,
  AdminSistema,
  AdminUpdates,
  AdminWizard,
} from './pages/admin'
import { AdminAuthProvider } from './admin-auth'
import { UnitsProvider } from './units'
import { StationDataProvider } from './station-data'
import './index.css'

// Registrar el service worker (PWA instalable + offline del app shell)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Dispara un $pageview en cada cambio de ruta (incluida la carga inicial) --
// las vistas con router navegan sin recargar, así que sin esto solo se vería
// la primera página visitada por sesión. Ver analytics.ts para por qué no
// se usa el `capture_pageview` automático de PostHog.
function RouteTracker() {
  const location = useLocation()
  useEffect(() => {
    posthog.capture('$pageview')
  }, [location.pathname])
  return null
}

// Detectar tipo de página:
// /embed -> widget compacto
// /admin -> panel de administración
// /pro   -> app de la estación
// /      -> vista clásica
const path = window.location.pathname
const isEmbed = path.startsWith('/embed')
const isAdmin = path.startsWith('/admin')
const isStation = path.startsWith('/pro')
const isKiosk = path.startsWith('/kiosko')
const isClassic = !isKiosk && !isEmbed && !isAdmin && !isStation

// Analítica solo en las vistas públicas (clásica y /pro) -- ver analytics.ts
// para por qué se excluyen admin/kiosko/embed.
if (isStation || isClassic) {
  initAnalytics()
}
// La clásica es página única sin router -- no hay `<RouteTracker>` que
// dispare el pageview de /pro, así que se manda una sola vez aquí.
if (isClassic) {
  posthog.capture('$pageview')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isKiosk ? (
      <UnitsProvider>
        <StationDataProvider>
          <KioskPage />
        </StationDataProvider>
      </UnitsProvider>
    ) : isEmbed ? (
      <EmbedWidget />
    ) : isAdmin ? (
      <AdminAuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="estaciones" element={<AdminEstaciones />} />
              <Route path="estaciones/:name" element={<AdminEstacionConfig />} />
              <Route path="alertas" element={<AdminAlertas />} />
              <Route path="calibracion" element={<AdminCalibracion />} />
              <Route path="publicacion" element={<AdminPublicacion />} />
              <Route path="notificaciones" element={<AdminNotificaciones />} />
              <Route path="integraciones" element={<AdminIntegraciones />} />
              <Route path="camara" element={<AdminCamara />} />
              <Route path="sistema" element={<AdminSistema />} />
              <Route path="updates" element={<AdminUpdates />} />
            </Route>
            <Route path="/admin/wizard" element={<AdminWizard />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </BrowserRouter>
      </AdminAuthProvider>
    ) : isStation ? (
      <UnitsProvider>
        <StationDataProvider>
          <BrowserRouter>
            <RouteTracker />
            <Routes>
              <Route path="/pro" element={<StationLayout />}>
                <Route index element={<HomePage />} />
                <Route path="tablero" element={<MiTableroPage />} />
                <Route path="pronostico" element={<ForecastPage />} />
                <Route path="historia" element={<HistoryPage />} />
                <Route path="estadisticas" element={<StatisticsPage />} />
                <Route path="climatologia" element={<ClimatePage />} />
                <Route path="radar" element={<RadarPage />} />
                <Route path="camara" element={<CameraPage />} />
                <Route path="astronomia" element={<AstronomyPage />} />
                <Route path="calidad-aire" element={<AirQualityPage />} />
                <Route path="aeronautica" element={<AeronauticaPage />} />
                <Route path="sismos" element={<EarthquakesPage />} />
                <Route path="remota" element={<RemoteStationPage />} />
                <Route path="tablas" element={<TablesPage />} />
                <Route path="compartir" element={<ShareEmbedPage />} />
                <Route path="consola" element={<ConsolePage />} />
                <Route path="instrumentos" element={<InstrumentosPage />} />
                <Route path="disclaimer" element={<DisclaimerPage />} />
                {/* Redirigir /pro/admin al nuevo panel */}
                <Route path="admin" element={<Navigate to="/admin" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/pro" replace />} />
            </Routes>
          </BrowserRouter>
        </StationDataProvider>
      </UnitsProvider>
    ) : (
      <UnitsProvider>
        <App />
      </UnitsProvider>
    )}
  </React.StrictMode>,
)
