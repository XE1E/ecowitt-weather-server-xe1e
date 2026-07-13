import { useState, useEffect } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface CalSettings {
  cal_enabled: boolean
  cal_temp_offset: number
  cal_humidity_offset: number
  cal_pressure_offset: number
  cal_wind_mult: number
  cal_rain_mult: number
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

function NumField({ value, onChange, min, max, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className="w-20 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50"
    />
  )
}

export function AdminCalibracion() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<CalSettings | null>(null)
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

  const update = <K extends keyof CalSettings>(key: K, value: CalSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Calibracion</h1>
          <p className="text-slate-400 text-sm">Offsets y multiplicadores</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Master switch */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 flex items-center gap-4">
        <Toggle enabled={settings.cal_enabled} onChange={(v) => update('cal_enabled', v)} label="Calibracion habilitada" />
        <span className="text-xs text-slate-500">Los ajustes se aplican antes de almacenar y publicar</span>
      </div>

      {/* Offsets y Multiplicadores en grid compacto */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Temperatura */}
          <div>
            <p className="text-sm font-medium mb-1">🌡️ Temperatura</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Offset</span>
              <NumField value={settings.cal_temp_offset} onChange={(v) => update('cal_temp_offset', v)} min={-10} max={10} step={0.1} />
              <span className="text-xs text-slate-500">°C</span>
            </div>
          </div>

          {/* Humedad */}
          <div>
            <p className="text-sm font-medium mb-1">💧 Humedad</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Offset</span>
              <NumField value={settings.cal_humidity_offset} onChange={(v) => update('cal_humidity_offset', v)} min={-20} max={20} step={1} />
              <span className="text-xs text-slate-500">%</span>
            </div>
          </div>

          {/* Presion */}
          <div>
            <p className="text-sm font-medium mb-1">📊 Presion</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Offset</span>
              <NumField value={settings.cal_pressure_offset} onChange={(v) => update('cal_pressure_offset', v)} min={-50} max={50} step={0.1} />
              <span className="text-xs text-slate-500">hPa</span>
            </div>
          </div>

          {/* Viento */}
          <div>
            <p className="text-sm font-medium mb-1">💨 Viento</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Factor</span>
              <NumField value={settings.cal_wind_mult} onChange={(v) => update('cal_wind_mult', v)} min={0.5} max={2} step={0.01} />
              <span className="text-xs text-slate-500">×</span>
            </div>
          </div>

          {/* Lluvia */}
          <div>
            <p className="text-sm font-medium mb-1">🌧️ Lluvia</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Factor</span>
              <NumField value={settings.cal_rain_mult} onChange={(v) => update('cal_rain_mult', v)} min={0.5} max={2} step={0.01} />
              <span className="text-xs text-slate-500">×</span>
            </div>
          </div>
        </div>
      </div>

      {/* Info compacta */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4 text-xs text-slate-500">
        <span className="text-slate-400">Offset:</span> se suma al valor (ej: -0.5 si lee 0.5° de mas) ·
        <span className="text-slate-400 ml-2">Factor:</span> multiplica el valor (1.0 = sin cambio, 1.1 = +10%)
      </div>
    </div>
  )
}
