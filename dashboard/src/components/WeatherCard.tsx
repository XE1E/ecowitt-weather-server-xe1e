import { ReactNode } from 'react'

interface WeatherCardProps {
  title: string
  value: number | undefined
  unit: string
  icon: ReactNode
  color?: string
  subtitle?: string
}

export function WeatherCard({
  title,
  value,
  unit,
  icon,
  color = 'text-white',
  subtitle
}: WeatherCardProps) {
  return (
    <div className="card">
      <p className="card-title flex items-center gap-2">
        {icon}
        {title}
      </p>
      <p className={`card-value ${color}`}>
        {value?.toFixed(1) ?? '--'}
        <span className="card-unit">{unit}</span>
      </p>
      {subtitle && (
        <p className="text-slate-400 text-sm mt-2">{subtitle}</p>
      )}
    </div>
  )
}
