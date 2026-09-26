import { useState, useEffect, Suspense, Fragment } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { WeatherFX } from '../components/WeatherFX'
import { deriveCondition } from '../weather'
import { useUnits } from '../units'
import { useStationData } from '../station-data'
import { LOCATION } from '../config'
import { useCiclones, enTemporada } from '../components/station/cyclones'
import logoDark from '../assets/logo-xe1e-dark.svg'
import logoLight from '../assets/logo-xe1e-light.svg'

// Cintillo: páginas listas (link) + próximas (deshabilitadas)
const NAV_ACTIVE = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/tablero', label: 'Mi tablero', end: false },
  { to: '/pronostico', label: 'Pronóstico', end: false },
  { to: '/historia', label: 'Historia', end: false },
  { to: '/estadisticas', label: 'Estadísticas', end: false },
  { to: '/tablas', label: 'Tablas', end: false },
  { to: '/climatologia', label: 'Climatología', end: false },
  { to: '/radar', label: 'Radar', end: false },
  { to: '/camara', label: 'Cámara', end: false },
  { to: '/astronomia', label: 'Astronomía', end: false },
  { to: '/calidad-aire', label: 'Calidad del aire', end: false },
  { to: '/aeronautica', label: 'Aeronáutica', end: false },
  { to: '/remota', label: 'Estación remota', end: false },
  { to: '/consola', label: 'Consola', end: false },
  { to: '/instrumentos', label: 'Instrumentos', end: false },
]

/**
 * Pestaña de Ciclones (al final; Widget se quedó sólo en el pie de página). Casi
 * todo el año no tiene nada, pero en temporada debe saltar a la vista: 🌀 en
 * temporada, y con ciclones activos un contador del color de la amenaza
 * (rojo = amenaza para México, ámbar = se acerca, azul = lejos).
 */
function CiclonesTab({ linkClass }: { linkClass: (a: { isActive: boolean }) => string }) {
  const n = useCiclones()?.tormentas ?? []
  const amenaza = n[0]?.nivel
  const temporada = enTemporada('ep') || enTemporada('al')
  const badge = amenaza === 'alta' ? 'bg-red-500 text-white' : amenaza === 'media' ? 'bg-amber-500 text-slate-900' : 'bg-sky-500/80 text-white'
  return (
    <NavLink to="/ciclones" className={(a) => `${linkClass(a)} flex items-center gap-1`}>
      {(temporada || n.length > 0) && <span aria-hidden>🌀</span>}
      Ciclones
      {n.length > 0 && (
        <span className={`ml-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold leading-[1.1rem] text-center ${badge} ${amenaza === 'alta' ? 'animate-pulse' : ''}`}
          title={`${n.length} ciclones activos`}>
          {/* animate-pulse (sólo opacidad) y no animate-ping: el ping crece al doble,
              desborda el cintillo y hacía aparecer/desaparecer su scroll cada segundo. */}
          {n.length}
        </span>
      )}
    </NavLink>
  )
}

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Fecha y hora del encabezado, con su PROPIO estado: antes el reloj vivía en el
 * layout y cada segundo redibujaba el layout y la página abierta completa.
 * `segundos`: la versión de escritorio los muestra y avanza cada segundo; la de
 * celular sólo avanza al cambiar el minuto.
 */
function HeaderClock({ segundos }: { segundos: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (segundos) {
      const i = setInterval(() => setNow(new Date()), 1000)
      return () => clearInterval(i)
    }
    let t: ReturnType<typeof setTimeout>
    const siguiente = () => {
      t = setTimeout(() => { setNow(new Date()); siguiente() }, 60000 - (Date.now() % 60000) + 50)
    }
    siguiente()
    return () => clearTimeout(t)
  }, [segundos])
  return segundos ? (
    <div className="text-center leading-tight">
      <p className="text-sm font-semibold text-slate-200">{DIAS[now.getDay()]} {now.getDate()} de {MESES[now.getMonth()]}</p>
      <p className="font-mono text-2xl font-bold">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</p>
    </div>
  ) : (
    <div className="text-center leading-tight">
      <p className="text-xs font-semibold text-slate-200">{DIAS[now.getDay()]} {now.getDate()} {MESES[now.getMonth()].slice(0, 3)}</p>
      <p className="font-mono text-lg font-bold">{pad(now.getHours())}:{pad(now.getMinutes())}</p>
    </div>
  )
}

export function StationLayout() {
  const { data, forecast, localForecast } = useStationData()
  const units = useUnits()
  const [fxEnabled, setFxEnabled] = useState(() => localStorage.getItem('fx') !== 'off')
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  )

  // Aplica y recuerda el tema (persiste entre recargas)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))

  const toggleFx = () =>
    setFxEnabled((prev) => {
      const next = !prev
      localStorage.setItem('fx', next ? 'on' : 'off')
      return next
    })

  // Contexto extendido para deriveCondition
  const currentHour = forecast?.hours?.[0]
  const cond = data ? deriveCondition(data, {
    forecastCode: currentHour?.code,
    cloudCoverPct: currentHour?.cloudCover,
    precipProb: currentHour?.precipProb,
    pressureDelta3h: localForecast?.delta_3h,
  }) : { fx: 'none' as const, intensity: 0, icon: '', label: '' }

  const nivelCiclon = useCiclones()?.tormentas?.[0]?.nivel
  const ciclonAmenaza = nivelCiclon === 'alta' || nivelCiclon === 'media'

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    // px-[5px] y no px-1.5: con 🌀 y el contador de Ciclones, a 1280 px el cintillo
    // se pasaba ~23 px y aparecía su scroll horizontal.
    `px-[5px] py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
      isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10'
    }`

  return (
    <>
      <WeatherFX type={fxEnabled ? cond.fx : 'none'} intensity={cond.intensity} />
      <div className="min-h-screen p-3 md:p-6">
        <div className="max-w-[1400px] mx-auto">
          {/* Header (banner fijo con nombre y fecha/hora centrada) */}
          <header className="appbar sticky top-0 z-30 -mx-3 md:-mx-6 px-3 md:px-6 py-2.5 mb-4 border-b border-white/10">
            {/* Desktop: 3 columnas con fecha/hora centrada */}
            <div className="hidden sm:grid sm:grid-cols-3 items-center gap-3">
              <div className="min-w-0 flex items-center gap-3">
                <img src={theme === 'dark' ? logoDark : logoLight} alt="" className="h-10 w-auto shrink-0" />
                <div className="min-w-0">
                  <h1 className="text-xl font-bold truncate">Estación Clima XE1E en {LOCATION.name}</h1>
                  <p className="text-base text-slate-300 truncate">{LOCATION.label}</p>
                </div>
              </div>
              <HeaderClock segundos />
              <div className="flex items-center gap-2 justify-end text-sm text-slate-300">
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
                <a href="/basica" className="text-blue-400 hover:text-blue-300 text-xs border border-white/10 rounded-lg px-2 py-1">
                  Vista clásica
                </a>
              </div>
            </div>
            {/* Móvil: layout compacto */}
            <div className="sm:hidden flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <img src={theme === 'dark' ? logoDark : logoLight} alt="" className="h-7 w-auto shrink-0" />
                  <h1 className="text-base font-bold truncate">Estación Clima XE1E</h1>
                </div>
                <HeaderClock segundos={false} />
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end text-sm text-slate-300">
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
              <a href="/basica" className="text-blue-400 hover:text-blue-300 text-xs border border-white/10 rounded-lg px-2 py-1">
                Vista clásica
              </a>
              </div>
            </div>
          </header>

          {/* Cintillo de navegación */}
          <nav className="flex items-center justify-between w-full overflow-x-auto mb-5 border-b border-white/10 pb-2">
            {NAV_ACTIVE.map((n, i) => (
              <Fragment key={n.to}>
                <NavLink to={n.to} end={n.end} className={linkClass}>
                  {n.label}
                </NavLink>
                {/* Con amenaza para México, Ciclones sube justo después de Inicio. */}
                {i === 0 && ciclonAmenaza && <CiclonesTab linkClass={linkClass} />}
              </Fragment>
            ))}
            {!ciclonAmenaza && <CiclonesTab linkClass={linkClass} />}
          </nav>

          {/* Contenido de la página */}
          {/* Las páginas se descargan al entrar (entries/StationApp): mientras llega una,
              encabezado y menú siguen en su sitio. */}
          <Suspense fallback={<div className="py-16 text-center text-slate-500 text-sm">Cargando…</div>}>
            <Outlet />
          </Suspense>

          {/* Footer */}
          <footer className="mt-10 pt-6 border-t border-white/10 text-slate-400 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="font-semibold text-slate-300 mb-1">Estación</p>
                <p>Hardware: Ecowitt WS2910 + WS69 + WN31</p>
                <p>Ecowitt GW1100 + WN32</p>
                <p>Ubicación: {LOCATION.label}</p>
                <p>Coordenadas: {LOCATION.latitude}, {LOCATION.longitude}</p>
                <p>Datos desde: 2026</p>
              </div>
              <div>
                <p className="font-semibold text-slate-300 mb-1">Datos</p>
                <p>Estación vía protocolo Ecowitt</p>
                <p>Pronóstico y Astronomía: Open-Meteo, Weather API, SMN y datos locales</p>
                <p>Radar: Ventusky · Satélite: NASA GIBS</p>
                <p>Calidad del aire: WAQI · IMECA (Open-Meteo)</p>
                <p>Sismos: USGS / SSN (México)</p>
                <p>METAR / TAF: aviationweather.gov (NOAA)</p>
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
                <p>
                  <NavLink to="/disclaimer" className="text-blue-400 hover:text-blue-300">
                    Aviso Legal / Disclaimer
                  </NavLink>
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
              <NavLink to="/compartir" className="hover:text-slate-400">Widget para tu sitio</NavLink> ·{' '}
              <a href="/admin" className="hover:text-slate-400">⚙ Admin</a>
            </p>
          </footer>
        </div>
      </div>
    </>
  )
}
