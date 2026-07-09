import { ForecastDay } from '../forecast'
import { WeatherIcon } from './WeatherIcon'

interface ForecastProps {
  days: ForecastDay[]
}

function dayName(iso: string, index: number): string {
  if (index === 0) return 'Hoy'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { weekday: 'short' })
}

export function Forecast({ days }: ForecastProps) {
  if (!days || days.length === 0) return null

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-slate-300 mb-4">Pronóstico 7 días</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {days.map((d, i) => (
          <div key={d.date} className="card flex flex-col items-center text-center p-3">
            <p className="text-sm font-semibold text-slate-300 capitalize">{dayName(d.date, i)}</p>
            {/* Móvil 56px; PC más grande (CSS override sobre el tamaño base) */}
            <WeatherIcon name={d.icon} size={56} className="w-14 h-14 md:w-[72px] md:h-[72px] lg:w-[88px] lg:h-[88px] my-1" alt={d.label} />
            <p className="text-sm">
              <span className="font-bold">{Math.round(d.tempMax)}°</span>
              <span className="text-slate-500"> / {Math.round(d.tempMin)}°</span>
            </p>
            {d.precipProb > 0 && (
              <p className="text-xs text-sky-400 mt-1">💧 {d.precipProb}%</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
