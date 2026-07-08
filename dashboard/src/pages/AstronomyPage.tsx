import { useStationData } from '../station-data'
import { SunMoonCard } from '../components/station/SunMoonCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { LOCATION } from '../config'

export function AstronomyPage() {
  const { forecast } = useStationData()

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-300 mb-3">Astronomía</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SunMoonCard astro={forecast?.astro ?? null} />
        <SkyEventsCard count={8} />
      </div>

      <div className="card mt-4 text-sm text-slate-300 leading-relaxed">
        <p>
          Horarios de salida y puesta del Sol calculados para {LOCATION.name} (vía Open-Meteo), junto con la
          fase lunar actual y las próximas fases principales (nueva, cuartos y llena). Las horas están en la
          zona horaria local. La fase de la Luna se calcula a partir del ciclo sinódico (~29.5 días).
        </p>
      </div>
    </div>
  )
}
