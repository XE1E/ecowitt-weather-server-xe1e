import { useCallback, useMemo, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { LOCATION } from '../config'
import { CameraCard } from '../components/station/CameraCard'
import { TimelapseCard } from '../components/station/TimelapseCard'
import { BestPhotoCard } from '../components/station/BestPhotoCard'
import { SkyAnalysisHistory } from '../components/station/SkyAnalysisHistory'
import { ForecastAccuracyCard } from '../components/station/ForecastAccuracyCard'
import { PageInfo } from '../components/station/PageInfo'
import { DayCalendar } from '../components/DayCalendar'

/**
 * Página propia para la cámara del exterior, no una tarjeta incrustada en otra:
 * decidido en `docs/archivo/PLAN-CAMARA-EXTERIOR.md` el 2026-08-05, porque la foto
 * es un contenido con entidad —foto en vivo, análisis del cielo y timelapse del día— y
 * en el kiosco también tiene pantalla propia.
 */
export function CameraPage() {
  // Fecha compartida entre Timelapse e Histórico de análisis: antes cada tarjeta
  // tenía su propio selector, así que ver el vídeo de un día Y su gráfica de
  // cobertura juntos exigía elegir la fecha dos veces. Cada tarjeta sigue
  // reportando sus PROPIOS días disponibles (pueden diferir: fotogramas y análisis
  // se podan por separado), y el selector navega la unión de ambos.
  const [selected, setSelected] = useState<string | null>(null)
  const [diasTimelapse, setDiasTimelapse] = useState<string[]>([])
  const [diasHistorial, setDiasHistorial] = useState<string[]>([])

  const disponibles = useMemo(
    () => new Set([...diasTimelapse, ...diasHistorial]),
    [diasTimelapse, diasHistorial],
  )
  const ordenados = useMemo(() => Array.from(disponibles).sort(), [disponibles])

  const paso = useCallback((delta: number) => {
    if (!ordenados.length) return
    const idx = selected ? ordenados.indexOf(selected) : -1
    const base = idx === -1 ? (delta > 0 ? -1 : ordenados.length) : idx
    const nuevo = Math.max(0, Math.min(ordenados.length - 1, base + delta))
    setSelected(ordenados[nuevo])
  }, [ordenados, selected])

  const idxActual = selected ? ordenados.indexOf(selected) : -1
  const puedeAtras = idxActual > 0
  const puedeAdelante = idxActual !== -1 && idxActual < ordenados.length - 1

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <Camera className="w-6 h-6 text-sky-400" /> Cámara
      </h2>
      <p className="text-xs text-slate-400 mb-4">
        Vista del exterior de la estación en {LOCATION.label}.
      </p>

      <CameraCard />

      {!!ordenados.length && (
        <div className="flex items-center justify-center gap-1.5 mt-4">
          <button
            onClick={() => paso(-1)}
            disabled={!puedeAtras}
            className="p-2 rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Día anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* El botón del calendario ya muestra "hoy"/"ayer"/fecha según el día
              elegido (ver `fmtDia`), así que un botón "Hoy" aparte era el mismo
              texto dos veces cuando el día activo era hoy. */}
          <DayCalendar selected={selected} available={disponibles} onSelect={setSelected} />

          <button
            onClick={() => paso(1)}
            disabled={!puedeAdelante}
            className="p-2 rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Día siguiente"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      <TimelapseCard selected={selected} onSelect={setSelected} onDaysChange={setDiasTimelapse} />

      <BestPhotoCard selected={selected} />

      <SkyAnalysisHistory selected={selected} onSelect={setSelected} onDaysChange={setDiasHistorial} />

      <ForecastAccuracyCard />

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
