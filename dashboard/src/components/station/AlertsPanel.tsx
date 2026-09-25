import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { WeatherIcon } from '../WeatherIcon'
import { ICON, iconAlerta } from '../../theme/icons'
import { trackEvent } from '../../analytics'
import { useSharedFetch } from '../../hooks/useSharedFetch'
import type { Alert } from '../../api-types'

interface HistoryEntry {
  key: string
  message: string
  timestamp: string
  resolved_at?: string
}

// La clave viene namespaceada: "temp_high" (principal) o "gw1100:temp_high"
// (secundaria). Se comparte entre activas e historial: mismo namespacing.
function stationBadge(key: string): { secondary: boolean; label: string } {
  const secondary = key.includes(':')
  return { secondary, label: secondary ? key.split(':')[0].toUpperCase() : 'Principal' }
}
const stripTag = (msg: string) => msg.replace(/^\[[^\]]+\]\s*/, '')

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hhmm = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (sameDay) return hhmm
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} ${hhmm}`
}

function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-400 pt-1">Sin alertas en las últimas 24 h.</p>
  }
  return (
    <div className="space-y-1.5 pt-1">
      {entries.map((e, i) => {
        const { secondary, label } = stationBadge(e.key)
        const msg = stripTag(e.message)
        return (
          <div key={`${e.key}-${e.timestamp}-${i}`} className="flex items-start gap-2 text-sm text-slate-300">
            <span className="shrink-0 w-12 pt-0.5 text-[11px] tabular-nums text-slate-500">{fmtWhen(e.timestamp)}</span>
            <span
              className={`shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                secondary ? 'bg-violet-500/25 text-violet-200' : 'bg-sky-500/25 text-sky-200'
              }`}
            >
              {label}
            </span>
            <WeatherIcon name={iconAlerta(e.key)} size={ICON.inline} alt="" className="shrink-0 mt-0.5" />
            <span className="flex-1">
              {msg}
              {e.resolved_at ? (
                <span className="text-emerald-400"> · normalizada {fmtWhen(e.resolved_at)}</span>
              ) : (
                <span className="text-red-300"> · activa</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function AlertsPanel() {
  // Compartida con AlertBanner (misma URL, una sola consulta por minuto).
  const resp = useSharedFetch<{ active?: Alert[]; enabled?: boolean }>('/api/alerts', 60000)
  const alerts = resp?.active ?? []
  const enabled = resp?.enabled ?? true
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)

  // El historial se carga solo al abrirlo (no en cada render de la página) y
  // se conserva mientras el panel siga montado -- no hace falta refrescarlo
  // cada minuto como las activas, es un vistazo hacia atrás.
  useEffect(() => {
    if (!showHistory || history !== null) return
    fetch('/api/alerts/history?hours=24&limit=20')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setHistory(j?.history ?? []))
      .catch(() => setHistory([]))
  }, [showHistory, history])

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
            const { secondary, label } = stationBadge(a.key)
            const msg = stripTag(a.message)
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
                  {label}
                </span>
                {/* Icono por variable: dice DE QUE es la alerta, no solo que hay una */}
                <WeatherIcon name={iconAlerta(a.key)} size={ICON.inline} alt="" className="shrink-0" />
                <span>{msg}</span>
              </div>
            )
          })}
        </div>
      )}

      {enabled && (
        <>
          <button
            onClick={() => setShowHistory((v) => {
              if (!v) trackEvent('alert_history_open')
              return !v
            })}
            className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Historial reciente
          </button>
          {showHistory && (
            history === null
              ? <p className="text-sm text-slate-400 pt-1">Cargando…</p>
              : <HistoryList entries={history} />
          )}
        </>
      )}
    </div>
  )
}
