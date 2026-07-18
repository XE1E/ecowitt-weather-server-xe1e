import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../admin-auth'

interface Station {
  name: string | null
  label: string
  status: 'online' | 'offline' | 'unknown'
  model: string | null
  sensors_detail: { id: string; type: string; label: string; category: string }[]
}

interface WizardData {
  station_label: string
  cwop_latitude: number
  cwop_longitude: number
  timezone_offset: number
  alerts_enabled: boolean
  telegram_enabled: boolean
  telegram_bot_token: string
  telegram_chat_id: string
  wu_enabled: boolean
  wu_station_id: string
  wu_station_key: string
  windy_enabled: boolean
  windy_api_key: string
}

const STEPS = [
  { key: 'welcome', title: 'Bienvenida', icon: '👋' },
  { key: 'station', title: 'Estación', icon: '📡' },
  { key: 'alerts', title: 'Alertas', icon: '🔔' },
  { key: 'publish', title: 'Publicación', icon: '📤' },
  { key: 'done', title: 'Listo', icon: '✅' },
]

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`w-3 h-3 rounded-full transition-colors ${
            i < current ? 'bg-sky-500' : i === current ? 'bg-sky-400' : 'bg-slate-600'
          }`}
        />
      ))}
    </div>
  )
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <div className="text-6xl mb-6">🌦️</div>
      <h2 className="text-2xl font-bold mb-4">Bienvenido al Panel de Administración</h2>
      <p className="text-slate-400 mb-8 max-w-md mx-auto">
        Tu estación está enviando datos correctamente. Vamos a configurar
        lo básico para que puedas sacarle el máximo provecho.
      </p>
      <button
        onClick={onNext}
        className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-8 py-3 rounded-lg transition-colors"
      >
        Comenzar configuración
      </button>
    </div>
  )
}

function StationStep({
  stations,
  data,
  onChange,
  onNext,
  onBack,
}: {
  stations: Station[]
  data: WizardData
  onChange: (d: Partial<WizardData>) => void
  onNext: () => void
  onBack: () => void
}) {
  const principal = stations.find(s => s.name === null)
  const sensors = principal?.sensors_detail || []

  return (
    <div>
      <h2 className="text-xl font-bold mb-2 text-center">Verifica tu estación</h2>
      <p className="text-slate-400 text-sm text-center mb-6">
        Confirma que la estación está correctamente detectada
      </p>

      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🏠</span>
          <div>
            <p className="font-medium">Estación Principal</p>
            <p className="text-sm text-slate-400">{principal?.model || 'Ecowitt'}</p>
          </div>
          <span className={`ml-auto text-xs px-2 py-1 rounded ${
            principal?.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'
          }`}>
            {principal?.status === 'online' ? '🟢 Online' : '⚪ Esperando datos'}
          </span>
        </div>

        <div className="space-y-2 mb-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Sensores detectados</p>
          {sensors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {sensors.map(s => (
                <span key={s.id} className="text-xs bg-slate-700/50 px-2 py-1 rounded">
                  {s.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm italic">Esperando primera lectura...</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-slate-300 mb-1">
            Nombre de la estación (opcional)
          </label>
          <input
            type="text"
            value={data.station_label}
            onChange={e => onChange({ station_label: e.target.value })}
            placeholder="Ej: Casa, Oficina, Terraza"
            className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
          />
        </div>

        <div className="border-t border-white/10 pt-4 mt-4">
          <p className="text-sm text-slate-300 mb-3">Ubicación y zona horaria</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Latitud</label>
              <input
                type="number"
                step="0.000001"
                value={data.cwop_latitude}
                onChange={e => onChange({ cwop_latitude: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Longitud</label>
              <input
                type="number"
                step="0.000001"
                value={data.cwop_longitude}
                onChange={e => onChange({ cwop_longitude: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Zona horaria (UTC offset)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="-12"
                  max="14"
                  value={data.timezone_offset}
                  onChange={e => onChange({ timezone_offset: parseInt(e.target.value) || 0 })}
                  className="w-20 rounded-lg bg-slate-900/50 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500/50"
                />
                <span className="text-xs text-slate-500">
                  {data.timezone_offset >= 0 ? `UTC+${data.timezone_offset}` : `UTC${data.timezone_offset}`}
                </span>
                <span className="text-xs text-slate-600 ml-auto">Ej: -6 México Central</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Coordenadas para calcular amanecer/atardecer y fases lunares
          </p>
        </div>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2">
          ← Atrás
        </button>
        <button
          onClick={onNext}
          className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-6 py-2 rounded-lg"
        >
          Continuar
        </button>
      </div>
    </div>
  )
}

function AlertsStep({
  data,
  onChange,
  onNext,
  onBack,
  onTest,
  testing,
  testResult,
}: {
  data: WizardData
  onChange: (d: Partial<WizardData>) => void
  onNext: () => void
  onBack: () => void
  onTest: () => void
  testing: boolean
  testResult: { ok: boolean; message: string } | null
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2 text-center">Configura las alertas</h2>
      <p className="text-slate-400 text-sm text-center mb-6">
        Recibe notificaciones cuando algo importante ocurra
      </p>

      <div className="space-y-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data.alerts_enabled}
            onChange={e => onChange({ alerts_enabled: e.target.checked })}
            className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
          />
          <div>
            <p className="font-medium">Habilitar alertas</p>
            <p className="text-sm text-slate-400">Temperatura, viento, lluvia, presión, etc.</p>
          </div>
        </label>

        <div className="border-t border-white/10 pt-4">
          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={data.telegram_enabled}
              onChange={e => onChange({ telegram_enabled: e.target.checked })}
              className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
            />
            <div>
              <p className="font-medium">Notificaciones por Telegram</p>
              <p className="text-sm text-slate-400">Recibe alertas en tu móvil</p>
            </div>
          </label>

          {data.telegram_enabled && (
            <div className="space-y-4 pl-8 animate-in slide-in-from-top-2">
              <div className="bg-slate-800/30 rounded-lg p-3 text-sm text-slate-400">
                <p className="font-medium text-slate-300 mb-2">¿Cómo obtener los datos?</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Abre Telegram y busca @BotFather</li>
                  <li>Envía /newbot y sigue las instrucciones</li>
                  <li>Copia el token que te da</li>
                  <li>Para el Chat ID, busca @userinfobot y envía cualquier mensaje</li>
                </ol>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Bot Token</label>
                <input
                  type="password"
                  value={data.telegram_bot_token}
                  onChange={e => onChange({ telegram_bot_token: e.target.value })}
                  placeholder="123456789:ABCdefGHI..."
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Chat ID</label>
                <input
                  type="text"
                  value={data.telegram_chat_id}
                  onChange={e => onChange({ telegram_chat_id: e.target.value })}
                  placeholder="123456789"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
              {data.telegram_bot_token && data.telegram_chat_id && (
                <div>
                  <button
                    onClick={onTest}
                    disabled={testing}
                    className="text-sky-400 hover:text-sky-300 text-sm disabled:text-slate-500"
                  >
                    {testing ? 'Enviando...' : '🧪 Enviar mensaje de prueba'}
                  </button>
                  {testResult && (
                    <p className={`text-sm mt-1 ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2">
          ← Atrás
        </button>
        <button
          onClick={onNext}
          className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-6 py-2 rounded-lg"
        >
          Continuar
        </button>
      </div>
    </div>
  )
}

function PublishStep({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: WizardData
  onChange: (d: Partial<WizardData>) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2 text-center">Comparte tus datos</h2>
      <p className="text-slate-400 text-sm text-center mb-6">
        Publica tu estación en redes meteorológicas públicas (opcional)
      </p>

      <div className="space-y-4">
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.wu_enabled}
              onChange={e => onChange({ wu_enabled: e.target.checked })}
              className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
            />
            <div>
              <p className="font-medium">Weather Underground</p>
              <p className="text-sm text-slate-400">wunderground.com</p>
            </div>
          </label>
          {data.wu_enabled && (
            <div className="mt-4 space-y-3 pl-8">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Station ID</label>
                <input
                  type="text"
                  value={data.wu_station_id}
                  onChange={e => onChange({ wu_station_id: e.target.value })}
                  placeholder="KMYSTATION1"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Station Key</label>
                <input
                  type="password"
                  value={data.wu_station_key}
                  onChange={e => onChange({ wu_station_key: e.target.value })}
                  placeholder="Tu clave de estación"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.windy_enabled}
              onChange={e => onChange({ windy_enabled: e.target.checked })}
              className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
            />
            <div>
              <p className="font-medium">Windy</p>
              <p className="text-sm text-slate-400">windy.com</p>
            </div>
          </label>
          {data.windy_enabled && (
            <div className="mt-4 pl-8">
              <label className="block text-sm text-slate-300 mb-1">API Key</label>
              <input
                type="password"
                value={data.windy_api_key}
                onChange={e => onChange({ windy_api_key: e.target.value })}
                placeholder="Tu API key de Windy"
                className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
              />
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-sm">
          Puedes configurar más redes después en Publicación
        </p>
      </div>

      <div className="flex justify-between mt-8">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2">
          ← Atrás
        </button>
        <button
          onClick={onNext}
          className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-6 py-2 rounded-lg"
        >
          Continuar
        </button>
      </div>
    </div>
  )
}

function DoneStep({
  data,
  saving,
  onFinish,
  onBack,
}: {
  data: WizardData
  saving: boolean
  onFinish: () => void
  onBack: () => void
}) {
  const tzLabel = data.timezone_offset >= 0 ? `UTC+${data.timezone_offset}` : `UTC${data.timezone_offset}`
  const features = [
    `Ubicación: ${data.cwop_latitude.toFixed(4)}, ${data.cwop_longitude.toFixed(4)}`,
    `Zona horaria: ${tzLabel}`,
    data.alerts_enabled && 'Alertas habilitadas',
    data.telegram_enabled && 'Notificaciones Telegram',
    data.wu_enabled && 'Weather Underground',
    data.windy_enabled && 'Windy',
  ].filter(Boolean)

  return (
    <div className="text-center">
      <div className="text-6xl mb-6">🎉</div>
      <h2 className="text-2xl font-bold mb-4">¡Todo listo!</h2>
      <p className="text-slate-400 mb-6 max-w-md mx-auto">
        Tu estación está configurada y lista para funcionar.
      </p>

      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 mb-6 text-left max-w-sm mx-auto">
        <p className="text-sm text-slate-400 mb-3">Configuración:</p>
        <ul className="space-y-2">
          <li className="flex items-center gap-2 text-sm">
            <span className="text-emerald-400">✓</span>
            <span>Estación: {data.station_label || 'Principal'}</span>
          </li>
          {features.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="text-emerald-400">✓</span>
              <span>{f}</span>
            </li>
          ))}
          {features.length === 0 && (
            <li className="text-slate-500 text-sm italic">
              Sin características adicionales (puedes agregarlas después)
            </li>
          )}
        </ul>
      </div>

      <div className="flex justify-center gap-4">
        <button
          onClick={onBack}
          disabled={saving}
          className="text-slate-400 hover:text-white px-4 py-2 disabled:opacity-50"
        >
          ← Atrás
        </button>
        <button
          onClick={onFinish}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-medium px-8 py-3 rounded-lg transition-colors"
        >
          {saving ? 'Guardando...' : 'Finalizar y entrar al panel'}
        </button>
      </div>
    </div>
  )
}

function WizardLogin({ onLogin }: { onLogin: () => void }) {
  const { login } = useAdminAuth()
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const ok = await login(user, pass)
    setLoading(false)
    if (ok) {
      onLogin()
    } else {
      setError('Credenciales inválidas')
    }
  }

  return (
    <div className="text-center">
      <div className="text-4xl mb-4">🔐</div>
      <h2 className="text-xl font-bold mb-2">Inicia sesión</h2>
      <p className="text-slate-400 text-sm mb-6">
        Ingresa tus credenciales de administrador para continuar
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <div>
          <label className="block text-sm text-slate-300 mb-1">Usuario</label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
            placeholder="admin"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-300 mb-1">Contraseña</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
          />
        </div>
        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !user || !pass}
          className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white font-medium py-2.5 rounded-lg"
        >
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}

export function AdminWizard() {
  const navigate = useNavigate()
  const { isAuthenticated, fetchWithAuth } = useAdminAuth()
  const [step, setStep] = useState(0)
  const [stations, setStations] = useState<Station[]>([])
  const [needsLogin, setNeedsLogin] = useState(!isAuthenticated)
  const [data, setData] = useState<WizardData>({
    station_label: '',
    cwop_latitude: 19.380359,
    cwop_longitude: -99.174564,
    timezone_offset: -6,
    alerts_enabled: true,
    telegram_enabled: false,
    telegram_bot_token: '',
    telegram_chat_id: '',
    wu_enabled: false,
    wu_station_id: '',
    wu_station_key: '',
    windy_enabled: false,
    windy_api_key: '',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/stations').then(r => r.json()).then(j => setStations(j.stations || []))
  }, [])

  const updateData = (partial: Partial<WizardData>) => {
    setData(d => ({ ...d, ...partial }))
    setTestResult(null)
  }

  const testTelegram = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetchWithAuth('/api/admin/wizard/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_token: data.telegram_bot_token,
          chat_id: data.telegram_chat_id,
        }),
      })
      const j = await r.json()
      setTestResult({ ok: r.ok, message: j.message || (r.ok ? 'Mensaje enviado' : 'Error') })
    } catch {
      setTestResult({ ok: false, message: 'Error de conexión' })
    }
    setTesting(false)
  }

  const finish = async () => {
    setSaving(true)
    try {
      const settings: Record<string, unknown> = {
        alerts_enabled: data.alerts_enabled,
        telegram_enabled: data.telegram_enabled,
        cwop_latitude: data.cwop_latitude,
        cwop_longitude: data.cwop_longitude,
        timezone_offset: data.timezone_offset,
      }
      if (data.telegram_enabled && data.telegram_bot_token) {
        settings.telegram_bot_token = data.telegram_bot_token
        settings.telegram_chat_id = data.telegram_chat_id
      }
      if (data.wu_enabled) {
        settings.wu_enabled = true
        settings.wu_station_id = data.wu_station_id
        if (data.wu_station_key) settings.wu_station_key = data.wu_station_key
      }
      if (data.windy_enabled) {
        settings.windy_enabled = true
        if (data.windy_api_key) settings.windy_api_key = data.windy_api_key
      }

      await fetchWithAuth('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (data.station_label) {
        await fetchWithAuth('/api/admin/stations/_principal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: data.station_label }),
        })
      }

      await fetchWithAuth('/api/admin/setup-complete', { method: 'POST' })

      navigate('/admin')
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {needsLogin ? (
          <div className="bg-slate-800/80 backdrop-blur rounded-2xl border border-white/10 p-8 shadow-xl">
            <WizardLogin onLogin={() => setNeedsLogin(false)} />
          </div>
        ) : (
          <>
            <StepIndicator current={step} total={STEPS.length} />
            <div className="bg-slate-800/80 backdrop-blur rounded-2xl border border-white/10 p-8 shadow-xl">
              {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
              {step === 1 && (
                <StationStep
                  stations={stations}
                  data={data}
                  onChange={updateData}
                  onNext={() => setStep(2)}
                  onBack={() => setStep(0)}
                />
              )}
              {step === 2 && (
                <AlertsStep
                  data={data}
                  onChange={updateData}
                  onNext={() => setStep(3)}
                  onBack={() => setStep(1)}
                  onTest={testTelegram}
                  testing={testing}
                  testResult={testResult}
                />
              )}
              {step === 3 && (
                <PublishStep
                  data={data}
                  onChange={updateData}
                  onNext={() => setStep(4)}
                  onBack={() => setStep(2)}
                />
              )}
              {step === 4 && (
                <DoneStep
                  data={data}
                  saving={saving}
                  onFinish={finish}
                  onBack={() => setStep(3)}
                />
              )}
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  fetchWithAuth('/api/admin/setup-complete', { method: 'POST' })
                  navigate('/admin')
                }}
                className="text-slate-500 hover:text-slate-400 text-sm"
              >
                Omitir configuración inicial →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
