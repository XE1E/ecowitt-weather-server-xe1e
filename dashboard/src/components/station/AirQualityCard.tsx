import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LOCATION } from '../../config'

interface AQ {
  aqi: number | null
  dominant?: string
  error?: string
}

function category(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Buena', color: '#22c55e' }
  if (aqi <= 100) return { label: 'Moderada', color: '#eab308' }
  if (aqi <= 150) return { label: 'Dañina a sensibles', color: '#f97316' }
  if (aqi <= 200) return { label: 'Dañina', color: '#ef4444' }
  if (aqi <= 300) return { label: 'Muy dañina', color: '#a855f7' }
  return { label: 'Peligrosa', color: '#9f1239' }
}

export function AirQualityCard() {
  const [aq, setAq] = useState<AQ | null>(null)

  useEffect(() => {
    fetch(`/api/airquality?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setAq)
      .catch(() => {})
  }, [])

  if (!aq || aq.aqi == null) return null // sin token o sin dato: no ocupa espacio

  const cat = category(aq.aqi)
  return (
    <Link to="/pro/calidad-aire" className="card block no-underline" style={{ color: 'inherit' }}>
      <p className="card-title">Calidad del aire</p>
      <div className="flex items-center gap-3">
        <div
          className="w-16 h-16 rounded-full flex flex-col items-center justify-center shrink-0"
          style={{ backgroundColor: cat.color + '22', border: `2px solid ${cat.color}` }}
        >
          <span className="text-2xl font-bold leading-none" style={{ color: cat.color }}>{aq.aqi}</span>
          <span className="text-[9px] text-slate-400">AQI</span>
        </div>
        <div className="min-w-0">
          <p className="font-semibold" style={{ color: cat.color }}>{cat.label}</p>
          {aq.dominant && <p className="text-xs text-slate-400">Principal: {aq.dominant.toUpperCase()}</p>}
          <p className="text-xs text-blue-400 mt-1">Ver detalle →</p>
        </div>
      </div>
    </Link>
  )
}
