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
  waqi_token: string | null
  waqi_token_masked: string | null
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
  const displayValue = value || ''
  const showMasked = !value && masked
  return (
    <input
      type={type}
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      placeholder={showMasked ? `(${masked})` : placeholder}
      className={`rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50 ${className}`}
    />
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

export function AdminIntegraciones() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<IntegSettings | null>(null)
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
          <span className="text-xs text-slate-500">Auto-discovery habilitado</span>
        </div>

        {settings.mqtt_enabled && (
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
        )}
      </div>

      {/* WAQI */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm font-medium">🌫️ WAQI (Calidad del aire)</span>
          <a href="https://aqicn.org/data-platform/token/" target="_blank" className="text-sky-400 text-xs ml-auto">Obtener token →</a>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-14">Token</span>
          <TextField value={settings.waqi_token} onChange={(v) => update('waqi_token', v)} placeholder="Token API" type="password" masked={settings.waqi_token_masked} className="flex-1 max-w-md" />
        </div>
        <p className="text-xs text-slate-500 mt-2">Permite obtener datos AQI e IMECA para alertas de calidad del aire</p>
      </div>

      {/* Info */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4 text-xs text-slate-500">
        <p><span className="text-slate-400">MQTT:</span> Los sensores aparecen automaticamente en Home Assistant via discovery · Topic base: <span className="text-slate-300">{settings.mqtt_topic}</span></p>
        <p className="mt-1"><span className="text-slate-400">WAQI:</span> Los datos se consultan cada 15 minutos · Se usan para alertas, no se almacenan</p>
      </div>
    </div>
  )
}
