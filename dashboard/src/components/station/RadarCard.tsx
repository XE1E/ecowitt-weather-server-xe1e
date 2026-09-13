import { LOCATION } from '../../config'

/**
 * Mapa meteorológico vía embed de Windy, centrado en la estación. Windy usa
 * una mezcla global (radar donde hay + satélite/nowcast + modelos), que
 * cubre CDMX. No requiere API key.
 *
 * `menu=true` expone el selector de capas NATIVO de Windy (viento, lluvia,
 * temperatura, nubes, presión, etc.) dentro del propio iframe -- mucho más
 * barato que construir un selector propio y reimplementar cada capa.
 */
export function RadarCard() {
  const { latitude, longitude } = LOCATION
  const src =
    `https://embed.windy.com/embed2.html?lat=${latitude}&lon=${longitude}` +
    `&detailLat=${latitude}&detailLon=${longitude}&width=650&height=450&zoom=8` +
    `&level=surface&overlay=radar&menu=true&message=&marker=true&calendar=&pressure=` +
    `&type=map&location=coordinates&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`

  return (
    <div className="card">
      <p className="card-title">Mapa meteorológico</p>
      <p className="text-xs text-slate-500 -mt-1 mb-2">Vía Windy -- cambia de capa (viento, lluvia, nubes...) con el menú del mapa</p>
      <div className="rounded-lg overflow-hidden" style={{ height: 420 }}>
        <iframe
          title="Mapa Windy"
          src={src}
          width="100%"
          height="100%"
          frameBorder="0"
          loading="lazy"
        />
      </div>
    </div>
  )
}
