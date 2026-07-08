import { AstroData } from '../../forecast'
import { WeatherIcon } from '../WeatherIcon'

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export function SunMoonCard({ astro }: { astro: AstroData | null }) {
  if (!astro) return null
  const rise = new Date(astro.sunrise).getTime()
  const set = new Date(astro.sunset).getTime()
  const daylightMin = Math.max(0, Math.round((set - rise) / 60000))
  const h = Math.floor(daylightMin / 60)
  const m = daylightMin % 60

  return (
    <div className="card">
      <p className="card-title">Sol y Luna</p>
      <div className="flex items-center justify-around text-center">
        <div className="flex flex-col items-center">
          <WeatherIcon name="sunrise" size={40} />
          <p className="text-xs text-slate-400 mt-1">Amanecer</p>
          <p className="font-semibold">{time(astro.sunrise)}</p>
        </div>
        <div className="flex flex-col items-center">
          <WeatherIcon name="sunset" size={40} />
          <p className="text-xs text-slate-400 mt-1">Atardecer</p>
          <p className="font-semibold">{time(astro.sunset)}</p>
        </div>
        <div className="flex flex-col items-center">
          <WeatherIcon name={astro.moonIcon} size={40} />
          <p className="text-xs text-slate-400 mt-1">Luna</p>
          <p className="font-semibold text-xs">{astro.moonLabel}</p>
        </div>
      </div>
      <p className="text-center text-xs text-slate-400 mt-3">
        Horas de luz: <span className="text-slate-200">{h} h {m} min</span>
      </p>
    </div>
  )
}
