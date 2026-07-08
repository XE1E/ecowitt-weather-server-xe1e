import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import { StationLayout } from './pages/StationLayout'
import { HomePage } from './pages/HomePage'
import { ForecastPage } from './pages/ForecastPage'
import { HistoryPage } from './pages/HistoryPage'
import { UnitsProvider } from './units'
import { StationDataProvider } from './station-data'
import './index.css'

// /pro* -> app de la estación (WeatherNode-style) con router; / -> dashboard clásico
const isStation = window.location.pathname.startsWith('/pro')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isStation ? (
      <UnitsProvider>
        <StationDataProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/pro" element={<StationLayout />}>
                <Route index element={<HomePage />} />
                <Route path="pronostico" element={<ForecastPage />} />
                <Route path="historia" element={<HistoryPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/pro" replace />} />
            </Routes>
          </BrowserRouter>
        </StationDataProvider>
      </UnitsProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
