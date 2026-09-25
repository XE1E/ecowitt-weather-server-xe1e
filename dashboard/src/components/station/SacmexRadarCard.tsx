import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Radar } from 'lucide-react'
import { LOCATION } from '../../config'

/**
 * Radar meteorológico del SACMEX (Gobierno de la CDMX): animación de los últimos
 * cuadros de reflectividad. Las imágenes pasan por nuestro backend
 * (`services/sacmex_radar.py`): su página no se deja incrustar en un iframe y
 * así SACMEX recibe una consulta cada 5 min, no una por visitante.
 */

interface Frame { id: string; time: string }
interface SacmexData {
  source: string
  source_url: string
  frames: Frame[]
  latest_age_minutes: number | null
  stale: boolean
}

const FRAME_MS = 700      // cada cuadro de la animación
const HOLD_LAST_MS = 5000 // pausa en el más reciente antes de volver a empezar (era 2 s: se iba demasiado rápido)
const REFRESH_MS = 5 * 60 * 1000

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Mexico_City',
  })

// Dónde cae la estación en la imagen del radar (702x512). La imagen trae la
// posición del radar (19°20'33.5"N, 99°05'22.1"W) pero no su escala en pixeles:
// se calibró el 2026-09-23 con 4 poblados rotulados en el propio mapa
// (Chimalhuacán, Xico, Cuernavaca, Cuautla), que ubican el centro del radar en
// (254, 252) px con 1-2 px de diferencia entre sí, a ~3.3 px/km. Si SACMEX
// cambia el encuadre de su imagen, hay que recalibrar estos números.
const IMG_W = 702
const IMG_H = 512
const RADAR = { lat: 19.342639, lon: -99.089472, px: 254, py: 252 }
const PX_PER_KM = 3.3

/** Pixel (en la imagen original) de una coordenada. */
function toPx(lat: number, lon: number) {
  const kmX = (lon - RADAR.lon) * 111.32 * Math.cos((RADAR.lat * Math.PI) / 180)
  const kmY = (lat - RADAR.lat) * 110.57
  return { x: RADAR.px + kmX * PX_PER_KM, y: RADAR.py - kmY * PX_PER_KM }
}

// Zoom a la CDMX: recorte cuadrado CENTRADO EN LA ESTACIÓN cuyo borde inferior
// cae justo debajo de Cuernavaca (18.9186 N, 99.2342 W). Deja fuera el panel en
// inglés de la derecha (la leyenda la ponemos nosotros, en español, abajo).
const EST = toPx(LOCATION.latitude, LOCATION.longitude)
const BORDE_INF = toPx(18.9186, -99.2342).y + 6
const MEDIO = BORDE_INF - EST.y
const VIEW = { x: EST.x - MEDIO, y: EST.y - MEDIO, s: 2 * MEDIO }
// Logo de SEGIAGUA (crédito de la imagen): el recorte lo deja fuera, así que se
// toma del MISMO cuadro -- el original, no una copia -- y se pone en la esquina
// superior izquierda, sobre el mismo gris claro del mapa (~#ececec, muestreado)
// para que no se note el "injerto". Caja en pixeles de la imagen original.
const LOGO = { x: 12, y: 17, w: 74, h: 69 }
const LOGO_ESCALA = 0.75
const RING_KM = 5
const RINGS = Array.from({ length: Math.floor(MEDIO / PX_PER_KM / RING_KM) }, (_, i) => (i + 1) * RING_KM)

// Colores de la escala tal como se VEN en el mapa: SACMEX pinta los ecos al ~40 %
// sobre el mapa, igual que su leyenda, así que sobre fondo claro se ven pastel. Se
// muestrearon de su leyenda (2026-09-23). El 24-09 se cambiaron por los colores
// "plenos" suponiendo ecos opacos; la tarde de lluvia de ese día mostró que no lo son
// (ver services/radar_decode.py, LEGEND/ALPHA) y se regresaron a éstos.
const DBZ_COLOR: [number, string][] = [
  [5, '#9cf7f8'], [10, '#9adafd'], [15, '#9a9acd'], [20, '#ceff9a'], [25, '#99ff99'],
  [30, '#9bcd9b'], [35, '#ffffb7'], [40, '#fbde99'], [45, '#ffcd99'], [50, '#ff989f'],
  [55, '#ee9f99'], [60, '#cd9ace'], [65, '#ff99ff'], [70, '#db9afb'], [75, '#ffffff'],
]

// Escala sencilla de reflectividad: cuanto más alto el dBZ, más agua (o hielo)
// devuelve el eco del radar. Rangos redondeados de la interpretación habitual.
const ESCALA: { rango: string; que: string; color: string }[] = [
  { rango: 'menos de 20', que: 'nubes o llovizna muy débil; a menudo no llega al suelo', color: '#9adafd' },
  { rango: '20 a 35', que: 'lluvia ligera a moderada', color: '#99ff99' },
  { rango: '35 a 50', que: 'lluvia fuerte', color: '#fbde99' },
  { rango: '50 a 60', que: 'aguacero o tormenta intensa; puede traer granizo pequeño', color: '#ee9f99' },
  { rango: 'más de 60', que: 'tormenta muy fuerte, granizo probable', color: '#ff99ff' },
]

export function SacmexRadarCard() {
  const [data, setData] = useState<SacmexData | null>(null)
  const [error, setError] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [ready, setReady] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    let vivo = true
    const cargar = () =>
      fetch('/api/radar/sacmex')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: SacmexData) => { if (vivo) { setData(d); setError(false) } })
        .catch(() => { if (vivo) setError(true) })
    cargar()
    const t = window.setInterval(cargar, REFRESH_MS)
    return () => { vivo = false; window.clearInterval(t) }
  }, [])

  const frames = data?.frames ?? []
  const urls = useMemo(() => frames.map((f) => `/api/radar/sacmex/${f.id}`), [frames])

  // Precargar todos los cuadros antes de animar: si no, la animación "parpadea"
  // mientras cada imagen llega por primera vez.
  useEffect(() => {
    if (!urls.length) return
    setReady(false)
    let pendientes = urls.length
    const listo = () => { pendientes -= 1; if (pendientes <= 0) setReady(true) }
    urls.forEach((u) => { const im = new Image(); im.onload = listo; im.onerror = listo; im.src = u })
    setIdx(urls.length - 1)
  }, [urls])

  useEffect(() => {
    if (!playing || !ready || urls.length < 2) return
    const ultimo = idx === urls.length - 1
    timer.current = window.setTimeout(
      () => setIdx((i) => (i + 1) % urls.length),
      ultimo ? HOLD_LAST_MS : FRAME_MS,
    )
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [playing, ready, idx, urls.length])

  if (error && !data) {
    return (
      <div className="card">
        <p className="card-title flex items-center gap-2"><Radar className="w-5 h-5 text-sky-400" /> Radar SACMEX (CDMX)</p>
        <p className="text-sm text-slate-400">El radar del SACMEX no está disponible en este momento.</p>
      </div>
    )
  }
  if (!data || !frames.length) return null

  const actual = frames[Math.min(idx, frames.length - 1)]
  const esUltimo = idx === frames.length - 1

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="card-title mb-0 flex items-center gap-2">
          <Radar className="w-5 h-5 text-sky-400" /> Radar SACMEX (CDMX)
        </p>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="px-2 py-1 rounded-lg text-xs bg-white/5 text-slate-300 hover:bg-white/10 flex items-center gap-1"
          aria-label={playing ? 'Pausar animación' : 'Reproducir animación'}
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {playing ? 'Pausa' : 'Animar'}
        </button>
      </div>

      {/* Ancho tope: a ancho completo en escritorio la imagen salía más alta que la
          pantalla y había que hacer scroll para ver el deslizador. */}
      <div className="max-w-xl mx-auto">
      <div className="rounded-xl overflow-hidden bg-white aspect-square">
        <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.s} ${VIEW.s}`} className="w-full h-full block"
          role="img" aria-label={`Radar SACMEX, ${hora(actual.time)}, con anillos cada ${RING_KM} km desde la estación`}>
          <image href={urls[Math.min(idx, urls.length - 1)]} x={0} y={0} width={IMG_W} height={IMG_H} />
          {RINGS.map((km) => {
            const r = km * PX_PER_KM
            const lx = EST.x + r * Math.SQRT1_2
            const ly = EST.y - r * Math.SQRT1_2
            return (
              <g key={km}>
                <circle cx={EST.x} cy={EST.y} r={r} fill="none" stroke="#1e293b"
                  strokeOpacity={km % 10 === 0 ? 0.55 : 0.3} strokeWidth={km % 10 === 0 ? 0.9 : 0.6}
                  strokeDasharray={km % 10 === 0 ? undefined : '2 2'} />
                <text x={lx} y={ly} fontSize={6.5} fontWeight={600} textAnchor="middle" dominantBaseline="middle"
                  fill="#0f172a" stroke="#ffffff" strokeWidth={2} paintOrder="stroke">{km} km</text>
              </g>
            )
          })}
          <g>
            <rect x={VIEW.x + 3} y={VIEW.y + 3} width={LOGO.w * LOGO_ESCALA + 4} height={LOGO.h * LOGO_ESCALA + 4}
              rx={6} fill="#ececec" fillOpacity={0.95} />
            <svg x={VIEW.x + 5} y={VIEW.y + 5} width={LOGO.w * LOGO_ESCALA} height={LOGO.h * LOGO_ESCALA}
              viewBox={`${LOGO.x} ${LOGO.y} ${LOGO.w} ${LOGO.h}`}>
              <image href={urls[Math.min(idx, urls.length - 1)]} x={0} y={0} width={IMG_W} height={IMG_H} />
            </svg>
            <title>Imagen: SEGIAGUA / SACMEX, Gobierno de la Ciudad de México</title>
          </g>
          <circle cx={EST.x} cy={EST.y} r={3.2} fill="#dc2626" stroke="#ffffff" strokeWidth={1.3}>
            <title>Estación XE1E</title>
          </circle>
        </svg>
      </div>

      {/* Leyenda propia en español, con los colores del radar (la suya, en inglés,
          queda fuera del recorte). */}
      <div className="mt-2">
        <div className="flex h-2.5 rounded overflow-hidden ring-1 ring-black/10">
          {DBZ_COLOR.map(([v, c]) => <div key={v} className="flex-1" style={{ backgroundColor: c }} title={`${v} dBZ`} />)}
        </div>
        {/* Mismas 15 columnas que la barra: cada número queda centrado bajo SU color. */}
        <div className="flex text-[10px] text-slate-500 mt-0.5 tabular-nums">
          {DBZ_COLOR.map(([v]) => <span key={v} className="flex-1 text-center">{v % 10 === 0 ? v : ''}</span>)}
        </div>
        <p className="text-[10px] text-slate-500 text-center -mt-0.5">reflectividad (dBZ)</p>
      </div>

      <div className="flex items-center gap-3 mt-2">
        <span className="text-sm font-semibold text-slate-100 tabular-nums w-12">{hora(actual.time)}</span>
        <input
          type="range" min={0} max={frames.length - 1} value={Math.min(idx, frames.length - 1)}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }}
          className="flex-1 accent-sky-500" aria-label="Cuadro del radar"
        />
        <span className="text-xs text-slate-500 whitespace-nowrap">{esUltimo ? 'más reciente' : `${idx + 1}/${frames.length}`}</span>
      </div>
      </div>

      {data.stale && (
        <p className="text-xs text-amber-400 mt-2">
          ⚠ El último cuadro tiene {data.latest_age_minutes != null ? Math.round(data.latest_age_minutes) : '?'} min: el radar puede estar sin publicar.
        </p>
      )}

      <div className="text-xs text-slate-400 mt-3 leading-relaxed">
        <p className="mb-1">
          <span className="font-semibold text-slate-300">¿Qué son los dBZ?</span> Es la fuerza del eco que vuelve al
          radar: cuanto más alto, más agua (o granizo) hay en esa zona. Los colores del mapa siguen la barra de
          arriba; el <span className="text-red-500 font-semibold">punto rojo</span> es la estación y los anillos marcan
          la distancia a ella cada {RING_KM} km. Como guía sencilla:
        </p>
        <ul className="space-y-0.5">
          {ESCALA.map((e) => (
            <li key={e.rango} className="flex items-start gap-1.5">
              <span className="mt-1 w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-black/10" style={{ backgroundColor: e.color }} />
              <span><span className="text-slate-300 tabular-nums">{e.rango} dBZ</span> — {e.que}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-slate-500">
          Radar: <a href={data.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">SACMEX, Gobierno de la Ciudad de México</a>
          {' '}· cuadro cada ~5 min, últimos {frames.length} (hora de CDMX).
        </p>
      </div>
    </div>
  )
}
