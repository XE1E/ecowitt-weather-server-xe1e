import { upcomingMoonEvents } from '../../forecast'
import { WeatherIcon } from '../WeatherIcon'

export function SkyEventsCard({ count = 4 }: { count?: number }) {
  const events = upcomingMoonEvents(count)
  if (events.length === 0) return null

  return (
    <div className="card">
      <p className="card-title">Próximos eventos</p>
      <div className="space-y-2">
        {events.map((e) => (
          <div key={e.label + e.date} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
            <WeatherIcon name={e.icon} size={32} />
            <div>
              <p className="text-sm font-semibold">{e.label}</p>
              <p className="text-xs text-slate-400">
                {new Date(e.date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'short' })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
