import { Radar } from 'lucide-react'
import { LOCATION } from '../config'
import { NasaSatelliteCard } from '../components/station/NasaSatelliteCard'
import { PageInfo } from '../components/station/PageInfo'

/**
 * Radar / mapa meteorológico vía embed de Ventusky, centrado en la estación,
 * más una imagen satelital diaria de NASA GIBS.
 */
export function RadarPage() {
  const { latitude, longitude } = LOCATION
  const src = `https://www.ventusky.com/?p=${latitude};${longitude};8&l=radar`

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Radar className="w-6 h-6 text-sky-400" /> Radar y satélite</h2>
      <p className="text-xs text-slate-400 mb-4">Radar meteorológico interactivo e imagen satelital diaria para {LOCATION.label}.</p>

      <div className="rounded-2xl overflow-hidden border border-white/10" style={{ height: 560 }}>
        <iframe title="Ventusky" src={src} width="100%" height="100%" frameBorder="0" loading="lazy" />
      </div>

      <div className="card mt-4 text-sm text-slate-300 leading-relaxed">
        <p>
          Mapa interactivo de <span className="font-semibold">Ventusky</span> centrado en {LOCATION.name}.
          Usa el <span className="font-semibold">menú de la izquierda</span> para cambiar de capa
          (radar, satélite, precipitación, viento, temperatura, calidad del aire…), el
          {' '}<span className="font-semibold">selector de modelo</span> (abajo a la izquierda: ECMWF, GFS,
          ICON…) y la <span className="font-semibold">línea de tiempo</span> para animar. La precipitación
          combina radar (donde existe) con satélite y modelos; en el centro de México úsalo como referencia
          general.
        </p>
      </div>

      {/* Imagen satelital NASA GIBS */}
      <div className="mt-6">
        <NasaSatelliteCard />
      </div>

      <p className="text-xs text-slate-500 mt-2">Mapa: Ventusky · Satélite: NASA GIBS · centrado en {LOCATION.label}</p>

      <PageInfo>
        <p>
          El <span className="font-semibold">radar</span> (Ventusky) muestra dónde está lloviendo ahora y su intensidad,
          combinando radar meteorológico con satélite y modelos; anima la línea de tiempo para ver hacia dónde se mueve.
          La <span className="font-semibold">imagen satelital</span> (NASA GIBS) es la foto de color real del día: te deja
          ver la nubosidad y los sistemas sobre la región. Son datos externos de referencia general —a diferencia del resto
          del sitio, no provienen de tu estación.
        </p>
      </PageInfo>
    </div>
  )
}
