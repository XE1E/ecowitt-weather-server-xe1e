import { ReactNode } from 'react'
import { WeatherIcon } from './WeatherIcon'

interface WeatherCardProps {
  title: string
  value: number | undefined
  unit: string
  /** Meteocons icon name (preferred) */
  iconName?: string
  /** Fallback custom icon node */
  icon?: ReactNode
  color?: string
  subtitle?: string
  offline?: boolean
}

export function WeatherCard({
  title,
  value,
  unit,
  iconName,
  icon,
  color = 'text-white',
  subtitle,
  offline = false,
}: WeatherCardProps) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <p className="card-title">
          {iconName ? <WeatherIcon name={iconName} size={22} /> : icon}
          {title}
        </p>
        {offline && <span className="badge badge-offline">offline</span>}
      </div>
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
