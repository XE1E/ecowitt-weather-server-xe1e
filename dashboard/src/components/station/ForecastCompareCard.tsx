import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { WeatherIcon } from '../WeatherIcon'
import { useUnits } from '../../units'
import { ForecastResult } from '../../forecast'

// Descripción de cielo del SMN → ícono meteocons (versión compacta).
function skyIcon(sky: string | null): string {
  const s = (sky || '').toLowerCase()
  if (s.includes('torment')) return 'thunderstorms-day-rain'
  if (s.includes('llovizna')) return 'drizzle'
  if (s.includes('chubasc') || s.includes('lluvia') || s.includes('llov')) {
    const partial = s.includes('interval') || s.includes('disperso') || s.includes('aislad') || s.includes('parcial') || s.includes('medio')
    return partial ? 'partly-cloudy-day-rain' : 'rain'
  }
  if (s.includes('nublado') || s.includes('nubes') || s.includes('cubierto')) {
    const partial = s.includes('medio') || s.includes('parcial') || s.includes('mayormente despejado') || s.includes('algunas')
    return partial ? 'partly-cloudy-day' : 'overcast-day'
  }
  if (s.includes('despejado') || s.includes('soleado')) return 'clear-day'
  return 'partly-cloudy-day'
}

interface SmnDay { tmax: number | null; tmin: number | null; prob_precip: number | null; sky: string | null }
interface SmnData { municipio: string; days: SmnDay[] }

// Comparativa compacta del pronóstico de HOY: Open-Meteo (modelo) vs SMN (oficial).
export function ForecastCompareCard({ forecast }: { forecast: ForecastResult | null }) {
  const u = useUnits()
  const [smn, setSmn] = useState<SmnData | null>(null)

  useEffect(() => {
    let cancel = false
    // hourly=0 → solo el diario (evita descargar el archivo horario grande).
    fetch('/api/smn?hourly=0').then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancel && j?.days?.length) setSmn(j) })
      .catch(() => {})
    return () => { cancel = true }
  }, [])

  const om = forecast?.days?.[0]
  const sd = smn?.days?.[0]
  if (!om && !sd) return null

  const T = (c?: number | null) => (c == null ? '--' : `${Math.round(u.tempN(c))}°`)

  const Col = ({ label, icon, alt, max, min, prob }: {
    label: string; icon: string; alt: string; max?: number | null; min?: number | null; prob: number
  }) => (
    <div className="rounded-lg bg-white/5 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <WeatherIcon name={icon} size={38} alt={alt} className="shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-bold leading-none">
            <span className="text-orange-300">{T(max)}</span>
            <span className="text-sky-300 text-sm"> / {T(min)}</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">💧 {Math.round(prob)}%</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="card">
      <p className="card-title">Pronóstico de hoy · comparativa</p>
      <div className="grid grid-cols-2 gap-3">
        <Col label="Open-Meteo" icon={om?.icon ?? 'not-available'} alt="" max={om?.tempMax} min={om?.tempMin} prob={om?.precipProb ?? 0} />
        <Col label="SMN oficial" icon={sd ? skyIcon(sd.sky) : 'not-available'} alt={sd?.sky ?? ''} max={sd?.tmax} min={sd?.tmin} prob={sd?.prob_precip ?? 0} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">Modelo global vs. oficial (SMN)</span>
        <Link to="/pro/pronostico" className="text-xs text-blue-400 hover:text-blue-300">Ver pronóstico →</Link>
      </div>
    </div>
  )
}
