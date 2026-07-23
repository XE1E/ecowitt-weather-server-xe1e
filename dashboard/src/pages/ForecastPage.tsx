import { useState, useEffect } from 'react'
import { RefreshCw, CloudSun } from 'lucide-react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { WeatherIcon } from '../components/WeatherIcon'
import { describeDay, ForecastResult } from '../forecast'
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

// --- SMN (CONAGUA) ---
interface SmnDay {
  date: string; tmax: number | null; tmin: number | null
  prob_precip: number | null; precip: number | null; sky: string | null
  wind: number | null; wind_dir: string | null; gust: number | null; cloud: number | null
}
interface SmnHour {
  time: string; temp: number | null; humidity: number | null; dew: number | null
  prob_precip: number | null; precip: number | null; sky: string | null
  wind: number | null; wind_dir: string | null; gust: number | null
}
interface SmnData { source: string; municipio: string; fetched_at?: string; days: SmnDay[]; hours: SmnHour[] }

// Descripción de cielo del SMN → ícono meteocons.
function skyIcon(sky: string | null, night = false): string {
  const s = (sky || '').toLowerCase()
  if (s.includes('torment')) return night ? 'thunderstorms-rain' : 'thunderstorms-day-rain'
  if (s.includes('llovizna')) return 'drizzle'
  if (s.includes('chubasc') || s.includes('lluvia') || s.includes('llov')) {
    const partial = s.includes('interval') || s.includes('disperso') || s.includes('aislad') || s.includes('parcial') || s.includes('medio')
    if (partial) return night ? 'overcast-night-rain' : 'partly-cloudy-day-rain'
    return 'rain'
  }
  if (s.includes('nublado') || s.includes('nubes') || s.includes('cubierto')) {
    const partial = s.includes('medio') || s.includes('parcial') || s.includes('mayormente despejado') || s.includes('algunas')
    if (partial) return night ? 'partly-cloudy-night' : 'partly-cloudy-day'
    return night ? 'overcast-night' : 'overcast-day'
  }
  if (s.includes('despejado') || s.includes('soleado')) return night ? 'clear-night' : 'clear-day'
  return night ? 'partly-cloudy-night' : 'partly-cloudy-day'
}

export function ForecastPage() {
  const { forecast } = useStationData()
  const u = useUnits()
  const [source, setSource] = useState<'om' | 'smn'>('om')
  const [tab, setTab] = useState<'days' | 'hourly'>('days')
  const [smn, setSmn] = useState<SmnData | null>(null)
  const [smnErr, setSmnErr] = useState(false)

  useEffect(() => {
    if (source !== 'smn') return
    let cancel = false
    const load = () => fetch('/api/smn')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancel) { if (j && j.days) { setSmn(j); setSmnErr(false) } else setSmnErr(true) } })
      .catch(() => !cancel && setSmnErr(true))
    load()
    const i = setInterval(load, 1800000) // 30 min
    return () => { cancel = true; clearInterval(i) }
  }, [source])

  const T = (c: number) => Math.round(u.tempN(c))
  const btn = (a: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm transition ${a ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`
  const srcBtn = (a: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition ${a ? 'bg-sky-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><CloudSun className="w-6 h-6 text-sky-400" /> Pronóstico</h2>
          <p className="text-xs text-slate-400">Pronóstico para {LOCATION.label}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Selector de fuente */}
          <div className="flex gap-1 rounded-lg bg-white/[0.03] p-0.5">
            <button className={srcBtn(source === 'om')} onClick={() => setSource('om')}>Open-Meteo</button>
            <button className={srcBtn(source === 'smn')} onClick={() => setSource('smn')}>SMN oficial</button>
          </div>
          {/* Vista por día / por hora */}
          <div className="flex gap-1">
            <button className={btn(tab === 'days')} onClick={() => setTab('days')}>por día</button>
            <button className={btn(tab === 'hourly')} onClick={() => setTab('hourly')}>por hora</button>
          </div>
        </div>
      </div>

      {source === 'om' ? (
        !forecast ? (
          <div className="h-64 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-400" /></div>
        ) : (
          <OpenMeteoView forecast={forecast} tab={tab} u={u} T={T} />
        )
      ) : (
        smnErr ? (
          <div className="card text-slate-400">No se pudo obtener el pronóstico del SMN. Intenta más tarde.</div>
        ) : !smn ? (
          <div className="h-64 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-400" /></div>
        ) : (
          <SmnView smn={smn} tab={tab} u={u} T={T} />
        )
      )}
    </div>
  )
}

// ------------------- Open-Meteo (contenido original) -------------------
function OpenMeteoView({ forecast, tab, u, T }: { forecast: ForecastResult; tab: 'days' | 'hourly'; u: ReturnType<typeof useUnits>; T: (c: number) => number }) {
  return (
    <>
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
            Descripciones generadas automáticamente (NLG) a partir del pronóstico de Open-Meteo.
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
                  <span className={`text-[10px] ${h.precipProb > 0 ? 'text-sky-400' : 'text-slate-600'}`}>{h.precipProb}%</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Próximas 48 horas · Fuente: Open-Meteo · temperaturas en {u.tempU}</p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Acerca del pronóstico</h2>
        <div className="card text-sm text-slate-300 space-y-2 leading-relaxed">
          <p>
            El pronóstico proviene de <span className="font-semibold">Open-Meteo</span>, un servicio
            meteorológico abierto y gratuito. Son estimaciones de modelos numéricos,
            {' '}<span className="text-slate-400">no mediciones de la estación</span>. Usa el modo
            {' '}<span className="font-mono text-slate-200">best_match</span> (elige el mejor modelo global
            para la ubicación: ECMWF, GFS, ICON…). Refresca cada 30 min; los primeros 2-3 días son los más confiables.
            Cambia a <span className="font-semibold text-sky-300">SMN oficial</span> arriba para ver el pronóstico del
            Servicio Meteorológico Nacional.
          </p>
        </div>
      </section>
    </>
  )
}

// ------------------- SMN (CONAGUA) -------------------
function SmnView({ smn, tab, u, T }: { smn: SmnData; tab: 'days' | 'hourly'; u: ReturnType<typeof useUnits>; T: (c: number) => number }) {
  const d0 = smn.days[0]
  return (
    <>
      {d0 && (
        <div className="card flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <WeatherIcon name={skyIcon(d0.sky)} size={64} alt={d0.sky ?? ''} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-lg font-semibold">{d0.sky ?? 'Pronóstico'}</p>
              <p className="text-xs text-slate-400 first-letter:uppercase">
                {new Date(d0.date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-5 text-center shrink-0">
            <div><p className="text-sm text-slate-400 mb-0.5">Máx</p><p className="text-3xl font-bold text-orange-300 leading-none">{d0.tmax != null ? T(d0.tmax) : '--'}<span className="text-lg font-semibold text-slate-400">°</span></p></div>
            <div><p className="text-sm text-slate-400 mb-0.5">Mín</p><p className="text-3xl font-bold text-sky-300 leading-none">{d0.tmin != null ? T(d0.tmin) : '--'}<span className="text-lg font-semibold text-slate-400">°</span></p></div>
            <div><p className="text-sm text-slate-400 mb-0.5">Lluvia</p><p className="text-3xl font-bold text-violet-300 leading-none">{d0.prob_precip != null ? Math.round(d0.prob_precip) : '--'}<span className="text-lg font-semibold text-slate-400">%</span></p></div>
            <div><p className="text-sm text-slate-400 mb-0.5">Viento</p><p className="text-3xl font-bold text-emerald-300 leading-none">{d0.wind != null ? u.wind(d0.wind) : '--'}<span className="text-lg font-semibold text-slate-400"> {u.windU}</span></p></div>
          </div>
        </div>
      )}

      {tab === 'days' && (
        <section>
          <div className="space-y-2">
            {smn.days.map((d, i) => (
              <div key={d.date} className="card py-3">
                <div className="flex items-center gap-3">
                  <div className="w-20 sm:w-28 shrink-0">
                    <p className="font-semibold capitalize">{dayName(d.date, i)}</p>
                    <p className="text-xs text-slate-400 capitalize">{dayDate(d.date)}</p>
                  </div>
                  <WeatherIcon name={skyIcon(d.sky)} size={40} alt={d.sky ?? ''} className="shrink-0" />
                  <p className="flex-1 min-w-0 font-medium text-slate-200 truncate">{d.sky ?? '--'}</p>
                  <div className="text-right shrink-0 whitespace-nowrap">
                    <span className="font-bold text-lg">{d.tmax != null ? T(d.tmax) : '--'}°</span>
                    <span className="text-slate-500"> / {d.tmin != null ? T(d.tmin) : '--'}°</span>
                    {d.prob_precip != null && d.prob_precip > 0 && <span className="text-sm text-sky-400 ml-2">💧 {Math.round(d.prob_precip)}%</span>}
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Viento {d.wind != null ? `${u.wind(d.wind)} ${u.windU}` : '--'}{d.wind_dir ? ` del ${d.wind_dir}` : ''}
                  {d.gust != null ? ` · ráfaga ${u.wind(d.gust)} ${u.windU}` : ''}
                  {d.cloud != null ? ` · nubosidad ${Math.round(d.cloud)}%` : ''}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'hourly' && (
        <section>
          <div className="card">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {smn.hours.map((h) => {
                const hh = parseInt(h.time.slice(11, 13), 10)
                const night = hh < 6 || hh >= 19
                return (
                  <div key={h.time} className="flex flex-col items-center text-center rounded-lg bg-white/5 py-2 px-2 min-w-[64px]">
                    <span className="text-xs text-slate-400">{hourLabel(h.time)}</span>
                    <WeatherIcon name={skyIcon(h.sky, night)} size={34} alt="" />
                    <span className="text-sm font-bold">{h.temp != null ? T(h.temp) : '--'}°</span>
                    <span className={`text-[10px] ${h.prob_precip && h.prob_precip > 0 ? 'text-sky-400' : 'text-slate-600'}`}>{h.prob_precip != null ? Math.round(h.prob_precip) : 0}%</span>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Próximas 48 horas · Fuente: SMN CONAGUA · temperaturas en {u.tempU}</p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Acerca del pronóstico</h2>
        <div className="card text-sm text-slate-300 space-y-2 leading-relaxed">
          <p>
            Pronóstico <span className="font-semibold text-sky-300">oficial del Servicio Meteorológico Nacional (SMN · CONAGUA)</span>
            {' '}para <span className="font-semibold">{smn.municipio}</span>. El SMN publica una actualización
            {' '}<span className="text-slate-400">cada hora (a los :15)</span>; aquí se refresca automáticamente.
            Es el pronóstico oficial por municipio de México — complementa al de Open-Meteo (modelo global),
            que puedes ver con el selector de arriba.
          </p>
        </div>
      </section>
    </>
  )
}
