import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface NotifSettings {
  telegram_enabled: boolean
  telegram_bot_token: string | null
  telegram_bot_token_masked: string | null
  telegram_chat_id: string | null
  telegram_categories: string[] | null
  email_enabled: boolean
  smtp_host: string | null
  smtp_port: number
  smtp_user: string | null
  smtp_password: string | null
  smtp_password_masked: string | null
  smtp_tls: boolean
  email_from: string | null
  email_to: string | null
  email_categories: string[] | null
}

// Categorías de alerta (deben coincidir con alerts.ALERT_CATEGORIES del backend)
const CATEGORIES = [
  { key: 'temp', icon: '🌡️', label: 'Temperatura' },
  { key: 'wind', icon: '💨', label: 'Viento' },
  { key: 'rain', icon: '🌧️', label: 'Lluvia' },
  { key: 'pressure', icon: '📊', label: 'Presion' },
  { key: 'station', icon: '📡', label: 'Estacion offline' },
  { key: 'battery', icon: '🔋', label: 'Bateria baja' },
  { key: 'sensor', icon: '📶', label: 'Sensor perdido' },
  { key: 'air', icon: '🌫️', label: 'Calidad aire' },
] as const

const ALL_KEYS = CATEGORIES.map((c) => c.key)

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

// null = todas las categorías; array = solo esas; [] = ninguna
function CategoryPicker({ selected, onChange }: { selected: string[] | null; onChange: (v: string[]) => void }) {
  const sel = selected ?? ALL_KEYS
  const toggle = (key: string) => {
    const next = sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]
    onChange(next)
  }
  const allOn = sel.length === ALL_KEYS.length
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">Alertas que se envian por este canal</span>
        <button
          type="button"
          onClick={() => onChange(allOn ? [] : [...ALL_KEYS])}
          className="text-xs text-sky-400 hover:text-sky-300"
        >
          {allOn ? 'Ninguna' : 'Todas'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const on = sel.includes(c.key)
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                on
                  ? 'bg-sky-600/30 border-sky-500/50 text-white'
                  : 'bg-slate-700/40 border-white/10 text-slate-500 hover:text-slate-300'
              }`}
            >
              {c.icon} {c.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CfgBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
      {ok ? '✓ Configurado' : '⚠ Falta configurar'}
    </span>
  )
}

export function AdminNotificaciones() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<NotifSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<'telegram' | 'email' | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchWithAuth('/api/admin/settings')
      .then((r) => r.json())
      .then(setSettings)
      .finally(() => setLoading(false))
  }, [fetchWithAuth])

  // Campos obligatorios cuando un canal está habilitado. Un secreto cuenta como
  // presente si ya hay un valor guardado (viene enmascarado del backend).
  const validationErrors: string[] = []
  if (settings) {
    const has = (v: string | null) => !!(v && v.trim())
    if (settings.telegram_enabled) {
      if (!has(settings.telegram_bot_token) && !settings.telegram_bot_token_masked)
        validationErrors.push('Telegram: falta el Bot Token')
      if (!has(settings.telegram_chat_id)) validationErrors.push('Telegram: falta el Chat ID')
    }
    if (settings.email_enabled) {
      if (!has(settings.smtp_host)) validationErrors.push('Correo: falta el Servidor SMTP')
      if (!has(settings.email_to)) validationErrors.push('Correo: falta el Destinatario')
    }
  }

  const handleSave = async () => {
    if (!settings) return
    if (validationErrors.length > 0) {
      setMessage({ type: 'error', text: 'Completa los campos faltantes' })
      return
    }
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

  const handleTest = async (channel: 'telegram' | 'email') => {
    setTesting(channel)
    setMessage(null)
    const url = channel === 'telegram' ? '/api/admin/test-telegram' : '/api/admin/test-email'
    try {
      const res = await fetchWithAuth(url, { method: 'POST' })
      if (res.ok) {
        setMessage({ type: 'ok', text: channel === 'email' ? 'Correo de prueba enviado' : 'Mensaje de prueba enviado' })
      } else {
        const err = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: err.detail || 'Error al enviar' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Error de conexion' })
    } finally {
      setTesting(null)
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
          <p className="text-slate-400 text-sm">Telegram y correo · elige qué alertas van a cada canal</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button
            onClick={handleSave}
            disabled={saving || validationErrors.length > 0}
            title={validationErrors.length > 0 ? validationErrors.join(' · ') : undefined}
            className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:cursor-not-allowed px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-300">
          <span className="font-medium">Faltan datos antes de guardar:</span>
          <ul className="list-disc list-inside mt-1 text-red-300/90">
            {validationErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Telegram config */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-4 mb-4">
          <Toggle enabled={settings.telegram_enabled} onChange={(v) => update('telegram_enabled', v)} label="Telegram" />
          {settings.telegram_enabled && <CfgBadge ok={(!!settings.telegram_bot_token || !!settings.telegram_bot_token_masked) && !!settings.telegram_chat_id} />}
          {settings.telegram_enabled && settings.telegram_chat_id && (
            <button
              onClick={() => handleTest('telegram')}
              disabled={testing !== null}
              className="text-sky-400 hover:text-sky-300 text-sm ml-auto disabled:text-slate-600"
            >
              {testing === 'telegram' ? 'Enviando...' : 'Enviar prueba'}
            </button>
          )}
        </div>

        {settings.telegram_enabled && (
          <div className="space-y-4">
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
            <CategoryPicker selected={settings.telegram_categories} onChange={(v) => update('telegram_categories', v)} />
          </div>
        )}
      </div>

      {/* Correo config */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-4 mb-4">
          <Toggle enabled={settings.email_enabled} onChange={(v) => update('email_enabled', v)} label="Correo (SMTP)" />
          {settings.email_enabled && <CfgBadge ok={!!settings.smtp_host && !!settings.email_to} />}
          {settings.email_enabled && settings.smtp_host && settings.email_to && (
            <button
              onClick={() => handleTest('email')}
              disabled={testing !== null}
              className="text-sky-400 hover:text-sky-300 text-sm ml-auto disabled:text-slate-600"
            >
              {testing === 'email' ? 'Enviando...' : 'Enviar prueba'}
            </button>
          )}
        </div>

        {settings.email_enabled && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Servidor SMTP</label>
                <TextField value={settings.smtp_host} onChange={(v) => update('smtp_host', v)} placeholder="smtp.gmail.com" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Puerto</label>
                <input
                  type="number"
                  value={settings.smtp_port ?? 587}
                  onChange={(e) => update('smtp_port', Math.max(1, Math.round(Number(e.target.value))))}
                  className="w-full rounded bg-slate-900/50 border border-white/10 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Usuario</label>
                <TextField value={settings.smtp_user} onChange={(v) => update('smtp_user', v)} placeholder="tucuenta@gmail.com" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Contraseña</label>
                <TextField
                  value={settings.smtp_password}
                  onChange={(v) => update('smtp_password', v)}
                  placeholder="App Password"
                  type="password"
                  masked={settings.smtp_password_masked}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Remitente (From)</label>
                <TextField value={settings.email_from} onChange={(v) => update('email_from', v)} placeholder="(por defecto = usuario)" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Destinatario(s)</label>
                <TextField value={settings.email_to} onChange={(v) => update('email_to', v)} placeholder="alguien@dominio.com, otro@..." />
              </div>
            </div>
            <Toggle enabled={settings.smtp_tls} onChange={(v) => update('smtp_tls', v)} label="Usar STARTTLS (recomendado en puerto 587; el 465 usa SSL directo)" />
            <CategoryPicker selected={settings.email_categories} onChange={(v) => update('email_categories', v)} />
          </div>
        )}
      </div>

      {/* Instrucciones */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4">
          <h3 className="text-sm font-medium mb-2">Configurar Telegram</h3>
          <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
            <li>Busca <span className="text-slate-300">@BotFather</span> y envia <span className="text-slate-300">/newbot</span></li>
            <li>Copia el <span className="text-slate-300">Bot Token</span></li>
            <li>Agrega el bot a tu grupo/canal</li>
            <li>Obtén el Chat ID en <span className="text-slate-400">api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span></li>
          </ol>
        </div>
        <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4">
          <h3 className="text-sm font-medium mb-2">Configurar correo</h3>
          <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
            <li>Usa el SMTP de tu proveedor (Gmail, tu dominio, etc.)</li>
            <li>Gmail: activa 2FA y crea una <span className="text-slate-300">App Password</span> (la contraseña normal no sirve)</li>
            <li>Puerto <span className="text-slate-300">587</span> con STARTTLS, o <span className="text-slate-300">465</span> con SSL</li>
            <li>Guarda y usa <span className="text-slate-300">Enviar prueba</span> para verificar</li>
          </ol>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Los umbrales de cada alerta se configuran en <a href="/admin/alertas" className="text-sky-400">Alertas</a> · Las claves se guardan encriptadas · Deja en blanco para conservar el valor actual
      </p>
    </div>
  )
}
