import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StationPage } from './pages/StationPage'
import { UnitsProvider } from './units'
import './index.css'

// Router mínimo sin dependencias: /pro -> página estilo WeatherNode, / -> dashboard clásico
const isStation = window.location.pathname.startsWith('/pro')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isStation ? (
      <UnitsProvider>
        <StationPage />
      </UnitsProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
