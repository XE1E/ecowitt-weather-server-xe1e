import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface SensorDetail {
  id: string; type: string; category: string; channel?: number; label: string
  temperature?: number; humidity?: number; pressure?: number
  wind_speed?: number; rain_daily?: number; uv_index?: number
  battery_ok: boolean; active: boolean
}

interface Station {
  name: string | null; label: string; last_received: string | null
  status: 'online' | 'offline' | 'unknown'; sensors_detail: SensorDetail[]; model: string | null
  config: { alerts_enabled: boolean; publish_enabled: boolean; mqtt_enabled: boolean }
}

interface AdminStatus {
  station_offline: boolean; last_received: string | null
  active_alerts: { key: string; message: string }[]
  alerts_enabled: boolean; telegram_enabled: boolean; waqi_configured: boolean
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Nunca'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function SensorRow({ sensor }: { sensor: SensorDetail }) {
  const icon = { exterior: '🌡️', interior: '🏠', canal: '📍', viento: '💨', lluvia: '🌧️', solar: '☀️' }[sensor.category] || '📡'
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-sm bg-slate-900/30 rounded">
      <span>{icon}</span>
      <span className="flex-1 truncate">{sensor.label}{sensor.channel ? ` (${sensor.channel})` : ''}</span>
      <span className="text-slate-400 tabular-nums">
        {sensor.temperature !== undefined && `${sensor.temperature.toFixed(1)}°`}
        {sensor.humidity !== undefined && ` ${Math.round(sensor.humidity)}%`}
        {sensor.pressure !== undefined && ` ${sensor.pressure.toFixed(0)}hPa`}
        {sensor.wind_speed !== undefined && ` ${sensor.wind_speed.toFixed(0)}km/h`}
        {sensor.rain_daily !== undefined && ` ${sensor.rain_daily.toFixed(1)}mm`}
        {sensor.uv_index !== undefined && ` UV${sensor.uv_index}`}
      </span>
      <span title={sensor.battery_ok ? 'OK' : 'Baja'} className="text-xs">{sensor.battery_ok ? '🔋' : '🪫'}</span>
    </div>
  )
}

function StationCard({ station }: { station: Station }) {
  const isPrincipal = station.name === null
  const sensors = station.sensors_detail || []
  const ws69 = sensors.filter(s => s.type === 'WS69')
  const wn31 = sensors.filter(s => s.type === 'WN31')
  const console = sensors.find(s => s.type === 'console')
  const hw = isPrincipal
    ? [ws69.length > 0 && 'WS69', wn31.length > 0 && `WN31(${wn31.length})`].filter(Boolean).join('+') || station.model
    : station.model || 'GW1100'

  return (
    <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span>{isPrincipal ? '🏠' : '📡'}</span>
          <span className="font-medium">{isPrincipal ? 'Principal' : 'Remota'}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            station.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' :
            station.status === 'offline' ? 'bg-red-500/20 text-red-400' : 'bg-slate-600 text-slate-400'
          }`}>{station.status === 'online' ? '🟢' : station.status === 'offline' ? '🔴' : '⚪'} {station.status}</span>
        </div>
        <span className="text-xs text-slate-500">{timeAgo(station.last_received)}</span>
      </div>
      <p className="text-xs text-slate-500 mb-2">{hw}</p>
      <div className="space-y-1">
        {console && <SensorRow sensor={console} />}
        {ws69.map(s => <SensorRow key={s.id} sensor={s} />)}
        {wn31.map(s => <SensorRow key={s.id} sensor={s} />)}
        {sensors.length === 0 && <p className="text-slate-500 text-xs italic">Sin sensores</p>}
      </div>
      <div className="mt-3 pt-2 border-t border-white/5">
        <a href={station.name ? `/admin/estaciones/${station.name}` : '/admin/estaciones/_principal'} className="text-sky-400 hover:text-sky-300 text-xs">
          Configurar →
        </a>
      </div>
    </div>
  )
}

function ServiceDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`text-xs ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
      {ok ? '●' : '○'} {label}
    </span>
  )
}

export function AdminDashboard() {
  const { fetchWithAuth } = useAdminAuth()
  const [stations, setStations] = useState<Station[]>([])
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [sRes, aRes] = await Promise.all([fetch('/api/stations'), fetchWithAuth('/api/admin/status')])
        if (sRes.ok) setStations((await sRes.json()).stations)
        if (aRes.ok) setStatus(await aRes.json())
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [fetchWithAuth])

  if (loading) return <div className="text-slate-400">Cargando...</div>

  const alerts = status?.active_alerts || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-slate-400 text-sm">Estado del sistema</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <ServiceDot ok={true} label="InfluxDB" />
          <ServiceDot ok={status?.telegram_enabled || false} label="Telegram" />
          <ServiceDot ok={status?.waqi_configured || false} label="WAQI" />
        </div>
      </div>

      {/* Alertas */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium flex items-center gap-2">
            <span>🔔</span> Alertas
            <span className={`text-xs px-1.5 py-0.5 rounded ${status?.alerts_enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'}`}>
              {status?.alerts_enabled ? 'ON' : 'OFF'}
            </span>
          </h2>
          <a href="/admin/alertas" className="text-sky-400 hover:text-sky-300 text-xs">Configurar →</a>
        </div>
        {alerts.length > 0 ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-sm">
            {alerts.map((a, i) => <div key={i} className="text-red-300">{a.message}</div>)}
          </div>
        ) : (
          <p className="text-emerald-400 text-sm">✓ Sin alertas activas</p>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          {['Temperatura', 'Viento', 'Lluvia', 'Presion', 'Offline', 'Bateria', 'Sensor', 'Aire'].map(t => (
            <span key={t} className={`text-xs px-2 py-0.5 rounded ${status?.alerts_enabled ? 'bg-slate-700/50 text-slate-300' : 'bg-slate-800/50 text-slate-500'}`}>{t}</span>
          ))}
        </div>
      </div>

      {/* Estaciones */}
      <div className="grid gap-4 lg:grid-cols-2">
        {stations.map((s, i) => <StationCard key={s.name || i} station={s} />)}
      </div>

      {/* Servicios y publicacion */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium flex items-center gap-2"><span>📤</span> Publicacion</h2>
            <a href="/admin/publicacion" className="text-sky-400 hover:text-sky-300 text-xs">Configurar →</a>
          </div>
          <div className="flex flex-wrap gap-3">
            {['Weather Underground', 'Windy', 'PWSWeather', 'OpenWeatherMap', 'CWOP'].map(n => (
              <span key={n} className="text-xs text-slate-500">○ {n}</span>
            ))}
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium flex items-center gap-2"><span>⚙️</span> Sistema</h2>
            <a href="/admin/sistema" className="text-sky-400 hover:text-sky-300 text-xs">Ver →</a>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><span className="text-slate-500">Version:</span> <span className="text-slate-300">1.0</span></div>
            <div><span className="text-slate-500">Estaciones:</span> <span className="text-slate-300">{stations.length}</span></div>
            <div><span className="text-slate-500">Ultima:</span> <span className="text-slate-300">{timeAgo(status?.last_received || null)}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
