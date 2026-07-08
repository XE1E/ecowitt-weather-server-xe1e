import { RefreshCw } from 'lucide-react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { WeatherIcon } from '../components/WeatherIcon'

function dayName(iso: string, i: number): string {
  if (i === 0) return 'Hoy'
  if (i === 1) return 'Mañana'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long' })
}
function dayDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}
function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit' })
}

export function ForecastPage() {
  const { forecast } = useStationData()
  const u = useUnits()

  if (!forecast) {
    return (
      <div className="h-64 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    )
  }
  const T = (c: number) => Math.round(u.tempN(c))

  return (
    <div className="space-y-6">
      {/* Pronóstico diario (7 días) */}
      <section>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Pronóstico 7 días</h2>
        <div className="space-y-2">
          {forecast.days.map((d, i) => (
            <div key={d.date} className="card flex items-center gap-4 py-3">
              <div className="w-28 shrink-0">
                <p className="font-semibold capitalize">{dayName(d.date, i)}</p>
                <p className="text-xs text-slate-400 capitalize">{dayDate(d.date)}</p>
              </div>
              <WeatherIcon name={d.icon} size={44} alt={d.label} />
              <p className="flex-1 text-sm text-slate-300">{d.label}</p>
              {d.precipProb > 0 && (
                <p className="text-sm text-sky-400 w-16 text-right">💧 {d.precipProb}%</p>
              )}
              <p className="w-24 text-right">
                <span className="font-bold text-lg">{T(d.tempMax)}°</span>
                <span className="text-slate-500"> / {T(d.tempMin)}°</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Pronóstico horario (próximas 24 h) */}
      <section>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Próximas 24 horas</h2>
        <div className="card">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {forecast.hours.map((h) => (
              <div key={h.time} className="flex flex-col items-center text-center rounded-lg bg-white/5 py-2 px-2 min-w-[64px]">
                <span className="text-xs text-slate-400">{hourLabel(h.time)}</span>
                <WeatherIcon name={h.icon} size={34} alt="" />
                <span className="text-sm font-bold">{T(h.temp)}°</span>
                <span className={`text-[10px] ${h.precipProb > 0 ? 'text-sky-400' : 'text-slate-600'}`}>
                  {h.precipProb}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">Fuente: Open-Meteo · temperaturas en {u.tempU}</p>
      </section>
    </div>
  )
}
