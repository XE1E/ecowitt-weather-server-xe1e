import { Camera } from 'lucide-react'
import { LOCATION } from '../config'
import { CameraCard } from '../components/station/CameraCard'
import { TimelapseCard } from '../components/station/TimelapseCard'
import { SkyAnalysisHistory } from '../components/station/SkyAnalysisHistory'
import { PageInfo } from '../components/station/PageInfo'

/**
 * Página propia para la cámara del exterior, no una tarjeta incrustada en otra:
 * decidido en `docs/internal/PLAN-CAMARA-EXTERIOR.md` el 2026-08-05, porque la foto
 * es un contenido con entidad —foto en vivo, análisis del cielo y timelapse del día— y
 * en el kiosco también tiene pantalla propia.
 */
export function CameraPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <Camera className="w-6 h-6 text-sky-400" /> Cámara
      </h2>
      <p className="text-xs text-slate-400 mb-4">
        Vista del exterior de la estación en {LOCATION.label}.
      </p>

      <CameraCard />

      <TimelapseCard />

      <SkyAnalysisHistory />

      <PageInfo>
        <p>
          La cámara mira <span className="font-semibold">al horizonte</span>, no al cielo ni a la estación:
          con la línea del horizonte por debajo del centro entra cielo suficiente, que es donde se ve
          llegar el tiempo, y es lo que da valor a la foto junto a los datos.
        </p>
        <p className="mt-2">
          No es un directo, sino una <span className="font-semibold">foto periódica</span>. Se decidió así a
          propósito: un vídeo continuo serían del orden de 1 TB al mes de subida desde casa y un proceso
          de vídeo encendido para siempre, y para un sitio de clima la foto cada pocos minutos —más el
          timelapse del día, que se monta en el servidor y está aquí arriba— dice más que el directo. La cámara está en la red de casa y nunca se expone
          a internet: es un proceso local el que empuja cada captura al servidor.
        </p>
        <p className="mt-2">
          Si la última captura tiene más de quince minutos, se marca como
          {' '}<span className="font-semibold">antigua</span> sobre la propia imagen. Sin ese aviso, una foto
          sin fecha es una mentira en potencia: nada distinguiría el cielo de ahora del de anteayer.
        </p>
      </PageInfo>
    </div>
  )
}
