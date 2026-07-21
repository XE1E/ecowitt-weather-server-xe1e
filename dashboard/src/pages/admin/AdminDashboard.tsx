import { useState, useEffect, useCallback } from 'react'
import { useAdminAuth } from '../../admin-auth'
import { parseServerDate } from '../../weather'
import { BatteryIcon, statusLabel, statusDot } from '../../components/admin-ui'

interface SensorDetail {
  id: string; type: string; category: string; channel?: number; label: string
  temperature?: number; humidity?: number; pressure?: number
  wind_speed?: number; rain_daily?: number; uv_index?: number
  battery_ok: boolean; active: boolean
}

interface Station {
  name: string | null; label: string; last_received: string | null
  status: 'online' | 'offline' | 'unknown'; sensors_detail: SensorDetail[]; model: string | null
}

interface AlertHistoryItem {
  key: string
  message: string
  timestamp: string
  resolved_at?: string
}

interface PublicationStatus {
  wu: boolean
  windy: boolean
  pws: boolean
  owm: boolean
  cwop: boolean
}

interface AdminStatus {
  last_received: string | null
  active_alerts: { key: string; message: string }[]
  alert_history: AlertHistoryItem[]
  alerts_enabled: boolean
  telegram_enabled: boolean
  waqi_configured: boolean
  mqtt_enabled: boolean
  publication: PublicationStatus
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Nunca'
  const s = Math.max(0, Math.floor((Date.now() - parseServerDate(iso)) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function SensorRow({ sensor, online }: { sensor: SensorDetail; online: boolean }) {
  const icon = { exterior: '🌡️', interior: '🏠', canal: '📍', viento: '💨', lluvia: '🌧️', solar: '☀️' }[sensor.category] || '📡'
  const receiving = sensor.active && online
  const values = [
    sensor.temperature !== undefined && `${sensor.temperature.toFixed(1)}°`,
    sensor.humidity !== undefined && `${Math.round(sensor.humidity)}%`,
    sensor.pressure !== undefined && `${sensor.pressure.toFixed(0)}hPa`,
    sensor.wind_speed !== undefined && `${sensor.wind_speed.toFixed(0)}km/h`,
    sensor.rain_daily !== undefined && `${sensor.rain_daily.toFixed(1)}mm`,
    sensor.uv_index !== undefined && `UV${sensor.uv_index}`,
  ].filter(Boolean).join(' ')

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-sm bg-slate-900/30 rounded">
      <span>{icon}</span>
      <span className="truncate">{sensor.label}{sensor.channel ? ` (${sensor.channel})` : ''}</span>
      <span className="flex-1 text-right text-slate-400 tabular-nums">{values}</span>
      <span title={receiving ? 'Recibiendo datos' : 'Sin datos recientes'} className={`text-xs font-bold ${receiving ? 'text-emerald-400' : 'text-red-400'}`}>{receiving ? '✓' : '✗'}</span>
      <BatteryIcon ok={sensor.battery_ok} size={18} />
    </div>
  )
}

function StationCard({ station }: { station: Station }) {
  const isPrincipal = station.name === null
  const sensors = station.sensors_detail || []
  const ws69 = sensors.filter(s => s.type === 'WS69')
  const wn31 = sensors.filter(s => s.type === 'WN31')
  const console = sensors.find(s => s.type === 'console')
  const lowBatt = sensors.filter(s => s.active && !s.battery_ok).length
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
          }`}>{statusDot(station.status)} {statusLabel(station.status)}</span>
          {sensors.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${lowBatt ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
              🔋 {lowBatt ? `${lowBatt} baja${lowBatt > 1 ? 's' : ''}` : 'OK'}
            </span>
          )}
        </div>
        <span className="text-xs text-slate-500">{timeAgo(station.last_received)}</span>
      </div>
      <p className="text-xs text-slate-500 mb-2">{hw}</p>
      <div className="space-y-1">
        {console && <SensorRow sensor={console} online={station.status === 'online'} />}
        {ws69.map(s => <SensorRow key={s.id} sensor={s} online={station.status === 'online'} />)}
        {wn31.map(s => <SensorRow key={s.id} sensor={s} online={station.status === 'online'} />)}
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

function LiveIndicator({ lastUpdate }: { lastUpdate: Date | null }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(i)
  }, [])
  const ago = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null
  const isRecent = ago !== null && ago < 15
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-2 h-2 rounded-full ${isRecent ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
      <span className="text-slate-400">
        {ago === null ? 'Conectando...' : ago < 5 ? 'Actualizado' : `Hace ${ago}s`}
      </span>
    </div>
  )
}

function AlertHistory({ history }: { history: AlertHistoryItem[] }) {
  if (history.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <p className="text-xs text-slate-500 mb-2">Últimas 24h</p>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {history.slice(0, 10).map((a, i) => {
          const time = new Date(a.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
          const resolved = a.resolved_at ? ` → ${new Date(a.resolved_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : ''
          return (
            <div key={i} className="text-xs text-slate-400 flex gap-2">
              <span className="text-slate-500 tabular-nums">{time}{resolved}</span>
              <span className={a.resolved_at ? 'line-through text-slate-600' : ''}>{a.message}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AdminDashboard() {
  const { fetchWithAuth } = useAdminAuth()
  const [stations, setStations] = useState<Station[]>([])
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [sRes, aRes] = await Promise.all([fetch('/api/stations'), fetchWithAuth('/api/admin/status')])
      if (sRes.ok) setStations((await sRes.json()).stations)
      if (aRes.ok) setStatus(await aRes.json())
      setLastUpdate(new Date())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [fetchWithAuth])

  useEffect(() => {
    load()
    const i = setInterval(load, 10000)
    return () => clearInterval(i)
  }, [load])

  const toggleAlerts = async () => {
    if (!status) return
    setActionLoading('alerts')
    try {
      await fetchWithAuth('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alerts_enabled: !status.alerts_enabled }),
      })
      await load()
    } catch (e) { console.error(e) }
    setActionLoading(null)
  }

  const testTelegram = async () => {
    setActionLoading('telegram')
    try {
      const r = await fetchWithAuth('/api/admin/test-telegram', { method: 'POST' })
      if (r.ok) alert('Mensaje enviado')
      else alert('Error al enviar')
    } catch { alert('Error de conexión') }
    setActionLoading(null)
  }

  if (loading) return <div className="text-slate-400">Cargando...</div>

  const alerts = status?.active_alerts || []
  const history = status?.alert_history || []
  const pub = status?.publication || { wu: false, windy: false, pws: false, owm: false, cwop: false }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-slate-400 text-sm">Estado del sistema</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator lastUpdate={lastUpdate} />
          <button
            onClick={load}
            className="text-slate-400 hover:text-white p-1.5 hover:bg-white/5 rounded-lg transition-colors"
            title="Actualizar ahora"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Alertas */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium flex items-center gap-2">
            <span>🔔</span> Alertas
            <button
              onClick={toggleAlerts}
              disabled={actionLoading === 'alerts'}
              className={`text-xs px-2 py-0.5 rounded transition-colors cursor-pointer ${
                status?.alerts_enabled ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-slate-600 text-slate-400 hover:bg-slate-500'
              } disabled:opacity-50`}
              title={status?.alerts_enabled ? 'Click para desactivar' : 'Click para activar'}
            >
              {actionLoading === 'alerts' ? '...' : status?.alerts_enabled ? 'ON' : 'OFF'}
            </button>
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
        <AlertHistory history={history} />
      </div>

      {/* Estaciones */}
      <div className="grid gap-4 lg:grid-cols-2">
        {stations.map((s, i) => <StationCard key={s.name || i} station={s} />)}
      </div>

      {/* Sistema y Servicios + Publicacion */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium flex items-center gap-2"><span>⚙️</span> Sistema</h2>
            <a href="/admin/sistema" className="text-sky-400 hover:text-sky-300 text-xs">Ver →</a>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm mb-3">
            <div><span className="text-slate-500">Version:</span> <span className="text-slate-300">1.0</span></div>
            <div><span className="text-slate-500">Estaciones:</span> <span className="text-slate-300">{stations.length}</span></div>
            <div><span className="text-slate-500">Ultima:</span> <span className="text-slate-300">{timeAgo(status?.last_received || null)}</span></div>
          </div>
          <div className="border-t border-white/5 pt-3">
            <p className="text-xs text-slate-500 mb-2">Servicios</p>
            <div className="flex flex-wrap gap-3 items-center">
              <span className="text-xs text-emerald-400">● InfluxDB</span>
              <span className={`text-xs ${status?.telegram_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                {status?.telegram_enabled ? '●' : '○'} Telegram
              </span>
              <span className={`text-xs ${status?.mqtt_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                {status?.mqtt_enabled ? '●' : '○'} MQTT
              </span>
              <span className={`text-xs ${status?.waqi_configured ? 'text-emerald-400' : 'text-slate-500'}`}>
                {status?.waqi_configured ? '●' : '○'} WAQI
              </span>
            </div>
            {status?.telegram_enabled && (
              <button
                onClick={testTelegram}
                disabled={actionLoading === 'telegram'}
                className="mt-3 text-xs text-sky-400 hover:text-sky-300 disabled:text-slate-500"
              >
                {actionLoading === 'telegram' ? 'Enviando...' : '🧪 Probar Telegram'}
              </button>
            )}
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium flex items-center gap-2"><span>📤</span> Publicación</h2>
            <a href="/admin/publicacion" className="text-sky-400 hover:text-sky-300 text-xs">Configurar →</a>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className={`text-xs ${pub.wu ? 'text-emerald-400' : 'text-slate-500'}`}>
              {pub.wu ? '●' : '○'} Weather Underground
            </span>
            <span className={`text-xs ${pub.windy ? 'text-emerald-400' : 'text-slate-500'}`}>
              {pub.windy ? '●' : '○'} Windy
            </span>
            <span className={`text-xs ${pub.pws ? 'text-emerald-400' : 'text-slate-500'}`}>
              {pub.pws ? '●' : '○'} PWSWeather
            </span>
            <span className={`text-xs ${pub.owm ? 'text-emerald-400' : 'text-slate-500'}`}>
              {pub.owm ? '●' : '○'} OpenWeatherMap
            </span>
            <span className={`text-xs ${pub.cwop ? 'text-emerald-400' : 'text-slate-500'}`}>
              {pub.cwop ? '●' : '○'} CWOP
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
