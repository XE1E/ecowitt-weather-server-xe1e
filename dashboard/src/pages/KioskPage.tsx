import { useEffect, useState, type ReactNode } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { deriveCondition, relativeTime, parseServerDate } from '../weather'
import { LOCATION } from '../config'
import { WeatherIcon } from '../components/WeatherIcon'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_CORTO = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
const pad = (n: number) => String(n).padStart(2, '0')

// ── Helpers de la página "consola" (réplica de la consola física Ecowitt) ──
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const cardinal = (deg?: number) => (deg == null ? '--' : DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16])

// Fase lunar sencilla (mes sinódico) → fracción iluminada + creciente/menguante.
function moonPhase(d: Date) {
  const syn = 29.530588853
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000 // luna nueva de referencia
  const phase = (((d.getTime() / 86400000 - ref) / syn) % 1 + 1) % 1
  return { phase, illum: (1 - Math.cos(2 * Math.PI * phase)) / 2, waxing: phase <= 0.5 }
}

// Números de la consola: la parte decimal (".4") en fuente más chica, como una
// consola física. Divide en el punto; si no hay decimal, devuelve el string tal cual.
function decNum(s: string): ReactNode {
  const i = s.indexOf('.')
  if (i < 0) return s
  return (
    <>
      {s.slice(0, i)}
      <span className="dec">{s.slice(i)}</span>
    </>
  )
}

// Dibuja la luna con la iluminación real (terminador elíptico correcto).
function MoonGlyph({ size = 42 }: { size?: number }) {
  const R = size / 2
  const { phase, illum, waxing } = moonPhase(new Date())
  const rx = Math.max(0.4, Math.abs(R * Math.cos(2 * Math.PI * phase)))
  const gibbous = illum > 0.5
  const s1 = waxing ? 1 : 0
  const s2 = gibbous ? s1 : 1 - s1
  const litPath = `M0,${-R} A ${R} ${R} 0 0 ${s1} 0 ${R} A ${rx} ${R} 0 0 ${s2} 0 ${-R} Z`
  return (
    <svg width={size} height={size} viewBox={`${-R} ${-R} ${size} ${size}`}>
      <circle r={R} fill="#1b1b1b" />
      <path d={litPath} fill="#ffcf19" />
    </svg>
  )
}

// Pestañas de la barra inferior. El ORDEN y el número deben coincidir con
// NUM_PAGES del firmware (que mapea el toque en la franja inferior a la pagina
// segun la X). Pagina N -> TABS[N-1].
const TABS = [
  { icon: '☀️', label: 'Estación' },
  { icon: '📍', label: 'Local' },
  { icon: '🏠', label: 'Sensores' },
  { icon: '📅', label: '7 días' },
  { icon: '📈', label: '24 h' },
  { icon: '🖥️', label: 'Consola' },
]

interface Imeca { available: boolean; imeca?: number; category?: string; color?: string }
interface Local {
  latest: { temperature?: number; humidity?: number; pressure?: number; received_at?: string } | null
  min: { temperature?: number; humidity?: number; pressure?: number }
  max: { temperature?: number; humidity?: number; pressure?: number }
}

function Tile({ label, value, unit, sub, color }: {
  label: string; value: string; unit?: string; sub?: string; color?: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 flex flex-col justify-center">
      <p className="text-[15px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-[38px] leading-none font-bold mt-1" style={{ color: color || '#e2e8f0' }}>
        {value}<span className="text-[19px] font-medium text-slate-400 ml-1">{unit}</span>
      </p>
      {sub && <p className="text-[13px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

// Tarjeta compacta para sensores (interior / canal / remoto).
function SensorCard({ title, temp, hum, extra, warn }: {
  title: string; temp: string; hum?: string; extra?: string; warn?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 flex flex-col justify-center">
      <div className="flex items-center justify-between">
        <p className="text-[17px] text-slate-300 font-semibold">{title}</p>
        {warn && <span className="text-[13px] text-amber-400">⚠ batería</span>}
      </div>
      <p className="text-[44px] leading-none font-bold mt-2 text-orange-200">{temp}</p>
      <p className="text-[16px] text-slate-400 mt-2">
        {hum ? <>💧 {hum}</> : null}{extra ? <span className="ml-3">{extra}</span> : null}
      </p>
    </div>
  )
}

/**
 * Página "kiosco" 1024×600 para el display ESP32-S3. El servidor la renderiza
 * (headless) y sirve la imagen; el ESP32 solo la baja y la pinta. `?page=N`
 * elige la página. `data-kiosk-ready` avisa al renderer cuándo capturar.
 * Barra de pestañas inferior fija (64px) para navegar por touch.
 */
export function KioskPage() {
  const { data, stats, forecast, history, loading } = useStationData()
  const u = useUnits()
  const [now, setNow] = useState(() => new Date())
  const [imeca, setImeca] = useState<Imeca | null>(null)
  const [local, setLocal] = useState<Local | null>(null)
  const [localFetched, setLocalFetched] = useState(false)
  const [remote, setRemote] = useState<Record<string, number> | null>(null)

  const page = new URLSearchParams(window.location.search).get('page') || '1'

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  useEffect(() => {
    fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setImeca).catch(() => {})
  }, [])
  useEffect(() => {
    const load = () => fetch('/api/kiosk/local').then((r) => (r.ok ? r.json() : null))
      .then((j) => { setLocal(j); setLocalFetched(true) }).catch(() => setLocalFetched(true))
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [])
  // Estación remota (GW1100): página de sensores y consola.
  useEffect(() => {
    if (page !== '3' && page !== 'consola') return
    const load = () => fetch('/api/current?station=gw1100').then((r) => (r.ok ? r.json() : null))
      .then(setRemote).catch(() => {})
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [page])

  const ready =
    page === '2' ? localFetched :
    page === '4' ? !!(forecast?.days?.length) :
    page === '5' ? (!loading && history.length > 0) :
    (!loading && !!data)   // páginas 1 y 3

  const header = (
    <div className="flex items-center justify-between px-8 pt-4 pb-1">
      <div>
        <p className="text-[22px] font-bold leading-tight">Clima XE1E · {LOCATION.name}</p>
        <p className="text-[13px] text-slate-400">{LOCATION.label}</p>
      </div>
      <div className="text-right leading-none">
        <p className="text-[15px] text-slate-300 mb-1">{DIAS[now.getDay()]} {now.getDate()} de {MESES[now.getMonth()]}</p>
        <p className="text-[40px] font-bold tabular-nums">{pad(now.getHours())}:{pad(now.getMinutes())}</p>
      </div>
    </div>
  )

  const tabBar = (
    <div className="flex border-t border-white/10" style={{ height: 64 }}>
      {TABS.map((t, i) => {
        const active = (parseInt(page) || 1) === i + 1
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-center"
            style={{
              background: active ? 'rgba(56,189,248,0.15)' : 'transparent',
              borderTop: active ? '3px solid #38bdf8' : '3px solid transparent',
            }}>
            <span style={{ fontSize: 24, opacity: active ? 1 : 0.55, lineHeight: 1 }}>{t.icon}</span>
            <span className="text-[12px] mt-1" style={{ color: active ? '#e2e8f0' : '#64748b' }}>{t.label}</span>
          </div>
        )
      })}
    </div>
  )

  const shell = (children: ReactNode) => (
    <div
      data-kiosk-ready={ready ? 'true' : 'false'}
      className="text-slate-100 overflow-hidden flex flex-col"
      style={{
        width: 1024, height: 600,
        background: 'radial-gradient(1200px 600px at 70% -10%, #14304f 0%, #0b1220 55%, #070d17 100%)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      {header}
      <div className="flex-1 min-h-0">{children}</div>
      {tabBar}
    </div>
  )

  // ── Página "consola": réplica de la consola física Ecowitt, pantalla
  //    completa (sin header ni barra de pestañas), llena todo el ancho. ──
  if (page === 'consola') {
    const cond = data ? deriveCondition(data) : { icon: '', label: '' }
    const dir = data?.wind_direction
    const chTemp = data?.temperature_ch1
    const chHum = data?.humidity_ch1
    const hasCh1 = chTemp != null || chHum != null
    const sTemp = hasCh1 ? chTemp : remote?.temperature_indoor
    const sHum = hasCh1 ? chHum : remote?.humidity_indoor
    
    const css = `
      @font-face{font-family:'DSEG7';src:url('/fonts/DSEG7Classic-Bold.woff2') format('woff2');font-display:block}
      .cns{--o:#ff7b1c;--b:#2ab7f4;--y:#ffcf19;--g:#37d64a;--w:#eaeaea;--lbl:#8a8a8a;--red:#ff4128;
        font-family:'Roboto Condensed','Arial Narrow','Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}
      .cns .lbl{color:var(--lbl);font-size:18px;font-weight:700;letter-spacing:2px;line-height:1}
      .cns .lbl .ac{color:var(--o)} .cns .lbl .acg{color:var(--g)}
      .cns .big{font-weight:800;line-height:.82;letter-spacing:-1px}
      /* Números en fuente 7-segmentos (DSEG). Las clases de glow .go/.gy/.gw/.gb
         solo se usan en números; .gg es mixta (números + fecha) → a mano con .seg.
         Las unidades (.u) y etiquetas (.lbl) se quedan en sans. */
      .cns .seg,.cns .big,.cns .go,.cns .gy,.cns .gw,.cns .gb{font-family:'DSEG7','Roboto Condensed',monospace}
      .cns .go{color:var(--o);text-shadow:0 0 12px rgba(255,123,28,.55)}
      .cns .gb{color:var(--b);text-shadow:0 0 12px rgba(42,183,244,.55)}
      .cns .gy{color:var(--y);text-shadow:0 0 12px rgba(255,207,25,.5)}
      .cns .gg{color:var(--g);text-shadow:0 0 12px rgba(55,214,74,.55)}
      .cns .gw{color:var(--w);text-shadow:0 0 10px rgba(234,234,234,.35)}
      .cns .u{font-weight:700;vertical-align:top;font-family:'Roboto Condensed','Arial Narrow',system-ui,sans-serif} .cns .ured{color:var(--red)}
      .cns .dec{font-size:0.6em}          /* decimales en tamaño más chico */
      .cns .rt{text-align:right}          /* valor pegado al borde derecho */
      .cns .cell{background:#000;position:relative;padding:9px 12px;overflow:hidden;min-width:0;min-height:0}
      .cns .col{display:flex;flex-direction:column}
      .cns .ctr{margin-top:auto;margin-bottom:auto}
      .cns .bt{display:flex;justify-content:space-between;align-items:flex-start}
    `
    return (
      <div data-kiosk-ready={ready ? 'true' : 'false'} className="cns"
        style={{ width: 1024, height: 600, background: '#242424', overflow: 'hidden' }}>
        <style>{css}</style>
        <div style={{
          display: 'grid', width: 1024, height: 600, gap: 4,
          gridTemplateColumns: '1fr 1fr 1fr',
          gridTemplateRows: '1.32fr 1.14fr 1.18fr 1.0fr 0.92fr',
          background: '#3a3a3a',
        }}>
          {/* Fila 1 */}
          <div className="cell col">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>EXT</div>
            <div className="big go ctr rt" style={{ fontSize: 104 }}>
              {decNum(u.temp(data?.temperature_outdoor))}<span className="u ured" style={{ fontSize: 26 }}>{u.tempU}</span>
            </div>
          </div>

          <div className="cell" style={{ gridRow: 'span 2', padding: '7px 9px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>VIENTO</div>
            <span style={{ position: 'absolute', left: 10, top: 32, color: 'var(--w)', fontSize: 16, fontWeight: 700, zIndex: 2 }}>{cardinal(dir)}</span>
            {/* Compás ovalado grande: ocupa el centro de las 2 filas fusionadas */}
            <div style={{ flex: 1, position: 'relative', minHeight: 0, marginTop: -8 }}>
              <svg viewBox="0 0 100 80" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block', position: 'absolute', inset: 0 }}>
                <ellipse cx="50" cy="40" rx="49" ry="38" stroke="#3a3a3a" strokeWidth="1" fill="none" />
                <ellipse cx="50" cy="40" rx="42" ry="31" stroke="#232323" strokeWidth="0.8" fill="none" />
                <text x="50" y="9" fill="#eaeaea" fontSize="6.5" fontWeight="700" textAnchor="middle">N</text>
                <text x="98" y="43" fill="#eaeaea" fontSize="6.5" fontWeight="700" textAnchor="middle">E</text>
                <text x="50" y="76" fill="#eaeaea" fontSize="6.5" fontWeight="700" textAnchor="middle">S</text>
                <text x="2" y="43" fill="#eaeaea" fontSize="6.5" fontWeight="700" textAnchor="middle">W</text>
                {dir != null && (
                  <g transform={`rotate(${dir} 50 40)`}>
                    <polygon points="50,-1 47,6 50,4 53,6" fill="#37d64a" />
                  </g>
                )}
              </svg>
              <div className="gg" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontWeight: 800 }}>
                <span className="seg" style={{ fontSize: 52 }}>{dir != null ? Math.round(dir) : '--'}</span><span style={{ fontSize: 28, verticalAlign: 'super' }}>°</span>
              </div>
            </div>
            {/* ROCÍO + SENS en una línea, al pie de la celda del viento */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly', gap: 6, paddingBottom: 2 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--o)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>ROCÍO</div>
                <div className="go" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                  {decNum(u.temp(data?.dew_point))}<span className="u ured" style={{ fontSize: 16 }}>{u.tempU}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--o)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>SENS</div>
                <div className="go" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                  {decNum(u.temp(data?.feels_like))}<span className="u ured" style={{ fontSize: 16 }}>{u.tempU}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="cell col">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>VEL</div>
            <div style={{ position: 'absolute', top: 10, right: 12 }}>
              <svg width="30" height="22" viewBox="0 0 34 24" fill="none">
                <path d="M2 8 H20 a4 4 0 1 0 -4 -4" stroke="#ff7b1c" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M2 15 H25 a4.5 4.5 0 1 1 -4.5 4.5" stroke="#ff7b1c" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="big go ctr rt" style={{ fontSize: 104 }}>
              {decNum(u.wind(data?.wind_speed, 1))}<span className="u" style={{ fontSize: 26, color: 'var(--o)' }}> {u.windU}</span>
            </div>
          </div>

          {/* Fila 2 */}
          <div className="cell col">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>HUMEDAD</div>
            <div className="big gw ctr rt" style={{ fontSize: 80, lineHeight: 0.8 }}>
              {decNum((data?.humidity_outdoor ?? 0).toFixed(0))}<span className="u" style={{ fontSize: 34, color: 'var(--w)' }}>%</span>
            </div>
          </div>

          {/* ROCÍO/SENS viven dentro de la celda VIENTO */}

          <div className="cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>PROM <span style={{ color: 'var(--w)', fontWeight: 400 }}>{u.windU}</span></div>
                <div className="gw seg" style={{ fontSize: 44, fontWeight: 800, marginTop: 4 }}>
                  {decNum(u.wind(data?.wind_speed, 1))}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>RÁFAGA <span style={{ color: 'var(--w)', fontWeight: 400 }}>{u.windU}</span></div>
                <div className="go seg" style={{ fontSize: 44, fontWeight: 800, marginTop: 4 }}>
                  {decNum(u.wind(data?.wind_gust, 1))}
                </div>
              </div>
            </div>
          </div>

          {/* Fila 3 */}
          <div className="cell col">
            <div className="bt"><span style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>PRESIÓN</span><span style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700 }}>REL</span></div>
            <div className="big gb ctr rt" style={{ fontSize: 56 }}>
              {u.press(data?.pressure_relative, 0)}<span className="u" style={{ fontSize: 24, color: 'var(--b)' }}> {u.pressU}</span>
            </div>
          </div>

          <div className="cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
            <WeatherIcon name={cond.icon} size={160} className="weather-main-icon" />
          </div>

          <div className="cell">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>LLUVIA</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: 7 }}>
              <span className="gb seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {decNum(u.rain(data?.rain_daily))}<span className="u" style={{ fontSize: 20, color: 'var(--b)' }}>{u.rainU}</span>
              </span>
              <span className="gb seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {decNum(u.rain(data?.rain_rate))}<span className="u" style={{ fontSize: 20, color: 'var(--b)' }}>/h</span>
              </span>
            </div>
          </div>

          {/* Fila 4 */}
          <div className="cell col">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>INT</div>
            <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16 }}>
              <span className="gy" style={{ fontSize: 46, fontWeight: 800 }}>
                {decNum(u.temp(data?.temperature_indoor))}<span className="u ured" style={{ fontSize: 20 }}>{u.tempU}</span>
              </span>
              <span className="gy" style={{ fontSize: 46, fontWeight: 800 }}>
                {data?.humidity_indoor != null ? data.humidity_indoor.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--y)' }}>%</span>
              </span>
            </div>
          </div>

          <div className="cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'center', width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>LUNA</div>
                <MoonGlyph size={42} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>SOLAR</div>
                <div className="gw seg" style={{ fontSize: 32, fontWeight: 800, marginTop: 2 }}>
                  {data?.solar_radiation != null ? decNum(data.solar_radiation.toFixed(0)) : '--'}<span className="u" style={{ fontSize: 12, color: 'var(--w)' }}> W/m²</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>UV</div>
                <div className="gw seg" style={{ fontSize: 32, fontWeight: 800, marginTop: 2 }}>
                  {data?.uv_index ?? '--'}
                </div>
              </div>
            </div>
          </div>

          <div className="cell col">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA <span style={{ color: 'var(--g)' }}>GW1100</span></div>
            <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16 }}>
              <span className="gg seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remote?.temperature_indoor != null ? decNum(u.temp(remote.temperature_indoor)) : '--'}<span className="u ured" style={{ fontSize: 20 }}>{u.tempU}</span>
              </span>
              <span className="gg seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remote?.humidity_indoor != null ? remote.humidity_indoor.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--g)' }}>%</span>
              </span>
            </div>
          </div>

          {/* Fila 5 */}
          <div className="cell col">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>JARDÍN</div>
            <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16 }}>
              <span className="gg seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {sTemp != null ? decNum(u.temp(sTemp)) : '--'}<span className="u ured" style={{ fontSize: 20 }}>{u.tempU}</span>
              </span>
              <span className="gg seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {sHum != null ? sHum.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--g)' }}>%</span>
              </span>
            </div>
          </div>

          <div className="cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>HORA</div>
                <div className="gg seg" style={{ fontSize: 46, fontWeight: 800, marginTop: 4 }}>{pad(now.getHours())}:{pad(now.getMinutes())}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>FECHA</div>
                <div style={{ marginTop: 4, lineHeight: 1.02 }}>
                  <div className="gg" style={{ fontSize: 26, fontWeight: 800 }}>{DIAS_CORTO[now.getDay()].toUpperCase()}</div>
                  <div className="gg" style={{ fontSize: 26, fontWeight: 800 }}>{now.getDate()} {MESES_CORTO[now.getMonth()]}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="cell col">
            <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>PRESIÓN <span style={{ color: 'var(--g)' }}>GW1100</span></div>
            <div className="big gg ctr rt" style={{ fontSize: 46 }}>
              {remote?.pressure_relative != null ? u.press(remote.pressure_relative, 0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--g)' }}> {u.pressU}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Página 2: sensor local del display (BME280) ──
  if (page === '2') {
    const L = local?.latest
    const mn = local?.min || {}
    const mx = local?.max || {}
    const bigCard = (label: string, value: string, unit: string, sub: string, color: string) => (
      <div className="flex-1 rounded-3xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-center">
        <p className="text-[28px] uppercase tracking-wider text-slate-300 font-semibold">{label}</p>
        <p className="text-[80px] leading-none font-bold mt-2" style={{ color }}>{value}<span className="text-[30px] text-slate-400 ml-1">{unit}</span></p>
        <p className="text-[24px] text-slate-300 mt-3">{sub}</p>
      </div>
    )
    return shell(
      <div className="h-full px-8 pt-1 pb-3 flex flex-col">
        <p className="text-[17px] text-slate-300 mb-2">📍 Sensor local del display · BME280</p>
        {!L ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-[20px]">
            Esperando datos del sensor local del display…
          </div>
        ) : (
          <>
            <div className="flex-1 flex gap-6 min-h-0">
              {bigCard('Temperatura', L.temperature != null ? `${u.temp(L.temperature)}` : '--', u.tempU,
                `mín ${mn.temperature != null ? u.temp(mn.temperature) : '--'}° · máx ${mx.temperature != null ? u.temp(mx.temperature) : '--'}°`, '#fdba74')}
              {bigCard('Humedad', L.humidity != null ? `${L.humidity.toFixed(0)}` : '--', '%',
                `mín ${mn.humidity?.toFixed(0) ?? '--'}% · máx ${mx.humidity?.toFixed(0) ?? '--'}%`, '#67e8f9')}
              {bigCard('Presión', L.pressure != null ? `${u.press(L.pressure)}` : '--', u.pressU,
                `mín ${mn.pressure != null ? u.press(mn.pressure) : '--'} · máx ${mx.pressure != null ? u.press(mx.pressure) : '--'}`, '#c4b5fd')}
            </div>
            <p className="text-[13px] text-slate-500 mt-2 text-center">
              Actualizado {L.received_at ? relativeTime(L.received_at) : '—'} · mín/máx de hoy
            </p>
          </>
        )}
      </div>
    )
  }

  // ── Página 3: sensores interior / adicionales / remoto ──
  if (page === '3') {
    const channels = Array.from({ length: 8 }, (_, i) => i + 1)
      .map((ch) => ({
        ch,
        temp: (data as any)?.[`temperature_ch${ch}`] as number | undefined,
        hum: (data as any)?.[`humidity_ch${ch}`] as number | undefined,
        battLow: (data as any)?.[`battery_ch${ch}`] === false,
      }))
      .filter((c) => c.temp != null || c.hum != null)

    const hasIndoor = data?.temperature_indoor != null || data?.humidity_indoor != null
    const hasRemote = remote && (remote.temperature_indoor != null || remote.humidity_indoor != null)

    return shell(
      <div className="h-full px-8 pt-1 pb-3 flex flex-col">
        <p className="text-[17px] text-slate-300 mb-2">🏠 Sensores · interior, adicionales y remoto</p>
        <div className="flex-1 grid grid-cols-3 grid-rows-2 gap-4 min-h-0">
          {hasIndoor && (
            <SensorCard title="🛋 Interior (consola)"
              temp={data?.temperature_indoor != null ? `${u.temp(data.temperature_indoor)}${u.tempU}` : '--'}
              hum={data?.humidity_indoor != null ? `${data.humidity_indoor.toFixed(0)}%` : undefined} />
          )}
          {channels.map((c) => (
            <SensorCard key={c.ch}
              title={`Canal ${c.ch}`}
              temp={c.temp != null ? `${u.temp(c.temp)}${u.tempU}` : '--'}
              hum={c.hum != null ? `${c.hum.toFixed(0)}%` : undefined}
              warn={c.battLow} />
          ))}
          {hasRemote && (
            <SensorCard title="📡 Remota (GW1100)"
              temp={remote!.temperature_indoor != null ? `${u.temp(remote!.temperature_indoor)}${u.tempU}` : '--'}
              hum={remote!.humidity_indoor != null ? `${remote!.humidity_indoor.toFixed(0)}%` : undefined}
              extra={remote!.pressure_relative != null ? `${u.press(remote!.pressure_relative)} ${u.pressU}` : undefined} />
          )}
          {!hasIndoor && channels.length === 0 && !hasRemote && (
            <div className="col-span-3 row-span-2 flex items-center justify-center text-slate-500 text-[20px]">
              Sin sensores adicionales conectados
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Página 4: pronóstico 7 días ──
  if (page === '4') {
    const days = forecast?.days?.slice(0, 7) ?? []
    return shell(
      <div className="h-full px-6 pt-1 pb-3 flex flex-col">
        <p className="text-[17px] text-slate-300 mb-2 px-2">📅 Pronóstico · 7 días</p>
        <div className="flex-1 flex gap-3 min-h-0">
          {days.length === 0 ? (
            <div className="w-full flex items-center justify-center text-slate-500 text-[20px]">Pronóstico no disponible</div>
          ) : days.map((d, i) => {
            const dt = new Date(d.date + 'T12:00:00')
            const name = i === 0 ? 'Hoy' : DIAS_CORTO[dt.getDay()]
            return (
              <div key={i} className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-between py-4">
                <span className="text-[19px] font-semibold text-slate-200">{name}</span>
                <span className="text-[13px] text-slate-500">{dt.getDate()}/{dt.getMonth() + 1}</span>
                <WeatherIcon name={d.icon} size={56} />
                <div className="text-center leading-tight">
                  <span className="text-[26px] font-bold">{u.temp(d.tempMax, 0)}°</span>
                  <span className="text-[19px] text-slate-400 ml-1">{u.temp(d.tempMin, 0)}°</span>
                </div>
                <span className="text-[15px] text-sky-300">💧 {d.precipProb ?? 0}%</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Página 5: tendencia 24 h ──
  if (page === '5') {
    const hist = history
      .map((h) => ({
        label: (() => { const dt = new Date(parseServerDate(h._time)); return `${pad(dt.getHours())}:${pad(dt.getMinutes())}` })(),
        temp: h.temperature_outdoor != null ? u.tempN(h.temperature_outdoor) : null,
        hum: h.humidity_outdoor ?? null,
      }))
      .filter((p) => p.temp != null)
    const step = Math.max(0, Math.floor(hist.length / 8))
    return shell(
      <div className="h-full px-8 pt-1 pb-2 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[17px] text-slate-300">📈 Tendencia · últimas 24 h</p>
          <p className="text-[14px]"><span className="text-orange-300">— temperatura</span> <span className="text-cyan-300 ml-3">-- humedad</span></p>
        </div>
        {hist.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-[20px]">Sin datos históricos</div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <LineChart width={960} height={400} data={hist} margin={{ top: 10, right: 40, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#ffffff14" vertical={false} />
              <XAxis dataKey="label" interval={step} tick={{ fill: '#94a3b8', fontSize: 14 }} stroke="#ffffff20" tickMargin={8} />
              <YAxis yAxisId="t" tick={{ fill: '#fdba74', fontSize: 14 }} stroke="#ffffff20" width={46} domain={['auto', 'auto']} unit={u.tempU} />
              <YAxis yAxisId="h" orientation="right" tick={{ fill: '#67e8f9', fontSize: 14 }} stroke="#ffffff20" width={40} domain={[0, 100]} unit="%" />
              <Line yAxisId="t" type="monotone" dataKey="temp" stroke="#fb923c" strokeWidth={3} dot={false} isAnimationActive={false} />
              <Line yAxisId="h" type="monotone" dataKey="hum" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} strokeDasharray="5 4" />
            </LineChart>
          </div>
        )}
      </div>
    )
  }

  // ── Página 1: estación ──
  const cond = data ? deriveCondition(data) : { icon: '', label: '' }
  const t = stats?.temperature_outdoor
  const uv = data?.uv_index ?? 0
  const hours = forecast?.hours?.slice(0, 6) ?? []

  return shell(
    <div className="h-full flex flex-col px-8 pt-2 pb-3 gap-3">
      <div className="flex-1 flex gap-6 min-h-0">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-center" style={{ width: 420 }}>
          <WeatherIcon name={cond.icon} size={120} />
          <div className="flex items-start mt-1">
            <span className="text-[110px] leading-none font-bold text-orange-200">
              {data?.temperature_outdoor != null ? u.temp(data.temperature_outdoor) : '--'}
            </span>
            <span className="text-[36px] font-semibold text-slate-400 mt-3">{u.tempU}</span>
          </div>
          <p className="text-[22px] text-slate-300 mt-1">{cond.label}</p>
          <p className="text-[17px] text-slate-400 mt-2">
            Sensación {data?.feels_like != null ? `${u.temp(data.feels_like)}${u.tempU}` : '--'} ·
            {' '}máx {t?.max != null ? `${u.temp(t.max)}°` : '--'} / mín {t?.min != null ? `${u.temp(t.min)}°` : '--'}
          </p>
        </div>

        <div className="grid grid-cols-3 grid-rows-2 gap-4 flex-1">
          <Tile label="Humedad" value={`${(data?.humidity_outdoor ?? 0).toFixed(0)}`} unit="%" color="#67e8f9" />
          <Tile label="Presión" value={u.press(data?.pressure_relative ?? 0, 0)} unit={u.pressU} color="#c4b5fd" />
          <Tile label="Viento" value={u.wind(data?.wind_speed ?? 0, 0)} unit={u.windU} sub={data?.wind_direction != null ? `${Math.round(data.wind_direction)}°` : undefined} color="#6ee7b7" />
          <Tile label="Lluvia hoy" value={u.rain(data?.rain_daily ?? 0)} unit={u.rainU} color="#93c5fd" />
          <Tile label="Índice UV" value={`${uv}`} color={uv >= 8 ? '#fca5a5' : uv >= 6 ? '#fdba74' : '#fde047'} />
          <Tile label="IMECA" value={imeca?.available && imeca.imeca != null ? `${imeca.imeca}` : '--'} sub={imeca?.category} color={imeca?.color || '#e2e8f0'} />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 flex justify-between" style={{ height: 128 }}>
        {hours.length === 0 ? (
          <div className="w-full flex items-center justify-center text-slate-500 text-[15px]">Pronóstico no disponible</div>
        ) : hours.map((h, i) => {
          const d = new Date(h.time)
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-between">
              <span className="text-[15px] text-slate-400">{pad(d.getHours())}:00</span>
              <WeatherIcon name={h.icon} size={36} />
              <span className="text-[21px] font-bold leading-none">{u.temp(h.temp)}°</span>
              <span className="text-[13px] text-sky-300 leading-none">💧 {h.precipProb ?? 0}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
