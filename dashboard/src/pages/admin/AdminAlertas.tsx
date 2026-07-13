import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface AlertSettings {
  alerts_enabled: boolean
  alert_temp_high: number
  alert_temp_low: number
  alert_wind_high: number
  alert_gust_high: number
  alert_rain_rate: number
  alert_rain_daily: number
  alert_pressure_high: number
  alert_pressure_low: number
  alert_station_offline_minutes: number
  alert_battery_enabled: boolean
  alert_sensor_lost_enabled: boolean
  alert_air_enabled: boolean
  alert_aqi_threshold: number
  alert_imeca_threshold: number
  telegram_enabled: boolean
  telegram_chat_id: string | null
}

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <div className="relative">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
        <div className={`w-8 h-5 rounded-full transition-colors ${enabled ? 'bg-sky-600' : 'bg-slate-600'}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3' : ''}`} />
      </div>
      <span className="text-sm">{label}</span>
    </label>
  )
}

function Field({ label, unit, value, onChange, min, max, step = 1 }: {
  label: string; unit: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-400 min-w-0 flex-1">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-20 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50"
      />
      <span className="text-xs text-slate-500 w-10">{unit}</span>
    </div>
  )
}

export function AdminAlertas() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<AlertSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchWithAuth('/api/admin/settings')
      .then((r) => r.json())
      .then(setSettings)
      .finally(() => setLoading(false))
  }, [fetchWithAuth])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetchWithAuth('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
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

  const update = <K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  if (loading || !settings) {
    return <div className="text-slate-400">Cargando...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Alertas</h1>
          <p className="text-slate-400 text-sm">Umbrales y notificaciones</p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Master + Telegram status */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle enabled={settings.alerts_enabled} onChange={(v) => update('alerts_enabled', v)} label="Alertas habilitadas" />
        <div className="h-4 w-px bg-white/10" />
        <span className={`text-sm ${settings.telegram_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
          {settings.telegram_enabled ? '✓ Telegram activo' : '○ Telegram no configurado'}
        </span>
        <a href="/admin/notificaciones" className="text-sky-400 hover:text-sky-300 text-sm ml-auto">Configurar →</a>
      </div>

      {/* Grid de umbrales */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Temperatura */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2"><span>🌡️</span> Temperatura</h2>
          <div className="grid gap-2">
            <Field label="Alta" unit="°C" value={settings.alert_temp_high} onChange={(v) => update('alert_temp_high', v)} min={0} max={60} step={0.5} />
            <Field label="Baja" unit="°C" value={settings.alert_temp_low} onChange={(v) => update('alert_temp_low', v)} min={-40} max={30} step={0.5} />
          </div>
        </div>

        {/* Viento */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2"><span>💨</span> Viento</h2>
          <div className="grid gap-2">
            <Field label="Velocidad" unit="km/h" value={settings.alert_wind_high} onChange={(v) => update('alert_wind_high', v)} min={0} max={200} step={5} />
            <Field label="Rafaga" unit="km/h" value={settings.alert_gust_high} onChange={(v) => update('alert_gust_high', v)} min={0} max={200} step={5} />
          </div>
        </div>

        {/* Lluvia */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2"><span>🌧️</span> Lluvia</h2>
          <div className="grid gap-2">
            <Field label="Intensidad" unit="mm/h" value={settings.alert_rain_rate} onChange={(v) => update('alert_rain_rate', v)} min={0} max={100} />
            <Field label="Diaria" unit="mm" value={settings.alert_rain_daily} onChange={(v) => update('alert_rain_daily', v)} min={0} max={500} step={5} />
          </div>
        </div>

        {/* Presion */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2"><span>📊</span> Presion</h2>
          <div className="grid gap-2">
            <Field label="Alta" unit="hPa" value={settings.alert_pressure_high} onChange={(v) => update('alert_pressure_high', v)} min={900} max={1100} />
            <Field label="Baja" unit="hPa" value={settings.alert_pressure_low} onChange={(v) => update('alert_pressure_low', v)} min={900} max={1100} />
          </div>
        </div>
      </div>

      {/* Estacion, sensores y calidad aire */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2"><span>📡</span> Estacion y sensores</h2>
          <div className="space-y-3">
            <Field label="Offline despues de" unit="min" value={settings.alert_station_offline_minutes} onChange={(v) => update('alert_station_offline_minutes', v)} min={1} max={60} />
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Toggle enabled={settings.alert_battery_enabled} onChange={(v) => update('alert_battery_enabled', v)} label="Bateria baja" />
              <Toggle enabled={settings.alert_sensor_lost_enabled} onChange={(v) => update('alert_sensor_lost_enabled', v)} label="Sensor perdido" />
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2"><span>🌫️</span> Calidad del aire</h2>
          <div className="space-y-3">
            <Toggle enabled={settings.alert_air_enabled} onChange={(v) => update('alert_air_enabled', v)} label="Alertas AQI/IMECA" />
            {settings.alert_air_enabled && (
              <div className="grid gap-2">
                <Field label="Umbral AQI" unit="" value={settings.alert_aqi_threshold} onChange={(v) => update('alert_aqi_threshold', v)} min={0} max={500} step={10} />
                <Field label="Umbral IMECA" unit="" value={settings.alert_imeca_threshold} onChange={(v) => update('alert_imeca_threshold', v)} min={0} max={500} step={10} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
