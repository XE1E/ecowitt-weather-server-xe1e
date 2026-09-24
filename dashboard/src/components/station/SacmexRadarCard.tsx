import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Radar } from 'lucide-react'

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
const HOLD_LAST_MS = 2000 // pausa en el más reciente antes de volver a empezar
const REFRESH_MS = 5 * 60 * 1000

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Mexico_City',
  })

// Escala sencilla de reflectividad: cuanto más alto el dBZ, más agua (o hielo)
// devuelve el eco del radar. Rangos redondeados de la interpretación habitual.
const ESCALA: { rango: string; que: string }[] = [
  { rango: 'menos de 20', que: 'nubes o llovizna muy débil; a menudo no llega al suelo' },
  { rango: '20 a 35', que: 'lluvia ligera a moderada' },
  { rango: '35 a 50', que: 'lluvia fuerte' },
  { rango: '50 a 60', que: 'aguacero o tormenta intensa; puede traer granizo pequeño' },
  { rango: 'más de 60', que: 'tormenta muy fuerte, granizo probable' },
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
      <div className="max-w-3xl mx-auto">
      <div className="rounded-xl overflow-hidden bg-white" style={{ aspectRatio: '702 / 512' }}>
        <img src={urls[Math.min(idx, urls.length - 1)]} alt={`Radar SACMEX, ${hora(actual.time)}`}
          className="w-full h-full object-contain" />
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
          radar: cuanto más alto, más agua (o granizo) hay en esa zona. Los colores de la imagen siguen la escala
          de la derecha. Como guía sencilla:
        </p>
        <ul className="space-y-0.5">
          {ESCALA.map((e) => (
            <li key={e.rango}><span className="text-slate-300 tabular-nums">{e.rango} dBZ</span> — {e.que}</li>
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
