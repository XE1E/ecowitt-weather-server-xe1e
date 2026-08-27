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
 *
 * Fecha CONTROLADA desde `CameraPage`, que la comparte con `SkyAnalysisHistory`: un
 * solo calendario mueve las dos tarjetas a la vez, en vez de cada una con el suyo.
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

export interface TimelapseCardProps {
  selected: string | null
  onSelect: (iso: string) => void
  /** Reporta hacia arriba qué fechas tienen fotogramas, para el calendario compartido. */
  onDaysChange: (dates: string[]) => void
}

export function TimelapseCard({ selected, onSelect, onDaysChange }: TimelapseCardProps) {
  const [info, setInfo] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
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

  useEffect(() => {
    onDaysChange(info?.days?.map((d) => d.date) ?? [])
  }, [info, onDaysChange])

  // Selección inicial (sólo si nadie ha elegido fecha todavía): el día más reciente
  // que ya tenga vídeo; si ninguno lo tiene, el más reciente con fotogramas
  // suficientes (se generará al pedirlo).
  useEffect(() => {
    if (selected || !info?.days?.length) return
    const conVideo = info.days.find((d) => d.video)
    onSelect((conVideo ?? info.days.find((d) => d.enough_frames) ?? info.days[0]).date)
  }, [info, selected, onSelect])

  const dia = info?.days?.find((d) => d.date === selected) ?? null

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

    if (!dia) {
      // `selected` puede venir de un día que SÍ existe en el histórico de análisis
      // pero no aquí (fotogramas ya podados, u otra fuente): no es "cargando", es
      // que esta tarjeta no tiene nada para esa fecha.
      return (
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center px-6">
          <p className="text-slate-300 font-semibold">Sin fotogramas para este día</p>
          <p className="text-sm text-slate-500 mt-1">
            Los fotogramas se conservan {info.frames_retention_days} días; puede que ya se hayan podado.
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
          key={selected ?? ''}
          src={`/api/camera/timelapse/${selected}.mp4`}
          // Sin cartel el reproductor es un rectángulo NEGRO hasta que alguien le da al
          // play --con `preload="metadata"` ni siquiera carga el primer fotograma-- y la
          // tarjeta parece rota. El servidor lo saca del medio del vídeo, o sea cerca del
          // mediodía; si por lo que sea no existe, responde 404 y se ve como antes.
          poster={dia?.poster ? `/api/camera/timelapse/${selected}.jpg` : undefined}
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
              href={`/api/camera/timelapse/${selected}.mp4`}
              download={`timelapse-${selected}.mp4`}
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
      <p className="card-title mb-3 flex items-center gap-2">
        <Clapperboard className="w-5 h-5 text-sky-400" /> Timelapse del día
      </p>

      {cuerpo()}
    </div>
  )
}
