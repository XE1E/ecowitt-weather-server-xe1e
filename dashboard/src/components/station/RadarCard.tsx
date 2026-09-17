import { useState } from 'react'
import { LOCATION } from '../../config'
import { trackEvent } from '../../analytics'

/**
 * Mapa meteorológico vía embed de Windy, centrado en la estación. Windy usa
 * una mezcla global (radar donde hay + satélite/nowcast + modelos), que
 * cubre CDMX. No requiere API key.
 *
 * El embed2.html de Windy NO trae un selector de capas nativo utilizable
 * (se probó `menu=true`: produce el mismo DOM, byte a byte, que `menu=`
 * vacío -- ese parámetro no hace nada en la versión actual del widget).
 * Así que las capas se cambian aquí, con botones propios que solo
 * reescriben el parámetro `overlay` del iframe.
 */
const LAYERS = [
  { key: 'radar', label: 'Radar' },
  { key: 'wind', label: 'Viento' },
  { key: 'rain', label: 'Lluvia' },
  { key: 'temp', label: 'Temperatura' },
  { key: 'clouds', label: 'Nubes' },
  { key: 'pressure', label: 'Presión' },
] as const

export function RadarCard() {
  const { latitude, longitude } = LOCATION
  const [layer, setLayer] = useState<(typeof LAYERS)[number]['key']>('radar')
  const src =
    `https://embed.windy.com/embed2.html?lat=${latitude}&lon=${longitude}` +
    `&detailLat=${latitude}&detailLon=${longitude}&width=650&height=450&zoom=8` +
    `&level=surface&overlay=${layer}&menu=&message=&marker=true&calendar=&pressure=` +
    `&type=map&location=coordinates&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`

  const btn = (active: boolean) =>
    `px-3 py-1 rounded-lg text-sm transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  return (
    <div className="card">
      <p className="card-title">Mapa meteorológico</p>
      <p className="text-xs text-slate-500 -mt-1 mb-2">Vía Windy</p>
      <div className="flex flex-wrap gap-1 mb-2">
        {LAYERS.map((l) => (
          <button key={l.key} className={btn(layer === l.key)} onClick={() => { setLayer(l.key); trackEvent('radar_layer_change', { layer: l.key }) }}>{l.label}</button>
        ))}
      </div>
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
