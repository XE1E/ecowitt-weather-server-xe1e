import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface NotifSettings {
  telegram_enabled: boolean
  telegram_bot_token: string | null
  telegram_bot_token_masked: string | null
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

function TextField({ value, onChange, placeholder, type = 'text', masked }: {
  value: string | null; onChange: (v: string) => void; placeholder: string; type?: string; masked?: string | null
}) {
  const displayValue = value || ''
  const showMasked = !value && masked
  return (
    <input
      type={type}
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      placeholder={showMasked ? `(${masked})` : placeholder}
      className="flex-1 min-w-0 rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
    />
  )
}

export function AdminNotificaciones() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<NotifSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
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

  const handleTest = async () => {
    setTesting(true)
    setMessage(null)
    try {
      const res = await fetchWithAuth('/api/admin/test-telegram', { method: 'POST' })
      if (res.ok) {
        setMessage({ type: 'ok', text: 'Mensaje de prueba enviado' })
      } else {
        const err = await res.json()
        setMessage({ type: 'error', text: err.detail || 'Error al enviar' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Error de conexion' })
    } finally {
      setTesting(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const update = <K extends keyof NotifSettings>(key: K, value: NotifSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Notificaciones</h1>
          <p className="text-slate-400 text-sm">Telegram</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Telegram config */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-4 mb-4">
          <Toggle enabled={settings.telegram_enabled} onChange={(v) => update('telegram_enabled', v)} label="Telegram habilitado" />
          {settings.telegram_enabled && settings.telegram_chat_id && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="text-sky-400 hover:text-sky-300 text-sm ml-auto"
            >
              {testing ? 'Enviando...' : 'Enviar prueba'}
            </button>
          )}
        </div>

        {settings.telegram_enabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Bot Token</label>
              <TextField
                value={settings.telegram_bot_token}
                onChange={(v) => update('telegram_bot_token', v)}
                placeholder="123456789:ABCdefGHI..."
                type="password"
                masked={settings.telegram_bot_token_masked}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Chat ID</label>
              <TextField
                value={settings.telegram_chat_id}
                onChange={(v) => update('telegram_chat_id', v)}
                placeholder="-1001234567890"
              />
            </div>
          </div>
        )}
      </div>

      {/* Instrucciones */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4">
        <h3 className="text-sm font-medium mb-2">Como configurar Telegram</h3>
        <ol className="text-xs text-slate-400 space-y-2 list-decimal list-inside">
          <li>Abre Telegram y busca <span className="text-slate-300">@BotFather</span></li>
          <li>Envia <span className="text-slate-300">/newbot</span> y sigue las instrucciones para crear tu bot</li>
          <li>Copia el <span className="text-slate-300">Bot Token</span> que te da BotFather</li>
          <li>Crea un grupo o canal y agrega tu bot como administrador</li>
          <li>Para obtener el Chat ID:
            <ul className="list-disc list-inside ml-4 mt-1 text-slate-500">
              <li>Envia un mensaje al grupo/canal</li>
              <li>Visita: <span className="text-slate-400">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span></li>
              <li>Busca el campo "chat":{"{"}"id": en la respuesta</li>
            </ul>
          </li>
          <li>Pega el token y chat ID aqui y guarda</li>
        </ol>
      </div>

      {/* Que se notifica */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4">
        <h3 className="text-sm font-medium mb-2">Que se notifica</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { icon: '🌡️', label: 'Temperatura extrema' },
            { icon: '💨', label: 'Viento fuerte' },
            { icon: '🌧️', label: 'Lluvia intensa' },
            { icon: '📊', label: 'Presion anormal' },
            { icon: '📡', label: 'Estacion offline' },
            { icon: '🔋', label: 'Bateria baja' },
            { icon: '🌫️', label: 'Calidad aire' },
          ].map(({ icon, label }) => (
            <span key={label} className="text-xs bg-slate-700/50 text-slate-300 px-2 py-1 rounded">
              {icon} {label}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Los umbrales se configuran en <a href="/admin/alertas" className="text-sky-400">Alertas</a>
        </p>
      </div>
    </div>
  )
}
