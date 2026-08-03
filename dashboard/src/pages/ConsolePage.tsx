import { useStationData } from '../station-data'
import { ConsoleReplica } from '../components/station/ConsoleReplica'

/**
 * Tab "Consola" del dashboard. Toda la vista vive en <ConsoleReplica>, que es
 * el mismo componente que renderiza la página `?page=consola` del kiosco; aquí
 * sólo se le pone el encabezado y se deja que escale al ancho disponible.
 */
export function ConsolePage() {
  const { loading } = useStationData()

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
        Réplica de la consola física Ecowitt. Esta es la vista que se despliega en la pantalla del kiosco.
      </p>
      <ConsoleReplica />
    </div>
  )
}
