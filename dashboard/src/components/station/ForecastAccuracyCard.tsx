import { useEffect, useState } from 'react'
import { Target } from 'lucide-react'

/**
 * Qué tan seguido coincidió la cámara con el pronóstico (Open-Meteo), en los
 * últimos N días. Se arma sobre `match` guardado por captura en el histórico
 * diario (ver `CameraStore.save_analysis` / `get_accuracy_stats` en el
 * receiver) -- no recalcula nada, sólo tabula lo ya persistido.
 *
 * Se oculta mientras no haya comparaciones guardadas: recién se activó esta
 * persistencia, así que los primeros días no hay nada que mostrar todavía.
 */

interface AccuracyStats {
  days_requested: number
  days_with_data: number
  total: number
  counts: { exact: number; close: number; differ: number; conflict: number }
  pct: { exact: number; close: number; differ: number; conflict: number }
}

const MATCH_INFO: Record<keyof AccuracyStats['counts'], { label: string; color: string }> = {
  exact: { label: 'Coincide', color: 'bg-emerald-500' },
  close: { label: 'Parecido', color: 'bg-emerald-300' },
  differ: { label: 'Difiere', color: 'bg-slate-400' },
  conflict: { label: 'Contradice', color: 'bg-amber-500' },
}

const ORDEN: (keyof AccuracyStats['counts'])[] = ['exact', 'close', 'differ', 'conflict']

const DIAS = 30

export function ForecastAccuracyCard() {
  const [stats, setStats] = useState<AccuracyStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/camera/analysis/accuracy?days=${DIAS}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  if (!stats || stats.total === 0) return null

  const buenas = Math.round(stats.pct.exact + stats.pct.close)

  return (
    <div className="card mt-4">
      <p className="card-title mb-3 flex items-center gap-2">
        <Target className="w-5 h-5 text-violet-400" />
        Precisión del pronóstico
      </p>

      <p className="text-base text-slate-100 mb-3 leading-relaxed">
        La cámara coincidió o fue parecida al pronóstico el <span className="font-semibold">{buenas}%</span> de
        las veces en los últimos {stats.days_requested} días.
      </p>

      <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-white/[0.03]">
        {ORDEN.map((k) => stats.pct[k] > 0 && (
          <div key={k} className={MATCH_INFO[k].color} style={{ width: `${stats.pct[k]}%` }} />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {ORDEN.map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`w-2.5 h-2.5 rounded-sm ${MATCH_INFO[k].color}`} />
            {MATCH_INFO[k].label}: {stats.counts[k]}
          </span>
        ))}
      </div>

      <p className="text-xs text-slate-600 mt-3">
        {stats.total} comparaciones en {stats.days_with_data} de los últimos {stats.days_requested} días.
      </p>
    </div>
  )
}
