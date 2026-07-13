import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface Station {
  name: string | null
  label: string
  last_received: string | null
  status: 'online' | 'offline' | 'unknown'
  sensors: string[]
  model: string | null
  passkey_hint?: string
  config: {
    alerts_enabled: boolean
    publish_enabled: boolean
    mqtt_enabled: boolean
    watchdog_enabled: boolean
    watchdog_minutes: number
  }
}

interface StationsResponse {
  stations: Station[]
  count: number
}

interface AdminStatus {
  station_offline: boolean
  last_received: string | null
  active_alerts: { key: string; message: string }[]
  alerts_enabled: boolean
  telegram_enabled: boolean
  waqi_configured: boolean
  admin_enabled: boolean
}

function StatusBadge({ status }: { status: 'online' | 'offline' | 'unknown' }) {
  const colors = {
    online: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    offline: 'bg-red-500/20 text-red-400 border-red-500/30',
    unknown: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  }
  const labels = { online: 'Online', offline: 'Offline', unknown: 'Desconocido' }
  const dots = { online: '🟢', offline: '🔴', unknown: '⚪' }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border ${colors[status]}`}>
      <span>{dots[status]}</span>
      {labels[status]}
    </span>
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

function StationCard({ station }: { station: Station }) {
  const sensorGroups = {
    exterior: station.sensors.filter(s => ['exterior', 'viento', 'lluvia', 'UV', 'solar'].includes(s)),
    interior: station.sensors.filter(s => s === 'interior'),
    canales: station.sensors.filter(s => s.startsWith('WN31')),
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <span>{station.name ? '🏢' : '🏠'}</span>
            {station.label}
          </h3>
          {station.model && (
            <p className="text-slate-500 text-sm">{station.model}</p>
          )}
        </div>
        <StatusBadge status={station.status} />
      </div>

      <div className="text-sm text-slate-400 mb-4">
        Última lectura: <span className="text-slate-300">{timeAgo(station.last_received)}</span>
      </div>

      <div className="space-y-3">
        {sensorGroups.exterior.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Exterior</p>
            <div className="flex flex-wrap gap-1">
              {sensorGroups.exterior.map(s => (
                <span key={s} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded text-xs">
                  ✓ {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {sensorGroups.interior.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Interior</p>
            <span className="px-2 py-0.5 bg-sky-500/10 text-sky-400 rounded text-xs">
              ✓ interior
            </span>
          </div>
        )}

        {sensorGroups.canales.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Canales WN31</p>
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(ch => {
                const active = sensorGroups.canales.some(s => s.includes(`ch${ch}`))
                return (
                  <span
                    key={ch}
                    className={`w-8 text-center py-0.5 rounded text-xs ${
                      active
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-slate-700/50 text-slate-600'
                    }`}
                  >
                    {active ? '✓' : '—'} {ch}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {station.sensors.length === 0 && (
          <p className="text-slate-500 text-sm italic">Sin sensores detectados</p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-white/5">
        <a
          href={station.name ? `/admin/estaciones/${station.name}` : '/admin/estaciones/_principal'}
          className="text-sky-400 hover:text-sky-300 text-sm"
        >
          Configurar →
        </a>
      </div>
    </div>
  )
}

function ServiceCard({
  icon,
  name,
  status,
  detail
}: {
  icon: string
  name: string
  status: 'ok' | 'warning' | 'error' | 'off'
  detail: string
}) {
  const statusColors = {
    ok: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
    off: 'text-slate-500',
  }
  const statusIcons = {
    ok: '🟢',
    warning: '🟡',
    error: '🔴',
    off: '⚪',
  }

  return (
    <div className="bg-slate-800/30 rounded-lg p-4 border border-white/5">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <span className="font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span>{statusIcons[status]}</span>
        <span className={statusColors[status]}>{detail}</span>
      </div>
    </div>
  )
}

export function AdminDashboard() {
  const { fetchWithAuth } = useAdminAuth()
  const [stations, setStations] = useState<Station[]>([])
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [stationsRes, statusRes] = await Promise.all([
          fetch('/api/stations'),
          fetchWithAuth('/api/admin/status'),
        ])

        if (stationsRes.ok) {
          const data: StationsResponse = await stationsRes.json()
          setStations(data.stations)
        }

        if (statusRes.ok) {
          setAdminStatus(await statusRes.json())
        }
      } catch (e) {
        console.error('Error loading dashboard:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 30000) // refresh cada 30s
    return () => clearInterval(interval)
  }, [fetchWithAuth])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Cargando...</div>
      </div>
    )
  }

  const activeAlerts = adminStatus?.active_alerts || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-slate-400">Estado general del sistema</p>
      </div>

      {/* Alertas activas */}
      {activeAlerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <h2 className="font-semibold text-red-400 flex items-center gap-2 mb-2">
            <span>🚨</span> Alertas Activas
          </h2>
          <ul className="space-y-1">
            {activeAlerts.map((a, i) => (
              <li key={i} className="text-sm text-red-300">{a.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Estaciones */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>📡</span> Estaciones
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {stations.map((s, i) => (
            <StationCard key={s.name || i} station={s} />
          ))}
        </div>
      </section>

      {/* Servicios */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>🔌</span> Servicios
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ServiceCard
            icon="🗄️"
            name="InfluxDB"
            status="ok"
            detail="Conectado"
          />
          <ServiceCard
            icon="💬"
            name="Telegram"
            status={adminStatus?.telegram_enabled ? 'ok' : 'off'}
            detail={adminStatus?.telegram_enabled ? 'Activo' : 'No configurado'}
          />
          <ServiceCard
            icon="🔔"
            name="Alertas"
            status={adminStatus?.alerts_enabled ? 'ok' : 'off'}
            detail={adminStatus?.alerts_enabled ? 'Habilitadas' : 'Deshabilitadas'}
          />
          <ServiceCard
            icon="🌡️"
            name="WAQI"
            status={adminStatus?.waqi_configured ? 'ok' : 'off'}
            detail={adminStatus?.waqi_configured ? 'Configurado' : 'Sin token'}
          />
        </div>
      </section>

      {/* Publicación a redes */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>📤</span> Publicación
          <a href="/admin/publicacion" className="text-sky-400 text-sm font-normal ml-2">
            Configurar →
          </a>
        </h2>
        <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4">
          <div className="flex flex-wrap gap-4">
            {['Weather Underground', 'Windy', 'PWSWeather', 'OpenWeatherMap', 'CWOP'].map(net => (
              <div key={net} className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">⚪</span>
                <span className="text-slate-400">{net}</span>
              </div>
            ))}
          </div>
          <p className="text-slate-500 text-sm mt-3">
            Configura las redes en la sección de Publicación
          </p>
        </div>
      </section>

      {/* Info del sistema */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>⚙️</span> Sistema
        </h2>
        <div className="bg-slate-800/30 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-white/5">
              <tr>
                <td className="px-4 py-2 text-slate-500">Versión</td>
                <td className="px-4 py-2 text-slate-300">1.0.0</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-slate-500">Estaciones</td>
                <td className="px-4 py-2 text-slate-300">{stations.length}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-slate-500">Última lectura</td>
                <td className="px-4 py-2 text-slate-300">
                  {timeAgo(adminStatus?.last_received || null)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
