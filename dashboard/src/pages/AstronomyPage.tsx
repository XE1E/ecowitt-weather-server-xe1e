import { useStationData } from '../station-data'
import { SunMoonCard } from '../components/station/SunMoonCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { AlmanacCard } from '../components/station/AlmanacCard'
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

      <div className="mt-4">
        <AlmanacCard />
      </div>

      <div className="card mt-4 text-sm text-slate-300 leading-relaxed">
        <p>
          El <strong>almanaque</strong> se calcula localmente para {LOCATION.name} (con pyephem): orto y ocaso del
          Sol, mediodía solar y duración del día; los tres crepúsculos (civil −6°, náutico −12° y astronómico −18°),
          amanecer y anochecer; la Luna (orto/ocaso, fase, % de iluminación y próximas luna nueva y llena); y los
          planetas visibles (Mercurio, Venus, Marte, Júpiter y Saturno) con su orto/ocaso, altitud actual y magnitud.
          Todas las horas están en la zona horaria local.
        </p>
      </div>
    </div>
  )
}
