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
  email_enabled: boolean
}

const THRESHOLD_KEYS = [
  'alert_temp_high', 'alert_temp_low', 'alert_wind_high', 'alert_gust_high',
  'alert_rain_rate', 'alert_rain_daily', 'alert_pressure_high', 'alert_pressure_low',
] as const

interface StationOpt { name: string; label: string }

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
  const [globalCache, setGlobalCache] = useState<AlertSettings | null>(null)
  const [secondaries, setSecondaries] = useState<StationOpt[]>([])
  const [selected, setSelected] = useState<string | null>(null)  // null = principal
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    Promise.all([
      fetchWithAuth('/api/admin/settings').then((r) => r.json()),
      fetch('/api/stations').then((r) => r.json()).catch(() => null),
    ]).then(([s, st]) => {
      setSettings(s); setGlobalCache(s)
      const list = st?.stations || []
      setSecondaries(
        list.filter((x: { name: string | null }) => x.name !== null)
          .map((x: { name: string; label: string }) => ({ name: x.name, label: x.label || x.name }))
      )
    }).finally(() => setLoading(false))
  }, [fetchWithAuth])

  const onSelectStation = async (sel: string | null) => {
    setSelected(sel); setMessage(null); setLoading(true)
    try {
      if (sel === null) {
        const s = await fetchWithAuth('/api/admin/settings').then((r) => r.json())
        setSettings(s); setGlobalCache(s)
      } else {
        const ov = await fetchWithAuth(`/api/admin/stations/${sel}/alerts`)
          .then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
        // Sembrar con los umbrales globales y sobreponer los propios de la estación.
        const base: Record<string, number> = {}
        for (const k of THRESHOLD_KEYS) base[k] = (globalCache as unknown as Record<string, number>)?.[k] ?? 0
        setSettings({ ...base, ...ov } as AlertSettings)
      }
    } finally { setLoading(false) }
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setMessage(null)
    try {
      let res: Response
      if (selected === null) {
        res = await fetchWithAuth('/api/admin/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        })
      } else {
        const th: Record<string, number> = {}
        for (const k of THRESHOLD_KEYS) th[k] = (settings as unknown as Record<string, number>)[k]
        res = await fetchWithAuth(`/api/admin/stations/${selected}/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(th),
        })
      }
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

  const isPrincipal = selected === null
  const selLabel = isPrincipal ? 'Principal (WS69)' : (secondaries.find((s) => s.name === selected)?.label || selected)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Alertas</h1>
          <p className="text-slate-400 text-sm">
            {isPrincipal ? 'Umbrales de la estación principal · WS69' : `Umbrales de ${selLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {secondaries.length > 0 && (
            <select
              value={selected ?? ''}
              onChange={(e) => onSelectStation(e.target.value || null)}
              className="rounded bg-slate-900/50 border border-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
            >
              <option value="">Principal (WS69)</option>
              {secondaries.map((s) => (<option key={s.name} value={s.name}>{s.label}</option>))}
            </select>
          )}
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {isPrincipal ? (
        <>
          {/* Master + Telegram */}
          <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Toggle enabled={settings.alerts_enabled} onChange={(v) => update('alerts_enabled', v)} label="Alertas habilitadas" />
            <div className="h-4 w-px bg-white/10" />
            <span className={`text-sm ${settings.telegram_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
              {settings.telegram_enabled ? '✓ Telegram activo' : '○ Telegram no configurado'}
            </span>
            <span className={`text-sm ${settings.email_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
              {settings.email_enabled ? '✓ Correo activo' : '○ Correo no configurado'}
            </span>
            <a href="/admin/notificaciones" className="text-sky-400 hover:text-sky-300 text-sm ml-auto">Configurar →</a>
          </div>
          <div className="bg-slate-800/30 rounded-xl border border-white/5 px-4 py-2 text-xs text-slate-500">
            ℹ️ Estos umbrales aplican a la <span className="text-slate-400">estación principal (WS69)</span>. Elige otra estación arriba para editar sus umbrales propios.
          </div>
        </>
      ) : (
        <div className="bg-slate-800/30 rounded-xl border border-white/5 px-4 py-2 text-xs text-slate-500">
          ℹ️ Umbrales propios de <span className="text-slate-400">{selLabel}</span>. Actívale las alertas en <a href="/admin/estaciones" className="text-sky-400">Estaciones</a>. Batería, sensor perdido, offline y aire usan la configuración global.
        </div>
      )}

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

      {isPrincipal && (
        <>
          {/* Estacion, sensores */}
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
        </>
      )}
    </div>
  )
}
