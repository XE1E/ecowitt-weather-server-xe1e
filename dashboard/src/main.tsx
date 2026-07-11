import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import { StationLayout } from './pages/StationLayout'
import { HomePage } from './pages/HomePage'
import { MiTableroPage } from './pages/MiTableroPage'
import { ForecastPage } from './pages/ForecastPage'
import { HistoryPage } from './pages/HistoryPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { RadarPage } from './pages/RadarPage'
import { AstronomyPage } from './pages/AstronomyPage'
import { AirQualityPage } from './pages/AirQualityPage'
import { AeronauticaPage } from './pages/AeronauticaPage'
import { ClimatePage } from './pages/ClimatePage'
import { EarthquakesPage } from './pages/EarthquakesPage'
import { RemoteStationPage } from './pages/RemoteStationPage'
import { ShareEmbedPage } from './pages/ShareEmbedPage'
import { AdminPage } from './pages/AdminPage'
import { EmbedWidget } from './pages/EmbedWidget'
import { UnitsProvider } from './units'
import { StationDataProvider } from './station-data'
import './index.css'

// Registrar el service worker (PWA instalable + offline del app shell)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// /embed -> widget compacto para incrustar; /pro* -> app de la estación; / -> clásico
const path = window.location.pathname
const isEmbed = path.startsWith('/embed')
const isStation = path.startsWith('/pro')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isEmbed ? (
      <EmbedWidget />
    ) : isStation ? (
      <UnitsProvider>
        <StationDataProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/pro" element={<StationLayout />}>
                <Route index element={<HomePage />} />
                <Route path="tablero" element={<MiTableroPage />} />
                <Route path="pronostico" element={<ForecastPage />} />
                <Route path="historia" element={<HistoryPage />} />
                <Route path="estadisticas" element={<StatisticsPage />} />
                <Route path="climatologia" element={<ClimatePage />} />
                <Route path="radar" element={<RadarPage />} />
                <Route path="astronomia" element={<AstronomyPage />} />
                <Route path="calidad-aire" element={<AirQualityPage />} />
                <Route path="aeronautica" element={<AeronauticaPage />} />
                <Route path="sismos" element={<EarthquakesPage />} />
                <Route path="remota" element={<RemoteStationPage />} />
                <Route path="compartir" element={<ShareEmbedPage />} />
                <Route path="admin" element={<AdminPage />} />
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
