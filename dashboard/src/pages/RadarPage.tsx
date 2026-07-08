import { LOCATION } from '../config'

/**
 * Radar / mapa meteorológico vía embed de Ventusky, centrado en la estación.
 * Se embebe el mapa completo (www.ventusky.com no bloquea iframes), por lo que
 * los menús de capas (radar, satélite, temperatura, viento, calidad del aire…),
 * el selector de modelo (ECMWF/GFS/ICON…) y la línea de tiempo quedan dentro de
 * la página. Muestra precipitación real para CDMX (mezcla radar + satélite/modelo).
 */
export function RadarPage() {
  const { latitude, longitude } = LOCATION
  const src = `https://www.ventusky.com/?p=${latitude};${longitude};8&l=radar`

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-300 mb-3">Radar y mapa meteorológico</h2>

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
      <p className="text-xs text-slate-500 mt-2">Mapa: Ventusky · centrado en {LOCATION.label}</p>
    </div>
  )
}
