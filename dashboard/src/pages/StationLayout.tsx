import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { WeatherFX } from '../components/WeatherFX'
import { deriveCondition } from '../weather'
import { useUnits } from '../units'
import { useStationData } from '../station-data'
import { LOCATION } from '../config'

// Cintillo: páginas listas (link) + próximas (deshabilitadas)
const NAV_ACTIVE = [
  { to: '/pro', label: 'Inicio', end: true },
  { to: '/pro/pronostico', label: 'Pronóstico', end: false },
  { to: '/pro/historia', label: 'Historia', end: false },
  { to: '/pro/estadisticas', label: 'Estadísticas', end: false },
  { to: '/pro/climatologia', label: 'Climatología', end: false },
  { to: '/pro/radar', label: 'Radar', end: false },
  { to: '/pro/astronomia', label: 'Astronomía', end: false },
  { to: '/pro/calidad-aire', label: 'Calidad del aire', end: false },
  { to: '/pro/aeronautica', label: 'Aeronáutica', end: false },
]
const NAV_SOON: string[] = []

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const pad = (n: number) => String(n).padStart(2, '0')

export function StationLayout() {
  const { data } = useStationData()
  const units = useUnits()
  const [now, setNow] = useState(() => new Date())
  const [fxEnabled, setFxEnabled] = useState(() => localStorage.getItem('fx') !== 'off')
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  )

  const toggleTheme = () =>
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      document.documentElement.dataset.theme = next
      return next
    })

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  const toggleFx = () =>
    setFxEnabled((prev) => {
      const next = !prev
      localStorage.setItem('fx', next ? 'on' : 'off')
      return next
    })

  const cond = data ? deriveCondition(data) : { fx: 'none' as const, intensity: 0, icon: '', label: '' }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
      isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10'
    }`

  return (
    <>
      <WeatherFX type={fxEnabled ? cond.fx : 'none'} intensity={cond.intensity} />
      <div className="min-h-screen p-3 md:p-6">
        <div className="max-w-[1400px] mx-auto">
          {/* Header (banner fijo con nombre y fecha/hora centrada) */}
          <header className="appbar sticky top-0 z-30 -mx-3 md:-mx-6 px-3 md:px-6 py-2.5 mb-4 border-b border-white/10 flex items-center gap-3">
            <div className="min-w-0 shrink">
              <h1 className="text-base md:text-xl font-bold truncate">Estación Clima XE1E en {LOCATION.name}</h1>
              <p className="text-[11px] text-slate-400 truncate hidden sm:block">{LOCATION.label}</p>
            </div>
            <div className="flex-1 text-center leading-tight">
              <p className="text-xs md:text-sm font-semibold text-slate-200">{DIAS[now.getDay()]} {now.getDate()} de {MESES[now.getMonth()]}</p>
              <p className="font-mono text-lg md:text-2xl font-bold">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-300 shrink-0">
              <button
                onClick={units.toggle}
                title="Cambiar unidades (métrico / imperial)"
                className="text-xs rounded-lg px-2 py-1 border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 transition"
              >
                {units.system === 'metric' ? '°C · km/h' : '°F · mph'}
              </button>
              <button
                onClick={toggleTheme}
                title="Tema claro / oscuro"
                className="text-xs rounded-lg px-2 py-1 border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 transition"
              >
                {theme === 'dark' ? '🌙' : '☀️'}
              </button>
              <button
                onClick={toggleFx}
                title="Efectos de clima (lluvia/nieve/etc.)"
                className={`text-xs rounded-lg px-2 py-1 border transition ${
                  fxEnabled
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-slate-400'
                }`}
              >
                FX {fxEnabled ? 'on' : 'off'}
              </button>
              <a href="/" className="text-blue-400 hover:text-blue-300 text-xs border border-white/10 rounded-lg px-2 py-1">
                Vista clásica
              </a>
            </div>
          </header>

          {/* Cintillo de navegación */}
          <nav className="flex items-center gap-1 overflow-x-auto mb-5 border-b border-white/10 pb-2">
            {NAV_ACTIVE.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}>
                {n.label}
              </NavLink>
            ))}
            {NAV_SOON.map((label) => (
              <span
                key={label}
                title="Próximamente"
                className="px-3 py-1.5 rounded-lg text-sm whitespace-nowrap text-slate-600 cursor-default"
              >
                {label}
              </span>
            ))}
          </nav>

          {/* Contenido de la página */}
          <Outlet />

          {/* Footer */}
          <footer className="mt-10 pt-6 border-t border-white/10 text-slate-400 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="font-semibold text-slate-300 mb-1">Estación</p>
                <p>Hardware: Ecowitt WS2910 + WS69 + WN31</p>
                <p>Ubicación: {LOCATION.label}</p>
                <p>Coordenadas: {LOCATION.latitude}, {LOCATION.longitude}</p>
                <p>Datos desde: 2026</p>
              </div>
              <div>
                <p className="font-semibold text-slate-300 mb-1">Datos</p>
                <p>Estación vía protocolo Ecowitt</p>
                <p>Pronóstico y astronomía: Open-Meteo</p>
                <p>Radar: Ventusky · Satélite: NASA GIBS</p>
                <p>Calidad del aire: WAQI · IMECA (Open-Meteo)</p>
              </div>
              <div>
                <p className="font-semibold text-slate-300 mb-1">Proyecto</p>
                <p>
                  <a href="/guia.html" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                    📖 Guía completa de la estación
                  </a>
                </p>
                <p>
                  <a href="https://github.com/XE1E/ecowitt-weather-server-xe1e" className="text-blue-400 hover:text-blue-300">
                    GitHub — ecowitt-weather-server-xe1e
                  </a>
                </p>
                <p>Stack propio (FastAPI + InfluxDB + React)</p>
              </div>
            </div>
            <p className="mt-5 text-slate-500 leading-relaxed">
              Datos meteorológicos en vivo y pronóstico para {LOCATION.label}. Esta estación (Ecowitt
              WS2910 + WS69 + WN31) publica condiciones actuales, pronóstico horario y diario, radar y
              satélite, astronomía (sol y luna), calidad del aire (AQI e IMECA) e histórico y récords. Los
              datos se actualizan de forma continua. Proyecto personal sobre el clima.
            </p>
            <p className="text-center text-slate-600 mt-6">
              © 2026 Estación XE1E · {LOCATION.name} ·{' '}
              <NavLink to="/pro/compartir" className="hover:text-slate-400">Compartir / insertar</NavLink> ·{' '}
              <NavLink to="/pro/admin" className="hover:text-slate-400">⚙ Admin</NavLink>
            </p>
          </footer>
        </div>
      </div>
    </>
  )
}
