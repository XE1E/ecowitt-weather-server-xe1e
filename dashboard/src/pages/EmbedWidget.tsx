import { useState, useEffect } from 'react'
import { WeatherData } from '../types'
import { deriveCondition, cardinal } from '../weather'
import { WeatherIcon } from '../components/WeatherIcon'
import { LOCATION } from '../config'

// Widget compacto para incrustar en otros sitios vía <iframe>.
// Parámetros de URL: ?units=metric|imperial  &theme=light|dark
const params = new URLSearchParams(window.location.search)
const UNITS = params.get('units') === 'imperial' ? 'imperial' : 'metric'
const THEME = params.get('theme') === 'light' ? 'light' : 'dark'
document.documentElement.dataset.theme = THEME

const tC = (c?: number) => (c == null ? '--' : UNITS === 'imperial' ? Math.round(c * 9 / 5 + 32) : Math.round(c))
const tU = UNITS === 'imperial' ? '°F' : '°C'
const w = (k?: number) => (k == null ? '--' : UNITS === 'imperial' ? Math.round(k * 0.621371) : Math.round(k))
const wU = UNITS === 'imperial' ? 'mph' : 'km/h'
const pr = (h?: number) => (h == null ? '--' : UNITS === 'imperial' ? (h * 0.02953).toFixed(2) : Math.round(h))
const pU = UNITS === 'imperial' ? 'inHg' : 'mb'

export function EmbedWidget() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    const load = () =>
      fetch('/api/current')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => { setData(d); setErr(false) })
        .catch(() => setErr(true))
    load()
    const i = setInterval(load, 60000)
    return () => clearInterval(i)
  }, [])

  const cond = data ? deriveCondition(data) : null

  return (
    <div style={{ minHeight: '100vh' }} className="flex items-center justify-center p-2">
      <a
        href="https://clima.xe1e.net/pro"
        target="_blank"
        rel="noopener noreferrer"
        className="card block w-full max-w-[360px] no-underline"
        style={{ color: 'inherit' }}
      >
        {!data ? (
          <p className="text-slate-400 text-sm py-8 text-center">
            {err ? 'Sin datos disponibles' : 'Cargando…'}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">{LOCATION.name}</p>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold tracking-tight">{tC(data.temperature_outdoor)}</span>
                  <span className="text-lg text-slate-400 mb-1">{tU}</span>
                </div>
                <p className="text-sm text-slate-300">{cond?.label}</p>
              </div>
              {cond && <WeatherIcon name={cond.icon} size={64} alt={cond.label} />}
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/10 text-center text-sm">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Sensación</p>
                <p className="font-semibold">{tC(data.feels_like ?? data.temperature_outdoor)}{tU}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Humedad</p>
                <p className="font-semibold">{data.humidity_outdoor != null ? `${Math.round(data.humidity_outdoor)}%` : '--'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Viento</p>
                <p className="font-semibold">
                  {w(data.wind_speed)} {wU}
                  {data.wind_direction != null && <span className="text-slate-400"> {cardinal(data.wind_direction)}</span>}
                </p>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 mt-2 text-center">
              Presión {pr(data.pressure_relative)} {pU} · clima.xe1e.net
            </p>
          </>
        )}
      </a>
    </div>
  )
}
