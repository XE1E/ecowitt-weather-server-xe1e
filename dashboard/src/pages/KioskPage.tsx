import { useEffect, useState, type ReactNode } from 'react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { deriveCondition, relativeTime } from '../weather'
import { LOCATION } from '../config'
import { WeatherIcon } from '../components/WeatherIcon'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const pad = (n: number) => String(n).padStart(2, '0')

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
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 flex flex-col justify-center">
      <p className="text-[15px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-[40px] leading-none font-bold mt-1" style={{ color: color || '#e2e8f0' }}>
        {value}<span className="text-[20px] font-medium text-slate-400 ml-1">{unit}</span>
      </p>
      {sub && <p className="text-[14px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

/**
 * Página "kiosco" 1024×600 para el display ESP32-S3. El servidor la renderiza
 * (headless) y sirve la imagen; el ESP32 solo la baja y la pinta. Layout fijo
 * para un screenshot determinista. `?page=1` estación, `?page=2` sensor local
 * (BME280 del display). `data-kiosk-ready` avisa al renderer cuándo capturar.
 */
export function KioskPage() {
  const { data, stats, forecast, loading } = useStationData()
  const u = useUnits()
  const [now, setNow] = useState(() => new Date())
  const [imeca, setImeca] = useState<Imeca | null>(null)
  const [local, setLocal] = useState<Local | null>(null)
  const [localFetched, setLocalFetched] = useState(false)

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

  const ready = page === '2' ? localFetched : (!loading && !!data)

  const header = (
    <div className="flex items-center justify-between px-8 pt-5">
      <div>
        <p className="text-[22px] font-bold leading-tight">Clima XE1E · {LOCATION.name}</p>
        <p className="text-[14px] text-slate-400">{LOCATION.label}</p>
      </div>
      <div className="text-right leading-none">
        <p className="text-[16px] text-slate-300 mb-1">{DIAS[now.getDay()]} {now.getDate()} de {MESES[now.getMonth()]}</p>
        <p className="text-[44px] font-bold tabular-nums">{pad(now.getHours())}:{pad(now.getMinutes())}</p>
      </div>
    </div>
  )

  const shell = (children: ReactNode) => (
    <div
      data-kiosk-ready={ready ? 'true' : 'false'}
      className="text-slate-100 overflow-hidden"
      style={{
        width: 1024, height: 600,
        background: 'radial-gradient(1200px 600px at 70% -10%, #14304f 0%, #0b1220 55%, #070d17 100%)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      {header}
      {children}
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
        <p className="text-[84px] leading-none font-bold mt-2" style={{ color }}>{value}<span className="text-[32px] text-slate-400 ml-1">{unit}</span></p>
        <p className="text-[24px] text-slate-300 mt-3">{sub}</p>
      </div>
    )
    return shell(
      <div className="px-8 mt-2" style={{ height: 510 }}>
        <p className="text-[18px] text-slate-300 mb-3">📍 Sensor local del display · BME280</p>
        {!L ? (
          <div className="h-[380px] flex items-center justify-center text-slate-500 text-[20px]">
            Esperando datos del sensor local del display…
          </div>
        ) : (
          <>
            <div className="flex gap-6" style={{ height: 380 }}>
              {bigCard('Temperatura', L.temperature != null ? `${u.temp(L.temperature)}` : '--', u.tempU,
                `mín ${mn.temperature != null ? u.temp(mn.temperature) : '--'}° · máx ${mx.temperature != null ? u.temp(mx.temperature) : '--'}°`, '#fdba74')}
              {bigCard('Humedad', L.humidity != null ? `${L.humidity.toFixed(0)}` : '--', '%',
                `mín ${mn.humidity?.toFixed(0) ?? '--'}% · máx ${mx.humidity?.toFixed(0) ?? '--'}%`, '#67e8f9')}
              {bigCard('Presión', L.pressure != null ? `${u.press(L.pressure)}` : '--', u.pressU,
                `mín ${mn.pressure != null ? u.press(mn.pressure) : '--'} · máx ${mx.pressure != null ? u.press(mx.pressure) : '--'}`, '#c4b5fd')}
            </div>
            <p className="text-[14px] text-slate-500 mt-4 text-center">
              Actualizado {L.received_at ? relativeTime(L.received_at) : '—'} · mín/máx de hoy
            </p>
          </>
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
    <>
      <div className="flex gap-6 px-8 mt-3" style={{ height: 352 }}>
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-center" style={{ width: 430 }}>
          <WeatherIcon name={cond.icon} size={140} />
          <div className="flex items-start mt-1">
            <span className="text-[128px] leading-none font-bold text-orange-200">
              {data?.temperature_outdoor != null ? u.temp(data.temperature_outdoor) : '--'}
            </span>
            <span className="text-[40px] font-semibold text-slate-400 mt-4">{u.tempU}</span>
          </div>
          <p className="text-[24px] text-slate-300 mt-1">{cond.label}</p>
          <p className="text-[18px] text-slate-400 mt-2">
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

      <div className="px-8 mt-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 flex justify-between" style={{ height: 140 }}>
          {hours.length === 0 ? (
            <div className="w-full flex items-center justify-center text-slate-500 text-[15px]">Pronóstico no disponible</div>
          ) : hours.map((h, i) => {
            const d = new Date(h.time)
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-between">
                <span className="text-[15px] text-slate-400">{pad(d.getHours())}:00</span>
                <WeatherIcon name={h.icon} size={38} />
                <span className="text-[22px] font-bold leading-none">{u.temp(h.temp)}°</span>
                <span className="text-[13px] text-sky-300 leading-none">💧 {h.precipProb ?? 0}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
