import { useCallback, useEffect, useState } from 'react'
import { Camera, RefreshCw, AlertTriangle } from 'lucide-react'
import { relativeTime } from '../../weather'

/**
 * Vista del exterior de la estación (Tapo C325WB).
 *
 * La cámara vive detrás del NAT de casa y el servidor en el VPS, así que aquí no se
 * habla con la cámara: se lee la última foto que alguien empujó a
 * `POST /api/camera/upload`. Ver `docs/internal/PLAN-CAMARA-EXTERIOR.md`.
 *
 * Se acordó **foto periódica y no directo 24/7**: un directo serían ~1 TB/mes de
 * subida desde casa y un proceso de vídeo corriendo para siempre, y para un sitio de
 * clima la foto cada pocos minutos dice más.
 */
interface Estado {
  available?: boolean
  captured_at?: string
  age_seconds?: number
  stale?: boolean
  bytes?: number
}

/** Cada cuánto se pregunta si hay foto nueva. La cadencia acordada es de 5-10 min. */
const SONDEO_MS = 60_000

export function CameraCard() {
  const [st, setSt] = useState<Estado | null>(null)
  const [cargando, setCargando] = useState(true)
  const [falloRed, setFalloRed] = useState(false)
  const [imgCargando, setImgCargando] = useState(true)

  const consultar = useCallback(() => {
    fetch('/api/camera/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { setSt(j); setFalloRed(j == null) })
      .catch(() => setFalloRed(true))
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => {
    consultar()
    const i = setInterval(consultar, SONDEO_MS)
    return () => clearInterval(i)
  }, [consultar])

  const hayFoto = !!st?.available
  const vieja = !!st?.stale

  /**
   * La URL lleva la marca de la captura, no un `Date.now()`.
   *
   * La respuesta viaja con `max-age=150`, así que sin nada el navegador reusaría la
   * foto vieja; y con un timestamp cambiante en cada render se saltaría la caché
   * siempre, volviendo a bajar los mismos ~120 KB cada minuto. Con la marca de
   * captura se descarga exactamente una vez por foto.
   */
  const src = hayFoto
    ? `/api/camera/latest.jpg?t=${encodeURIComponent(st?.captured_at || '')}`
    : ''

  useEffect(() => { if (src) setImgCargando(true) }, [src])

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="card-title mb-0 flex items-center gap-2">
          <Camera className="w-5 h-5 text-sky-400" /> Exterior de la estación
        </p>
        <div className="flex items-center gap-3">
          {hayFoto && st?.captured_at && (
            <span className={`text-xs ${vieja ? 'text-amber-400' : 'text-slate-400'}`}>
              {vieja && <AlertTriangle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}
              {relativeTime(st.captured_at)}
            </span>
          )}
          <button
            onClick={consultar}
            title="Buscar una captura más reciente"
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {cargando ? (
        <div className="h-64 rounded-xl bg-white/5 animate-pulse" />
      ) : !hayFoto ? (
        // Degradar con gracia: decir qué pasa, no dejar el hueco en blanco. Mientras
        // la cámara no esté instalada, éste es el estado normal.
        <div className="h-64 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center px-6">
          <Camera className="w-10 h-10 text-slate-600 mb-3" />
          <p className="text-slate-300 font-semibold">Sin imagen todavía</p>
          <p className="text-sm text-slate-500 mt-1">
            {falloRed
              ? 'No se pudo consultar el estado de la cámara.'
              : 'La cámara del exterior aún no envía capturas.'}
          </p>
        </div>
      ) : (
        <div className="relative">
          {imgCargando && (
            <div className="absolute inset-0 rounded-xl bg-white/5 animate-pulse" />
          )}
          <img
            src={src}
            alt="Vista del exterior de la estación"
            onLoad={() => setImgCargando(false)}
            onError={() => { setImgCargando(false); setSt({ available: false }) }}
            className="w-full rounded-xl border border-white/10"
          />
          {/* El aviso va SOBRE la foto y no en el pie: si la imagen es de hace horas
              hay que verlo al mirarla, no al buscar la letra pequeña. */}
          {vieja && (
            <div className="absolute top-3 left-3 rounded-lg bg-amber-500/90 text-slate-900 text-xs font-bold px-2 py-1">
              FOTO ANTIGUA
            </div>
          )}
        </div>
      )}

      {hayFoto && st?.captured_at && (
        <p className="text-xs text-slate-500 mt-2">
          Capturada el {new Date(st.captured_at).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
          })}
          {typeof st.bytes === 'number' && ` · ${Math.round(st.bytes / 1024)} KB`}
        </p>
      )}
    </div>
  )
}
