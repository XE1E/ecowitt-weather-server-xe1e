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
  alert_humidity_low: number
  alert_humidity_high: number
  alert_pressure_drop_warn: number
  alert_pressure_drop_strong: number
  alert_pressure_rise_warn: number
  alert_pressure_rise_strong: number
  alert_pressure_trend_window_min: number
  alert_uv_high: number
  alert_solar_high: number
  alert_dew_high: number
  alert_dew_low: number
  alert_feels_high: number
  alert_feels_low: number
  alert_temp_drop_warn: number
  alert_temp_drop_strong: number
  alert_temp_rise_warn: number
  alert_temp_rise_strong: number
  alert_temp_trend_window_min: number
  alert_persist_minutes: number
  alert_rules_disabled: string[]
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

// Umbrales que se pueden sobreescribir POR ESTACIÓN (se siembran de los globales
// al elegir una secundaria y se guardan en su alert_thresholds). La ventana de
// tendencia y la persistencia anti-spam son globales (no van aquí).
const THRESHOLD_KEYS = [
  'alert_temp_high', 'alert_temp_low', 'alert_wind_high', 'alert_gust_high',
  'alert_rain_rate', 'alert_rain_daily', 'alert_pressure_high', 'alert_pressure_low',
  'alert_humidity_high', 'alert_humidity_low',
  'alert_pressure_drop_warn', 'alert_pressure_drop_strong',
  'alert_pressure_rise_warn', 'alert_pressure_rise_strong',
  'alert_dew_high', 'alert_dew_low', 'alert_feels_high', 'alert_feels_low',
  'alert_temp_drop_warn', 'alert_temp_drop_strong',
  'alert_temp_rise_warn', 'alert_temp_rise_strong',
  // UV y solar solo los reporta la principal, pero se dejan sobreescribibles por
  // si algún día una secundaria trae esos sensores.
  'alert_uv_high', 'alert_solar_high',
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

function NumField({ value, onChange, min, max, step = 1, w = 'w-16', off = false }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; w?: string; off?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      disabled={off}
      className={`${w} rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50 ${off ? 'opacity-40' : ''}`}
    />
  )
}

// Interruptor pequeño para habilitar/deshabilitar una alarma concreta.
function RuleGate({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={onToggle}
      title={on ? 'Alarma activa — clic para desactivar' : 'Alarma desactivada — clic para activar'}
      className="w-3.5 h-3.5 accent-sky-500 cursor-pointer shrink-0"
    />
  )
}

export function AdminAlertas() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<AlertSettings | null>(null)
  const [globalCache, setGlobalCache] = useState<AlertSettings | null>(null)
  const [secondaries, setSecondaries] = useState<StationOpt[]>([])
  const [selected, setSelected] = useState<string | null>(null)  // null = principal
  const [offlineMin, setOfflineMin] = useState(15)  // watchdog de la secundaria
  const [disabled, setDisabled] = useState<string[]>([])  // reglas apagadas
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    Promise.all([
      fetchWithAuth('/api/admin/settings').then((r) => r.json()),
      fetch('/api/stations').then((r) => r.json()).catch(() => null),
    ]).then(([s, st]) => {
      setSettings(s); setGlobalCache(s)
      setDisabled(Array.isArray(s.alert_rules_disabled) ? s.alert_rules_disabled : [])
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
        setDisabled(Array.isArray(s.alert_rules_disabled) ? s.alert_rules_disabled : [])
      } else {
        const [ov, station] = await Promise.all([
          fetchWithAuth(`/api/admin/stations/${sel}/alerts`)
            .then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
          fetch(`/api/stations/${sel}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ])
        // Sembrar con los umbrales globales y sobreponer los propios de la estación.
        const base: Record<string, number> = {}
        for (const k of THRESHOLD_KEYS) base[k] = (globalCache as unknown as Record<string, number>)?.[k] ?? 0
        setSettings({ ...base, ...ov } as AlertSettings)
        setOfflineMin(station?.config?.watchdog_minutes ?? 15)
        setDisabled(Array.isArray(station?.config?.disabled_rules) ? station.config.disabled_rules : [])
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
          body: JSON.stringify({ ...settings, alert_rules_disabled: disabled }),
        })
      } else {
        const th: Record<string, unknown> = {}
        for (const k of THRESHOLD_KEYS) th[k] = (settings as unknown as Record<string, number>)[k]
        th.disabled_rules = disabled
        res = await fetchWithAuth(`/api/admin/stations/${selected}/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(th),
        })
        // Guardar también el "offline después de" (watchdog) de la estación.
        // El backend fusiona, así que no pisa calibración ni umbrales.
        if (res.ok) {
          await fetchWithAuth(`/api/stations/${selected}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: { watchdog_minutes: offlineMin } }),
          })
        }
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

  const isOff = (rule: string) => disabled.includes(rule)
  const toggleRule = (rule: string) =>
    setDisabled((d) => (d.includes(rule) ? d.filter((r) => r !== rule) : [...d, rule]))

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  const isPrincipal = selected === null
  const selLabel = isPrincipal ? 'Principal (WS2910)' : (secondaries.find((s) => s.name === selected)?.label || selected)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Alertas</h1>
          <p className="text-slate-400 text-sm">
            {isPrincipal ? 'Umbrales de la estación principal · WS2910' : `Umbrales de ${selLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {secondaries.length > 0 && (
            <select
              value={selected ?? ''}
              onChange={(e) => onSelectStation(e.target.value || null)}
              className="rounded bg-slate-900/50 border border-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
            >
              <option value="">Principal (WS2910)</option>
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
            ℹ️ Estos umbrales aplican a la <span className="text-slate-400">estación principal (WS2910)</span>. Elige otra estación arriba para editar sus umbrales propios. <span className="text-slate-400">Desmarca la ☑ de una alarma para desactivarla sin afectar las demás.</span>
          </div>
        </>
      ) : (
        <div className="bg-slate-800/30 rounded-xl border border-white/5 px-4 py-2 text-xs text-slate-500">
          ℹ️ Umbrales propios de <span className="text-slate-400">{selLabel}</span>. Actívale las alertas en <a href="/admin/estaciones" className="text-sky-400">Estaciones</a>. Batería, sensor perdido y aire usan la configuración global. <span className="text-slate-400">Desmarca la ☑ de una alarma para desactivarla (independiente de la principal).</span>
        </div>
      )}

      {/* Umbrales en grid compacto */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Temperatura — en 2 líneas (alta / baja) para mayor claridad */}
          <div>
            <p className="text-sm font-medium mb-1">🌡️ Temperatura</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('temp_high')} onToggle={() => toggleRule('temp_high')} />
                <span className="text-slate-400 w-14">Alta</span>
                <NumField value={settings.alert_temp_high} onChange={(v) => update('alert_temp_high', v)} min={0} max={60} step={0.5} off={isOff('temp_high')} />
                <span className="text-xs text-slate-500">°C</span>
              </div>
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('temp_low')} onToggle={() => toggleRule('temp_low')} />
                <span className="text-slate-400 w-14">Baja</span>
                <NumField value={settings.alert_temp_low} onChange={(v) => update('alert_temp_low', v)} min={-40} max={30} step={0.5} off={isOff('temp_low')} />
                <span className="text-xs text-slate-500">°C</span>
              </div>
            </div>
          </div>

          {/* Viento y Lluvia solo aplican a la principal (WS2910). El GW1100 no los tiene. */}
          {isPrincipal && (
            <div>
              <p className="text-sm font-medium mb-1">💨 Viento</p>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <RuleGate on={!isOff('wind_high')} onToggle={() => toggleRule('wind_high')} />
                  <span className="text-slate-400 w-14">Sostenido</span>
                  <NumField value={settings.alert_wind_high} onChange={(v) => update('alert_wind_high', v)} min={0} max={200} step={5} off={isOff('wind_high')} />
                  <span className="text-xs text-slate-500">km/h</span>
                </div>
                <div className="flex items-center gap-2">
                  <RuleGate on={!isOff('gust_high')} onToggle={() => toggleRule('gust_high')} />
                  <span className="text-slate-400 w-14">Ráfaga</span>
                  <NumField value={settings.alert_gust_high} onChange={(v) => update('alert_gust_high', v)} min={0} max={200} step={5} off={isOff('gust_high')} />
                  <span className="text-xs text-slate-500">km/h</span>
                </div>
              </div>
            </div>
          )}

          {isPrincipal && (
            <div>
              <p className="text-sm font-medium mb-1">🌧️ Lluvia</p>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <RuleGate on={!isOff('rain_rate')} onToggle={() => toggleRule('rain_rate')} />
                  <span className="text-slate-400 w-14">Intensidad</span>
                  <NumField value={settings.alert_rain_rate} onChange={(v) => update('alert_rain_rate', v)} min={0} max={100} off={isOff('rain_rate')} />
                  <span className="text-xs text-slate-500">mm/h</span>
                </div>
                <div className="flex items-center gap-2">
                  <RuleGate on={!isOff('rain_daily')} onToggle={() => toggleRule('rain_daily')} />
                  <span className="text-slate-400 w-14">Día</span>
                  <NumField value={settings.alert_rain_daily} onChange={(v) => update('alert_rain_daily', v)} min={0} max={500} step={5} off={isOff('rain_daily')} />
                  <span className="text-xs text-slate-500">mm</span>
                </div>
              </div>
            </div>
          )}

          {/* Presion */}
          <div>
            <p className="text-sm font-medium mb-1">📊 Presion</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('pressure_high')} onToggle={() => toggleRule('pressure_high')} />
                <span className="text-slate-400 w-14">Alta</span>
                <NumField value={settings.alert_pressure_high} onChange={(v) => update('alert_pressure_high', v)} min={900} max={1100} off={isOff('pressure_high')} />
                <span className="text-xs text-slate-500">hPa</span>
              </div>
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('pressure_low')} onToggle={() => toggleRule('pressure_low')} />
                <span className="text-slate-400 w-14">Baja</span>
                <NumField value={settings.alert_pressure_low} onChange={(v) => update('alert_pressure_low', v)} min={900} max={1100} off={isOff('pressure_low')} />
                <span className="text-xs text-slate-500">hPa</span>
              </div>
            </div>
          </div>

          {/* Humedad (aplica a ambas: exterior WS2910; GW1100 con trampa = exterior) */}
          <div>
            <p className="text-sm font-medium mb-1">💧 Humedad</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('humidity_high')} onToggle={() => toggleRule('humidity_high')} />
                <span className="text-slate-400 w-14">Alta</span>
                <NumField value={settings.alert_humidity_high} onChange={(v) => update('alert_humidity_high', v)} min={0} max={100} step={5} off={isOff('humidity_high')} />
                <span className="text-xs text-slate-500">%</span>
              </div>
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('humidity_low')} onToggle={() => toggleRule('humidity_low')} />
                <span className="text-slate-400 w-14">Baja</span>
                <NumField value={settings.alert_humidity_low} onChange={(v) => update('alert_humidity_low', v)} min={0} max={100} step={5} off={isOff('humidity_low')} />
                <span className="text-xs text-slate-500">%</span>
              </div>
            </div>
          </div>

          {/* Punto de rocío: se deriva de temp+humedad, así que existe en ambas. */}
          <div>
            <p className="text-sm font-medium mb-1">🥵 Punto de rocío</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('dew_high')} onToggle={() => toggleRule('dew_high')} />
                <span className="text-slate-400 w-14">Alto</span>
                <NumField value={settings.alert_dew_high} onChange={(v) => update('alert_dew_high', v)} min={-20} max={35} step={0.5} off={isOff('dew_high')} />
                <span className="text-xs text-slate-500">°C</span>
              </div>
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('dew_low')} onToggle={() => toggleRule('dew_low')} />
                <span className="text-slate-400 w-14">Bajo</span>
                <NumField value={settings.alert_dew_low} onChange={(v) => update('alert_dew_low', v)} min={-40} max={25} step={0.5} off={isOff('dew_low')} />
                <span className="text-xs text-slate-500">°C</span>
              </div>
            </div>
          </div>

          {/* Sensación térmica (heat index con calor, wind chill con frío). */}
          <div>
            <p className="text-sm font-medium mb-1">🌡️ Sensación térmica</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('feels_high')} onToggle={() => toggleRule('feels_high')} />
                <span className="text-slate-400 w-14">Alta</span>
                <NumField value={settings.alert_feels_high} onChange={(v) => update('alert_feels_high', v)} min={0} max={60} step={0.5} off={isOff('feels_high')} />
                <span className="text-xs text-slate-500">°C</span>
              </div>
              <div className="flex items-center gap-2">
                <RuleGate on={!isOff('feels_low')} onToggle={() => toggleRule('feels_low')} />
                <span className="text-slate-400 w-14">Baja</span>
                <NumField value={settings.alert_feels_low} onChange={(v) => update('alert_feels_low', v)} min={-40} max={30} step={0.5} off={isOff('feels_low')} />
                <span className="text-xs text-slate-500">°C</span>
              </div>
            </div>
          </div>

          {/* UV y radiación solar: solo la principal trae esos sensores (WS69). */}
          {isPrincipal && (
            <div>
              <p className="text-sm font-medium mb-1">😎 Sol</p>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <RuleGate on={!isOff('uv_high')} onToggle={() => toggleRule('uv_high')} />
                  <span className="text-slate-400 w-14">UV</span>
                  <NumField value={settings.alert_uv_high} onChange={(v) => update('alert_uv_high', v)} min={0} max={16} step={1} off={isOff('uv_high')} />
                  <span className="text-xs text-slate-500">índice</span>
                </div>
                <div className="flex items-center gap-2">
                  <RuleGate on={!isOff('solar_high')} onToggle={() => toggleRule('solar_high')} />
                  <span className="text-slate-400 w-14">Radiación</span>
                  <NumField value={settings.alert_solar_high} onChange={(v) => update('alert_solar_high', v)} min={0} max={1500} step={50} off={isOff('solar_high')} />
                  <span className="text-xs text-slate-500">W/m²</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tendencia de presión (2 niveles). Aplica a ambas estaciones. */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <p className="text-sm font-medium mb-2">
          📉 Tendencia de presión <span className="text-xs text-slate-500 font-normal">— cambio dentro de la ventana (caída = tormenta · subida = frente frío)</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <RuleGate on={!isOff('pressure_drop')} onToggle={() => toggleRule('pressure_drop')} />
            <span className="text-slate-400">Caída</span>
            <span className="text-xs text-slate-500">aviso</span>
            <NumField value={settings.alert_pressure_drop_warn} onChange={(v) => update('alert_pressure_drop_warn', v)} min={0} max={20} step={0.5} off={isOff('pressure_drop')} />
            <span className="text-xs text-slate-500">fuerte</span>
            <NumField value={settings.alert_pressure_drop_strong} onChange={(v) => update('alert_pressure_drop_strong', v)} min={0} max={20} step={0.5} off={isOff('pressure_drop')} />
          </div>
          <div className="flex items-center gap-2">
            <RuleGate on={!isOff('pressure_rise')} onToggle={() => toggleRule('pressure_rise')} />
            <span className="text-slate-400">Subida</span>
            <span className="text-xs text-slate-500">aviso</span>
            <NumField value={settings.alert_pressure_rise_warn} onChange={(v) => update('alert_pressure_rise_warn', v)} min={0} max={20} step={0.5} off={isOff('pressure_rise')} />
            <span className="text-xs text-slate-500">fuerte</span>
            <NumField value={settings.alert_pressure_rise_strong} onChange={(v) => update('alert_pressure_rise_strong', v)} min={0} max={20} step={0.5} off={isOff('pressure_rise')} />
          </div>
          <span className="text-xs text-slate-500">hPa</span>
          {isPrincipal && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-slate-400">Ventana</span>
              <NumField value={settings.alert_pressure_trend_window_min} onChange={(v) => update('alert_pressure_trend_window_min', v)} min={15} max={180} step={15} />
              <span className="text-xs text-slate-500">min (global)</span>
            </div>
          )}
        </div>
      </div>

      {/* Tendencia de temperatura (2 niveles). Misma mecánica que la de presión. */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <p className="text-sm font-medium mb-2">
          🌡️ Tendencia de temperatura <span className="text-xs text-slate-500 font-normal">— cambio dentro de la ventana (una caída rápida suele ser la llegada de una tormenta)</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <RuleGate on={!isOff('temp_drop')} onToggle={() => toggleRule('temp_drop')} />
            <span className="text-slate-400">Caída</span>
            <span className="text-xs text-slate-500">aviso</span>
            <NumField value={settings.alert_temp_drop_warn} onChange={(v) => update('alert_temp_drop_warn', v)} min={0} max={25} step={0.5} off={isOff('temp_drop')} />
            <span className="text-xs text-slate-500">fuerte</span>
            <NumField value={settings.alert_temp_drop_strong} onChange={(v) => update('alert_temp_drop_strong', v)} min={0} max={25} step={0.5} off={isOff('temp_drop')} />
          </div>
          <div className="flex items-center gap-2">
            <RuleGate on={!isOff('temp_rise')} onToggle={() => toggleRule('temp_rise')} />
            <span className="text-slate-400">Subida</span>
            <span className="text-xs text-slate-500">aviso</span>
            <NumField value={settings.alert_temp_rise_warn} onChange={(v) => update('alert_temp_rise_warn', v)} min={0} max={25} step={0.5} off={isOff('temp_rise')} />
            <span className="text-xs text-slate-500">fuerte</span>
            <NumField value={settings.alert_temp_rise_strong} onChange={(v) => update('alert_temp_rise_strong', v)} min={0} max={25} step={0.5} off={isOff('temp_rise')} />
          </div>
          <span className="text-xs text-slate-500">°C</span>
          {isPrincipal && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-slate-400">Ventana</span>
              <NumField value={settings.alert_temp_trend_window_min} onChange={(v) => update('alert_temp_trend_window_min', v)} min={15} max={180} step={15} />
              <span className="text-xs text-slate-500">min (global)</span>
            </div>
          )}
        </div>
      </div>

      {!isPrincipal && (
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">📡 Offline despues de</span>
            <NumField value={offlineMin} onChange={setOfflineMin} min={1} max={120} />
            <span className="text-xs text-slate-500">min sin datos (watchdog de esta estación)</span>
          </div>
        </div>
      )}

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
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">⏱️ Sostener</span>
                <NumField value={settings.alert_persist_minutes} onChange={(v) => update('alert_persist_minutes', v)} min={0} max={30} step={0.5} />
                <span className="text-xs text-slate-500">min antes de avisar (anti-spam global; ráfaga es inmediata)</span>
              </div>
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
