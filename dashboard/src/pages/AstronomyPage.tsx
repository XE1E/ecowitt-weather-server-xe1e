import { MoonStar } from 'lucide-react'
import { SunMoonDetailCard } from '../components/station/SunMoonDetailCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { AlmanacCard } from '../components/station/AlmanacCard'
import { PageInfo } from '../components/station/PageInfo'
import { LOCATION } from '../config'

export function AstronomyPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><MoonStar className="w-6 h-6 text-sky-400" /> Astronomía</h2>
      <p className="text-xs text-slate-400 mb-4">Observaciones del sol, la luna y el cielo para {LOCATION.label}.</p>

      <div className="space-y-4">
        <SunMoonDetailCard />
        <AlmanacCard />
        <SkyEventsCard count={8} />
      </div>

      <PageInfo>
        <p>
          Todo se <span className="font-semibold">calcula localmente</span> para {LOCATION.name} (con pyephem), sin
          servicios externos. Del <span className="font-semibold">Sol</span>: salida, ocaso, mediodía solar, duración del
          día y su cambio respecto a ayer, más elevación y azimut actuales. De la <span className="font-semibold">Luna</span>:
          salida/ocaso, fase, iluminación, edad y distancia, y las próximas fases. El <span className="font-semibold">almanaque</span>
          añade los tres crepúsculos (civil −6°, náutico −12° y astronómico −18°) y los planetas visibles con su orto/ocaso,
          altitud y magnitud. Todas las horas están en tu zona local.
        </p>
      </PageInfo>
    </div>
  )
}
