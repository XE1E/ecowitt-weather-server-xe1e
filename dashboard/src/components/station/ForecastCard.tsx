import { useState } from 'react'
import { ForecastResult } from '../../forecast'
import { WeatherIcon } from '../WeatherIcon'

function dayName(iso: string, i: number): string {
  if (i === 0) return 'Hoy'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short' })
}
function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit' })
}

export function ForecastCard({ forecast }: { forecast: ForecastResult | null }) {
  const [tab, setTab] = useState<'5d' | 'hourly'>('5d')
  if (!forecast) return null

  const btn = (a: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs transition ${a ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <p className="card-title mb-0">Pronóstico</p>
        <div className="flex gap-1">
          <button className={btn(tab === '5d')} onClick={() => setTab('5d')}>5 días</button>
          <button className={btn(tab === 'hourly')} onClick={() => setTab('hourly')}>Horario</button>
        </div>
      </div>

      {tab === '5d' ? (
        <div className="grid grid-cols-5 gap-2">
          {forecast.days.slice(0, 5).map((d, i) => (
            <div key={d.date} className="flex flex-col items-center text-center rounded-lg bg-white/5 py-2">
              <span className="text-xs font-semibold text-slate-300 capitalize">{dayName(d.date, i)}</span>
              <WeatherIcon name={d.icon} size={40} alt={d.label} />
              <span className="text-sm font-bold">{Math.round(d.tempMax)}°</span>
              <span className="text-xs text-slate-500">{Math.round(d.tempMin)}°</span>
              {d.precipProb > 0 && <span className="text-[10px] text-sky-400">{d.precipProb}%</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {forecast.hours.slice(0, 24).map((h) => (
            <div key={h.time} className="flex flex-col items-center text-center rounded-lg bg-white/5 py-2 px-2 min-w-[56px]">
              <span className="text-[11px] text-slate-400">{hourLabel(h.time)}</span>
              <WeatherIcon name={h.icon} size={32} alt="" />
              <span className="text-sm font-bold">{Math.round(h.temp)}°</span>
              {h.precipProb > 0 && <span className="text-[10px] text-sky-400">{h.precipProb}%</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
