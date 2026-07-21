import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface IntegSettings {
  mqtt_enabled: boolean
  mqtt_broker: string
  mqtt_port: number
  mqtt_username: string | null
  mqtt_password: string | null
  mqtt_password_masked: string | null
  mqtt_topic: string
  hass_discovery: boolean
  hass_discovery_prefix: string
  waqi_token: string | null
  waqi_token_masked: string | null
  ecowitt_secure_enabled: boolean
  ecowitt_secure_token: string | null
  ecowitt_secure_token_masked: string | null
  ecowitt_ip_allowlist: string | null
}

interface MqttStatus {
  enabled: boolean
  connected: boolean
  broker: string | null
  port: number | null
  topic: string | null
  hass_discovery: boolean
  last_error: string | null
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="relative">
      <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <div onClick={() => onChange(!enabled)} className={`w-8 h-5 rounded-full cursor-pointer transition-colors ${enabled ? 'bg-sky-600' : 'bg-slate-600'}`}>
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3' : ''}`} />
      </div>
    </div>
  )
}

function TextField({ value, onChange, placeholder, type = 'text', masked, className = '' }: {
  value: string | null; onChange: (v: string) => void; placeholder: string; type?: string; masked?: string | null; className?: string
}) {
  const [show, setShow] = useState(false)
  const displayValue = value || ''
  const showMasked = !value && masked
  const isPw = type === 'password'
  return (
    <div className={`relative ${className}`}>
      <input
        type={isPw && show ? 'text' : type}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={showMasked ? `(${masked})` : placeholder}
        className={`w-full rounded bg-slate-900/50 border border-white/10 px-2 py-1 ${isPw ? 'pr-8' : ''} text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50`}
      />
      {isPw && (
        <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
          title={show ? 'Ocultar' : 'Mostrar'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">
          {show ? '🙈' : '👁️'}
        </button>
      )}
    </div>
  )
}

function NumField({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max}
      className="w-20 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50"
    />
  )
}

function randToken(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

export function AdminIntegraciones() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<IntegSettings | null>(null)
  const [mqttStatus, setMqttStatus] = useState<MqttStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const loadMqttStatus = async () => {
    try {
      const r = await fetchWithAuth('/api/admin/mqtt/status')
      if (r.ok) setMqttStatus(await r.json())
    } catch { /* ignore */ }
  }

  useEffect(() => {
    Promise.all([
      fetchWithAuth('/api/admin/settings').then((r) => r.json()),
      fetchWithAuth('/api/admin/mqtt/status').then((r) => r.ok ? r.json() : null),
    ]).then(([s, m]) => {
      setSettings(s)
      setMqttStatus(m)
    }).finally(() => setLoading(false))
  }, [fetchWithAuth])

  const testMqtt = async () => {
    if (!settings) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetchWithAuth('/api/admin/mqtt/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broker: settings.mqtt_broker,
          port: settings.mqtt_port,
          username: settings.mqtt_username,
          password: settings.mqtt_password,
        }),
      })
      const result = await r.json()
      setTestResult(result)
    } catch {
      setTestResult({ success: false, message: 'Error de conexión' })
    }
    setTesting(false)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setMessage(null)
    setTestResult(null)
    try {
      const res = await fetchWithAuth('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) {
        setMessage({ type: 'ok', text: 'Guardado' })
        setTimeout(() => setMessage(null), 2000)
        // Reload MQTT status after save (reconnection may have happened)
        setTimeout(loadMqttStatus, 500)
      } else {
        setMessage({ type: 'error', text: 'Error' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Error de conexion' })
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof IntegSettings>(key: K, value: IntegSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Integraciones</h1>
          <p className="text-slate-400 text-sm">MQTT y servicios externos</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* MQTT / Home Assistant */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <Toggle enabled={settings.mqtt_enabled} onChange={(v) => update('mqtt_enabled', v)} />
          <span className="text-sm font-medium">🏠 MQTT / Home Assistant</span>
          {settings.mqtt_enabled && mqttStatus && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              mqttStatus.connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {mqttStatus.connected ? '● Conectado' : '○ Desconectado'}
            </span>
          )}
        </div>

        {settings.mqtt_enabled && (
          <div className="space-y-4">
            {/* Connection settings */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14">Broker</span>
                <TextField value={settings.mqtt_broker} onChange={(v) => update('mqtt_broker', v)} placeholder="localhost" className="flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14">Puerto</span>
                <NumField value={settings.mqtt_port} onChange={(v) => update('mqtt_port', v)} min={1} max={65535} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14">Topic</span>
                <TextField value={settings.mqtt_topic} onChange={(v) => update('mqtt_topic', v)} placeholder="weather/ecowitt" className="flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14">Usuario</span>
                <TextField value={settings.mqtt_username} onChange={(v) => update('mqtt_username', v)} placeholder="(opcional)" className="flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14">Password</span>
                <TextField value={settings.mqtt_password} onChange={(v) => update('mqtt_password', v)} placeholder="(opcional)" type="password" masked={settings.mqtt_password_masked} className="flex-1" />
              </div>
            </div>

            {/* Home Assistant Discovery */}
            <div className="border-t border-white/5 pt-3">
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.hass_discovery}
                    onChange={(e) => update('hass_discovery', e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-sky-500"
                  />
                  <span className="text-sm">Home Assistant Auto-Discovery</span>
                </label>
                {settings.hass_discovery && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Prefijo:</span>
                    <TextField
                      value={settings.hass_discovery_prefix}
                      onChange={(v) => update('hass_discovery_prefix', v)}
                      placeholder="homeassistant"
                      className="w-36"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Test connection */}
            <div className="border-t border-white/5 pt-3 flex items-center gap-3 flex-wrap">
              <button
                onClick={testMqtt}
                disabled={testing || !settings.mqtt_broker}
                className="text-sm text-sky-400 hover:text-sky-300 disabled:text-slate-500"
              >
                {testing ? 'Probando...' : '🔌 Probar conexión'}
              </button>
              {testResult && (
                <span className={`text-xs ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResult.message}
                </span>
              )}
              {mqttStatus?.last_error && !testResult && (
                <span className="text-xs text-red-400">Último error: {mqttStatus.last_error}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* WAQI */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm font-medium">🌫️ WAQI (Calidad del aire)</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
            settings.waqi_token || settings.waqi_token_masked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-slate-400'
          }`}>
            {settings.waqi_token || settings.waqi_token_masked ? '✓ Configurado' : 'Sin token'}
          </span>
          <a href="https://aqicn.org/data-platform/token/" target="_blank" className="text-sky-400 text-xs ml-auto">Obtener token →</a>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-14">Token</span>
          <TextField value={settings.waqi_token} onChange={(v) => update('waqi_token', v)} placeholder="Token API" type="password" masked={settings.waqi_token_masked} className="flex-1 max-w-md" />
        </div>
        <p className="text-xs text-slate-500 mt-2">Permite obtener datos AQI e IMECA para alertas de calidad del aire</p>
      </div>

      {/* Seguridad del endpoint de push */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <Toggle enabled={settings.ecowitt_secure_enabled} onChange={(v) => update('ecowitt_secure_enabled', v)} />
          <span className="text-sm font-medium">🔒 Seguridad del endpoint (push)</span>
          {settings.ecowitt_secure_enabled && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
              settings.ecowitt_secure_token || settings.ecowitt_secure_token_masked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
            }`}>
              {settings.ecowitt_secure_token || settings.ecowitt_secure_token_masked ? '✓ Token activo' : '⚠ Falta token'}
            </span>
          )}
        </div>

        {settings.ecowitt_secure_enabled && (
          <div className="grid gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-20">Token</span>
              <TextField value={settings.ecowitt_secure_token} onChange={(v) => update('ecowitt_secure_token', v)} placeholder="token secreto" type="password" masked={settings.ecowitt_secure_token_masked} className="flex-1 max-w-md" />
              <button type="button" onClick={() => update('ecowitt_secure_token', randToken())} className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 whitespace-nowrap">Generar</button>
            </div>
            <p className="text-xs text-slate-500">
              Con esto activo, el datalogger debe enviar a <code className="text-sky-300">/data/report/?token=…</code> (configura ese Path en WS View Plus). Deja el token en blanco para conservar el actual.
            </p>
          </div>
        )}

        <div className="border-t border-white/5 pt-3 flex items-center gap-2">
          <span className="text-xs text-slate-400 w-20">IP allowlist</span>
          <TextField value={settings.ecowitt_ip_allowlist} onChange={(v) => update('ecowitt_ip_allowlist', v)} placeholder="p.ej. 189.203.10.5 (vacío = todas)" className="flex-1 max-w-md" />
        </div>
        <p className="text-xs text-slate-500 mt-2">Solo acepta datos desde estas IPs (separadas por coma). Útil si tu IP pública es fija; déjala vacía si es dinámica.</p>
      </div>

      {/* Info */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4 text-xs text-slate-500">
        <p><span className="text-slate-400">MQTT:</span> Publica datos en <span className="text-slate-300">{settings.mqtt_topic}/state</span> como JSON · Se reconecta automáticamente al guardar</p>
        {settings.hass_discovery && (
          <p className="mt-1"><span className="text-slate-400">HA Discovery:</span> Sensores en <span className="text-slate-300">{settings.hass_discovery_prefix}/sensor/ecowitt/*/config</span> · Aparecen automáticamente en Home Assistant</p>
        )}
        <p className="mt-1"><span className="text-slate-400">WAQI:</span> Consulta calidad del aire cada 15 min para alertas (AQI/IMECA)</p>
      </div>
    </div>
  )
}
