import { LOCATION } from '../../config'

/**
 * Radar de precipitación vía embed de Windy, centrado en la estación.
 * Windy usa una mezcla global (radar donde hay + satélite/nowcast), que cubre
 * CDMX. No requiere API key.
 */
export function RadarCard() {
  const { latitude, longitude } = LOCATION
  const src =
    `https://embed.windy.com/embed2.html?lat=${latitude}&lon=${longitude}` +
    `&detailLat=${latitude}&detailLon=${longitude}&width=650&height=450&zoom=8` +
    `&level=surface&overlay=radar&menu=&message=&marker=true&calendar=&pressure=` +
    `&type=map&location=coordinates&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`

  return (
    <div className="card">
      <p className="card-title">Radar de precipitación</p>
      <div className="rounded-lg overflow-hidden" style={{ height: 320 }}>
        <iframe
          title="Radar Windy"
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
