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
const pad = (n: number) => String(n).padStart(2, '0')

// Pestañas de la barra inferior. El ORDEN y el número deben coincidir con
// NUM_PAGES del firmware (que mapea el toque en la franja inferior a la pagina
// segun la X). Pagina N -> TABS[N-1].
const TABS = [
  { icon: '☀️', label: 'Estación' },
  { icon: '📍', label: 'Local' },
  { icon: '🏠', label: 'Sensores' },
  { icon: '📅', label: '7 días' },
  { icon: '📈', label: '24 h' },
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
  // Estación remota (GW1100): solo en la página de sensores.
  useEffect(() => {
    if (page !== '3') return
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
