import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface PubSettings {
  wu_enabled: boolean
  wu_station_id: string | null
  wu_station_key: string | null
  wu_station_key_masked: string | null
  wu_interval: number
  pws_enabled: boolean
  pws_station_id: string | null
  pws_password: string | null
  pws_password_masked: string | null
  pws_interval: number
  windy_enabled: boolean
  windy_api_key: string | null
  windy_api_key_masked: string | null
  windy_interval: number
  owm_enabled: boolean
  owm_api_key: string | null
  owm_api_key_masked: string | null
  owm_station_id: string | null
  owm_interval: number
  cwop_enabled: boolean
  cwop_callsign: string | null
  cwop_passcode: string | null
  cwop_passcode_masked: string | null
  cwop_latitude: number
  cwop_longitude: number
  cwop_interval: number
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
      className="flex-1 min-w-0 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
    />
  )
}

function NumField({ value, onChange, step = 0.000001 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      step={step}
      className="w-28 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50"
    />
  )
}

function IntervalField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 w-16">Intervalo</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value ?? 0}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value))))}
        className="w-16 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50"
      />
      <span className="text-xs text-slate-500">min (0 = cada dato)</span>
    </div>
  )
}

export function AdminPublicacion() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<PubSettings | null>(null)
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

  const update = <K extends keyof PubSettings>(key: K, value: PubSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Publicacion</h1>
          <p className="text-slate-400 text-sm">Redes meteorologicas publicas</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Weather Underground */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.wu_enabled} onChange={(v) => update('wu_enabled', v)} />
            <span className="text-sm font-medium">Weather Underground</span>
            <a href="https://www.wunderground.com/member/devices" target="_blank" className="text-sky-400 text-xs ml-auto">Obtener ID →</a>
          </div>
          {settings.wu_enabled && (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">Station ID</span>
                <TextField value={settings.wu_station_id} onChange={(v) => update('wu_station_id', v)} placeholder="ICDMX123" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">Key</span>
                <TextField value={settings.wu_station_key} onChange={(v) => update('wu_station_key', v)} placeholder="API key" type="password" masked={settings.wu_station_key_masked} />
              </div>
              <IntervalField value={settings.wu_interval} onChange={(v) => update('wu_interval', v)} />
            </div>
          )}
        </div>

        {/* PWSWeather */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.pws_enabled} onChange={(v) => update('pws_enabled', v)} />
            <span className="text-sm font-medium">PWSWeather</span>
            <a href="https://www.pwsweather.com/register.php" target="_blank" className="text-sky-400 text-xs ml-auto">Registrar →</a>
          </div>
          {settings.pws_enabled && (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">Station ID</span>
                <TextField value={settings.pws_station_id} onChange={(v) => update('pws_station_id', v)} placeholder="STATIONID" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">Password</span>
                <TextField value={settings.pws_password} onChange={(v) => update('pws_password', v)} placeholder="Password" type="password" masked={settings.pws_password_masked} />
              </div>
              <IntervalField value={settings.pws_interval} onChange={(v) => update('pws_interval', v)} />
            </div>
          )}
        </div>

        {/* Windy */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.windy_enabled} onChange={(v) => update('windy_enabled', v)} />
            <span className="text-sm font-medium">Windy.com</span>
            <a href="https://stations.windy.com/" target="_blank" className="text-sky-400 text-xs ml-auto">Obtener API →</a>
          </div>
          {settings.windy_enabled && (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">API Key</span>
                <TextField value={settings.windy_api_key} onChange={(v) => update('windy_api_key', v)} placeholder="API key" type="password" masked={settings.windy_api_key_masked} />
              </div>
              <IntervalField value={settings.windy_interval} onChange={(v) => update('windy_interval', v)} />
            </div>
          )}
        </div>

        {/* OpenWeatherMap */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.owm_enabled} onChange={(v) => update('owm_enabled', v)} />
            <span className="text-sm font-medium">OpenWeatherMap</span>
            <a href="https://home.openweathermap.org/stations" target="_blank" className="text-sky-400 text-xs ml-auto">Crear estacion →</a>
          </div>
          {settings.owm_enabled && (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">API Key</span>
                <TextField value={settings.owm_api_key} onChange={(v) => update('owm_api_key', v)} placeholder="API key" type="password" masked={settings.owm_api_key_masked} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">Station ID</span>
                <TextField value={settings.owm_station_id} onChange={(v) => update('owm_station_id', v)} placeholder="Station ID" />
              </div>
              <IntervalField value={settings.owm_interval} onChange={(v) => update('owm_interval', v)} />
            </div>
          )}
        </div>

        {/* CWOP */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.cwop_enabled} onChange={(v) => update('cwop_enabled', v)} />
            <span className="text-sm font-medium">CWOP / APRS-IS</span>
            <span className="text-xs text-slate-500">(entra a MADIS/NOAA)</span>
            <a href="http://www.wxqa.com/SIGN-UP.html" target="_blank" className="text-sky-400 text-xs ml-auto">Registrar →</a>
          </div>
          {settings.cwop_enabled && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Callsign</span>
                <TextField value={settings.cwop_callsign} onChange={(v) => update('cwop_callsign', v)} placeholder="XE1E o CW1234" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Passcode</span>
                <TextField value={settings.cwop_passcode} onChange={(v) => update('cwop_passcode', v)} placeholder="-1" masked={settings.cwop_passcode_masked} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Lat</span>
                <NumField value={settings.cwop_latitude} onChange={(v) => update('cwop_latitude', v)} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Lon</span>
                <NumField value={settings.cwop_longitude} onChange={(v) => update('cwop_longitude', v)} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Intervalo</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={settings.cwop_interval ?? 10}
                  onChange={(e) => update('cwop_interval', Math.max(0, Math.round(Number(e.target.value))))}
                  className="w-16 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50"
                />
                <span className="text-xs text-slate-500">min</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4 text-xs text-slate-500">
        Cada red se publica según su intervalo (CWOP recomienda 10-15 min; 0 = en cada dato recibido) · Las claves se guardan encriptadas · Deja en blanco para conservar valor actual
      </div>
    </div>
  )
}
