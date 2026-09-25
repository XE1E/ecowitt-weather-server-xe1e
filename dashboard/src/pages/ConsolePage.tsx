import { useEffect, useState } from 'react'
import { useStationData } from '../station-data'
import { ConsoleReplica } from '../components/station/ConsoleReplica'
import { useIsMobile } from '../hooks/useIsMobile'

/**
 * Tab "Consola" del dashboard.
 *
 * - En PC (≥768px): muestra el componente React interactivo
 * - En móvil (<768px): muestra la imagen del kiosco, que permite zoom táctil
 *
 * Se monta SÓLO la que toca. Antes las dos iban siempre y una se escondía con CSS:
 * en PC se bajaba igual la imagen cada 15 s y en móvil la réplica seguía con sus
 * 8 consultas periódicas.
 */
export function ConsolePage() {
  const { loading } = useStationData()
  const [ts, setTs] = useState(() => Date.now())
  const [imgError, setImgError] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!isMobile) return
    const interval = setInterval(() => setTs(Date.now()), 15000)
    return () => clearInterval(interval)
  }, [isMobile])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        Cargando datos de la consola...
      </div>
    )
  }

  return (
    <div>
      <p className="text-slate-400 mb-4">
        Reemplazo de la consola física Ecowitt. Esta es la vista que se despliega en la pantalla del kiosco.
        <span className="md:hidden"> Puedes hacer zoom táctil.</span>
      </p>

      {/* PC: componente React -- envuelto en .panel para que tenga marco propio
          en tema claro (antes quedaba suelta sobre el fondo de la pagina) */}
      {!isMobile && (
      <div className="panel p-4">
        <ConsoleReplica />
      </div>
      )}

      {/* Móvil: imagen del kiosco con zoom táctil */}
      {isMobile && (
      <div className="bg-black rounded-xl overflow-hidden">
        {imgError ? (
          <div className="flex items-center justify-center aspect-[1024/600] text-slate-400">
            No se pudo cargar la imagen
          </div>
        ) : (
          <img
            src={`/api/display.jpg?page=consola&_t=${ts}`}
            alt="Consola del kiosco"
            className="w-full h-auto"
            style={{ aspectRatio: '1024 / 600' }}
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
          />
        )}
      </div>
      )}
    </div>
  )
}
