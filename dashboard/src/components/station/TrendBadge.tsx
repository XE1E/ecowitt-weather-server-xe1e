import { ArrowUp, ArrowDown, Minus } from 'lucide-react'

// Flechita de tendencia (↑/↓/→) con el delta y la ventana de tiempo.
export function TrendBadge({ delta, unit, threshold }: {
  delta: number | null
  unit: string
  threshold: number
}) {
  if (delta == null) return null
  const up = delta > threshold
  const down = delta < -threshold
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus
  const color = up ? 'text-amber-300' : down ? 'text-sky-300' : 'text-slate-400'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`} title="Cambio en las últimas 3 h">
      <Icon className="w-3.5 h-3.5" />
      {sign}{delta.toFixed(1)}{unit} / 3 h
    </span>
  )
}
