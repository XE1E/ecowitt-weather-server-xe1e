import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface SensorDetail {
  id: string
  type: string
  category: string
  channel?: number
  label: string
  temperature?: number
  humidity?: number
  pressure?: number
  wind_speed?: number
  wind_gust?: number
  wind_direction?: number
  rain_rate?: number
  rain_daily?: number
  uv_index?: number
  solar_radiation?: number
  battery_ok: boolean
  active: boolean
}

interface Station {
  name: string | null
  label: string
  last_received: string | null
  status: 'online' | 'offline' | 'unknown'
  sensors: string[]
  sensors_detail: SensorDetail[]
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

function SensorIndicator({ sensor }: { sensor: SensorDetail }) {
  const categoryIcons: Record<string, string> = {
    exterior: '🌡️',
    interior: '🏠',
    canal: '📍',
    viento: '💨',
    lluvia: '🌧️',
    solar: '☀️',
  }

  const formatTemp = (t?: number) => t !== undefined ? `${t.toFixed(1)}°` : '--'
  const formatHum = (h?: number) => h !== undefined ? `${Math.round(h)}%` : '--'

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
      sensor.active ? 'bg-slate-700/50' : 'bg-slate-800/50 opacity-50'
    }`}>
      <span className="text-base">{categoryIcons[sensor.category] || '📡'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{sensor.label}</span>
          {sensor.type === 'WN31' && (
            <span className="text-xs text-slate-500">ch{sensor.channel}</span>
          )}
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          {sensor.temperature !== undefined && (
            <span>{formatTemp(sensor.temperature)}</span>
          )}
          {sensor.humidity !== undefined && (
            <span>{formatHum(sensor.humidity)}</span>
          )}
          {sensor.pressure !== undefined && (
            <span>{sensor.pressure.toFixed(0)} hPa</span>
          )}
          {sensor.wind_speed !== undefined && (
            <span>{sensor.wind_speed.toFixed(1)} km/h</span>
          )}
          {sensor.rain_daily !== undefined && (
            <span>{sensor.rain_daily.toFixed(1)} mm</span>
          )}
          {sensor.uv_index !== undefined && (
            <span>UV {sensor.uv_index}</span>
          )}
        </div>
      </div>
      <span title={sensor.battery_ok ? 'Batería OK' : 'Batería baja'}>
        {sensor.battery_ok ? '🔋' : '🪫'}
      </span>
    </div>
  )
}

function StationCard({ station }: { station: Station }) {
  const isPrincipal = station.name === null
  const sensors = station.sensors_detail || []

  const ws69Sensors = sensors.filter(s => s.type === 'WS69')
  const wn31Sensors = sensors.filter(s => s.type === 'WN31')
  const consoleSensor = sensors.find(s => s.type === 'console')

  const getHardwareDescription = () => {
    if (isPrincipal) {
      const parts = []
      if (ws69Sensors.length > 0) parts.push('WS69')
      if (wn31Sensors.length > 0) parts.push(`WN31 (${wn31Sensors.length} ch)`)
      return parts.length > 0 ? parts.join(' + ') : station.model || 'Sin sensores'
    }
    return station.model || 'GW1100'
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <span>{isPrincipal ? '🏠' : '📡'}</span>
            {isPrincipal ? 'Principal' : 'Remota'}
          </h3>
          <p className="text-slate-500 text-sm">{getHardwareDescription()}</p>
        </div>
        <StatusBadge status={station.status} />
      </div>

      <div className="text-sm text-slate-400 mb-4">
        Última lectura: <span className="text-slate-300">{timeAgo(station.last_received)}</span>
      </div>

      <div className="space-y-3">
        {/* Consola / Interior */}
        {consoleSensor && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
              {isPrincipal ? 'Consola' : 'Gateway'}
            </p>
            <SensorIndicator sensor={consoleSensor} />
          </div>
        )}

        {/* WS69 - Sensores exteriores */}
        {ws69Sensors.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">WS69 Exterior</p>
            <div className="space-y-1">
              {ws69Sensors.map(s => (
                <SensorIndicator key={s.id} sensor={s} />
              ))}
            </div>
          </div>
        )}

        {/* WN31 - Canales */}
        {wn31Sensors.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
              WN31 Sensores ({wn31Sensors.length})
            </p>
            <div className="space-y-1">
              {wn31Sensors.map(s => (
                <SensorIndicator key={s.id} sensor={s} />
              ))}
            </div>
          </div>
        )}

        {sensors.length === 0 && (
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

      {/* Alertas */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>🔔</span> Alertas
          <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
            adminStatus?.alerts_enabled
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-slate-500/20 text-slate-400'
          }`}>
            {adminStatus?.alerts_enabled ? 'Habilitadas' : 'Deshabilitadas'}
          </span>
          <a href="/admin/alertas" className="text-sky-400 text-sm font-normal ml-auto">
            Configurar →
          </a>
        </h2>

        {/* Alertas activas */}
        {activeAlerts.length > 0 ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
            <h3 className="font-medium text-red-400 flex items-center gap-2 mb-2">
              <span>🚨</span> Activas ahora ({activeAlerts.length})
            </h3>
            <ul className="space-y-1">
              {activeAlerts.map((a, i) => (
                <li key={i} className="text-sm text-red-300">{a.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 mb-4">
            <p className="text-emerald-400 flex items-center gap-2">
              <span>✓</span> Sin alertas activas
            </p>
          </div>
        )}

        {/* Tipos de alertas configuradas */}
        <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Monitoreando</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {[
              { key: 'temp', label: 'Temperatura', icon: '🌡️' },
              { key: 'wind', label: 'Viento', icon: '💨' },
              { key: 'rain', label: 'Lluvia', icon: '🌧️' },
              { key: 'pressure', label: 'Presión', icon: '📊' },
              { key: 'offline', label: 'Estación caída', icon: '🔌' },
              { key: 'battery', label: 'Batería baja', icon: '🔋' },
              { key: 'sensor', label: 'Sensor perdido', icon: '📡' },
              { key: 'air', label: 'Calidad del aire', icon: '🌫️' },
            ].map(alert => (
              <div
                key={alert.key}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  adminStatus?.alerts_enabled
                    ? 'bg-slate-700/50 text-slate-300'
                    : 'bg-slate-800/50 text-slate-500'
                }`}
              >
                <span>{alert.icon}</span>
                <span>{alert.label}</span>
              </div>
            ))}
          </div>
          {adminStatus?.telegram_enabled && (
            <p className="text-slate-500 text-sm mt-3 flex items-center gap-2">
              <span>💬</span> Notificaciones vía Telegram activas
            </p>
          )}
        </div>
      </section>

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
          <a href="/admin/integraciones" className="text-sky-400 text-sm font-normal ml-auto">
            Configurar →
          </a>
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
            icon="🏠"
            name="MQTT / HA"
            status="off"
            detail="No configurado"
          />
          <ServiceCard
            icon="🌡️"
            name="WAQI (AQI)"
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
