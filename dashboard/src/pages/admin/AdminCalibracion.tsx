import { useState, useEffect, type ReactNode } from 'react'
import { useAdminAuth } from '../../admin-auth'

interface CalSettings {
  cal_enabled: boolean
  cal_temp_outdoor: number; cal_temp_indoor: number
  cal_temp_ch1: number; cal_temp_ch2: number; cal_temp_ch3: number; cal_temp_ch4: number
  cal_temp_ch5: number; cal_temp_ch6: number; cal_temp_ch7: number; cal_temp_ch8: number
  cal_hum_outdoor: number; cal_hum_indoor: number
  cal_hum_ch1: number; cal_hum_ch2: number; cal_hum_ch3: number; cal_hum_ch4: number
  cal_hum_ch5: number; cal_hum_ch6: number; cal_hum_ch7: number; cal_hum_ch8: number
  cal_pressure_offset: number
  cal_wind_mult: number; cal_wind_dir_offset: number
  cal_rain_mult: number
  cal_solar_mult: number; cal_uv_offset: number
  [key: string]: number | boolean
}

const FIXED_ROWS: { label: string; t: keyof CalSettings; h: keyof CalSettings }[] = [
  { label: 'Exterior — WS69', t: 'cal_temp_outdoor', h: 'cal_hum_outdoor' },
  { label: 'Interior — WS2910', t: 'cal_temp_indoor', h: 'cal_hum_indoor' },
]
const CH_ROWS = Array.from({ length: 8 }, (_, i) => ({
  t: `cal_temp_ch${i + 1}` as keyof CalSettings,
  h: `cal_hum_ch${i + 1}` as keyof CalSettings,
  channel: i + 1,
}))

interface StationOpt { name: string; label: string }

// Calibración vacía (para estaciones secundarias que aún no tienen ajustes).
function emptyCal(): CalSettings {
  const c: Record<string, number | boolean> = {
    cal_enabled: false, cal_pressure_offset: 0, cal_wind_mult: 1, cal_wind_dir_offset: 0,
    cal_rain_mult: 1, cal_solar_mult: 1, cal_uv_offset: 0,
    cal_temp_outdoor: 0, cal_temp_indoor: 0, cal_hum_outdoor: 0, cal_hum_indoor: 0,
  }
  for (let i = 1; i <= 8; i++) { c[`cal_temp_ch${i}`] = 0; c[`cal_hum_ch${i}`] = 0 }
  return c as CalSettings
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

function NumField({ value, onChange, min, max, step = 1, disabled }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max} step={step} disabled={disabled}
      className="w-20 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50 disabled:opacity-40"
    />
  )
}

export function AdminCalibracion() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<CalSettings | null>(null)
  const [chLabels, setChLabels] = useState<Record<number, string>>({})
  const [secondaries, setSecondaries] = useState<StationOpt[]>([])
  const [selected, setSelected] = useState<string | null>(null)  // null = principal (global)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // Carga la calibración de la estación seleccionada (principal = settings global).
  const loadCal = async (sel: string | null) => {
    if (sel === null) {
      const s = await fetchWithAuth('/api/admin/settings').then((r) => r.json())
      setSettings(s)
    } else {
      const partial = await fetchWithAuth(`/api/admin/stations/${sel}/calibration`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
      setSettings({ ...emptyCal(), ...partial })
    }
  }

  useEffect(() => {
    Promise.all([
      fetchWithAuth('/api/admin/settings').then((r) => r.json()),
      fetch('/api/stations').then((r) => r.json()).catch(() => null),
    ]).then(([settingsData, stationsData]) => {
      setSettings(settingsData)
      const list = stationsData?.stations || []
      const principal = list.find((s: { name: string | null }) => s.name === null)
      if (principal) {
        const map: Record<number, string> = {}
        for (const s of principal.sensors_detail || []) {
          if (s.category === 'canal' && s.channel && s.label && s.label !== `Canal ${s.channel}`) {
            map[s.channel] = s.label
          }
        }
        setChLabels(map)
      }
      setSecondaries(
        list.filter((s: { name: string | null }) => s.name !== null)
          .map((s: { name: string; label: string }) => ({ name: s.name, label: s.label || s.name }))
      )
    }).finally(() => setLoading(false))
  }, [fetchWithAuth])

  const onSelectStation = async (sel: string | null) => {
    setSelected(sel)
    setSettings(null)
    setLoading(true)
    try { await loadCal(sel) } finally { setLoading(false) }
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
        const cal: Record<string, number | boolean> = {}
        for (const k in settings) if (k.startsWith('cal_')) cal[k] = settings[k]
        res = await fetchWithAuth(`/api/admin/stations/${selected}/calibration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cal),
        })
      }
      setMessage(res.ok ? { type: 'ok', text: 'Guardado' } : { type: 'error', text: 'Error' })
      if (res.ok) setTimeout(() => setMessage(null), 2000)
    } catch {
      setMessage({ type: 'error', text: 'Error de conexion' })
    } finally {
      setSaving(false)
    }
  }

  const update = (key: keyof CalSettings, value: number | boolean) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  const on = settings.cal_enabled
  const isPrincipal = selected === null
  const fixedRows = isPrincipal ? FIXED_ROWS : [
    { label: 'Exterior', t: 'cal_temp_outdoor' as keyof CalSettings, h: 'cal_hum_outdoor' as keyof CalSettings },
    { label: 'Interior', t: 'cal_temp_indoor' as keyof CalSettings, h: 'cal_hum_indoor' as keyof CalSettings },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Calibracion</h1>
          <p className="text-slate-400 text-sm">Ajustes por sensor · cada estación tiene su propia calibración</p>
        </div>
        <div className="flex items-center gap-3">
          {secondaries.length > 0 && (
            <select
              value={selected ?? ''}
              onChange={(e) => onSelectStation(e.target.value || null)}
              className="rounded bg-slate-900/50 border border-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
            >
              <option value="">Principal (WS69)</option>
              {secondaries.map((s) => (
                <option key={s.name} value={s.name}>{s.label}</option>
              ))}
            </select>
          )}
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Master switch */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 flex items-center gap-4">
        <Toggle enabled={settings.cal_enabled} onChange={(v) => update('cal_enabled', v)} label="Calibracion habilitada" />
        <span className="text-xs text-slate-500">Se aplica antes de almacenar y publicar. No afecta la pantalla de la consola.</span>
      </div>

      {/* Temperatura y humedad por sensor */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="text-sm font-medium mb-3">Temperatura y humedad por sensor</h2>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 items-center text-sm">
          <span className="text-xs text-slate-500"></span>
          <span className="text-xs text-slate-500 text-center">Temp (°C)</span>
          <span className="text-xs text-slate-500 text-center">Humedad (%)</span>
          {fixedRows.map((row) => (
            <RowFields
              key={row.t}
              label={row.label}
              tVal={settings[row.t] as number}
              hVal={settings[row.h] as number}
              onT={(v) => update(row.t, v)}
              onH={(v) => update(row.h, v)}
              disabled={!on}
            />
          ))}
          <div className="col-span-3 mt-2 pt-2 border-t border-white/10 text-xs font-medium text-slate-400">
            Sensor WN31 — 8 canales
          </div>
          {CH_ROWS.map((row) => (
            <RowFields
              key={row.t}
              label={chLabels[row.channel] ? `Canal ${row.channel} (${chLabels[row.channel]})` : `Canal ${row.channel}`}
              tVal={settings[row.t] as number}
              hVal={settings[row.h] as number}
              onT={(v) => update(row.t, v)}
              onH={(v) => update(row.h, v)}
              disabled={!on}
            />
          ))}
        </div>
      </div>

      {/* Presion (WS2910) y viento/lluvia/solar (WS69) */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="text-sm font-medium mb-3">Presion, viento, lluvia y solar</h2>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <Item label="📊 Presion" src="WS2910" hint="hPa">
            <NumField value={settings.cal_pressure_offset} onChange={(v) => update('cal_pressure_offset', v)} min={-50} max={50} step={0.1} disabled={!on} />
          </Item>
          <Item label="💨 Viento (factor)" src="WS69" hint="×">
            <NumField value={settings.cal_wind_mult} onChange={(v) => update('cal_wind_mult', v)} min={0.5} max={2} step={0.01} disabled={!on} />
          </Item>
          <Item label="🧭 Direccion viento" src="WS69" hint="°">
            <NumField value={settings.cal_wind_dir_offset} onChange={(v) => update('cal_wind_dir_offset', v)} min={-180} max={180} step={1} disabled={!on} />
          </Item>
          <Item label="🌧️ Lluvia (factor)" src="WS69" hint="×">
            <NumField value={settings.cal_rain_mult} onChange={(v) => update('cal_rain_mult', v)} min={0.5} max={2} step={0.01} disabled={!on} />
          </Item>
          <Item label="☀️ Solar (factor)" src="WS69" hint="×">
            <NumField value={settings.cal_solar_mult} onChange={(v) => update('cal_solar_mult', v)} min={0.5} max={2} step={0.01} disabled={!on} />
          </Item>
          <Item label="🔆 UV (offset)" src="WS69" hint="idx">
            <NumField value={settings.cal_uv_offset} onChange={(v) => update('cal_uv_offset', v)} min={-5} max={5} step={1} disabled={!on} />
          </Item>
        </div>
      </div>

      {/* Info */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4 text-xs text-slate-500">
        <span className="text-slate-400">Offset:</span> se suma al valor (ej: -0.5 si lee 0.5° de mas) ·
        <span className="text-slate-400 ml-2">Factor:</span> multiplica (1.0 = sin cambio, 1.1 = +10%) ·
        <span className="text-slate-400 ml-2">Direccion:</span> gira la veleta (ej: +10 corrige 10° al este).
      </div>
    </div>
  )
}

function RowFields({ label, tVal, hVal, onT, onH, disabled }: {
  label: string; tVal: number; hVal: number; onT: (v: number) => void; onH: (v: number) => void; disabled: boolean
}) {
  return (
    <>
      <span className="text-slate-300">{label}</span>
      <NumField value={tVal} onChange={onT} min={-10} max={10} step={0.1} disabled={disabled} />
      <NumField value={hVal} onChange={onH} min={-20} max={20} step={1} disabled={disabled} />
    </>
  )
}

function Item({ label, src, hint, children }: { label: string; src: string; hint: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium mb-1">
        {label} <span className="text-xs font-normal text-slate-500">· {src}</span>
      </p>
      <div className="flex items-center gap-2">
        {children}
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
    </div>
  )
}
