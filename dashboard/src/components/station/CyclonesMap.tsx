import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useSharedFetch } from '../../hooks/useSharedFetch'
import { LOCATION } from '../../config'
import { Ciclon, CiclonMapa, COLOR_AVISO, colorCiclon, categoriaDeKt, etiquetaCiclon, fmtHora } from './cyclones'

// Vista inicial: México con el Pacífico oriental, el Golfo y el Caribe (donde se
// forman los que nos importan). Los del Atlántico lejano quedan a un arrastre.
const MEXICO: L.LatLngBoundsExpression = [[6, -125], [33, -76]]

function colorKt(kt: number | null): string {
  const cat = categoriaDeKt(kt)
  if (cat) return colorCiclon({ clase: 'HU', categoria: cat })
  return colorCiclon({ clase: kt != null && kt >= 34 ? 'TS' : 'TD', categoria: null })
}

// Los tooltips/íconos de Leaflet son HTML: lo que viene del NHC se escapa.
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

function temaOscuro(): boolean {
  return document.documentElement.getAttribute('data-theme') !== 'light'
}

/**
 * Mapa con todas las tormentas: cono, trayectoria pronosticada (puntos del color
 * de la intensidad prevista), posición actual, tramos de costa con vigilancia o
 * aviso y la estación. Leaflet a pelo (sin react-leaflet): un solo efecto que
 * redibuja la capa de datos cuando cambian.
 */
export function CyclonesMap({ tormentas }: { tormentas: Ciclon[] }) {
  const mapa = useSharedFetch<CiclonMapa>('/api/ciclones/mapa', 600000)
  const div = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)

  // Mapa base (una vez).
  useEffect(() => {
    if (!div.current || map.current) return
    const m = L.map(div.current, { worldCopyJump: true, scrollWheelZoom: false, attributionControl: true })
    m.fitBounds(MEXICO)
    // Mosaicos de OpenStreetMap (CARTO ya pide clave de API). En tema oscuro se
    // oscurecen con un filtro CSS (.mapa-ciclones en index.css): así el mapa
    // sigue al tema aunque se cambie con la página abierta.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 10, minZoom: 2,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · NHC · NOAA',
    }).addTo(m)
    // La rueda del ratón mueve la página; sólo tras hacer clic en el mapa hace zoom.
    m.on('click', () => m.scrollWheelZoom.enable())
    m.on('mouseout', () => m.scrollWheelZoom.disable())
    capa.current = L.layerGroup().addTo(m)
    map.current = m
    return () => { m.remove(); map.current = null; capa.current = null }
  }, [])

  // Datos.
  useEffect(() => {
    const g = capa.current
    if (!g) return
    g.clearLayers()
    const geo = new Map((mapa?.tormentas ?? []).map((t) => [t.id, t]))

    for (const t of tormentas) {
      const color = colorCiclon(t)
      const gt = geo.get(t.id)
      gt?.cono.forEach((anillo) =>
        L.polygon(anillo, { color, weight: 1, opacity: 0.8, fillColor: color, fillOpacity: 0.12, interactive: false }).addTo(g))
      gt?.avisos.forEach((a) =>
        L.polyline(a.coords, { color: COLOR_AVISO[a.clave] ?? '#e2e8f0', weight: 6, opacity: 0.95 })
          .bindTooltip(esc(a.tipo), { sticky: true }).addTo(g))

      const ruta: [number, number][] = [[t.lat, t.lon], ...t.pronostico.map((p) => [p.lat, p.lon] as [number, number])]
      L.polyline(ruta, { color: temaOscuro() ? '#e2e8f0' : '#1e293b', weight: 1.5, dashArray: '4 4', interactive: false }).addTo(g)
      for (const p of t.pronostico) {
        L.circleMarker([p.lat, p.lon], { radius: 5, color: '#0f172a', weight: 1, fillColor: colorKt(p.viento_kt), fillOpacity: 1 })
          .bindTooltip(`${esc(t.nombre)} · ${p.valido ? fmtHora(p.valido) : `+${p.horas} h`}<br>${p.viento_kt != null ? `${Math.round(p.viento_kt * 1.852)} km/h` : ''}`)
          .addTo(g)
      }
      const icono = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap;transform:translate(-11px,-11px)">
          <span style="font-size:22px;line-height:22px;filter:drop-shadow(0 0 2px #000)">🌀</span>
          <span style="font:600 12px system-ui;color:#fff;background:${color}cc;border-radius:6px;padding:1px 6px">${esc(t.nombre)}</span></div>`,
      })
      L.marker([t.lat, t.lon], { icon: icono, zIndexOffset: 1000 })
        .bindTooltip(`${esc(etiquetaCiclon(t))} ${esc(t.nombre)}${t.viento_kmh ? ` · ${t.viento_kmh} km/h` : ''}`)
        .on('click', () => document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        .addTo(g)
    }

    L.circleMarker([LOCATION.latitude, LOCATION.longitude], { radius: 5, color: '#fff', weight: 2, fillColor: '#0ea5e9', fillOpacity: 1 })
      .bindTooltip('Estación Clima XE1E').addTo(g)
  }, [tormentas, mapa])

  return (
    <div className="card p-0 overflow-hidden hover:transform-none">
      <div ref={div} className="mapa-ciclones h-[360px] sm:h-[460px] w-full z-0" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-slate-400">
        <span>Cono, trayectoria y posición actual (🌀). Toca un ciclón para ver su ficha.</span>
        <span className="flex items-center gap-1"><span className="w-4 h-1.5 rounded" style={{ background: COLOR_AVISO.HWR }} />Aviso de huracán</span>
        <span className="flex items-center gap-1"><span className="w-4 h-1.5 rounded" style={{ background: COLOR_AVISO.HWA }} />Vigilancia de huracán</span>
        <span className="flex items-center gap-1"><span className="w-4 h-1.5 rounded" style={{ background: COLOR_AVISO.TWR }} />Aviso de tormenta tropical</span>
        <span className="flex items-center gap-1"><span className="w-4 h-1.5 rounded" style={{ background: COLOR_AVISO.TWA }} />Vigilancia de tormenta tropical</span>
      </div>
    </div>
  )
}
