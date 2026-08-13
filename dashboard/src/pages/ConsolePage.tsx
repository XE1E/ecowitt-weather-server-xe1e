import { useEffect, useState } from 'react'
import { useStationData } from '../station-data'
import { ConsoleReplica } from '../components/station/ConsoleReplica'

/**
 * Tab "Consola" del dashboard.
 *
 * - En PC (≥768px): muestra el componente React interactivo
 * - En móvil (<768px): muestra la imagen del kiosco, que permite zoom táctil
 */
export function ConsolePage() {
  const { loading } = useStationData()
  const [ts, setTs] = useState(() => Date.now())
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setTs(Date.now()), 15000)
    return () => clearInterval(interval)
  }, [])

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

      {/* PC: componente React */}
      <div className="hidden md:block">
        <ConsoleReplica />
      </div>

      {/* Móvil: imagen del kiosco con zoom táctil */}
      <div className="md:hidden bg-black rounded-xl overflow-hidden">
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
    </div>
  )
}
