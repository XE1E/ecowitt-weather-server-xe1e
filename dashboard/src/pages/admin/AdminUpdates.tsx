import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface Commit { sha: string; message: string; date: string | null; url: string }
interface UpdatesData {
  repo: string
  current_sha: string | null
  latest: Commit | null
  behind: number | null
  commits: Commit[]
}

export function AdminUpdates() {
  const { fetchWithAuth } = useAdminAuth()
  const [data, setData] = useState<UpdatesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchWithAuth('/api/admin/updates')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [fetchWithAuth])

  if (loading) return <div className="text-slate-400">Cargando...</div>
  if (error || !data) return <div className="text-red-400">No se pudo consultar GitHub.</div>

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : ''

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Actualizaciones</h1>
        <p className="text-slate-400 text-sm">Últimos cambios publicados en GitHub</p>
      </div>

      {/* Estado */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-slate-400">Instalada: <span className="text-slate-200 font-mono">{data.current_sha || '—'}</span></span>
          <span className="text-slate-400">Última en GitHub: <span className="text-slate-200 font-mono">{data.latest?.sha || '—'}</span></span>
          {data.behind === null ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-600/40 text-slate-300">Estado desconocido</span>
          ) : data.behind === 0 ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">✓ Al día</span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">⚠ {data.behind} commit(s) atrás</span>
          )}
          <a href={`https://github.com/${data.repo}`} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 text-sm ml-auto">Ver repo →</a>
        </div>
      </div>

      {/* Commits recientes */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <p className="text-xs text-slate-500 mb-2">Cambios recientes</p>
        <div className="space-y-2">
          {data.commits.map((c) => (
            <div key={c.sha} className="flex items-start gap-3 text-sm">
              <a href={c.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 font-mono text-xs mt-0.5 whitespace-nowrap">{c.sha}</a>
              <span className="text-slate-300 flex-1">{c.message}</span>
              <span className="text-slate-500 text-xs whitespace-nowrap">{fmt(c.date)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cómo actualizar */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4 text-xs text-slate-400">
        <p className="font-medium text-slate-300 mb-1">Cómo actualizar (en el VPS)</p>
        <pre className="bg-slate-900/60 rounded p-2 overflow-x-auto text-slate-300">git pull && docker compose up -d --build --force-recreate</pre>
        <p className="mt-2">La comparación exacta de versión y la actualización desde el panel llegarán en una siguiente iteración.</p>
      </div>
    </div>
  )
}
