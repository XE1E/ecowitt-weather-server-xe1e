import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { initAnalytics, trackEvent } from '../analytics'
import { StationLayout } from '../pages/StationLayout'
import { HomePage } from '../pages/HomePage'
import { UnitsProvider } from '../units'
import { StationDataProvider } from '../station-data'
import { lazyPage } from './lazyPage'

// La portada va en el paquete principal (es lo que abre casi todo el mundo); cada
// otra página se descarga al entrar a ella (el Suspense está en StationLayout,
// alrededor del <Outlet>, para que encabezado y menú no parpadeen). Antes TODO el sitio --Admin incluido--
// iba en un solo archivo de 1.87 MB.
const MiTableroPage = lazyPage(() => import('../pages/MiTableroPage'), 'MiTableroPage')
const ForecastPage = lazyPage(() => import('../pages/ForecastPage'), 'ForecastPage')
const HistoryPage = lazyPage(() => import('../pages/HistoryPage'), 'HistoryPage')
const StatisticsPage = lazyPage(() => import('../pages/StatisticsPage'), 'StatisticsPage')
const ClimatePage = lazyPage(() => import('../pages/ClimatePage'), 'ClimatePage')
const RadarPage = lazyPage(() => import('../pages/RadarPage'), 'RadarPage')
const CameraPage = lazyPage(() => import('../pages/CameraPage'), 'CameraPage')
const AstronomyPage = lazyPage(() => import('../pages/AstronomyPage'), 'AstronomyPage')
const AirQualityPage = lazyPage(() => import('../pages/AirQualityPage'), 'AirQualityPage')
const AeronauticaPage = lazyPage(() => import('../pages/AeronauticaPage'), 'AeronauticaPage')
const EarthquakesPage = lazyPage(() => import('../pages/EarthquakesPage'), 'EarthquakesPage')
const RemoteStationPage = lazyPage(() => import('../pages/RemoteStationPage'), 'RemoteStationPage')
const TablesPage = lazyPage(() => import('../pages/TablesPage'), 'TablesPage')
const ShareEmbedPage = lazyPage(() => import('../pages/ShareEmbedPage'), 'ShareEmbedPage')
const ConsolePage = lazyPage(() => import('../pages/ConsolePage'), 'ConsolePage')
const InstrumentosPage = lazyPage(() => import('../pages/InstrumentosPage'), 'InstrumentosPage')
const CyclonesPage = lazyPage(() => import('../pages/CyclonesPage'), 'CyclonesPage')
const DisclaimerPage = lazyPage(() => import('../pages/DisclaimerPage'), 'DisclaimerPage')

// Dispara un $pageview en cada cambio de ruta (incluida la carga inicial) --
// las vistas con router navegan sin recargar, así que sin esto solo se vería
// la primera página visitada por sesión. Ver analytics.ts para por qué no
// se usa el `capture_pageview` automático de PostHog.
function RouteTracker() {
  const location = useLocation()
  useEffect(() => {
    trackEvent('$pageview')
  }, [location.pathname])
  return null
}

initAnalytics()

export default function StationApp() {
  return (
    <UnitsProvider>
      <StationDataProvider>
        <BrowserRouter>
          <RouteTracker />
          <Routes>
            <Route path="/" element={<StationLayout />}>
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
              <Route path="ciclones" element={<CyclonesPage />} />
              <Route path="disclaimer" element={<DisclaimerPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </StationDataProvider>
    </UnitsProvider>
  )
}

