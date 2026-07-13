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
  telegram_bot_token_masked: string | null
  telegram_chat_id: string | null
}

function Toggle({
  enabled,
  onChange,
  label,
  description,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative mt-0.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`w-10 h-6 rounded-full transition-colors ${enabled ? 'bg-sky-600' : 'bg-slate-600'}`} />
        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <span className="font-medium">{label}</span>
        {description && <p className="text-slate-400 text-sm">{description}</p>}
      </div>
    </label>
  )
}

function NumberInput({
  value,
  onChange,
  label,
  unit,
  min,
  max,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  label: string
  unit: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div>
      <label className="block text-sm text-slate-300 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          className="w-24 rounded-lg bg-slate-900/50 border border-white/10 px-3 py-2 text-white focus:outline-none focus:border-sky-500/50"
        />
        <span className="text-slate-400 text-sm">{unit}</span>
      </div>
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
        setMessage({ type: 'ok', text: 'Configuracion guardada correctamente' })
      } else {
        const err = await res.json()
        setMessage({ type: 'error', text: err.detail || 'Error al guardar' })
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alertas</h1>
        <p className="text-slate-400">Configuracion de umbrales y notificaciones</p>
      </div>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 ${
            message.type === 'ok'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Master switch */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <Toggle
          enabled={settings.alerts_enabled}
          onChange={(v) => update('alerts_enabled', v)}
          label="Alertas habilitadas"
          description="Activa o desactiva todas las alertas del sistema"
        />
      </section>

      {/* Temperatura */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>🌡️</span> Temperatura
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput
            value={settings.alert_temp_high}
            onChange={(v) => update('alert_temp_high', v)}
            label="Alerta temperatura alta"
            unit="°C"
            min={0}
            max={60}
            step={0.5}
          />
          <NumberInput
            value={settings.alert_temp_low}
            onChange={(v) => update('alert_temp_low', v)}
            label="Alerta temperatura baja"
            unit="°C"
            min={-40}
            max={30}
            step={0.5}
          />
        </div>
      </section>

      {/* Viento */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>💨</span> Viento
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput
            value={settings.alert_wind_high}
            onChange={(v) => update('alert_wind_high', v)}
            label="Alerta velocidad viento"
            unit="km/h"
            min={0}
            max={200}
            step={5}
          />
          <NumberInput
            value={settings.alert_gust_high}
            onChange={(v) => update('alert_gust_high', v)}
            label="Alerta rafaga"
            unit="km/h"
            min={0}
            max={200}
            step={5}
          />
        </div>
      </section>

      {/* Lluvia */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>🌧️</span> Lluvia
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput
            value={settings.alert_rain_rate}
            onChange={(v) => update('alert_rain_rate', v)}
            label="Alerta intensidad lluvia"
            unit="mm/h"
            min={0}
            max={100}
            step={1}
          />
          <NumberInput
            value={settings.alert_rain_daily}
            onChange={(v) => update('alert_rain_daily', v)}
            label="Alerta lluvia diaria"
            unit="mm"
            min={0}
            max={500}
            step={5}
          />
        </div>
      </section>

      {/* Presion */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>📊</span> Presion
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput
            value={settings.alert_pressure_high}
            onChange={(v) => update('alert_pressure_high', v)}
            label="Alerta presion alta"
            unit="hPa"
            min={900}
            max={1100}
            step={1}
          />
          <NumberInput
            value={settings.alert_pressure_low}
            onChange={(v) => update('alert_pressure_low', v)}
            label="Alerta presion baja"
            unit="hPa"
            min={900}
            max={1100}
            step={1}
          />
        </div>
      </section>

      {/* Estacion y sensores */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>📡</span> Estacion y sensores
        </h2>
        <div className="space-y-4">
          <NumberInput
            value={settings.alert_station_offline_minutes}
            onChange={(v) => update('alert_station_offline_minutes', v)}
            label="Alertar si la estacion no reporta en"
            unit="minutos"
            min={1}
            max={60}
            step={1}
          />
          <Toggle
            enabled={settings.alert_battery_enabled}
            onChange={(v) => update('alert_battery_enabled', v)}
            label="Alerta bateria baja"
            description="Notificar cuando un sensor tenga bateria baja"
          />
          <Toggle
            enabled={settings.alert_sensor_lost_enabled}
            onChange={(v) => update('alert_sensor_lost_enabled', v)}
            label="Alerta sensor perdido"
            description="Notificar cuando un sensor deje de reportar"
          />
        </div>
      </section>

      {/* Calidad del aire */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>🌫️</span> Calidad del aire
        </h2>
        <div className="space-y-4">
          <Toggle
            enabled={settings.alert_air_enabled}
            onChange={(v) => update('alert_air_enabled', v)}
            label="Alertas de calidad del aire"
            description="Requiere token WAQI configurado"
          />
          {settings.alert_air_enabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberInput
                value={settings.alert_aqi_threshold}
                onChange={(v) => update('alert_aqi_threshold', v)}
                label="Umbral AQI (US EPA)"
                unit=""
                min={0}
                max={500}
                step={10}
              />
              <NumberInput
                value={settings.alert_imeca_threshold}
                onChange={(v) => update('alert_imeca_threshold', v)}
                label="Umbral IMECA (Mexico)"
                unit=""
                min={0}
                max={500}
                step={10}
              />
            </div>
          )}
        </div>
      </section>

      {/* Notificaciones */}
      <section className="bg-slate-800/50 rounded-xl border border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>💬</span> Notificaciones
        </h2>
        <div className="flex items-center gap-4 text-sm">
          <span className={settings.telegram_enabled ? 'text-emerald-400' : 'text-slate-500'}>
            {settings.telegram_enabled ? '✓ Telegram configurado' : '○ Telegram no configurado'}
          </span>
          {settings.telegram_enabled && settings.telegram_chat_id && (
            <span className="text-slate-400">Chat: {settings.telegram_chat_id}</span>
          )}
          <a href="/admin/notificaciones" className="text-sky-400 hover:text-sky-300 ml-auto">
            Configurar Telegram →
          </a>
        </div>
      </section>

      {/* Guardar */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 px-6 py-2 rounded-lg font-medium transition-colors"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
