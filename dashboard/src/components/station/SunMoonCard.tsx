import { AstroData } from '../../forecast'
import { WeatherIcon } from '../WeatherIcon'
import { CardSkeleton } from './CardSkeleton'

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export function SunMoonCard({ astro }: { astro: AstroData | null }) {
  if (!astro) return <CardSkeleton title="Sol y Luna" lines={2} />
  const rise = new Date(astro.sunrise).getTime()
  const set = new Date(astro.sunset).getTime()
  const daylightMin = Math.max(0, Math.round((set - rise) / 60000))
  const h = Math.floor(daylightMin / 60)
  const m = daylightMin % 60

  return (
    <div className="card">
      <p className="card-title">Sol y Luna</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center">
          <WeatherIcon name="sunrise" size={34} />
          <p className="text-xs text-slate-400 mt-1">Amanecer</p>
          <p className="font-semibold">{time(astro.sunrise)}</p>
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center">
          <WeatherIcon name="sunset" size={34} />
          <p className="text-xs text-slate-400 mt-1">Atardecer</p>
          <p className="font-semibold">{time(astro.sunset)}</p>
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2 flex flex-col items-center">
          <WeatherIcon name={astro.moonIcon} size={34} />
          <p className="text-xs text-slate-400 mt-1">Luna</p>
          <p className="font-semibold text-xs leading-tight">{astro.moonLabel}</p>
        </div>
      </div>
      <p className="text-center text-xs text-slate-400 mt-3">
        Horas de luz: <span className="text-slate-200">{h} h {m} min</span>
      </p>
    </div>
  )
}
