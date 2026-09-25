import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAdminAuth } from '../../admin-auth'
import { BatteryIcon, statusLabel, statusDot } from '../../components/admin-ui'
import type { SensorDetail } from '../../api-types'

interface Registry {
  whitelist_active: boolean
  primary: { has_passkey: boolean; passkey_masked: string }
  secondaries: { name: string; passkey_masked: string }[]
}

const MAC_HINT = 'MAC del equipo (etiqueta), p. ej. 8C:4F:00:4F:8B:63 — con o sin «:». El servidor deriva el passkey.'

interface StationConfig {
  label?: string
  alerts_enabled?: boolean
  watchdog_enabled?: boolean
  watchdog_minutes?: number
  altitude_m?: number
  disabled_rules?: string[]
  alert_thresholds?: Record<string, number>
  calibration?: Record<string, number | boolean>
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
  const [sensorLabels, setSensorLabels] = useState<Record<string, string>>({})
  // La principal guarda alertas/calibración en la configuración global.
  const [globalCfg, setGlobalCfg] = useState<Record<string, unknown> | null>(null)

  // Registro (passkey por MAC)
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [regMac, setRegMac] = useState('')
  const [savingReg, setSavingReg] = useState(false)
  const [regMsg, setRegMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const loadRegistry = useCallback(async () => {
    try {
      const r = await fetchWithAuth('/api/admin/registry')
      setRegistry(await r.json())
    } catch {
      /* silencioso: la tarjeta mostrará estado desconocido */
    }
  }, [fetchWithAuth])

  useEffect(() => {
    loadRegistry()
  }, [loadRegistry])

  const saveRegistro = async (mac: string) => {
    const principal = station?.name === null
    setSavingReg(true)
    setRegMsg(null)
    try {
      const res = principal
        ? await fetchWithAuth('/api/admin/registry/primary', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mac }),
          })
        : await fetchWithAuth('/api/admin/registry/secondary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mac }),
          })
      if (res.ok) {
        setRegMac('')
        setRegMsg({ type: 'ok', text: mac ? 'Passkey actualizada' : 'Whitelist desactivada' })
        await loadRegistry()
        setTimeout(() => setRegMsg(null), 2500)
      } else {
        const data = await res.json().catch(() => ({}))
        setRegMsg({ type: 'error', text: data.detail || 'Error al guardar' })
      }
    } catch {
      setRegMsg({ type: 'error', text: 'Error de conexión' })
    } finally {
      setSavingReg(false)
    }
  }

  const handleSaveRegistro = () => {
    if (!regMac.trim()) {
      setRegMsg({ type: 'error', text: 'Ingresa una MAC del equipo' })
      return
    }
    saveRegistro(regMac.trim())
  }

  const handleDisableWhitelist = () => {
    if (!window.confirm('¿Desactivar la whitelist? El servidor aceptará pushes de cualquier passkey y la primera desconocida se tratará como estación principal.')) return
    saveRegistro('')
  }

  useEffect(() => {
    if (name !== '_principal') return
    fetchWithAuth('/api/admin/settings').then(r => r.json()).then(setGlobalCfg).catch(() => {})
  }, [name, fetchWithAuth])

  useEffect(() => {
    if (!name) return
    fetch(`/api/stations/${name}`)
      .then(r => r.json())
      .then(data => {
        setStation(data)
        setStationLabel(data.config?.label || '')
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
          // La ficha sólo guarda el nombre (y los nombres de sensores): alertas y
          // "sin datos" viven en Alertas, altitud y offsets en Calibración.
          config: { label: stationLabel },
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
  const q = isPrincipal ? '?estacion=principal' : `?estacion=${name}`
  // Resumen de lo que esta estación tiene en Alertas y Calibración (sólo lectura;
  // se edita allá). Para la principal sale de la configuración global.
  const g = globalCfg as Record<string, number | boolean> | null
  const cfg = station.config
  const signo = (v: number) => (v > 0 ? `+${v}` : `${v}`)
  const resumenAlertas: string | null = isPrincipal
    ? (g ? `${g.alerts_enabled ? 'activas' : 'apagadas (todas)'} · sin datos tras ${g.alert_station_offline_minutes} min` : null)
    : [
        cfg.alerts_enabled ? 'activas' : 'apagadas',
        cfg.watchdog_enabled === false ? 'sin aviso de «sin datos»' : `sin datos tras ${cfg.watchdog_minutes ?? 15} min`,
        (cfg.disabled_rules?.length ?? 0) > 0 ? `${cfg.disabled_rules!.length} regla(s) desactivada(s)` : null,
      ].filter(Boolean).join(' · ')
  const cal = isPrincipal ? g : (cfg.calibration ?? {})
  const alt = isPrincipal ? (g?.station_altitude_m as number | undefined) : cfg.altitude_m
  const resumenCal: string | null = cal
    ? [
        cal.cal_enabled ? 'habilitada' : 'deshabilitada',
        `presión ${signo(Number(cal.cal_pressure_offset ?? 0))} hPa`,
        alt ? `altitud ${alt} m` : 'altitud de la consola',
      ].join(' · ')
    : null
  const wn31Sensors = station.sensors_detail.filter(s => s.type === 'WN31')
  const otherSensors = station.sensors_detail.filter(s => s.type !== 'WN31')

  // Registro: passkey de ESTA estación
  const regSecondary = isPrincipal ? undefined : registry?.secondaries.find(s => s.name === name)
  const regHasPasskey = isPrincipal ? !!registry?.primary.has_passkey : !!regSecondary
  const regPasskeyMasked = isPrincipal ? registry?.primary.passkey_masked : regSecondary?.passkey_masked
  const whitelistActive = registry?.whitelist_active ?? false

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
        <h2 className="font-medium mb-3">Nombre</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              aria-label="Nombre de la estación"
              value={stationLabel}
              onChange={e => setStationLabel(e.target.value)}
              placeholder={isPrincipal ? 'Principal' : name || ''}
              className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
            />
          </div>
        </div>
      </div>

      {/* Registro (passkey por MAC) */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Registro</h2>
          <span className="text-sm text-slate-400">
            {regHasPasskey
              ? <>Passkey: <span className="font-mono text-slate-300">{regPasskeyMasked}</span></>
              : <span className="text-amber-400">No registrado</span>}
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Solo se aceptan pushes de estaciones registradas. El registro se gestiona por MAC
          (etiqueta del equipo); el servidor deriva el passkey.
        </p>
        {isPrincipal && !whitelistActive && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-center gap-2">
            <span>⚠️</span>
            <p className="text-xs text-amber-400">
              Whitelist inactiva: no hay passkey principal configurada. Cualquier estación
              desconocida sería tratada como principal.
            </p>
          </div>
        )}
        {isPrincipal && whitelistActive && (
          <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 flex items-center gap-2">
            <span>🟢</span>
            <p className="text-xs text-emerald-400">
              Whitelist activa: solo se aceptan las passkeys registradas.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm text-slate-400 mb-1">MAC del equipo</label>
            <input
              type="text"
              value={regMac}
              onChange={e => setRegMac(e.target.value)}
              placeholder="8C:4F:00:4F:8B:63"
              className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-sky-500/50"
            />
          </div>
          <button
            onClick={handleSaveRegistro}
            disabled={savingReg}
            className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            {savingReg ? 'Guardando...' : 'Guardar'}
          </button>
          {regMsg && (
            <span className={`text-sm ${regMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{regMsg.text}</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2">{MAC_HINT}</p>
        {isPrincipal && (
          <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-3">
            <button
              onClick={handleDisableWhitelist}
              disabled={savingReg || !regHasPasskey}
              className="text-sm text-red-400 hover:text-red-300 disabled:text-slate-600 disabled:cursor-not-allowed"
            >
              Desactivar whitelist
            </button>
            <span className="text-xs text-slate-500">Borra el passkey principal y deja de filtrar por registro.</span>
          </div>
        )}
      </div>

      {/* Accesos directos: lo demás de esta estación vive en su categoría (Alertas,
          Calibración), con esta estación ya elegida. Así cada ajuste está en un solo lugar. */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="font-medium mb-3">Ajustes de esta estación</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link to={`/admin/alertas${q}`}
            className="rounded-lg bg-slate-900/50 border border-white/5 hover:border-sky-500/40 px-3 py-2 text-sm">
            🔔 <span className="text-slate-200">Alertas</span> <span className="text-sky-400 text-xs">editar →</span>
            <span className="block text-xs text-slate-400 mt-0.5">{resumenAlertas ?? '…'}</span>
            <span className="block text-xs text-slate-500">umbrales y aviso de «sin datos»</span>
          </Link>
          <Link to={`/admin/calibracion${q}`}
            className="rounded-lg bg-slate-900/50 border border-white/5 hover:border-sky-500/40 px-3 py-2 text-sm">
            🔧 <span className="text-slate-200">Calibración</span> <span className="text-sky-400 text-xs">editar →</span>
            <span className="block text-xs text-slate-400 mt-0.5">{resumenCal ?? '…'}</span>
            <span className="block text-xs text-slate-500">offsets de sensores y altitud</span>
          </Link>
        </div>
        {!isPrincipal && (
          <p className="text-xs text-slate-500 mt-2">La publicación a redes y MQTT son sólo de la estación principal.</p>
        )}
      </div>

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
