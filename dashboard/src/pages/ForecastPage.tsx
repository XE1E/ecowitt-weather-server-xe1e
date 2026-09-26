import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, CloudSun } from 'lucide-react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { WeatherIcon } from '../components/WeatherIcon'
import { describeDay, ForecastResult } from '../forecast'
import { LOCATION } from '../config'
import { trackEvent } from '../analytics'
import { pollWhileVisible } from '../poll'

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
interface SmnData {
  source: string; municipio: string; fetched_at?: string; days: SmnDay[]; hours: SmnHour[]
  /** true = el SMN no respondió al refrescar y esto viene de la copia guardada. */
  stale?: boolean
  /** Antigüedad del dato en minutos (del dato, no de la respuesta). */
  age_minutes?: number | null
}

/** "de hace 40 min" / "de hace 3 h" / "de hace 2 d", en corto. */
function fmtEdad(min: number): string {
  if (min < 90) return `${Math.round(min)} min`
  const h = min / 60
  return h < 36 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`
}
interface Muni { ides: string; idmun: string; nmun: string; nes: string }

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
  // ?fuente=smn abre directo en el SMN (lo usa la guía rápida para quien no vive en la CDMX).
  const [params] = useSearchParams()
  const [source, setSource] = useState<'om' | 'smn'>(params.get('fuente') === 'smn' ? 'smn' : 'om')
  const [tab, setTab] = useState<'days' | 'hourly'>('days')
  const [smn, setSmn] = useState<SmnData | null>(null)
  // Se distingue POR QUÉ falló: el webservice de CONAGUA se cae seguido (responde
  // HTTP 500), y decir "no hay datos para este municipio" en ese caso desorienta
  // —parece culpa del municipio elegido cuando está caído el SMN entero—.
  const [smnErr, setSmnErr] = useState<null | 'caido' | 'sin-municipio'>(null)
  const [munis, setMunis] = useState<Muni[]>([])
  const [sel, setSel] = useState<Muni>({ ides: '9', idmun: '14', nmun: 'Benito Juárez', nes: 'Ciudad de México' })

  // Lista de municipios (una vez, al entrar a SMN) para el buscador.
  useEffect(() => {
    if (source !== 'smn' || munis.length) return
    let cancel = false
    fetch('/api/smn/municipios').then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancel && j?.municipios) setMunis(j.municipios) })
      .catch(() => {})
    return () => { cancel = true }
  }, [source, munis.length])

  // Pronóstico del municipio seleccionado.
  useEffect(() => {
    if (source !== 'smn') return
    let cancel = false
    setSmn(null); setSmnErr(null)
    // 502 = el servidor no pudo traerlo del SMN (ni tenía copia guardada).
    // 200 con days vacío = el SMN respondió pero no cubre ese municipio.
    const load = async () => {
      try {
        const r = await fetch(`/api/smn?ides=${sel.ides}&idmun=${sel.idmun}`)
        if (cancel) return
        if (!r.ok) { setSmn(null); setSmnErr('caido'); return }
        const j: SmnData = await r.json()
        if (cancel) return
        if (j?.days?.length) { setSmn(j); setSmnErr(null) }
        else { setSmn(null); setSmnErr('sin-municipio') }
      } catch {
        if (!cancel) { setSmn(null); setSmnErr('caido') }
      }
    }
    const stop = pollWhileVisible(load, 1800000) // 30 min
    return () => { cancel = true; stop() }
  }, [source, sel])

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
            <button className={srcBtn(source === 'om')} onClick={() => { setSource('om'); trackEvent('forecast_source_change', { source: 'om' }) }}>Open-Meteo</button>
            <button className={srcBtn(source === 'smn')} onClick={() => { setSource('smn'); trackEvent('forecast_source_change', { source: 'smn' }) }}>SMN oficial</button>
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
          <OpenMeteoView forecast={forecast} tab={tab} u={u} T={T}
            onSmn={() => { setSource('smn'); window.scrollTo({ top: 0, behavior: 'smooth' }); trackEvent('forecast_source_change', { source: 'smn', from: 'footer' }) }} />
        )
      ) : (
        <div className="space-y-4">
          <SmnSearch munis={munis} current={sel} onSelect={setSel} />
          {smnErr === 'caido' ? (
            <div className="card">
              <p className="text-slate-300 font-medium">El SMN no está disponible ahora</p>
              <p className="text-sm text-slate-400 mt-1">
                El servicio de CONAGUA no está respondiendo. No es un problema de esta
                estación: se reintenta solo cada 30 minutos. Mientras tanto puedes usar el
                pronóstico de <button className="text-sky-400 hover:text-sky-300 underline"
                  onClick={() => setSource('om')}>Open-Meteo</button>.
              </p>
            </div>
          ) : smnErr === 'sin-municipio' ? (
            <div className="card text-slate-400">El SMN no publica pronóstico para este municipio. Prueba con otro.</div>
          ) : !smn ? (
            <div className="h-64 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-400" /></div>
          ) : (
            <>
              {smn.stale && (
                <div className="card border-amber-500/30 bg-amber-500/5">
                  <p className="text-sm text-amber-200">
                    ⚠ El SMN no responde en este momento, así que se muestra el último
                    pronóstico que alcanzó a publicar
                    {smn.age_minutes != null && <> —de hace <strong>{fmtEdad(smn.age_minutes)}</strong>—</>}.
                  </p>
                </div>
              )}
              <SmnView smn={smn} tab={tab} u={u} T={T} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Buscador de municipio. Antes era un <datalist> nativo, pero en móvil (iOS Safari
// sobre todo) casi no despliega sugerencias: aquí la lista se dibuja a mano.
const MAX_SUG = 8
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function SmnSearch({ munis, current, onSelect }: { munis: Muni[]; current: Muni; onSelect: (m: Muni) => void }) {
  const label = (m: Muni) => `${m.nmun}, ${m.nes}`
  const [q, setQ] = useState(label(current))
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setQ(label(current)) }, [current])

  // Sin acentos ni mayúsculas; primero los que EMPIEZAN con lo escrito.
  const nq = norm(q)
  const sugs = !open || nq.length < 2 ? [] : (() => {
    const starts: Muni[] = [], has: Muni[] = []
    for (const m of munis) {
      const n = norm(label(m))
      if (n.startsWith(nq)) starts.push(m)
      else if (n.includes(nq)) has.push(m)
      if (starts.length >= MAX_SUG) break
    }
    return [...starts, ...has].slice(0, MAX_SUG)
  })()

  const choose = (m: Muni) => {
    setQ(label(m)); setOpen(false)
    // Soltar el foco: cierra el teclado del móvil y hace que el siguiente toque
    // vuelva a disparar onFocus (si no, lo nuevo se pega al nombre anterior).
    inputRef.current?.blur()
    onSelect(m)
    trackEvent('smn_municipio', { municipio: label(m) })
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!sugs.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % sugs.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + sugs.length) % sugs.length) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sugs[hi] ?? sugs[0]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const isHome = current.ides === '9' && current.idmun === '14'
  // overflow-visible: .card recorta (overflow-hidden) y la lista quedaba cortada.
  // hover:transform-none: el translateY del hover la hacía brincar.
  return (
    <div className="card relative z-20 overflow-visible hover:transform-none">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="smn-muni" className="text-sm text-slate-400 shrink-0">📍 Municipio</label>
        <div className="relative flex-1 min-w-[200px]">
          <input ref={inputRef} id="smn-muni" type="search" value={q} autoComplete="off" enterKeyHint="search"
            role="combobox" aria-expanded={sugs.length > 0} aria-controls="smn-sugs" aria-autocomplete="list"
            onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
            // Al tocarlo se vacía para escribir directo (en móvil borrar el texto largo es tedioso).
            onFocus={() => { setQ(''); setOpen(true); setHi(0) }}
            // El retraso deja que el toque en una sugerencia llegue antes de cerrar.
            onBlur={() => setTimeout(() => { setOpen(false); setQ((v) => (v.trim() ? v : label(current))) }, 150)}
            onKeyDown={onKey}
            placeholder="Escribe un municipio… (ej. Toluca)"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-sky-500/50" />
          {open && nq.length >= 2 && (
            <ul id="smn-sugs" role="listbox"
              className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl suggest-list">
              {!munis.length ? (
                <li className="px-3 py-2.5 text-sm text-slate-400">Cargando municipios…</li>
              ) : !sugs.length ? (
                <li className="px-3 py-2.5 text-sm text-slate-400">Sin coincidencias</li>
              ) : sugs.map((m, i) => (
                <li key={`${m.ides}:${m.idmun}`} role="option" aria-selected={i === hi}
                  onMouseDown={(e) => { e.preventDefault(); choose(m) }}
                  onMouseEnter={() => setHi(i)}
                  className={`px-3 py-2.5 text-sm cursor-pointer ${i === hi ? 'suggest-hi bg-sky-600/30 text-white' : 'text-slate-200'}`}>
                  {m.nmun}<span className="text-slate-400">, {m.nes}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!isHome && (
          <button onClick={() => onSelect({ ides: '9', idmun: '14', nmun: 'Benito Juárez', nes: 'Ciudad de México' })}
            className="shrink-0 text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap">★ Volver a Benito Juárez</button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mt-1">
        Pronóstico oficial del SMN para cualquier municipio de México
        {munis.length ? ` (${munis.length.toLocaleString('es-MX')} disponibles)` : ''}.
      </p>
    </div>
  )
}

// ------------------- Open-Meteo (contenido original) -------------------
function OpenMeteoView({ forecast, tab, u, T, onSmn }: { forecast: ForecastResult; tab: 'days' | 'hourly'; u: ReturnType<typeof useUnits>; T: (c: number) => number; onSmn: () => void }) {
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
          </p>
          <p>
            ¿Quieres el pronóstico de otro lugar? En{' '}
            <button onClick={onSmn} className="font-semibold text-sky-300 hover:text-sky-200 underline">SMN oficial</button>
            {' '}puedes buscar el pronóstico oficial del Servicio Meteorológico Nacional para{' '}
            <span className="font-semibold">cualquier municipio de México</span>: escribe su nombre en el buscador.
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
            <div><p className="text-sm text-slate-400 mb-0.5">Lluvia</p><p className="text-3xl font-bold text-violet-300 leading-none">{d0.prob_precip != null ? Math.round(d0.prob_precip) : '--'}<span className="text-lg font-semibold text-slate-400">%</span></p>{d0.precip != null && d0.precip > 0 && <p className="text-xs text-slate-400 mt-1">{u.rain(d0.precip)} {u.rainU}</p>}</div>
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
                    {/* El SMN a veces da 0% con varios mm esperados: se muestran ambos tal cual. */}
                    {((d.prob_precip ?? 0) > 0 || (d.precip ?? 0) > 0) && (
                      <span className="text-sm text-sky-400 ml-2">
                        💧 {d.prob_precip != null ? Math.round(d.prob_precip) : '--'}%
                        {d.precip != null && d.precip > 0 && <span className="text-sky-300/70"> · {u.rain(d.precip)} {u.rainU}</span>}
                      </span>
                    )}
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
                    {h.precip != null && h.precip > 0 && <span className="text-[10px] text-sky-300/70">{u.rain(h.precip)} {u.rainU}</span>}
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
