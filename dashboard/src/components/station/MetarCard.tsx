import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUnits } from '../../units'

const STATION = 'MMMX'   // Aeropuerto Internacional de la Ciudad de México
const REFRESH = 600000   // 10 min (igual que la caché del servidor)

interface Cloud { cover: string; base: number | null }
interface Metar {
  station?: string; name?: string; observed?: string | null
  temp_c?: number | null; dewpoint_c?: number | null
  wind_dir?: number | null; wind_speed_kt?: number | null; wind_gust_kt?: number | null
  visibility?: number | string | null; altimeter_hpa?: number | null
  flight_category?: string | null; clouds?: Cloud[]; wx?: string | null
}

const CARD16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const dir16 = (d: number) => CARD16[Math.round(d / 22.5) % 16]

const COVER: Record<string, string> = {
  FEW: 'Escasas', SCT: 'Dispersas', BKN: 'Fragmentadas', OVC: 'Cubierto',
  CLR: 'Despejado', SKC: 'Despejado', NSC: 'Sin nubes signif.', NCD: 'Sin nubes', VV: 'Cielo oscurecido',
}
const CAT: Record<string, { color: string; short: string; long: string }> = {
  VFR: { color: '#34d399', short: 'Buen tiempo para volar',
    long: 'Cielo despejado y buena visibilidad; se vuela a la vista.' },
  MVFR: { color: '#38bdf8', short: 'Tiempo marginal',
    long: 'Techo de nubes o visibilidad algo reducidos.' },
  IFR: { color: '#fb923c', short: 'Requiere instrumentos',
    long: 'Techo bajo o poca visibilidad; se vuela por instrumentos.' },
  LIFR: { color: '#f87171', short: 'Muy malo',
    long: 'Techo y visibilidad muy bajos; solo por instrumentos.' },
}

function obsTime(observed?: string | null): string | null {
  if (!observed) return null
  const iso = observed.includes('T') ? observed : observed.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}Z`
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-right tabular-nums">{value}</span>
    </div>
  )
}

export function MetarCard() {
  const u = useUnits()
  const [m, setM] = useState<Metar | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'empty'>('loading')

  useEffect(() => {
    let cancel = false
    const load = () => {
      fetch(`/api/metar?station=${STATION}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancel) return
          if (j && (j.raw || j.temp_c != null || j.flight_category)) { setM(j); setState('ok') }
          else setState('empty')
        })
        .catch(() => !cancel && setState('empty'))
    }
    load()
    const i = setInterval(load, REFRESH)
    return () => { cancel = true; clearInterval(i) }
  }, [])

  const header = (
    <div className="flex items-start justify-between gap-2">
      <p className="card-title mb-0">✈️ METAR</p>
      {m?.station && (
        <div className="text-right leading-tight">
          <p className="font-semibold tabular-nums">{m.station}</p>
          {m.name && <p className="text-[10px] text-slate-500 max-w-[22ch] truncate">{m.name}</p>}
        </div>
      )}
    </div>
  )

  if (state !== 'ok' || !m) {
    return (
      <div className="card">
        {header}
        <p className="text-slate-400 text-sm py-6 text-center">
          {state === 'loading' ? 'Cargando METAR…' : 'METAR no disponible.'}
        </p>
      </div>
    )
  }

  const cat = m.flight_category ? CAT[m.flight_category] : null

  // Viento: kt → unidad del sitio; flecha apunta desde dónde sopla.
  const windKmh = m.wind_speed_kt != null ? m.wind_speed_kt * 1.852 : null
  const gustKmh = m.wind_gust_kt != null ? m.wind_gust_kt * 1.852 : null
  const windValue = () => {
    if (windKmh == null || windKmh === 0) return 'Calma'
    const d = typeof m.wind_dir === 'number'
      ? <>{m.wind_dir}° <span className="text-slate-400 font-normal">{dir16(m.wind_dir)}</span> · </>
      : <>variable · </>
    return <>{d}{u.wind(windKmh)}{gustKmh ? ` (ráf. ${u.wind(gustKmh)})` : ''} {u.windU}</>
  }

  // Base de nubes: ft → m (métrico) o ft (imperial).
  const baseStr = (ft: number | null) => {
    if (ft == null) return ''
    return u.system === 'imperial'
      ? ` a ${ft.toLocaleString('es-MX')} ft`
      : ` a ${Math.round(ft * 0.3048).toLocaleString('es-MX')} m`
  }

  // Visibilidad: SM → km (métrico) o millas (imperial).
  const visValue = () => {
    const v = m.visibility
    if (v == null) return '--'
    if (typeof v === 'string') {
      const n = parseFloat(v)
      if (isNaN(n)) return v
      return u.system === 'imperial' ? `≥ ${n} mi` : `≥ ${Math.round(n * 1.609)} km`
    }
    return u.system === 'imperial' ? `${v} mi` : `${(v * 1.609).toFixed(v * 1.609 < 10 ? 1 : 0)} km`
  }

  const clouds = m.clouds ?? []
  const obs = obsTime(m.observed)

  return (
    <div className="card">
      {header}

      {cat && (
        <div className="mt-3 rounded-lg border px-3 py-2"
          style={{ backgroundColor: `${cat.color}1f`, borderColor: `${cat.color}55` }}>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold" style={{ color: cat.color }}>{m.flight_category}</span>
            <span className="text-sm font-semibold" style={{ color: cat.color }}>{cat.short}</span>
          </div>
          <p className="text-xs text-slate-300 mt-0.5 leading-snug">{cat.long}</p>
        </div>
      )}

      <div className="mt-3 space-y-2 text-sm">
        <Field label="Temp" value={m.temp_c != null
          ? <>{u.temp(m.temp_c)}{u.tempU}
              {m.dewpoint_c != null && <span className="text-slate-400 font-normal"> · rocío {u.temp(m.dewpoint_c)}{u.tempU}</span>}</>
          : '--'} />
        <Field label="Viento" value={
          <span className="inline-flex items-center gap-1.5 justify-end">
            {typeof m.wind_dir === 'number' && windKmh ? (
              <svg width={12} height={12} viewBox="0 0 12 12" className="shrink-0"
                style={{ transform: `rotate(${m.wind_dir}deg)` }}>
                <polygon points="6,1 3,9 6,7 9,9" fill={cat?.color ?? '#34d399'} />
              </svg>
            ) : null}
            {windValue()}
          </span>
        } />
        <Field label="Visibilidad" value={visValue()} />
        <Field label="Presión (QNH)" value={m.altimeter_hpa != null ? <>{u.press(m.altimeter_hpa)} {u.pressU}</> : '--'} />

        <div>
          <p className="text-slate-400 mb-1">Cielo</p>
          {clouds.length === 0 ? (
            <p className="text-right font-semibold">Despejado</p>
          ) : (
            <div className="space-y-0.5">
              {clouds.map((c, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-500">{COVER[c.cover] ?? c.cover}</span>
                  <span className="font-medium tabular-nums">{baseStr(c.base).replace(/^ a /, '')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
        <span>{obs ? `Obs. ${obs}` : ''}</span>
        <Link to="/pro/aeronautica" className="text-blue-400 hover:text-blue-300">Aeronáutica →</Link>
      </div>
    </div>
  )
}
