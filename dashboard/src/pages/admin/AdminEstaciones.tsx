import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface Station {
  name: string | null
  label: string
  last_received: string | null
  status: 'online' | 'offline' | 'unknown'
  sensors: string[]
  model: string | null
  passkey_hint?: string
}

function timeAgo(isoString: string | null): string {
  if (!isoString) return 'Nunca'
  const diff = Date.now() - new Date(isoString).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `hace ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

export function AdminEstaciones() {
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/stations')
      .then(r => r.json())
      .then(data => setStations(data.stations))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-slate-400">Cargando...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Estaciones</h1>
          <p className="text-slate-400">Gestión de estaciones meteorológicas</p>
        </div>
        <button className="bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg text-sm font-medium">
          + Agregar estación
        </button>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 text-left text-sm text-slate-400">
              <th className="px-4 py-3 font-medium">Estación</th>
              <th className="px-4 py-3 font-medium">Modelo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Última lectura</th>
              <th className="px-4 py-3 font-medium">Sensores</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {stations.map((s, i) => (
              <tr key={s.name || i} className="hover:bg-white/5">
                <td className="px-4 py-3">
                  <div className="font-medium">{s.label}</div>
                  {s.passkey_hint && (
                    <div className="text-xs text-slate-500">Passkey: {s.passkey_hint}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400">{s.model || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 text-sm ${
                    s.status === 'online' ? 'text-emerald-400' :
                    s.status === 'offline' ? 'text-red-400' : 'text-slate-400'
                  }`}>
                    {s.status === 'online' ? '🟢' : s.status === 'offline' ? '🔴' : '⚪'}
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">{timeAgo(s.last_received)}</td>
                <td className="px-4 py-3 text-slate-400">{s.sensors.length}</td>
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/estaciones/${s.name || '_principal'}`}
                    className="text-sky-400 hover:text-sky-300 text-sm"
                  >
                    Configurar
                  </Link>
                  {s.name && (
                    <button className="text-red-400 hover:text-red-300 text-sm ml-3">
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
