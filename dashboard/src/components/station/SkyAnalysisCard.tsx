import { useCallback, useEffect, useState } from 'react'
import { Cloud, Eye, CloudRain, TrendingUp, Sparkles, CheckCircle2 } from 'lucide-react'
import { relativeTime } from '../../weather'

/**
 * Análisis del cielo con IA.
 *
 * Muestra el análisis visual de la última foto de la cámara: tipo de nubes,
 * cobertura, visibilidad, y pronóstico a corto plazo basado en lo que se ve.
 * Se oculta automáticamente si no hay análisis disponible.
 */

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
  icon?: string
  explanation?: string
  reason?: string
}

interface Analysis {
  available: boolean
  enabled?: boolean
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
  error?: string
  trend?: Trend | null
}

const SKY_CONDITION_ES: Record<string, string> = {
  clear: 'Despejado',
  partly_cloudy: 'Parc. nublado',
  mostly_cloudy: 'May. nublado',
  overcast: 'Cubierto',
  foggy: 'Neblina',
  rainy: 'Lluvia',
  stormy: 'Tormenta',
  night: 'Noche',
}

const SKY_CONDITION_ICON: Record<string, string> = {
  clear: '☀️',
  partly_cloudy: '⛅',
  mostly_cloudy: '🌥️',
  overcast: '☁️',
  foggy: '🌫️',
  rainy: '🌧️',
  stormy: '⛈️',
  night: '🌙',
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
}

const VISIBILITY_ES: Record<string, string> = {
  excellent: 'Excelente',
  good: 'Buena',
  moderate: 'Moderada',
  poor: 'Pobre',
  very_poor: 'Muy pobre',
}

const DEVELOPMENT_ES: Record<string, string> = {
  building: 'En desarrollo',
  stable: 'Estable',
  dissipating: 'Disipándose',
}

const POLL_MS = 60_000

export function SkyAnalysisCard() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch_ = useCallback(() => {
    fetch('/api/camera/analysis')
      .then(r => r.ok ? r.json() : null)
      .then(setAnalysis)
      .catch(() => setAnalysis(null))
      .finally(() => setLoading(false))

    // Obtener validación por separado (no bloquea)
    fetch('/api/camera/analysis/validation')
      .then(r => r.ok ? r.json() : null)
      .then(setValidation)
      .catch(() => setValidation(null))
  }, [])

  useEffect(() => {
    fetch_()
    const i = setInterval(fetch_, POLL_MS)
    return () => clearInterval(i)
  }, [fetch_])

  // No mostrar si está cargando, no hay análisis, o hubo error
  if (loading) return null
  if (!analysis?.available || analysis.error) return null

  const icon = SKY_CONDITION_ICON[analysis.sky_condition || ''] || '🌤️'
  const condicion = SKY_CONDITION_ES[analysis.sky_condition || ''] || analysis.sky_condition
  const nubes = CLOUD_TYPE_ES[analysis.cloud_type || ''] || analysis.cloud_type
  const visibilidad = VISIBILITY_ES[analysis.visibility || ''] || analysis.visibility
  const desarrollo = DEVELOPMENT_ES[analysis.development || '']

  return (
    <div className="card">
      <p className="card-title flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-violet-400" />
        Estado del cielo
        <span className="text-lg ml-1">{icon}</span>
      </p>

      {/* Descripción principal */}
      {analysis.description && (
        <p className="text-sm text-slate-300 mb-3 leading-relaxed">
          {analysis.description}
        </p>
      )}

      {/* Grid de datos */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-white/[0.03] rounded-lg p-2">
          <p className="text-xs text-slate-500">Condición</p>
          <p className="text-sm font-medium text-slate-200">{condicion}</p>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2">
          <p className="text-xs text-slate-500">Cobertura</p>
          <p className="text-sm font-medium text-slate-200">{analysis.cloud_coverage_pct ?? '—'}%</p>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2">
          <p className="text-xs text-slate-500">Nubes</p>
          <p className="text-sm font-medium text-slate-200">{nubes}</p>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2">
          <p className="text-xs text-slate-500">Visibilidad</p>
          <p className="text-sm font-medium text-slate-200">{visibilidad}</p>
        </div>
      </div>

      {/* Desarrollo de nubes si aplica */}
      {desarrollo && analysis.development !== 'unknown' && (
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
          <Cloud className="w-3.5 h-3.5" />
          Nubes: {desarrollo.toLowerCase()}
        </div>
      )}

      {/* Precipitación visible */}
      {analysis.precipitation_visible && (
        <div className="flex items-center gap-2 text-sm text-amber-400 mb-2">
          <CloudRain className="w-4 h-4" />
          Precipitación visible en el horizonte
        </div>
      )}

      {/* Pronóstico a corto plazo */}
      {analysis.forecast_hint && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <TrendingUp className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-sky-200">{analysis.forecast_hint}</p>
        </div>
      )}

      {/* Tendencia (Nowcasting) */}
      {analysis.trend && (
        <div className="mt-3 p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{analysis.trend.icon}</span>
            <span className="text-sm font-medium text-violet-200">{analysis.trend.summary}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>Cobertura: {analysis.trend.coverage_icon} {analysis.trend.coverage_delta > 0 ? '+' : ''}{analysis.trend.coverage_delta}%</span>
            {analysis.trend.span_minutes > 0 && (
              <span>· últimos {analysis.trend.span_minutes} min</span>
            )}
          </div>
        </div>
      )}

      {/* Validación vs pronóstico */}
      {validation?.validated && (
        <div className={`mt-3 p-2 rounded-lg border flex items-center gap-2 ${
          validation.match === 'exact' || validation.match === 'close'
            ? 'bg-emerald-500/10 border-emerald-500/20'
            : validation.match === 'conflict'
            ? 'bg-amber-500/10 border-amber-500/20'
            : 'bg-slate-500/10 border-slate-500/20'
        }`}>
          <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${
            validation.match === 'exact' || validation.match === 'close'
              ? 'text-emerald-400'
              : validation.match === 'conflict'
              ? 'text-amber-400'
              : 'text-slate-400'
          }`} />
          <div>
            <p className="text-sm">{validation.summary}</p>
            <p className="text-xs text-slate-500">
              Confianza: {Math.round((validation.confidence || 0) * 100)}%
            </p>
          </div>
        </div>
      )}

      {/* Pie */}
      <p className="text-xs text-slate-600 mt-3 flex items-center gap-1">
        <Eye className="w-3 h-3" />
        Analizado por {analysis.provider === 'gemini' ? 'Gemini' : 'Claude'}
        {analysis.analyzed_at && ` · ${relativeTime(analysis.analyzed_at)}`}
      </p>
    </div>
  )
}
