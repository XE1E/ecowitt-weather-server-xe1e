import { useState, useEffect } from 'react'
import { WeatherIcon } from '../WeatherIcon'
import { ICON, iconAlerta } from '../../theme/icons'

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
    <div className="card" id="alertas">
      <p className="card-title">Alertas</p>
      {!enabled ? (
        <p className="text-sm text-slate-400">Alertas desactivadas</p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-emerald-300">Sin alertas activas ✓</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            // La clave viene namespaceada: "temp_high" (principal) o
            // "gw1100:temp_high" (secundaria). Se muestra una insignia por estación
            // y se quita el "[Remota]" del mensaje para no duplicarlo.
            const secondary = a.key.includes(':')
            const stationLabel = secondary ? a.key.split(':')[0].toUpperCase() : 'Principal'
            const msg = a.message.replace(/^\[[^\]]+\]\s*/, '')
            return (
              <div
                key={a.key}
                className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-200 flex items-start gap-2"
              >
                <span
                  className={`shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    secondary ? 'bg-violet-500/25 text-violet-200' : 'bg-sky-500/25 text-sky-200'
                  }`}
                >
                  {stationLabel}
                </span>
                {/* Icono por variable: dice DE QUE es la alerta, no solo que hay una */}
                <WeatherIcon name={iconAlerta(a.key)} size={ICON.inline} alt="" className="shrink-0" />
                <span>{msg}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
