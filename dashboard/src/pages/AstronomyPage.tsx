import { SunMoonDetailCard } from '../components/station/SunMoonDetailCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { AlmanacCard } from '../components/station/AlmanacCard'
import { LOCATION } from '../config'

export function AstronomyPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-100">Astronomía</h2>
      <p className="text-xs text-slate-400 mb-4">Observaciones del sol, la luna y el cielo para {LOCATION.label}.</p>

      <div className="space-y-4">
        <SunMoonDetailCard />
        <AlmanacCard />
        <SkyEventsCard count={8} />
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
