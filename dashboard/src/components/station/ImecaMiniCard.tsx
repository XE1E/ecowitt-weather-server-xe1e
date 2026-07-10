import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LOCATION } from '../../config'

interface Imeca {
  available: boolean
  imeca?: number; dominant?: string; category?: string; color?: string
}

export function ImecaMiniCard() {
  const [d, setD] = useState<Imeca | null>(null)

  useEffect(() => {
    fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setD)
      .catch(() => {})
  }, [])

  if (!d || !d.available || d.imeca == null) return null

  return (
    <Link to="/pro/calidad-aire" className="card block no-underline" style={{ color: 'inherit' }}>
      <p className="card-title">IMECA <span className="text-[10px] text-slate-500 font-normal">(estimado)</span></p>
      <div className="flex items-center gap-3">
        <div
          className="w-16 h-16 rounded-full flex flex-col items-center justify-center shrink-0"
          style={{ backgroundColor: (d.color ?? '#64748b') + '22', border: `2px solid ${d.color ?? '#64748b'}` }}
        >
          <span className="text-2xl font-bold leading-none" style={{ color: d.color }}>{d.imeca}</span>
          <span className="text-[9px] text-slate-400">IMECA</span>
        </div>
        <div className="min-w-0">
          <p className="font-semibold" style={{ color: d.color }}>{d.category}</p>
          {d.dominant && <p className="text-xs text-slate-400">Principal: {d.dominant}</p>}
          <p className="text-xs text-blue-400 mt-1">Ver detalle →</p>
        </div>
      </div>
    </Link>
  )
}
