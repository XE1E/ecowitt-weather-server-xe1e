import { useEffect, useState } from 'react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { deriveCondition } from '../weather'
import { LOCATION } from '../config'
import { WeatherIcon } from '../components/WeatherIcon'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const pad = (n: number) => String(n).padStart(2, '0')

interface Imeca { available: boolean; imeca?: number; category?: string; color?: string }

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
 * (headless) y sirve la imagen; el ESP32 solo la baja y la pinta. Layout de
 * tamaño fijo para un screenshot determinista. `?page=` reservado para más
 * pantallas. `data-kiosk-ready` avisa al renderer cuándo capturar.
 */
export function KioskPage() {
  const { data, stats, forecast, loading } = useStationData()
  const u = useUnits()
  const [now, setNow] = useState(() => new Date())
  const [imeca, setImeca] = useState<Imeca | null>(null)

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  useEffect(() => {
    fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setImeca).catch(() => {})
  }, [])

  const ready = !loading && !!data
  const cond = data ? deriveCondition(data) : { icon: '', label: '' }
  const t = stats?.temperature_outdoor
  const uv = data?.uv_index ?? 0
  const hours = forecast?.hours?.slice(0, 6) ?? []

  return (
    <div
      data-kiosk-ready={ready ? 'true' : 'false'}
      className="text-slate-100 overflow-hidden"
      style={{
        width: 1024, height: 600,
        background: 'radial-gradient(1200px 600px at 70% -10%, #14304f 0%, #0b1220 55%, #070d17 100%)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      {/* Header */}
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

      {/* Cuerpo: hero + tiles */}
      <div className="flex gap-6 px-8 mt-3" style={{ height: 372 }}>
        {/* Hero */}
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

        {/* Tiles 3x2 */}
        <div className="grid grid-cols-3 grid-rows-2 gap-4 flex-1">
          <Tile label="Humedad" value={`${(data?.humidity_outdoor ?? 0).toFixed(0)}`} unit="%" color="#67e8f9" />
          <Tile label="Presión" value={u.press(data?.pressure_relative ?? 0, 0)} unit={u.pressU} color="#c4b5fd" />
          <Tile label="Viento" value={u.wind(data?.wind_speed ?? 0, 0)} unit={u.windU} sub={data?.wind_direction != null ? `${Math.round(data.wind_direction)}°` : undefined} color="#6ee7b7" />
          <Tile label="Lluvia hoy" value={u.rain(data?.rain_daily ?? 0)} unit={u.rainU} color="#93c5fd" />
          <Tile label="Índice UV" value={`${uv}`} color={uv >= 8 ? '#fca5a5' : uv >= 6 ? '#fdba74' : '#fde047'} />
          <Tile label="IMECA" value={imeca?.available && imeca.imeca != null ? `${imeca.imeca}` : '--'} sub={imeca?.category} color={imeca?.color || '#e2e8f0'} />
        </div>
      </div>

      {/* Franja de pronóstico horario */}
      <div className="px-8 mt-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 flex justify-between" style={{ height: 118 }}>
          {hours.length === 0 ? (
            <div className="w-full flex items-center justify-center text-slate-500 text-[15px]">Pronóstico no disponible</div>
          ) : hours.map((h, i) => {
            const d = new Date(h.time)
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-center gap-1">
                <span className="text-[14px] text-slate-400">{pad(d.getHours())}:00</span>
                <WeatherIcon name={h.icon} size={40} />
                <span className="text-[22px] font-bold">{u.temp(h.temp)}°</span>
                <span className="text-[12px] text-sky-300">{h.precipProb ?? 0}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
