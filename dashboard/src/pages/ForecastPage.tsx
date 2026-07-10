import { useState } from 'react'
import { RefreshCw, CloudSun } from 'lucide-react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { WeatherIcon } from '../components/WeatherIcon'
import { describeDay } from '../forecast'
import { LOCATION } from '../config'

function dayName(iso: string, i: number): string {
  if (i === 0) return 'Hoy'
  if (i === 1) return 'Mañana'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long' })
}
function dayDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}
function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit' })
}

export function ForecastPage() {
  const { forecast } = useStationData()
  const u = useUnits()
  const [tab, setTab] = useState<'days' | 'hourly'>('days')

  if (!forecast) {
    return (
      <div className="h-64 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    )
  }
  const T = (c: number) => Math.round(u.tempN(c))
  const btn = (a: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm transition ${a ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><CloudSun className="w-6 h-6 text-sky-400" /> Pronóstico</h2>
          <p className="text-xs text-slate-400">Pronóstico para {LOCATION.label}</p>
        </div>
        <div className="flex gap-1">
          <button className={btn(tab === 'days')} onClick={() => setTab('days')}>por día</button>
          <button className={btn(tab === 'hourly')} onClick={() => setTab('hourly')}>por hora</button>
        </div>
      </div>

      {/* Tarjeta de resumen del día actual (visible en ambas pestañas) */}
      {forecast.days[0] && (
        <div className="card flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <WeatherIcon name={forecast.days[0].icon} size={64} alt={forecast.days[0].label} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-lg font-semibold">{forecast.days[0].label}</p>
              <p className="text-xs text-slate-400 first-letter:uppercase">
                {new Date(forecast.days[0].date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-5 text-center shrink-0">
            <div><p className="text-sm text-slate-400 mb-0.5">Máx</p><p className="text-3xl font-bold text-orange-300 leading-none">{T(forecast.days[0].tempMax)}<span className="text-lg font-semibold text-slate-400">°</span></p></div>
            <div><p className="text-sm text-slate-400 mb-0.5">Mín</p><p className="text-3xl font-bold text-sky-300 leading-none">{T(forecast.days[0].tempMin)}<span className="text-lg font-semibold text-slate-400">°</span></p></div>
            <div><p className="text-sm text-slate-400 mb-0.5">Precip.</p><p className="text-3xl font-bold text-violet-300 leading-none">{forecast.days[0].precipSum != null ? u.rain(forecast.days[0].precipSum) : '--'}<span className="text-lg font-semibold text-slate-400"> {u.rainU}</span></p></div>
            <div><p className="text-sm text-slate-400 mb-0.5">Viento</p><p className="text-3xl font-bold text-emerald-300 leading-none">{forecast.days[0].windMax != null ? u.wind(forecast.days[0].windMax) : '--'}<span className="text-lg font-semibold text-slate-400"> {u.windU}</span></p></div>
          </div>
        </div>
      )}

      {tab === 'days' && (
      <section>
        <div className="space-y-2">
          {forecast.days.map((d, i) => (
            <div key={d.date} className="card py-3">
              <div className="flex items-center gap-3">
                <div className="w-20 sm:w-28 shrink-0">
                  <p className="font-semibold capitalize">{dayName(d.date, i)}</p>
                  <p className="text-xs text-slate-400 capitalize">{dayDate(d.date)}</p>
                </div>
                <WeatherIcon name={d.icon} size={40} alt={d.label} className="shrink-0" />
                <p className="flex-1 min-w-0 font-medium text-slate-200 truncate">{d.label}</p>
                <div className="text-right shrink-0 whitespace-nowrap">
                  <span className="font-bold text-lg">{T(d.tempMax)}°</span>
                  <span className="text-slate-500"> / {T(d.tempMin)}°</span>
                  {d.precipProb > 0 && <span className="text-sm text-sky-400 ml-2">💧 {d.precipProb}%</span>}
                </div>
              </div>
              <p className="text-sm text-slate-400 leading-snug mt-2">
                {describeDay(d, (c) => `${u.temp(c)}${u.tempU}`)}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Descripciones generadas automáticamente (NLG — generación de lenguaje natural) a partir del pronóstico de Open-Meteo.
        </p>
      </section>
      )}

      {tab === 'hourly' && (
      <section>
        <div className="card">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {forecast.hours.map((h) => (
              <div key={h.time} className="flex flex-col items-center text-center rounded-lg bg-white/5 py-2 px-2 min-w-[64px]">
                <span className="text-xs text-slate-400">{hourLabel(h.time)}</span>
                <WeatherIcon name={h.icon} size={34} alt="" />
                <span className="text-sm font-bold">{T(h.temp)}°</span>
                <span className={`text-[10px] ${h.precipProb > 0 ? 'text-sky-400' : 'text-slate-600'}`}>
                  {h.precipProb}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">Próximas 48 horas · Fuente: Open-Meteo · temperaturas en {u.tempU}</p>
      </section>
      )}

      {/* Acerca del pronóstico / modelos */}
      <section>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Acerca del pronóstico</h2>
        <div className="card text-sm text-slate-300 space-y-2 leading-relaxed">
          <p>
            El pronóstico proviene de <span className="font-semibold">Open-Meteo</span>, un servicio
            meteorológico abierto y gratuito. Se muestra a modo informativo y son estimaciones de
            modelos numéricos, <span className="text-slate-400">no mediciones de la estación</span>.
          </p>
          <p>
            Open-Meteo usa por defecto el modo <span className="font-mono text-slate-200">best_match</span>,
            que selecciona automáticamente el mejor modelo global para la ubicación. Suele combinar
            modelos de referencia según la zona:
          </p>
          <ul className="list-disc list-inside text-slate-400 space-y-1">
            <li><span className="text-slate-200">ECMWF IFS</span> — Centro Europeo, muy preciso a medio plazo</li>
            <li><span className="text-slate-200">GFS</span> — NOAA (EE. UU.), cobertura global</li>
            <li><span className="text-slate-200">ICON</span> — DWD (Alemania), buen detalle regional</li>
          </ul>
          <p className="text-slate-400">
            Los modelos se actualizan varias veces al día; esta página refresca el pronóstico cada
            30 minutos. La precisión disminuye con el horizonte: los primeros 2-3 días son los más
            confiables.
          </p>
        </div>
      </section>
    </div>
  )
}
