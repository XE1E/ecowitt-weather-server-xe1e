import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAdminAuth } from '../../admin-auth'
import { BatteryIcon, statusLabel, statusDot } from '../../components/admin-ui'

interface SensorDetail {
  id: string
  type: string
  category: string
  channel?: number
  label: string
  temperature?: number
  humidity?: number
  pressure?: number
  battery_ok: boolean
  active: boolean
}

interface StationConfig {
  label?: string
  watchdog_enabled: boolean
  watchdog_minutes: number
  alerts_enabled: boolean
  publish_enabled: boolean
  mqtt_enabled: boolean
  treat_indoor_as_outdoor?: boolean
}

interface StationData {
  name: string | null
  label: string
  last_received: string | null
  status: 'online' | 'offline' | 'unknown'
  sensors_detail: SensorDetail[]
  model: string | null
  config: StationConfig
  sensor_labels: Record<string, string>
}

export function AdminEstacionConfig() {
  const { name } = useParams<{ name: string }>()
  const { fetchWithAuth } = useAdminAuth()
  const [station, setStation] = useState<StationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const [stationLabel, setStationLabel] = useState('')
  const [watchdogEnabled, setWatchdogEnabled] = useState(true)
  const [watchdogMinutes, setWatchdogMinutes] = useState(15)
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const [publishEnabled, setPublishEnabled] = useState(false)
  const [mqttEnabled, setMqttEnabled] = useState(false)
  const [treatOutdoor, setTreatOutdoor] = useState(false)
  const [sensorLabels, setSensorLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!name) return
    fetch(`/api/stations/${name}`)
      .then(r => r.json())
      .then(data => {
        setStation(data)
        setStationLabel(data.config?.label || '')
        setWatchdogEnabled(data.config?.watchdog_enabled ?? true)
        setWatchdogMinutes(data.config?.watchdog_minutes ?? 15)
        setAlertsEnabled(data.config?.alerts_enabled ?? false)
        setPublishEnabled(data.config?.publish_enabled ?? false)
        setMqttEnabled(data.config?.mqtt_enabled ?? false)
        setTreatOutdoor(data.config?.treat_indoor_as_outdoor ?? false)
        setSensorLabels(data.sensor_labels || {})
      })
      .finally(() => setLoading(false))
  }, [name])

  const handleSave = async () => {
    if (!name) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetchWithAuth(`/api/stations/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            label: stationLabel,
            watchdog_enabled: watchdogEnabled,
            watchdog_minutes: watchdogMinutes,
            alerts_enabled: alertsEnabled,
            publish_enabled: publishEnabled,
            mqtt_enabled: mqttEnabled,
            treat_indoor_as_outdoor: treatOutdoor,
          },
          sensor_labels: sensorLabels,
        }),
      })
      if (res.ok) {
        setMessage({ type: 'ok', text: 'Guardado' })
        setTimeout(() => setMessage(null), 2000)
      } else {
        setMessage({ type: 'error', text: 'Error al guardar' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Error de conexion' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-slate-400">Cargando...</div>
  if (!station) return (
    <div className="text-center py-8">
      <p className="text-slate-400">Estacion no encontrada</p>
      <Link to="/admin/estaciones" className="text-sky-400 text-sm">← Volver</Link>
    </div>
  )

  const isPrincipal = station.name === null
  const wn31Sensors = station.sensors_detail.filter(s => s.type === 'WN31')
  const otherSensors = station.sensors_detail.filter(s => s.type !== 'WN31')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/admin/estaciones" className="text-slate-400 hover:text-white">←</Link>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span>{isPrincipal ? '🏠' : '📡'}</span>
              {station.label}
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                station.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' :
                station.status === 'offline' ? 'bg-red-500/20 text-red-400' : 'bg-slate-500/20 text-slate-400'
              }`}>{statusDot(station.status)} {statusLabel(station.status)}</span>
            </h1>
            <p className="text-slate-400 text-sm">{station.model || (isPrincipal ? 'Estacion principal' : 'Estacion remota')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Config general */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="font-medium mb-3">Configuración general</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm text-slate-400 mb-1">Nombre</label>
            <input
              type="text"
              value={stationLabel}
              onChange={e => setStationLabel(e.target.value)}
              placeholder={isPrincipal ? 'Principal' : name || ''}
              className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
            />
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={watchdogEnabled} onChange={e => setWatchdogEnabled(e.target.checked)} className="w-4 h-4 rounded border-white/20 bg-slate-900/50 text-sky-500" />
            <span className="text-sm">Watchdog</span>
          </label>
          {watchdogEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Timeout:</span>
              <input
                type="number"
                value={watchdogMinutes}
                onChange={e => setWatchdogMinutes(Number(e.target.value))}
                min={1}
                max={60}
                className="w-16 rounded bg-slate-900/50 border border-white/10 px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:border-sky-500/50"
              />
              <span className="text-sm text-slate-500">min</span>
            </div>
          )}
        </div>
      </div>

      {/* Servicios por estación */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="font-medium mb-3">Servicios para esta estación</h2>
        <div className="flex flex-wrap gap-6">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={alertsEnabled}
              onChange={e => setAlertsEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-slate-900/50 text-sky-500"
            />
            <span className="text-sm">🔔 Alertas</span>
            <span className="text-xs text-slate-500">(usa umbrales globales)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={publishEnabled}
              onChange={e => setPublishEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-slate-900/50 text-sky-500"
            />
            <span className="text-sm">📤 Publicación</span>
            <span className="text-xs text-slate-500">(redes públicas)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mqttEnabled}
              onChange={e => setMqttEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-slate-900/50 text-sky-500"
            />
            <span className="text-sm">🏠 MQTT</span>
            <span className="text-xs text-slate-500">(Home Assistant)</span>
          </label>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          {isPrincipal
            ? 'La estación principal siempre procesa alertas y publica si está habilitado globalmente.'
            : 'Por defecto las estaciones secundarias solo almacenan datos. Activa estos servicios para incluirla.'}
        </p>
      </div>

      {/* Sensor integrado a la intemperie (solo secundarias) */}
      {!isPrincipal && (
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3">Sensor integrado</h2>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={treatOutdoor}
              onChange={e => setTreatOutdoor(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-slate-900/50 text-sky-500"
            />
            <span className="text-sm">🌡️ Está a la intemperie (tratar como exterior)</span>
          </label>
          <p className="text-xs text-slate-500 mt-2">
            El sensor integrado (temp/humedad) reporta como «interior». Si el gateway está
            afuera, actívalo para que su lectura se trate como <span className="text-slate-400">exterior</span> en
            toda la app (página remota, calibración, estadísticas y publicación). La presión no cambia.
          </p>
        </div>
      )}

      {/* Sensores WN31 */}
      {wn31Sensors.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3">Sensores WN31 ({wn31Sensors.length})</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {wn31Sensors.map(sensor => {
              const receiving = sensor.active && station?.status === 'online'
              return (
              <div key={sensor.id} className="bg-slate-900/50 rounded-lg p-3 border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-500 text-xs">CH{sensor.channel}</span>
                  <div className="flex items-center gap-1.5">
                    <span title={receiving ? 'Recibiendo datos' : 'Sin datos recientes'} className={`text-xs font-bold ${receiving ? 'text-emerald-400' : 'text-red-400'}`}>{receiving ? '✓' : '✗'}</span>
                    <BatteryIcon ok={sensor.battery_ok} size={18} />
                  </div>
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-xl font-bold">{sensor.temperature?.toFixed(1) ?? '--'}°</span>
                  <span className="text-slate-400 text-sm">{sensor.humidity !== undefined ? `${Math.round(sensor.humidity)}%` : ''}</span>
                </div>
                <input
                  type="text"
                  value={sensorLabels[sensor.id] || ''}
                  onChange={e => setSensorLabels(prev => ({ ...prev, [sensor.id]: e.target.value }))}
                  placeholder={`Canal ${sensor.channel}`}
                  className="w-full rounded bg-slate-800/50 border border-white/10 px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500/50"
                />
              </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Otros sensores */}
      {otherSensors.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3">Otros sensores</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {otherSensors.map(sensor => {
              const receiving = sensor.active && station?.status === 'online'
              return (
              <div key={sensor.id} className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-3 py-2 border border-white/5">
                <span>{sensor.category === 'exterior' ? '🌡️' : sensor.category === 'interior' ? '🏠' : sensor.category === 'viento' ? '💨' : sensor.category === 'lluvia' ? '🌧️' : sensor.category === 'solar' ? '☀️' : '📡'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{sensor.label}</div>
                  <div className="text-xs text-slate-500">{sensor.type}</div>
                </div>
                <span className="text-sm text-slate-400">
                  {sensor.temperature !== undefined && `${sensor.temperature.toFixed(1)}°`}
                  {sensor.humidity !== undefined && ` ${Math.round(sensor.humidity)}%`}
                  {sensor.pressure !== undefined && ` ${sensor.pressure.toFixed(0)}hPa`}
                </span>
                <span title={receiving ? 'Recibiendo datos' : 'Sin datos recientes'} className={`text-sm font-bold ${receiving ? 'text-emerald-400' : 'text-red-400'}`}>{receiving ? '✓' : '✗'}</span>
                <BatteryIcon ok={sensor.battery_ok} size={18} />
              </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
