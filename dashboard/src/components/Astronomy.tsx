import { AstroData } from '../forecast'
import { WeatherIcon } from './WeatherIcon'

interface AstronomyProps {
  astro: AstroData | null
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export function Astronomy({ astro }: AstronomyProps) {
  if (!astro) return null

  return (
    <div className="card mb-6">
      <p className="card-title">Astronomía</p>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <div className="flex flex-col items-center text-center">
          <WeatherIcon name="sunrise" size={48} alt="Amanecer" />
          <p className="text-xs text-slate-400 mt-1">Amanecer</p>
          <p className="font-semibold">{time(astro.sunrise)}</p>
        </div>
        <div className="flex flex-col items-center text-center">
          <WeatherIcon name="sunset" size={48} alt="Atardecer" />
          <p className="text-xs text-slate-400 mt-1">Atardecer</p>
          <p className="font-semibold">{time(astro.sunset)}</p>
        </div>
        <div className="flex flex-col items-center text-center">
          <WeatherIcon name={astro.moonIcon} size={48} alt={astro.moonLabel} />
          <p className="text-xs text-slate-400 mt-1">Luna</p>
          <p className="font-semibold text-xs">{astro.moonLabel}</p>
        </div>
      </div>
    </div>
  )
}
