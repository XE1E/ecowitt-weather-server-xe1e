import { useState, useEffect } from 'react'
import { Plane, RefreshCw, Search } from 'lucide-react'
import { AtmosphericProfile } from '../components/station/AtmosphericProfile'
import { PageInfo } from '../components/station/PageInfo'

// Los 15 aeropuertos más importantes de México (ICAO · nombre)
const AIRPORTS: [string, string][] = [
  ['MMMX', 'Ciudad de México'],
  ['MMUN', 'Cancún'],
  ['MMGL', 'Guadalajara'],
  ['MMTJ', 'Tijuana'],
  ['MMMY', 'Monterrey'],
  ['MMSD', 'Los Cabos'],
  ['MMPR', 'Puerto Vallarta'],
  ['MMMD', 'Mérida'],
  ['MMBJ', 'Del Bajío · León'],
  ['MMSM', 'AIFA · Santa Lucía'],
  ['MMHO', 'Hermosillo'],
  ['MMCU', 'Chihuahua'],
  ['MMCZ', 'Cozumel'],
  ['MMVR', 'Veracruz'],
  ['MMQT', 'Querétaro'],
]

interface Cloud { cover: string; base: number | null }
interface Metar {
  station?: string; name?: string; raw?: string; observed?: string
  temp_c?: number | null; dewpoint_c?: number | null
  wind_dir?: number | null; wind_speed_kt?: number | null; wind_gust_kt?: number | null
  visibility?: number | string | null; altimeter_hpa?: number | null; slp_hpa?: number | null
  flight_category?: string | null; clouds?: Cloud[]; wx?: string | null
}
interface TafPeriod {
  from: number; to: number; change: string | null; probability: number | null
  wind_dir: number | null; wind_speed_kt: number | null; wind_gust_kt: number | null
  visibility: number | string | null; wx: string | null; clouds: Cloud[]
}
interface Taf { station?: string; raw?: string; issued?: string; valid_from?: number; valid_to?: number; periods?: TafPeriod[] }

const CARD16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const dir16 = (d: number) => CARD16[Math.round(d / 22.5) % 16]

const COVER: Record<string, string> = {
  FEW: 'Escasas', SCT: 'Dispersas', BKN: 'Fragmentadas', OVC: 'Cubierto',
  CLR: 'Despejado', SKC: 'Despejado', NSC: 'Sin nubes significativas', NCD: 'Sin nubes', VV: 'Cielo oscurecido',
}
const CAT: Record<string, { es: string; color: string; desc: string }> = {
  VFR: { es: 'VFR', color: '#34d399', desc: 'Condiciones visuales' },
  MVFR: { es: 'MVFR', color: '#38bdf8', desc: 'Visuales marginales' },
  IFR: { es: 'IFR', color: '#fb923c', desc: 'Por instrumentos' },
  LIFR: { es: 'LIFR', color: '#f87171', desc: 'Instrumentos, techo/visibilidad muy bajos' },
}
const WX2: Record<string, string> = {
  MI: 'baja', BC: 'bancos', PR: 'parcial', DR: 'arrastre', BL: 'ventisca', SH: 'chubascos', TS: 'tormenta',
  FZ: 'engelante', DZ: 'llovizna', RA: 'lluvia', SN: 'nieve', SG: 'cinarra', PL: 'hielo granulado',
  GR: 'granizo', GS: 'granizo pequeño', UP: 'precipitación desconocida', BR: 'neblina', FG: 'niebla',
  FU: 'humo', VA: 'ceniza volcánica', DU: 'polvo', SA: 'arena', HZ: 'calima', PY: 'rocío', PO: 'remolinos',
  SQ: 'turbonada', FC: 'tromba', DS: 'tormenta de polvo', SS: 'tormenta de arena', NSW: 'sin fenómenos',
}

function decodeWxToken(tok: string): string {
  let pre = '', t = tok
  if (t.startsWith('-')) { pre = 'ligera '; t = t.slice(1) }
  else if (t.startsWith('+')) { pre = 'fuerte '; t = t.slice(1) }
  if (t.startsWith('VC')) { pre += 'en cercanías '; t = t.slice(2) }
  const parts: string[] = []
  for (let i = 0; i < t.length; i += 2) { const c = t.slice(i, i + 2); if (WX2[c]) parts.push(WX2[c]) }
  return (pre + parts.join(' de ')).trim() || tok
}
const decodeWx = (s?: string | null) => (s ? s.split(/\s+/).map(decodeWxToken).join(', ') : null)

function cloudsText(clouds?: Cloud[]): string {
  if (!clouds || !clouds.length) return 'Sin nubes reportadas'
  return clouds.map((c) => `${COVER[c.cover] ?? c.cover}${c.base != null ? ` a ${c.base.toLocaleString('es-MX')} ft` : ''}`).join(' · ')
}
function windText(dir?: number | string | null, spd?: number | null, gst?: number | null): string {
  if (spd == null || spd === 0) return 'Calma'
  const d = typeof dir === 'number' ? `${dir}° (${dir16(dir)})` : 'variable'
  return `${d}, ${spd} kt${gst ? `, ráfagas ${gst} kt` : ''}`
}
function visText(v?: number | string | null): string {
  if (v == null) return '--'
  if (typeof v === 'number') return `${v} SM (~${Math.round(v * 1.609)} km)`
  if (v.includes('+')) return '≥ 10 km'
  return `${v} SM`
}
function hhmm(ts?: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
function tstr(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function AeronauticaPage() {
  const [icao, setIcao] = useState('MMMX')
  const [query, setQuery] = useState('')
  const [metar, setMetar] = useState<Metar | null>(null)
  const [taf, setTaf] = useState<Taf | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    setLoading(true); setMetar(null); setTaf(null)
    Promise.all([
      fetch(`/api/metar?station=${icao}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/taf?station=${icao}`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([m, t]) => { if (!cancel) { setMetar(m); setTaf(t); setLoading(false) } })
      .catch(() => !cancel && setLoading(false))
    return () => { cancel = true }
  }, [icao])

  const search = () => {
    const c = query.trim().toUpperCase()
    if (c.length >= 3) { setIcao(c); setQuery('') }
  }

  const cat = metar?.flight_category ? CAT[metar.flight_category] : null
  const name = AIRPORTS.find((a) => a[0] === icao)?.[1] ?? metar?.name ?? icao

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Plane className="w-6 h-6 text-sky-400" /> Meteorología Aeronáutica</h2>
          <p className="text-xs text-slate-400">{name} ({icao}) · METAR, TAF y categoría de vuelo en vivo.</p>
        </div>
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="ICAO (ej. MMGL)"
            className="bg-white/5 border border-white/10 rounded-lg text-sm px-3 py-1.5 text-slate-200 w-36 uppercase placeholder:normal-case placeholder:text-slate-500"
          />
          <button onClick={search} className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 text-sm flex items-center gap-1">
            <Search className="w-4 h-4" /> Buscar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-400" /></div>
      ) : (
        <div className="space-y-4">
          {/* Perfil atmosférico en vivo */}
          {metar?.raw && (
            <div>
              <h3 className="text-lg font-semibold text-slate-300 mb-2">Perfil atmosférico en vivo · {icao}</h3>
              <AtmosphericProfile m={metar} />
            </div>
          )}

          {/* METAR decodificado */}
          <div className="card">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <p className="text-base font-bold text-slate-100">METAR · {icao} {name !== icao ? `· ${name}` : ''}</p>
                {metar?.observed && <p className="text-xs text-slate-400">Observado: {tstr(metar.observed)}</p>}
              </div>
              {cat && (
                <span className="px-2 py-1 rounded-lg text-xs font-bold" style={{ backgroundColor: cat.color + '22', color: cat.color }}>
                  {cat.es} · {cat.desc}
                </span>
              )}
            </div>
            {!metar?.raw ? (
              <p className="text-slate-400 text-sm mt-3">Sin METAR disponible para {icao}. Verifica el código ICAO.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm mt-3">
                  <Field label="Viento" value={windText(metar.wind_dir, metar.wind_speed_kt, metar.wind_gust_kt)} />
                  <Field label="Visibilidad" value={visText(metar.visibility)} />
                  <Field label="Nubes" value={cloudsText(metar.clouds)} />
                  <Field label="Temp. / Rocío" value={metar.temp_c != null ? `${metar.temp_c}° / ${metar.dewpoint_c ?? '--'}°C` : '--'} />
                  <Field label="Presión (QNH)" value={metar.altimeter_hpa != null ? `${metar.altimeter_hpa} hPa` : '--'} />
                  {decodeWx(metar.wx) && <Field label="Fenómenos" value={decodeWx(metar.wx)!} />}
                </div>
                <p className="text-[11px] text-slate-500 mt-3 font-mono break-all bg-black/20 rounded-lg px-3 py-2">{metar.raw}</p>
              </>
            )}
          </div>

          {/* TAF decodificado */}
          <div className="card">
            <p className="card-title">Pronóstico TAF</p>
            {!taf?.raw ? (
              <p className="text-slate-400 text-sm">Sin TAF disponible para {icao}.</p>
            ) : (
              <>
                {taf.issued && (
                  <p className="text-xs text-slate-400 -mt-1 mb-2">Emitido {tstr(taf.issued)} · válido {hhmm(taf.valid_from)} → {hhmm(taf.valid_to)}</p>
                )}
                <div className="space-y-2">
                  {(taf.periods ?? []).map((p, i) => <TafRow key={i} p={p} first={i === 0} />)}
                </div>
                <p className="text-[11px] text-slate-500 mt-3 font-mono break-all bg-black/20 rounded-lg px-3 py-2">{taf.raw}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Aeropuertos populares */}
      <div className="card mt-4">
        <p className="card-title">Aeropuertos populares (México)</p>
        <div className="flex flex-wrap gap-1.5">
          {AIRPORTS.map(([code, label]) => (
            <button
              key={code}
              onClick={() => setIcao(code)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${icao === code ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
            >
              <span className="font-mono font-semibold">{code}</span>
              <span className={`ml-1.5 text-xs ${icao === code ? 'text-blue-100' : 'text-slate-500'}`}>{label}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">Busca cualquier código ICAO arriba para ver su METAR, TAF y perfil atmosférico.</p>
      </div>

      <PageInfo>
        <p>
          El <span className="font-semibold">METAR</span> es la observación del aeropuerto (cada hora); el
          {' '}<span className="font-semibold">TAF</span> es el pronóstico aeronáutico (~24–30 h). La
          {' '}<span className="font-semibold">categoría de vuelo</span> resume las condiciones:
          {' '}<span style={{ color: CAT.VFR.color }}>VFR</span> (visual), <span style={{ color: CAT.MVFR.color }}>MVFR</span>,
          {' '}<span style={{ color: CAT.IFR.color }}>IFR</span> y <span style={{ color: CAT.LIFR.color }}>LIFR</span> (peores
          condiciones). El <span className="font-semibold">perfil atmosférico</span> dibuja las capas de nubes por altitud,
          el viento y el QNH del reporte. Fuente: aviationweather.gov (NOAA), en unidades aeronáuticas (nudos, millas
          terrestres, hPa). Horas en tu zona local.
        </p>
      </PageInfo>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-slate-100">{value}</p>
    </div>
  )
}

const CHANGE: Record<string, string> = { FM: 'Desde', BECMG: 'Cambio gradual', TEMPO: 'Temporal', PROB: 'Probable' }

function TafRow({ p, first }: { p: TafPeriod; first: boolean }) {
  let head: string
  if (first) head = `Base · ${hhmm(p.from)} → ${hhmm(p.to)}`
  else if (p.change === 'FM') head = `Desde ${hhmm(p.from)}`
  else if (p.change) head = `${CHANGE[p.change] ?? p.change} ${hhmm(p.from)} → ${hhmm(p.to)}`
  else if (p.probability) head = `Probable ${p.probability}% · ${hhmm(p.from)} → ${hhmm(p.to)}`
  else head = `${hhmm(p.from)} → ${hhmm(p.to)}`
  const wx = decodeWx(p.wx)
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-xs font-semibold text-sky-300">{head}</p>
      <p className="text-sm text-slate-300 mt-0.5">
        Viento {windText(p.wind_dir, p.wind_speed_kt, p.wind_gust_kt)} · Vis. {visText(p.visibility)} · {cloudsText(p.clouds)}
        {wx ? ` · ${wx}` : ''}
      </p>
    </div>
  )
}
