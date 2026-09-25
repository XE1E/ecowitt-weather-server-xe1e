import { NavLink } from 'react-router-dom'
import { useCiclones, etiquetaCiclon, fraseAmenaza, colorCiclon } from './cyclones'

/**
 * Aviso de ciclones en Inicio. Tres casos:
 *  - alguno amenaza o se acerca a México: cintillo rojo/ámbar con el más cercano;
 *  - hay ciclones pero lejos: una línea discreta (que se sepa que la temporada va);
 *  - no hay ninguno: nada.
 */
export function CycloneBanner() {
  const data = useCiclones()
  const ts = data?.tormentas ?? []
  if (!ts.length) return null

  const top = ts[0]   // el backend ya los ordena por amenaza y cercanía
  if (top.nivel === 'baja') {
    return (
      <NavLink to="/ciclones"
        className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 transition">
        <span className="shrink-0">🌀</span>
        <span className="truncate">
          {ts.length} {ts.length === 1 ? 'ciclón activo' : 'ciclones activos'}
          <span className="hidden sm:inline"> ({ts.map((t) => t.nombre).join(', ')})</span>, ninguno amenaza a México por ahora
        </span>
        <span className="ml-auto shrink-0 text-sky-400 whitespace-nowrap">Ver →</span>
      </NavLink>
    )
  }

  const alta = top.nivel === 'alta'
  const otros = ts.filter((t) => t.nivel !== 'baja').length - 1
  return (
    <NavLink to="/ciclones"
      className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
        alta ? 'border-red-500/50 bg-red-500/10 text-red-100 hover:bg-red-500/15'
             : 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15'}`}>
      <span className="relative flex h-3 w-3 shrink-0 mt-1">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${alta ? 'bg-red-400' : 'bg-amber-400'}`} />
        <span className="relative inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: colorCiclon(top) }} />
      </span>
      <span className="min-w-0">
        <span className="font-semibold">🌀 {etiquetaCiclon(top)} {top.nombre}</span>
        {top.viento_kmh != null && <span className="opacity-80"> · {top.viento_kmh} km/h</span>}
        <span className="block opacity-90">{fraseAmenaza(top)}{otros > 0 ? ` (y ${otros} más cerca de México)` : ''}</span>
      </span>
      <span className={`hidden sm:inline ml-auto shrink-0 whitespace-nowrap self-center ${alta ? 'text-red-300' : 'text-amber-300'}`}>Ver ciclones →</span>
    </NavLink>
  )
}
