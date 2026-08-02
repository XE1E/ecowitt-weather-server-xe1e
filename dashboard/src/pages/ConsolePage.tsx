import { useEffect, useState, type ReactNode } from 'react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { deriveCondition, parseServerDate } from '../weather'
import { WeatherIcon } from '../components/WeatherIcon'

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES_CORTO = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
const pad = (n: number) => String(n).padStart(2, '0')
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const cardinal = (deg?: number) => (deg == null ? '--' : DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16])

function moonPhase(d: Date) {
  const syn = 29.530588853
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000
  const phase = (((d.getTime() / 86400000 - ref) / syn) % 1 + 1) % 1
  return { phase, illum: (1 - Math.cos(2 * Math.PI * phase)) / 2, waxing: phase <= 0.5 }
}

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

export function ConsolePage() {
  const { data, history, loading } = useStationData()
  const u = useUnits()
  const [now, setNow] = useState(() => new Date())
  const [remote, setRemote] = useState<Record<string, number> | null>(null)
  const [remoteHistory, setRemoteHistory] = useState<any[]>([])

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const load = () => fetch('/api/current?station=gw1100').then((r) => (r.ok ? r.json() : null))
      .then(setRemote).catch(() => {})
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const load = () => fetch('/api/history?start=-4h&station=gw1100').then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setRemoteHistory(j.data || [])).catch(() => {})
    load()
    const i = setInterval(load, 60000)
    return () => clearInterval(i)
  }, [])

  const cond = data ? deriveCondition(data) : { icon: '', label: '' }
  const dir = data?.wind_direction

  const getHistoricValue = (field: string, hoursAgo: number): number | null => {
    if (!history || history.length === 0) return null
    const targetTime = Date.now() - hoursAgo * 60 * 60 * 1000
    let closest: any = null
    let closestDiff = Infinity
    for (const h of history) {
      const t = new Date(parseServerDate(h._time)).getTime()
      const diff = Math.abs(t - targetTime)
      if (diff < closestDiff) { closestDiff = diff; closest = h }
    }
    if (!closest || closestDiff > 30 * 60 * 1000) return null
    return (closest as any)[field] ?? null
  }

  const getTrend = (current: number | undefined | null, previous: number | null, threshold: number): 'up' | 'down' | 'stable' => {
    if (current == null || previous == null) return 'stable'
    const diff = current - previous
    if (diff > threshold) return 'up'
    if (diff < -threshold) return 'down'
    return 'stable'
  }

  const tempPrev = getHistoricValue('temperature_outdoor', 1)
  const humPrev = getHistoricValue('humidity_outdoor', 1)
  const pressPrev = getHistoricValue('pressure_relative', 3)
  const tempTrend = getTrend(data?.temperature_outdoor, tempPrev, 0.5)
  const humTrend = getTrend(data?.humidity_outdoor, humPrev, 3)
  const pressTrend = getTrend(data?.pressure_relative, pressPrev, 1)

  const getRemoteHistoricValue = (field: string, hoursAgo: number): number | null => {
    if (!remoteHistory || remoteHistory.length === 0) return null
    const targetTime = Date.now() - hoursAgo * 60 * 60 * 1000
    let closest: any = null
    let closestDiff = Infinity
    for (const h of remoteHistory) {
      const t = new Date(parseServerDate(h._time)).getTime()
      const diff = Math.abs(t - targetTime)
      if (diff < closestDiff) { closestDiff = diff; closest = h }
    }
    if (!closest || closestDiff > 30 * 60 * 1000) return null
    return (closest as any)[field] ?? null
  }

  const remoteTempPrev = getRemoteHistoricValue('temperature_indoor', 1)
  const remoteHumPrev = getRemoteHistoricValue('humidity_indoor', 1)
  const remotePressPrev = getRemoteHistoricValue('pressure_relative', 3)
  const remoteTempTrend = getTrend(remote?.temperature_indoor, remoteTempPrev, 0.5)
  const remoteHumTrend = getTrend(remote?.humidity_indoor, remoteHumPrev, 3)
  const remotePressTrend = getTrend(remote?.pressure_relative, remotePressPrev, 1)

  const chTemp = data?.temperature_ch1
  const chHum = data?.humidity_ch1
  const hasCh1 = chTemp != null || chHum != null
  const sTemp = hasCh1 ? chTemp : remote?.temperature_indoor
  const sHum = hasCh1 ? chHum : remote?.humidity_indoor

  const css = `
    @font-face{font-family:'DSEG7';src:url('/fonts/DSEG7Classic-Bold.woff2') format('woff2');font-display:block}
    .cns{--t:#f97316;--h:#3b82f6;--p:#a78bfa;--r:#38bdf8;--v:#22c55e;--y:#ffcf19;--w:#eaeaea;--lbl:#8a8a8a;--red:#ff4128;
      --brd-main:#fbbf24;--brd-jardin:#4ade80;--brd-remota:#6b7280;--brd-clima:#ffffff;--brd-solar:#ffffff;--brd-reloj:#ff4128;
      font-family:'Roboto Condensed','Arial Narrow','Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .cns .lbl{color:var(--lbl);font-size:18px;font-weight:700;letter-spacing:2px;line-height:1}
    .cns .lbl .ac{color:var(--t)} .cns .lbl .acg{color:var(--v)}
    .cns .big{font-weight:800;line-height:.82;letter-spacing:-1px}
    .cns .seg,.cns .big,.cns .gt,.cns .gh,.cns .gp,.cns .gr,.cns .gv,.cns .gy{font-family:'DSEG7','Roboto Condensed',monospace}
    .cns .gt{color:var(--t);text-shadow:0 0 12px rgba(249,115,22,.55)}
    .cns .gh{color:var(--h);text-shadow:0 0 12px rgba(59,130,246,.55)}
    .cns .gp{color:var(--p);text-shadow:0 0 12px rgba(167,139,250,.55)}
    .cns .gr{color:var(--r);text-shadow:0 0 12px rgba(56,189,248,.55)}
    .cns .gv{color:var(--v);text-shadow:0 0 12px rgba(34,197,94,.55)}
    .cns .gy{color:var(--y);text-shadow:0 0 12px rgba(255,207,25,.5)}
    .cns .gw{color:var(--w);text-shadow:0 0 10px rgba(234,234,234,.35)}
    .cns .u{font-weight:700;vertical-align:top;font-family:'Roboto Condensed','Arial Narrow',system-ui,sans-serif} .cns .ured{color:var(--red)}
    .cns .dec{font-size:0.6em}
    .cns .rt{text-align:right}
    .cns .cell{background:#000;position:relative;padding:9px 12px;overflow:hidden;min-width:0;min-height:0;border-radius:12px;border:2px solid transparent}
    .cns .cell.main{border-color:var(--brd-main)}
    .cns .cell.jardin{border-color:var(--brd-jardin)}
    .cns .cell.remota{border-color:var(--brd-remota)}
    .cns .cell.clima{border-color:var(--brd-clima)}
    .cns .cell.solar{border-color:var(--brd-solar)}
    .cns .cell.reloj{border-color:var(--brd-reloj)}
    .cns .col{display:flex;flex-direction:column}
    .cns .ctr{margin-top:auto;margin-bottom:auto}
    .cns .bt{display:flex;justify-content:space-between;align-items:flex-start}
  `

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        Cargando datos de la consola...
      </div>
    )
  }

  return (
    <div>
      <p className="text-slate-400 mb-4">
        Réplica de la consola física Ecowitt. Esta es la vista que se despliega en la pantalla del kiosco.
      </p>
      <div className="cns rounded-xl overflow-hidden mx-auto" style={{ maxWidth: 1024 }}>
        <style>{css}</style>
        <div style={{
          display: 'grid', width: '100%', aspectRatio: '1024 / 600', gap: 3,
          gridTemplateColumns: '1fr 1fr 1fr',
          gridTemplateRows: '1.32fr 1.14fr 1.18fr 1.0fr 0.92fr',
          background: '#000',
        }}>
          {/* Fila 1 */}
          <div className="cell col main">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f97316', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>EXTERIOR</span>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="5" fill="#fbbf24" />
                <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)' }}>
              <svg width="24" height="48" viewBox="0 0 24 48" fill="none">
                <rect x="8" y="8" width="8" height="32" rx="4" stroke="#f97316" strokeWidth="2" fill="none" />
                <circle cx="12" cy="36" r="6" fill="#f97316" />
                <line x1="12" y1="14" x2="12" y2="28" stroke="#f97316" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
              <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
                {tempTrend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
                {tempTrend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
                {tempTrend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
              </svg>
            </div>
            <div className="big gt ctr rt" style={{ fontSize: 104, paddingRight: 32 }}>
              {decNum(u.temp(data?.temperature_outdoor))}<span className="u" style={{ fontSize: 26, color: 'var(--t)' }}>{u.tempU}</span>
            </div>
          </div>

          <div className="cell main" style={{ gridRow: 'span 2', padding: '7px 9px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: 2, textAlign: 'center' }}>Estación Clima XE1E</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
              <span style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>VIENTO</span>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.55a11 11 0 0114 0M8.5 16.05a6 6 0 017 0M12 20h.01" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ flex: 1, position: 'relative', minHeight: 0, marginTop: -18 }}>
              <svg viewBox="0 0 100 80" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block', position: 'absolute', inset: 0, transform: 'scale(1.2) translateY(-5%)', transformOrigin: 'center center' }}>
                <ellipse cx="50" cy="40" rx="49" ry="38" stroke="#555" strokeWidth="1.5" fill="none" />
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
                  const rad = (deg - 90) * Math.PI / 180
                  const x1 = 50 + 44 * Math.cos(rad)
                  const y1 = 40 + 34 * Math.sin(rad)
                  const x2 = 50 + 49 * Math.cos(rad)
                  const y2 = 40 + 38 * Math.sin(rad)
                  const isMajor = deg % 90 === 0
                  return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={isMajor ? '#888' : '#555'} strokeWidth={isMajor ? 2 : 1} />
                })}
                <ellipse cx="50" cy="40" rx="42" ry="31" stroke="#444" strokeWidth="1" fill="none" />
                <text x="50" y="8" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">N</text>
                <text x="98" y="44" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">E</text>
                <text x="50" y="77" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">S</text>
                <text x="2" y="44" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">O</text>
                {dir != null && (
                  <g transform={`rotate(${dir} 50 40)`}>
                    <polygon points="50,-1 47,6 50,4 53,6" fill="#22c55e" />
                  </g>
                )}
              </svg>
              <div className="gv" style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', fontWeight: 800 }}>
                <span className="seg" style={{ fontSize: 52 }}>{dir != null ? Math.round(dir) : '--'}</span><span style={{ fontSize: 28, verticalAlign: 'super' }}>°</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly', gap: 6, paddingBottom: 2 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>PROMEDIO</div>
                <div className="gv seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                  {decNum(u.wind(data?.wind_speed, 1))}<span className="u" style={{ fontSize: 16, color: 'var(--v)' }}>{u.windU}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>RÁFAGA</div>
                <div className="gv seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                  {decNum(u.wind(data?.wind_gust, 1))}<span className="u" style={{ fontSize: 16, color: 'var(--v)' }}>{u.windU}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="cell col main">
            <div style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>VELOCIDAD</div>
            <div style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)' }}>
              <svg width="30" height="22" viewBox="0 0 34 24" fill="none">
                <path d="M2 8 H20 a4 4 0 1 0 -4 -4" stroke="#22c55e" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M2 15 H25 a4.5 4.5 0 1 1 -4.5 4.5" stroke="#22c55e" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="big gv ctr rt" style={{ fontSize: 104, marginTop: -10 }}>
              {decNum(u.wind(data?.wind_speed, 1))}<span className="u" style={{ fontSize: 26, color: 'var(--v)' }}> {u.windU}</span>
            </div>
            <div style={{ position: 'absolute', bottom: 8, left: 12 }}>
              <span style={{ color: 'var(--v)', fontSize: 24, fontWeight: 800 }}>{cardinal(dir)}</span>
            </div>
          </div>

          {/* Fila 2 */}
          <div className="cell col main">
            <div style={{ color: 'var(--h)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>HUMEDAD</div>
            <div style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)' }}>
              <svg width="24" height="32" viewBox="0 0 24 32" fill="none">
                <path d="M12 4 C12 4 4 14 4 20 C4 25.5 7.6 28 12 28 C16.4 28 20 25.5 20 20 C20 14 12 4 12 4 Z" stroke="#3b82f6" strokeWidth="2" fill="none" />
              </svg>
            </div>
            <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
              <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
                {humTrend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
                {humTrend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
                {humTrend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
              </svg>
            </div>
            <div className="big gh ctr rt" style={{ fontSize: 80, lineHeight: 0.8, paddingRight: 32, marginTop: -12 }}>
              {decNum((data?.humidity_outdoor ?? 0).toFixed(0))}<span className="u" style={{ fontSize: 34, color: 'var(--h)' }}>%</span>
            </div>
          </div>

          <div className="cell main">
            <div style={{ color: 'var(--r)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>LLUVIA</div>
            <div style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)' }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M8 8 L8 18" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
                <path d="M14 4 L14 14" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
                <path d="M20 10 L20 20" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
                <path d="M11 16 L11 24" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
                <path d="M17 18 L17 26" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: 7 }}>
              <span className="gr seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {decNum(u.rain(data?.rain_daily))}<span className="u" style={{ fontSize: 20, color: 'var(--r)' }}>{u.rainU}</span>
              </span>
              <span className="gr seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {decNum(u.rain(data?.rain_rate))}<span className="u" style={{ fontSize: 20, color: 'var(--r)' }}>/h</span>
              </span>
            </div>
          </div>

          {/* Fila 3 */}
          <div className="cell col main">
            <div style={{ color: 'var(--p)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>PRESIÓN</div>
            <div style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)' }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="12" stroke="#a78bfa" strokeWidth="2" fill="none" />
                <line x1="14" y1="14" x2="20" y2="8" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="14" cy="14" r="2" fill="#a78bfa" />
              </svg>
            </div>
            <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
              <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
                {pressTrend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
                {pressTrend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
                {pressTrend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
              </svg>
            </div>
            <div className="big gp ctr rt" style={{ fontSize: 56, paddingRight: 32 }}>
              {decNum(u.press(data?.pressure_relative, 1))}<span className="u" style={{ fontSize: 24, color: 'var(--p)' }}> {u.pressU}</span>
            </div>
          </div>

          <div className="cell clima" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 }}>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1 }}>{cond.label || 'CLIMA'}</div>
            <div style={{ marginTop: -12 }}><WeatherIcon name={cond.icon} size={120} className="weather-main-icon" /></div>
          </div>

          <div className="cell main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'flex-start', width: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>ROCÍO</div>
                <div className="gt seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, marginTop: 4 }}>
                  {decNum(u.temp(data?.dew_point))}<span className="u" style={{ fontSize: 16, color: 'var(--t)' }}>{u.tempU}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>SENSACIÓN</div>
                <div className="gt seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, marginTop: 4 }}>
                  {decNum(u.temp(data?.feels_like))}<span className="u" style={{ fontSize: 16, color: 'var(--t)' }}>{u.tempU}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Fila 4 */}
          <div className="cell col main">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#fbbf24', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>INTERIOR</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 12l9-9 9 9" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16 }}>
              <span className="gt" style={{ fontSize: 46, fontWeight: 800 }}>
                {decNum(u.temp(data?.temperature_indoor))}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              <span className="gh" style={{ fontSize: 46, fontWeight: 800 }}>
                {data?.humidity_indoor != null ? data.humidity_indoor.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
            </div>
          </div>

          <div className="cell solar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'flex-start', width: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#f59e0b', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>SOLAR</div>
                <div className="gw seg" style={{ fontSize: 40, fontWeight: 800, marginTop: 2 }}>
                  {data?.solar_radiation != null ? decNum(data.solar_radiation.toFixed(0)) : '--'}<span className="u" style={{ fontSize: 14, color: 'var(--w)' }}> W/m²</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>UV</div>
                <div className="gw seg" style={{ fontSize: 40, fontWeight: 800, marginTop: 2 }}>
                  {data?.uv_index ?? '--'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>LUNA</div>
                <MoonGlyph size={50} />
              </div>
            </div>
          </div>

          <div className="cell col remota">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA <span style={{ color: 'var(--p)' }}>GW1100</span></span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="5" fill="#fbbf24" />
                <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 40 }}>
              <span style={{ position: 'relative', paddingRight: 16 }}>
                <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                  {remote?.temperature_indoor != null ? decNum(u.temp(remote.temperature_indoor)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
                </span>
                <svg width="14" height="18" viewBox="0 0 20 24" fill="none" style={{ position: 'absolute', top: 12, right: -2 }}>
                  {remoteTempTrend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
                  {remoteTempTrend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
                  {remoteTempTrend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
                </svg>
              </span>
              <span style={{ position: 'relative', paddingRight: 16 }}>
                <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                  {remote?.humidity_indoor != null ? remote.humidity_indoor.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
                </span>
                <svg width="14" height="18" viewBox="0 0 20 24" fill="none" style={{ position: 'absolute', top: 12, right: -2 }}>
                  {remoteHumTrend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
                  {remoteHumTrend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
                  {remoteHumTrend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
                </svg>
              </span>
            </div>
          </div>

          {/* Fila 5 */}
          <div className="cell col jardin">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>JARDÍN</span>
              <span style={{ color: 'var(--lbl)', fontSize: 12, fontWeight: 600 }}>CH1</span>
            </div>
            <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: -10 }}>
              <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {sTemp != null ? decNum(u.temp(sTemp)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {sHum != null ? sHum.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
            </div>
          </div>

          <div className="cell reloj" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--lbl)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>HORA</div>
                <div className="gw seg" style={{ fontSize: 46, fontWeight: 800, marginTop: 4 }}>{pad(now.getHours())}:{pad(now.getMinutes())}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--lbl)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>FECHA</div>
                <div style={{ marginTop: 4, lineHeight: 1.02 }}>
                  <div className="gw" style={{ fontSize: 26, fontWeight: 800 }}>{DIAS_CORTO[now.getDay()].toUpperCase()}</div>
                  <div className="gw" style={{ fontSize: 26, fontWeight: 800 }}>{now.getDate()} {MESES_CORTO[now.getMonth()]}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="cell col remota">
            <div style={{ color: 'var(--p)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>PRESIÓN <span style={{ color: 'var(--p)' }}>GW1100</span></div>
            <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
              <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
                {remotePressTrend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
                {remotePressTrend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
                {remotePressTrend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
              </svg>
            </div>
            <div className="big gp ctr rt" style={{ fontSize: 46, paddingRight: 32 }}>
              {remote?.pressure_relative != null ? decNum(u.press(remote.pressure_relative, 1)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--p)' }}> {u.pressU}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
