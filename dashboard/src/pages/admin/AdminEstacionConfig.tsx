import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
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
  battery_ok: boolean
  active: boolean
}

interface StationData {
  name: string | null
  label: string
  last_received: string | null
  status: 'online' | 'offline' | 'unknown'
  sensors_detail: SensorDetail[]
  model: string | null
  config: {
    label?: string
    watchdog_enabled: boolean
    watchdog_minutes: number
    alerts_enabled: boolean
  }
  sensor_labels: Record<string, string>
}

function StatusBadge({ status }: { status: 'online' | 'offline' | 'unknown' }) {
  const colors = {
    online: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    offline: 'bg-red-500/20 text-red-400 border-red-500/30',
    unknown: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  }
  const labels = { online: 'Online', offline: 'Offline', unknown: 'Desconocido' }

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm border ${colors[status]}`}>
      {status === 'online' ? '🟢' : status === 'offline' ? '🔴' : '⚪'}
      {labels[status]}
    </span>
  )
}

export function AdminEstacionConfig() {
  const { name } = useParams<{ name: string }>()
  const { fetchWithAuth } = useAdminAuth()
  const [station, setStation] = useState<StationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // Form state
  const [stationLabel, setStationLabel] = useState('')
  const [watchdogEnabled, setWatchdogEnabled] = useState(true)
  const [watchdogMinutes, setWatchdogMinutes] = useState(15)
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
        setSensorLabels(data.sensor_labels || {})
      })
      .finally(() => setLoading(false))
  }, [name])

  const handleSensorLabelChange = (sensorId: string, label: string) => {
    setSensorLabels(prev => ({ ...prev, [sensorId]: label }))
  }

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
          },
          sensor_labels: sensorLabels,
        }),
      })

      if (res.ok) {
        setMessage({ type: 'ok', text: 'Configuración guardada correctamente' })
      } else {
        const err = await res.json()
        setMessage({ type: 'error', text: err.detail || 'Error al guardar' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Error de conexión' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-slate-400">Cargando...</div>
  }

  if (!station) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400">Estación no encontrada</p>
        <Link to="/admin/estaciones" className="text-sky-400 hover:text-sky-300 mt-4 inline-block">
          ← Volver a estaciones
        </Link>
      </div>
    )
  }

  const isPrincipal = station.name === null
  const wn31Sensors = station.sensors_detail.filter(s => s.type === 'WN31')
  const otherSensors = station.sensors_detail.filter(s => s.type !== 'WN31')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link to="/admin/estaciones" className="text-slate-400 hover:text-white">
              ←
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span>{isPrincipal ? '🏠' : '📡'}</span>
              {station.label}
            </h1>
            <StatusBadge status={station.status} />
          </div>
          <p className="text-slate-400 ml-8">
            {station.model || (isPrincipal ? 'Estación principal' : 'Estación remota')}
          </p>
        </div>
      </div>

      {/* Mensaje de estado */}
      {message && (
        <div className={`rounded-lg px-4 py-3 ${
          message.type === 'ok'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Configuración general */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4">Configuración general</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Nombre de la estación</label>
            <input
              type="text"
              value={stationLabel}
              onChange={e => setStationLabel(e.target.value)}
              placeholder={isPrincipal ? 'Principal' : name || ''}
              className="w-full max-w-md rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={watchdogEnabled}
                onChange={e => setWatchdogEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-slate-900/50 text-sky-500 focus:ring-sky-500/50"
              />
              <span className="text-slate-300">Monitorear conexión (watchdog)</span>
            </label>
          </div>

          {watchdogEnabled && (
            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Alertar si no hay datos después de (minutos)
              </label>
              <input
                type="number"
                value={watchdogMinutes}
                onChange={e => setWatchdogMinutes(Number(e.target.value))}
                min={1}
                max={60}
                className="w-24 rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white focus:outline-none focus:border-sky-500/50"
              />
            </div>
          )}
        </div>
      </section>

      {/* Sensores WN31 */}
      {wn31Sensors.length > 0 && (
        <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
          <h2 className="text-lg font-semibold mb-4">
            Sensores WN31 ({wn31Sensors.length})
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Asigna nombres a cada canal para identificarlos fácilmente (ej: "Sala", "Recámara", "Garage")
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {wn31Sensors.map(sensor => (
              <div
                key={sensor.id}
                className="bg-slate-900/50 rounded-lg p-4 border border-white/5"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-slate-400 text-sm">Canal {sensor.channel}</span>
                  <span title={sensor.battery_ok ? 'Batería OK' : 'Batería baja'}>
                    {sensor.battery_ok ? '🔋' : '🪫'}
                  </span>
                </div>

                <div className="text-2xl font-bold mb-1">
                  {sensor.temperature?.toFixed(1) ?? '--'}°
                </div>
                <div className="text-slate-400 text-sm mb-3">
                  {sensor.humidity !== undefined ? `${Math.round(sensor.humidity)}% HR` : '--'}
                </div>

                <input
                  type="text"
                  value={sensorLabels[sensor.id] || ''}
                  onChange={e => handleSensorLabelChange(sensor.id, e.target.value)}
                  placeholder={`Canal ${sensor.channel}`}
                  className="w-full rounded bg-slate-800/50 border border-white/10 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Otros sensores */}
      {otherSensors.length > 0 && (
        <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
          <h2 className="text-lg font-semibold mb-4">Otros sensores</h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherSensors.map(sensor => (
              <div
                key={sensor.id}
                className="bg-slate-900/50 rounded-lg p-4 border border-white/5 flex items-center gap-4"
              >
                <div className="text-2xl">
                  {sensor.category === 'exterior' ? '🌡️' :
                   sensor.category === 'interior' ? '🏠' :
                   sensor.category === 'viento' ? '💨' :
                   sensor.category === 'lluvia' ? '🌧️' :
                   sensor.category === 'solar' ? '☀️' : '📡'}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{sensor.label}</div>
                  <div className="text-slate-400 text-sm">
                    {sensor.type} · {sensor.category}
                  </div>
                </div>
                <span title={sensor.battery_ok ? 'Batería OK' : 'Batería baja'}>
                  {sensor.battery_ok ? '🔋' : '🪫'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Botón guardar */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 px-6 py-2 rounded-lg font-medium transition-colors"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
        <Link to="/admin/estaciones" className="text-slate-400 hover:text-white">
          Cancelar
        </Link>
      </div>
    </div>
  )
}
