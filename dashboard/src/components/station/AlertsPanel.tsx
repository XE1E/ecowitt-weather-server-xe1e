import { useState, useEffect } from 'react'

interface Alert {
  key: string
  message: string
}

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    const load = () =>
      fetch('/api/alerts')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j) {
            setAlerts(j.active ?? [])
            setEnabled(j.enabled)
          }
        })
        .catch(() => {})
    load()
    const i = setInterval(load, 60000)
    return () => clearInterval(i)
  }, [])

  return (
    <div className="card">
      <p className="card-title">Alertas</p>
      {!enabled ? (
        <p className="text-sm text-slate-400">Alertas desactivadas</p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-emerald-300">Sin alertas activas ✓</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div
              key={a.key}
              className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-200"
            >
              {a.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
