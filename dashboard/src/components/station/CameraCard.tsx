import { useCallback, useEffect, useState } from 'react'
import { Camera, RefreshCw, AlertTriangle, Cloud, CloudRain, TrendingUp, CheckCircle2 } from 'lucide-react'
import { relativeTime } from '../../weather'

/**
 * Vista del exterior de la estación (Tapo C325WB).
 *
 * La cámara vive detrás del NAT de casa y el servidor en el VPS, así que aquí no se
 * habla con la cámara: se lee la última foto que alguien empujó a
 * `POST /api/camera/upload`. Ver `docs/archivo/PLAN-CAMARA-EXTERIOR.md`.
 *
 * Se acordó **foto periódica y no directo 24/7**: un directo serían ~1 TB/mes de
 * subida desde casa y un proceso de vídeo corriendo para siempre, y para un sitio de
 * clima la foto cada pocos minutos dice más.
 */
interface SkyAnalysis {
  cloud_type?: string
  cloud_coverage_pct?: number
  sky_condition?: string
  visibility?: string
  precipitation_visible?: boolean
  development?: string
  description?: string
  forecast_hint?: string
  analyzed_at?: string
  provider?: string
  model?: string
  error?: string
}

interface Estado {
  available?: boolean
  captured_at?: string
  age_seconds?: number
  stale?: boolean
  bytes?: number
  analysis?: SkyAnalysis
}

interface Trend {
  coverage_trend: 'increasing' | 'decreasing' | 'stable'
  coverage_delta: number
  coverage_icon: string
  development_trend: 'intensifying' | 'weakening' | 'stable'
  precip_appearing: boolean
  summary: string
  icon: string
  samples: number
  span_minutes: number
}

interface Validation {
  validated: boolean
  match?: 'exact' | 'close' | 'differ' | 'conflict'
  confidence?: number
  summary?: string
}

const SKY_CONDITION_ES: Record<string, string> = {
  clear: 'Despejado',
  partly_cloudy: 'Parcialmente nublado',
  mostly_cloudy: 'Mayormente nublado',
  overcast: 'Cubierto',
  foggy: 'Neblina',
  rainy: 'Lluvia',
  stormy: 'Tormenta',
  night: 'Noche',
  unknown: 'Desconocido',
}

const CLOUD_TYPE_ES: Record<string, string> = {
  cirrus: 'Cirros',
  cumulus: 'Cúmulos',
  stratus: 'Estratos',
  cumulonimbus: 'Cumulonimbos',
  altocumulus: 'Altocúmulos',
  stratocumulus: 'Estratocúmulos',
  nimbostratus: 'Nimboestratos',
  clear: 'Despejado',
  mixed: 'Mixto',
  unknown: 'Desconocido',
}

const VISIBILITY_ES: Record<string, string> = {
  excellent: 'Excelente',
  good: 'Buena',
  moderate: 'Moderada',
  poor: 'Pobre',
  very_poor: 'Muy pobre',
  unknown: 'Desconocida',
}

/** Cada cuánto se pregunta si hay foto nueva. La cadencia acordada es de 5-10 min. */
const SONDEO_MS = 60_000

export function CameraCard({ ocultarSiVacia = false }: {
  /**
   * En INICIO la tarjeta desaparece mientras no haya foto, en vez de dejar un hueco
   * con "sin imagen" ocupando sitio para siempre --hoy, con la cámara sin instalar,
   * ése sería el estado permanente--. Cuando empiecen a llegar capturas aparece
   * sola. En su página propia NO se oculta: allí el hueco explicado es la respuesta
   * a "¿y la cámara?".
   */
  ocultarSiVacia?: boolean
} = {}) {
  const [st, setSt] = useState<Estado | null>(null)
  const [cargando, setCargando] = useState(true)
  const [falloRed, setFalloRed] = useState(false)
  const [imgCargando, setImgCargando] = useState(true)

  // Tendencia (nowcasting) y validación vs pronóstico: viven en `/api/camera/analysis`
  // y `/api/camera/analysis/validation` -- ninguno de los dos va en `/api/camera/status`,
  // así que van en peticiones aparte, igual que hace `SkyAnalysisCard` en Inicio.
  const [tendencia, setTendencia] = useState<Trend | null>(null)
  const [validacion, setValidacion] = useState<Validation | null>(null)

  const consultar = useCallback(() => {
    fetch('/api/camera/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { setSt(j); setFalloRed(j == null) })
      .catch(() => setFalloRed(true))
      .finally(() => setCargando(false))

    fetch('/api/camera/analysis')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTendencia(j?.trend ?? null))
      .catch(() => setTendencia(null))

    fetch('/api/camera/analysis/validation')
      .then((r) => (r.ok ? r.json() : null))
      .then(setValidacion)
      .catch(() => setValidacion(null))
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

  // Se espera a la primera respuesta antes de decidir: ocultarla mientras carga y
  // sacarla después haría saltar el layout en cada visita.
  if (ocultarSiVacia && !cargando && !hayFoto) return null

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
            title="Comprobar si ya hay una foto más reciente (no dispara la cámara)"
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

      {/* Análisis del cielo con IA */}
      {hayFoto && st?.analysis && !st.analysis.error && (
        <div className="mt-4 p-4 rounded-xl bg-white/[0.03] border border-white/10">
          <p className="text-base font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Cloud className="w-5 h-5 text-sky-400" />
            Análisis del cielo
          </p>

          {/* Descripción principal: es el texto protagonista */}
          {st.analysis.description && (
            <p className="text-lg text-slate-100 mb-3 leading-relaxed">
              {st.analysis.description}
            </p>
          )}

          {/* Grid de métricas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="text-center p-2.5 rounded-lg bg-white/[0.03]">
              <p className="text-sm text-slate-500 mb-1">Condición</p>
              <p className="text-base font-semibold text-slate-100">
                {SKY_CONDITION_ES[st.analysis.sky_condition || ''] || st.analysis.sky_condition}
              </p>
            </div>
            <div className="text-center p-2.5 rounded-lg bg-white/[0.03]">
              <p className="text-sm text-slate-500 mb-1">Nubes</p>
              <p className="text-base font-semibold text-slate-100">
                {CLOUD_TYPE_ES[st.analysis.cloud_type || ''] || st.analysis.cloud_type}
              </p>
            </div>
            <div className="text-center p-2.5 rounded-lg bg-white/[0.03]">
              <p className="text-sm text-slate-500 mb-1">Cobertura</p>
              <p className="text-base font-semibold text-slate-100">
                {st.analysis.cloud_coverage_pct ?? '—'}%
              </p>
            </div>
            <div className="text-center p-2.5 rounded-lg bg-white/[0.03]">
              <p className="text-sm text-slate-500 mb-1">Visibilidad</p>
              <p className="text-base font-semibold text-slate-100">
                {VISIBILITY_ES[st.analysis.visibility || ''] || st.analysis.visibility}
              </p>
            </div>
          </div>

          {/* Pronóstico */}
          {st.analysis.forecast_hint && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20">
              <TrendingUp className="w-5 h-5 text-sky-400 mt-0.5 flex-shrink-0" />
              <p className="text-base text-sky-200 leading-relaxed">
                {st.analysis.forecast_hint}
              </p>
            </div>
          )}

          {/* Precipitación visible */}
          {st.analysis.precipitation_visible && (
            <div className="flex items-center gap-2 mt-2 text-amber-400 text-base">
              <CloudRain className="w-5 h-5" />
              Precipitación visible en el horizonte
            </div>
          )}

          {/* Tendencia (nowcasting): ¿la cobertura de nubes sube o baja en los
              últimos minutos? Antes sólo vivía en "Estado del cielo" (Inicio). */}
          {tendencia && (
            <div className="mt-3 p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{tendencia.icon}</span>
                <span className="text-base font-medium text-violet-200">{tendencia.summary}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-400">
                <span>Cobertura: {tendencia.coverage_icon} {tendencia.coverage_delta > 0 ? '+' : ''}{tendencia.coverage_delta}%</span>
                {tendencia.span_minutes > 0 && <span>· últimos {tendencia.span_minutes} min</span>}
              </div>
            </div>
          )}

          {/* Validación: ¿lo que ve la cámara coincide con lo que dicen los modelos
              de pronóstico ahora mismo? Antes sólo vivía en "Estado del cielo" (Inicio). */}
          {validacion?.validated && (
            <div className={`mt-3 p-2.5 rounded-lg border flex items-center gap-2 ${
              validacion.match === 'exact' || validacion.match === 'close'
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : validacion.match === 'conflict'
                ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-slate-500/10 border-slate-500/20'
            }`}>
              <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${
                validacion.match === 'exact' || validacion.match === 'close'
                  ? 'text-emerald-400'
                  : validacion.match === 'conflict'
                  ? 'text-amber-400'
                  : 'text-slate-400'
              }`} />
              <div>
                <p className="text-base">{validacion.summary}</p>
                <p className="text-sm text-slate-500">
                  Confianza: {Math.round((validacion.confidence || 0) * 100)}%
                </p>
              </div>
            </div>
          )}

          {/* Pie: proveedor y hora */}
          <p className="text-sm text-slate-600 mt-3">
            Analizado por {st.analysis.provider === 'gemini' ? 'Gemini' : 'Claude'}
            {st.analysis.analyzed_at && ` · ${relativeTime(st.analysis.analyzed_at)}`}
          </p>
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
