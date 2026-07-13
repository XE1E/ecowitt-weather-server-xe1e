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
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
      <div className="relative">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
        <div className={`w-8 h-5 rounded-full transition-colors ${enabled ? 'bg-sky-600' : 'bg-slate-600'}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3' : ''}`} />
      </div>
      <span>{label}</span>
    </label>
  )
}

function NumField({ value, onChange, min, max, step = 1, w = 'w-16' }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; w?: string
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className={`${w} rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50`}
    />
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
        setMessage({ type: 'error', text: 'Error' })
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

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Alertas</h1>
          <p className="text-slate-400 text-sm">Umbrales y notificaciones</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Master + Telegram */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle enabled={settings.alerts_enabled} onChange={(v) => update('alerts_enabled', v)} label="Alertas habilitadas" />
        <div className="h-4 w-px bg-white/10" />
        <span className={`text-sm ${settings.telegram_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
          {settings.telegram_enabled ? '✓ Telegram activo' : '○ Telegram no configurado'}
        </span>
        <a href="/admin/notificaciones" className="text-sky-400 hover:text-sky-300 text-sm ml-auto">Configurar →</a>
      </div>

      {/* Umbrales en grid compacto */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Temperatura */}
          <div>
            <p className="text-sm font-medium mb-1">🌡️ Temperatura</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Alta</span>
              <NumField value={settings.alert_temp_high} onChange={(v) => update('alert_temp_high', v)} min={0} max={60} step={0.5} />
              <span className="text-slate-400">Baja</span>
              <NumField value={settings.alert_temp_low} onChange={(v) => update('alert_temp_low', v)} min={-40} max={30} step={0.5} />
              <span className="text-xs text-slate-500">°C</span>
            </div>
          </div>

          {/* Viento */}
          <div>
            <p className="text-sm font-medium mb-1">💨 Viento</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Vel</span>
              <NumField value={settings.alert_wind_high} onChange={(v) => update('alert_wind_high', v)} min={0} max={200} step={5} />
              <span className="text-slate-400">Raf</span>
              <NumField value={settings.alert_gust_high} onChange={(v) => update('alert_gust_high', v)} min={0} max={200} step={5} />
              <span className="text-xs text-slate-500">km/h</span>
            </div>
          </div>

          {/* Lluvia */}
          <div>
            <p className="text-sm font-medium mb-1">🌧️ Lluvia</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Int</span>
              <NumField value={settings.alert_rain_rate} onChange={(v) => update('alert_rain_rate', v)} min={0} max={100} />
              <span className="text-xs text-slate-500">mm/h</span>
              <span className="text-slate-400">Dia</span>
              <NumField value={settings.alert_rain_daily} onChange={(v) => update('alert_rain_daily', v)} min={0} max={500} step={5} />
              <span className="text-xs text-slate-500">mm</span>
            </div>
          </div>

          {/* Presion */}
          <div>
            <p className="text-sm font-medium mb-1">📊 Presion</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Alta</span>
              <NumField value={settings.alert_pressure_high} onChange={(v) => update('alert_pressure_high', v)} min={900} max={1100} />
              <span className="text-slate-400">Baja</span>
              <NumField value={settings.alert_pressure_low} onChange={(v) => update('alert_pressure_low', v)} min={900} max={1100} />
              <span className="text-xs text-slate-500">hPa</span>
            </div>
          </div>
        </div>
      </div>

      {/* Estacion, sensores, calidad aire */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">📡 Offline despues de</span>
            <NumField value={settings.alert_station_offline_minutes} onChange={(v) => update('alert_station_offline_minutes', v)} min={1} max={60} />
            <span className="text-xs text-slate-500">min</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <Toggle enabled={settings.alert_battery_enabled} onChange={(v) => update('alert_battery_enabled', v)} label="🔋 Bateria baja" />
          <Toggle enabled={settings.alert_sensor_lost_enabled} onChange={(v) => update('alert_sensor_lost_enabled', v)} label="📡 Sensor perdido" />
        </div>
      </div>

      {/* Calidad del aire */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Toggle enabled={settings.alert_air_enabled} onChange={(v) => update('alert_air_enabled', v)} label="🌫️ Alertas calidad aire" />
          {settings.alert_air_enabled && (
            <>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">AQI ≥</span>
                <NumField value={settings.alert_aqi_threshold} onChange={(v) => update('alert_aqi_threshold', v)} min={0} max={500} step={10} />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">IMECA ≥</span>
                <NumField value={settings.alert_imeca_threshold} onChange={(v) => update('alert_imeca_threshold', v)} min={0} max={500} step={10} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
