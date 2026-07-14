import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAdminAuth } from '../../admin-auth'

interface Station {
  name: string | null
  label: string
  last_received: string | null
  status: 'online' | 'offline' | 'unknown'
  sensors: string[]
  model: string | null
  passkey_hint?: string
}

function AddStationModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { fetchWithAuth } = useAdminAuth()
  const [name, setName] = useState('')
  const [passkey, setPasskey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('El nombre es requerido')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetchWithAuth('/api/admin/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), passkey: passkey.trim() || null }),
      })
      if (res.ok) {
        onAdded()
        onClose()
      } else {
        const data = await res.json()
        setError(data.detail || 'Error al crear estación')
      }
    } catch {
      setError('Error de conexión')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl border border-white/10 p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">Agregar estación secundaria</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Nombre identificador *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ej: oficina, terraza, gw1100"
              className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-2 text-white focus:outline-none focus:border-sky-500/50"
              autoFocus
            />
            <p className="text-xs text-slate-500 mt-1">Nombre único sin espacios (se usa en la URL)</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Passkey (opcional)</label>
            <input
              type="text"
              value={passkey}
              onChange={e => setPasskey(e.target.value)}
              placeholder="Se detecta automáticamente si no se especifica"
              className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-2 text-white focus:outline-none focus:border-sky-500/50"
            />
            <p className="text-xs text-slate-500 mt-1">Si lo dejas vacío, el servidor lo detectará cuando la estación envíe datos</p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-2 rounded-lg font-medium"
            >
              {saving ? 'Creando...' : 'Crear estación'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ station, onClose, onDeleted }: { station: Station; onClose: () => void; onDeleted: () => void }) {
  const { fetchWithAuth } = useAdminAuth()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    if (!station.name) return
    setDeleting(true)
    try {
      const res = await fetchWithAuth(`/api/admin/stations/${station.name}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted()
        onClose()
      } else {
        const data = await res.json()
        setError(data.detail || 'Error al eliminar')
      }
    } catch {
      setError('Error de conexión')
    }
    setDeleting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl border border-white/10 p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-2">Eliminar estación</h2>
        <p className="text-slate-400 mb-4">
          ¿Estás seguro de eliminar <strong className="text-white">{station.label}</strong>?
          Esta acción no eliminará los datos históricos en InfluxDB.
        </p>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-500 disabled:bg-slate-700 px-4 py-2 rounded-lg font-medium"
          >
            {deleting ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteStation, setDeleteStation] = useState<Station | null>(null)

  const loadStations = () => {
    fetch('/api/stations')
      .then(r => r.json())
      .then(data => setStations(data.stations))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadStations() }, [])

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
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg text-sm font-medium"
        >
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
                  <div className="font-medium flex items-center gap-2">
                    <span>{s.name === null ? '🏠' : '📡'}</span>
                    {s.label}
                  </div>
                  {s.passkey_hint && (
                    <div className="text-xs text-slate-500 ml-6">Passkey: {s.passkey_hint}</div>
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
                    <button
                      onClick={() => setDeleteStation(s)}
                      className="text-red-400 hover:text-red-300 text-sm ml-3"
                    >
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <AddStationModal onClose={() => setShowAddModal(false)} onAdded={loadStations} />
      )}
      {deleteStation && (
        <DeleteConfirmModal station={deleteStation} onClose={() => setDeleteStation(null)} onDeleted={loadStations} />
      )}
    </div>
  )
}
