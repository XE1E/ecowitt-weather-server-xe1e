import { TrendArrow, getTrend } from '../TrendArrow'

// Flechita de tendencia (↑/↓/→) con el delta y la ventana de tiempo.
// `TrendArrow`/`getTrend` compartidos (docs/CONVENCIONES.md): nada de dibujar
// flechas propias -- aquí vivían iconos de Lucide, que la convención no
// admite para tendencias desde agosto de 2026. `getTrend(delta, 0, threshold)`
// reutiliza la clasificación up/down/stable sin cambiar su firma (current,
// previous): con previous=0 el delta pasado tal cual es el diff.
export function TrendBadge({ delta, unit, threshold }: {
  delta: number | null
  unit: string
  threshold: number
}) {
  if (delta == null) return null
  const trend = getTrend(delta, 0, threshold)
  const color = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-slate-400'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`} title="Cambio en las últimas 3 h">
      <TrendArrow trend={trend} size={16} />
      {sign}{delta.toFixed(1)}{unit} / 3 h
    </span>
  )
}
