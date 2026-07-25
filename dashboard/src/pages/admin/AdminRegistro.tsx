import { useState, useEffect, useCallback } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface Registry {
  whitelist_active: boolean
  primary: { has_passkey: boolean; passkey_masked: string }
  secondaries: { name: string; passkey_masked: string }[]
}

const MAC_HINT = 'MAC del equipo (etiqueta), p. ej. 8C:4F:00:4F:8B:63 — con o sin «:». El servidor deriva la passkey.'

export function AdminRegistro() {
  const { fetchWithAuth } = useAdminAuth()
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [loading, setLoading] = useState(true)

  // Principal
  const [primaryMac, setPrimaryMac] = useState('')
  const [savingPrimary, setSavingPrimary] = useState(false)
  const [primaryMsg, setPrimaryMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // Nueva secundaria
  const [newName, setNewName] = useState('')
  const [newMac, setNewMac] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // Borrado
  const [listMsg, setListMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const loadRegistry = useCallback(async () => {
    const r = await fetchWithAuth('/api/admin/registry')
    const data = await r.json()
    setRegistry(data)
  }, [fetchWithAuth])

  useEffect(() => {
    loadRegistry().finally(() => setLoading(false))
  }, [loadRegistry])

  const savePrimary = async (mac: string) => {
    setSavingPrimary(true)
    setPrimaryMsg(null)
    try {
      const res = await fetchWithAuth('/api/admin/registry/primary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac }),
      })
      if (res.ok) {
        setPrimaryMac('')
        setPrimaryMsg({ type: 'ok', text: mac ? 'Passkey principal actualizada' : 'Whitelist desactivada' })
        await loadRegistry()
        setTimeout(() => setPrimaryMsg(null), 2500)
      } else {
        const data = await res.json().catch(() => ({}))
        setPrimaryMsg({ type: 'error', text: data.detail || 'Error al guardar' })
      }
    } catch {
      setPrimaryMsg({ type: 'error', text: 'Error de conexión' })
    } finally {
      setSavingPrimary(false)
    }
  }

  const handleSavePrimary = () => {
    if (!primaryMac.trim()) {
      setPrimaryMsg({ type: 'error', text: 'Ingresa una MAC (o usa «Desactivar whitelist»)' })
      return
    }
    savePrimary(primaryMac.trim())
  }

  const handleDisableWhitelist = () => {
    if (!window.confirm('¿Desactivar la whitelist? El servidor aceptará pushes de cualquier passkey y la primera desconocida se tratará como estación principal.')) return
    savePrimary('')
  }

  const handleAddSecondary = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || !newMac.trim()) {
      setAddMsg({ type: 'error', text: 'Nombre y MAC son requeridos' })
      return
    }
    setAdding(true)
    setAddMsg(null)
    try {
      const res = await fetchWithAuth('/api/admin/registry/secondary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), mac: newMac.trim() }),
      })
      if (res.ok) {
        setNewName('')
        setNewMac('')
        setAddMsg({ type: 'ok', text: 'Estación agregada' })
        await loadRegistry()
        setTimeout(() => setAddMsg(null), 2500)
      } else {
        const data = await res.json().catch(() => ({}))
        setAddMsg({ type: 'error', text: data.detail || 'Error al agregar' })
      }
    } catch {
      setAddMsg({ type: 'error', text: 'Error de conexión' })
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteSecondary = async (name: string) => {
    if (!window.confirm(`¿Quitar la estación «${name}» del registro? Sus pushes dejarán de aceptarse.`)) return
    setListMsg(null)
    try {
      const res = await fetchWithAuth(`/api/admin/registry/secondary/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await loadRegistry()
      } else {
        const data = await res.json().catch(() => ({}))
        setListMsg({ type: 'error', text: data.detail || 'Error al quitar' })
      }
    } catch {
      setListMsg({ type: 'error', text: 'Error de conexión' })
    }
  }

  if (loading || !registry) return <div className="text-slate-400">Cargando...</div>

  const active = registry.whitelist_active

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Registro de estaciones</h1>
        <p className="text-slate-400 text-sm">
          Solo se aceptan pushes de estaciones registradas. El registro se gestiona por MAC (etiqueta del equipo); el servidor deriva la passkey.
        </p>
      </div>

      {/* Estado de la whitelist */}
      <div className={`rounded-xl border p-4 flex items-center gap-3 ${
        active ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
      }`}>
        <span className="text-lg">{active ? '🟢' : '⚠️'}</span>
        {active ? (
          <div>
            <p className="text-sm font-medium text-emerald-400">Whitelist activa</p>
            <p className="text-xs text-slate-400">Solo se aceptan las passkeys registradas (principal + secundarias). Passkeys desconocidas se rechazan.</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-amber-400">Whitelist inactiva</p>
            <p className="text-xs text-slate-400">No hay passkey principal configurada. Cualquier estación desconocida sería tratada como principal.</p>
          </div>
        )}
      </div>

      {/* Principal */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Estación principal</h2>
          <span className="text-sm text-slate-400">
            {registry.primary.has_passkey
              ? <>Passkey: <span className="font-mono text-slate-300">{registry.primary.passkey_masked}</span></>
              : <span className="text-amber-400">no configurado</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm text-slate-400 mb-1">MAC del equipo</label>
            <input
              type="text"
              value={primaryMac}
              onChange={e => setPrimaryMac(e.target.value)}
              placeholder="8C:4F:00:4F:8B:63"
              className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-sky-500/50"
            />
          </div>
          <button
            onClick={handleSavePrimary}
            disabled={savingPrimary}
            className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            {savingPrimary ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">{MAC_HINT}</p>
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-3">
          <button
            onClick={handleDisableWhitelist}
            disabled={savingPrimary || !registry.primary.has_passkey}
            className="text-sm text-red-400 hover:text-red-300 disabled:text-slate-600 disabled:cursor-not-allowed"
          >
            Desactivar whitelist
          </button>
          <span className="text-xs text-slate-500">Borra la passkey principal y deja de filtrar por registro.</span>
          {primaryMsg && (
            <span className={`text-sm ml-auto ${primaryMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{primaryMsg.text}</span>
          )}
        </div>
      </div>

      {/* Secundarias */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Estaciones secundarias</h2>
          {listMsg && (
            <span className={`text-sm ${listMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{listMsg.text}</span>
          )}
        </div>

        {registry.secondaries.length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">No hay estaciones secundarias registradas.</p>
        ) : (
          <ul className="divide-y divide-white/5 mb-4">
            {registry.secondaries.map(s => (
              <li key={s.name} className="flex items-center gap-3 py-2">
                <span>📡</span>
                <span className="font-medium text-sm">{s.name}</span>
                <span className="text-sm text-slate-400 font-mono">{s.passkey_masked}</span>
                <button
                  onClick={() => handleDeleteSecondary(s.name)}
                  className="ml-auto text-sm text-red-400 hover:text-red-300"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Agregar */}
        <form onSubmit={handleAddSecondary} className="pt-3 border-t border-white/10">
          <h3 className="text-sm font-medium mb-2">Agregar estación</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px]">
              <label className="block text-sm text-slate-400 mb-1">Nombre</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="oficina, terraza…"
                className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div className="flex-1 min-w-[220px]">
              <label className="block text-sm text-slate-400 mb-1">MAC del equipo</label>
              <input
                type="text"
                value={newMac}
                onChange={e => setNewMac(e.target.value)}
                placeholder="8C:4F:00:4F:8B:63"
                className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <button
              type="submit"
              disabled={adding}
              className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium"
            >
              {adding ? 'Agregando...' : 'Agregar'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">{MAC_HINT}</p>
          {addMsg && (
            <p className={`text-sm mt-2 ${addMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{addMsg.text}</p>
          )}
        </form>
      </div>
    </div>
  )
}
