import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Download, RefreshCw } from 'lucide-react'

/**
 * Timelapse del día: el vídeo que junta las capturas de la cámara.
 *
 * El servidor lo genera con ffmpeg (`services/timelapse.py`) y lo sirve como MP4, así
 * que aquí basta un `<video>`. La alternativa era animar los JPEG en el navegador, que
 * se descartó por tráfico (~50 MB al día) y porque un vídeo se comparte y se busca.
 *
 * Los días con vídeo se pueden ver de inmediato. Un día que aún no lo tiene se genera
 * en el servidor cuando se pide: el endpoint responde 202 y esta tarjeta se queda
 * sondeando hasta que aparece, porque el encode tarda segundos y dejar la petición
 * colgada daría una espera muda.
 */

interface Dia {
  date: string
  frames: number
  video: boolean
  bytes: number
  seconds: number
  frames_used: number
  poster: boolean
  stale: boolean
  generating: boolean
  enough_frames: boolean
}

interface Respuesta {
  enabled: boolean
  ffmpeg: boolean
  fps: number
  min_frames: number
  retention_days: number
  frames_retention_days: number
  disk_bytes: number
  days: Dia[]
}

const SONDEO_MS = 5000       // mientras un día se está generando
const MAX_SONDEOS = 36       // ~3 min: pasado eso, algo va mal y se deja de insistir

function fmtBytes(b: number): string {
  if (!b) return '--'
  const mb = b / (1024 * 1024)
  return mb < 1 ? `${Math.round(b / 1024)} KB` : `${mb.toFixed(1)} MB`
}

/** "18 ago" / "hoy" / "ayer" */
function fmtDia(iso: string): string {
  const hoy = new Date()
  const f = new Date(iso + 'T12:00:00')
  const dif = Math.round(
    (new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime() -
      new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime()) / 86400000,
  )
  if (dif === 0) return 'hoy'
  if (dif === 1) return 'ayer'
  return f.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

export function TimelapseCard() {
  const [info, setInfo] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sondeos = useRef(0)

  const consultar = useCallback(async (): Promise<Respuesta | null> => {
    try {
      const r = await fetch('/api/camera/timelapse/days')
      if (!r.ok) { setInfo(null); return null }
      const j: Respuesta = await r.json()
      setInfo(j)
      return j
    } catch {
      setInfo(null)
      return null
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { consultar() }, [consultar])

  // Selección inicial: el día más reciente que ya tenga vídeo; si ninguno lo tiene,
  // el más reciente con fotogramas suficientes (se generará al pedirlo).
  useEffect(() => {
    if (sel || !info?.days?.length) return
    const conVideo = info.days.find((d) => d.video)
    setSel((conVideo ?? info.days.find((d) => d.enough_frames) ?? info.days[0]).date)
  }, [info, sel])

  const dia = info?.days?.find((d) => d.date === sel) ?? null

  // Sólo los datos que deben re-disparar el sondeo, extraídos aparte a propósito: el
  // objeto `dia` sale de `info`, así que cambia de identidad en CADA consulta y usarlo
  // como dependencia reiniciaría el bucle de sondeo una y otra vez.
  const fecha = dia?.date ?? null
  const tieneVideo = !!dia?.video
  const suficientes = !!dia?.enough_frames
  const hayFfmpeg = !!info?.ffmpeg

  // Pedir el vídeo de un día que aún no existe: dispara la generación (202) y sondea.
  useEffect(() => {
    if (!fecha || tieneVideo || !suficientes || !hayFfmpeg) return
    let cancelado = false
    let timer = 0
    sondeos.current = 0
    setGenerando(true)
    setError(null)

    const tick = async () => {
      if (cancelado) return
      const j = await consultar()
      if (cancelado) return
      if (j?.days?.find((x) => x.date === fecha)?.video) { setGenerando(false); return }
      if (++sondeos.current >= MAX_SONDEOS) {
        setGenerando(false)
        setError('El vídeo está tardando más de lo normal. Vuelve a intentarlo.')
        return
      }
      timer = window.setTimeout(tick, SONDEO_MS)
    }

    // Con el vídeo ausente esta petición devuelve 202 y arranca el encode.
    fetch(`/api/camera/timelapse/${fecha}.mp4`)
      .catch(() => { /* el sondeo lo vuelve a intentar */ })
      .then(() => { if (!cancelado) timer = window.setTimeout(tick, SONDEO_MS) })

    return () => { cancelado = true; window.clearTimeout(timer) }
  }, [fecha, tieneVideo, suficientes, hayFfmpeg, consultar])

  const cuerpo = () => {
    if (cargando) return <div className="h-64 rounded-xl bg-white/5 animate-pulse" />

    if (!info) {
      return (
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-sm text-slate-400">
          No se pudo consultar el timelapse.
        </div>
      )
    }
    if (!info.enabled) {
      return (
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-sm text-slate-400">
          El timelapse está deshabilitado en el servidor.
        </div>
      )
    }
    if (!info.ffmpeg) {
      // Fallo de despliegue, no de datos: conviene que se lea tal cual.
      return (
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center px-6">
          <p className="text-slate-300 font-semibold">El servidor no tiene ffmpeg</p>
          <p className="text-sm text-slate-500 mt-1">
            Las capturas se siguen guardando; el vídeo se podrá generar en cuanto esté instalado.
          </p>
        </div>
      )
    }
    if (!info.days.length) {
      return (
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center px-6">
          <Clapperboard className="w-10 h-10 text-slate-600 mb-3" />
          <p className="text-slate-300 font-semibold">Todavía no hay días completos</p>
          <p className="text-sm text-slate-500 mt-1">
            El vídeo aparece cuando el día junta al menos {info.min_frames} capturas.
          </p>
        </div>
      )
    }

    if (dia && !dia.video) {
      if (!dia.enough_frames) {
        return (
          <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center px-6">
            <p className="text-slate-300 font-semibold">Ese día tiene pocas capturas</p>
            <p className="text-sm text-slate-500 mt-1">
              {dia.frames} de las {info.min_frames} que hacen falta: el vídeo duraría un pestañeo.
            </p>
          </div>
        )
      }
      return (
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center px-6">
          {generando ? (
            <>
              <RefreshCw className="w-8 h-8 text-sky-400 mb-3 animate-spin" />
              <p className="text-slate-300 font-semibold">Montando el vídeo…</p>
              <p className="text-sm text-slate-500 mt-1">
                {dia.frames} capturas. Tarda unos segundos y se guarda para las siguientes visitas.
              </p>
            </>
          ) : (
            <>
              <p className="text-slate-300 font-semibold">{error ?? 'El vídeo aún no está'}</p>
              <button onClick={() => consultar()} className="text-sm text-sky-400 hover:text-sky-300 mt-2">
                Volver a comprobar
              </button>
            </>
          )}
        </div>
      )
    }

    return (
      <div>
        <video
          // La clave fuerza a React a rehacer el elemento al cambiar de día: reusarlo
          // deja el primer fotograma del vídeo anterior congelado hasta que carga el
          // nuevo, que se lee como que la selección no funcionó.
          key={sel ?? ''}
          src={`/api/camera/timelapse/${sel}.mp4`}
          // Sin cartel el reproductor es un rectángulo NEGRO hasta que alguien le da al
          // play --con `preload="metadata"` ni siquiera carga el primer fotograma-- y la
          // tarjeta parece rota. El servidor lo saca del medio del vídeo, o sea cerca del
          // mediodía; si por lo que sea no existe, responde 404 y se ve como antes.
          poster={dia?.poster ? `/api/camera/timelapse/${sel}.jpg` : undefined}
          controls
          loop
          playsInline
          preload="metadata"
          className="w-full rounded-xl border border-white/10 bg-black"
        />
        {dia && (
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-xs text-slate-500">
            <span>
              {dia.frames_used} capturas · {dia.seconds}s a {info.fps} fps · {fmtBytes(dia.bytes)}
              {dia.stale && <span className="text-slate-400"> · le faltan las últimas de hoy</span>}
            </span>
            <a
              href={`/api/camera/timelapse/${sel}.mp4`}
              download={`timelapse-${sel}.mp4`}
              className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Descargar
            </a>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="card-title mb-0 flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-sky-400" /> Timelapse del día
        </p>
        {!!info?.days?.length && info.ffmpeg && info.enabled && (
          <div className="flex flex-wrap gap-1.5">
            {info.days.slice(0, 10).map((d) => (
              <button
                key={d.date}
                onClick={() => setSel(d.date)}
                title={`${d.frames} capturas${d.video ? '' : ' · sin vídeo todavía'}`}
                className={`rounded-lg px-2 py-1 text-xs transition border ${
                  d.date === sel
                    ? 'bg-sky-600/30 border-sky-500/50 text-slate-100'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                }`}
              >
                {fmtDia(d.date)}
                {/* Un punto para los días que aún no tienen vídeo: así se ve antes de
                    pulsar que ése habrá que montarlo. */}
                {!d.video && <span className="ml-1 text-amber-400/70">•</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {cuerpo()}
    </div>
  )
}
