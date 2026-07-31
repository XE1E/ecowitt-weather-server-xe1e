export type Trend = 'up' | 'down' | 'stable'

interface TrendArrowProps {
  trend: Trend
  size?: number
}

export function TrendArrow({ trend, size = 24 }: TrendArrowProps) {
  const color = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#6b7280'

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {trend === 'up' && (
        <path d="M12 4L20 14H15V20H9V14H4L12 4Z" fill={color} />
      )}
      {trend === 'down' && (
        <path d="M12 20L20 10H15V4H9V10H4L12 20Z" fill={color} />
      )}
      {trend === 'stable' && (
        <path d="M4 10H20V14H4V10Z" fill={color} />
      )}
    </svg>
  )
}

export function getTrend(current: number | undefined | null, previous: number | null, threshold: number): Trend {
  if (current == null || previous == null) return 'stable'
  const diff = current - previous
  if (diff > threshold) return 'up'
  if (diff < -threshold) return 'down'
  return 'stable'
}
