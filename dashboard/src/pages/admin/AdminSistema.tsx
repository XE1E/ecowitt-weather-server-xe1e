import { useState, useEffect, useCallback } from 'react'
import { useAdminAuth } from '../../admin-auth'
import { parseServerDate } from '../../weather'

interface SysSettings {
  qc_enabled: boolean
  qc_spike_enabled: boolean
  timezone_offset: number
  cwop_latitude: number
  cwop_longitude: number
  alert_station_offline_minutes: number
}

interface SysInfo {
  version: string
  stations: number
  last_received: string | null
  uptime: string
  influxdb: { status: string; url: string }
}

interface ServerInfo {
  os: { name: string; kernel: string; arch: string; hostname: string }
  cpu: { cores: number; load_1m: number; load_5m: number; load_15m: number }
  memory: { total_gb: number; used_gb: number; available_gb: number; used_pct: number | null }
  disk: { total_gb: number; used_gb: number; free_gb: number; used_pct: number | null }
  uptime: { seconds: number; human: string }
  runtime: { python: string; app_version: string; influxdb_url: string; data_retention: string }
}

interface LogEntry {
  timestamp: string
  level: string
  message: string
}

function UsageBar({ pct }: { pct: number | null }) {
  const p = pct ?? 0
  const color = p >= 90 ? 'bg-red-500' : p >= 75 ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{label}:</span>
      <span className="text-slate-300">{value}</span>
    </div>
  )
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

function timeAgo(iso: string | null): string {
  if (!iso) return 'Nunca'
  const s = Math.max(0, Math.floor((Date.now() - parseServerDate(iso)) / 1000))
  if (s < 60) return `hace ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

export function AdminSistema() {
  const { fetchWithAuth } = useAdminAuth()
  const [settings, setSettings] = useState<SysSettings | null>(null)
  const [info, setInfo] = useState<SysInfo | null>(null)
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsFilter, setLogsFilter] = useState<'all' | 'warning' | 'error'>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const r = await fetchWithAuth('/api/admin/logs?limit=100')
      if (r.ok) {
        const data = await r.json()
        setLogs(data.logs || [])
      }
    } catch (e) { console.error(e) }
    setLogsLoading(false)
  }, [fetchWithAuth])

  useEffect(() => {
    Promise.all([
      fetchWithAuth('/api/admin/settings').then(r => r.json()),
      fetchWithAuth('/api/admin/status').then(r => r.json()),
      fetch('/api/stations').then(r => r.json()),
      fetchWithAuth('/api/admin/system-info').then(r => r.json()).catch(() => null),
    ]).then(([settingsData, statusData, stationsData, serverData]) => {
      setSettings(settingsData)
      setServer(serverData)
      setInfo({
        version: '1.0.0',
        stations: stationsData.count || 0,
        last_received: statusData.last_received,
        uptime: '-',
        influxdb: { status: 'connected', url: 'http://influxdb:8086' },
      })
    }).finally(() => setLoading(false))
    loadLogs()
  }, [fetchWithAuth, loadLogs])

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

  const update = <K extends keyof SysSettings>(key: K, value: SysSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  if (loading || !settings) return <div className="text-slate-400">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Sistema</h1>
          <p className="text-slate-400 text-sm">Control de calidad e informacion</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Info del sistema */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="text-sm font-medium mb-3">Informacion</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Version:</span>
            <span className="text-slate-300">{info?.version}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Estaciones:</span>
            <span className="text-slate-300">{info?.stations}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Ultima lectura:</span>
            <span className="text-slate-300">{timeAgo(info?.last_received || null)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">InfluxDB:</span>
            <span className="text-emerald-400">● Conectado</span>
          </div>
        </div>
      </div>

      {/* Datos tecnicos del servidor */}
      {server && (
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <h2 className="text-sm font-medium mb-3">Datos tecnicos del servidor</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="text-slate-500">Disco</span>
                <span className="text-slate-300">{server.disk.used_gb} / {server.disk.total_gb} GB</span>
              </div>
              <UsageBar pct={server.disk.used_pct} />
              <p className="text-xs text-slate-500 mt-1">{server.disk.used_pct}% usado · {server.disk.free_gb} GB disponible</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="text-slate-500">Memoria RAM</span>
                <span className="text-slate-300">{server.memory.used_gb} / {server.memory.total_gb} GB</span>
              </div>
              <UsageBar pct={server.memory.used_pct} />
              <p className="text-xs text-slate-500 mt-1">{server.memory.used_pct}% usado · {server.memory.available_gb} GB disponible</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm mt-4">
            <Field label="Sistema operativo" value={server.os.name} />
            <Field label="Kernel" value={server.os.kernel} />
            <Field label="Arquitectura" value={server.os.arch} />
            <Field label="Hostname" value={server.os.hostname} />
            <Field label="CPU" value={`${server.cpu.cores} nucleos`} />
            <Field label="Carga 1/5/15m" value={`${server.cpu.load_1m} / ${server.cpu.load_5m} / ${server.cpu.load_15m}`} />
            <Field label="Uptime" value={server.uptime.human} />
            <Field label="Python" value={server.runtime.python} />
            <Field label="Retencion datos" value={server.runtime.data_retention} />
            <Field label="App" value={`v${server.runtime.app_version}`} />
          </div>
        </div>
      )}

      {/* Ubicacion y zona horaria */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="text-sm font-medium mb-3">Ubicacion y zona horaria</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Latitud</label>
            <input
              type="number"
              step="0.000001"
              value={settings.cwop_latitude ?? 19.380359}
              onChange={(e) => update('cwop_latitude', parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-700 border border-white/10 rounded px-2 py-1.5 text-sm text-slate-200"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Longitud</label>
            <input
              type="number"
              step="0.000001"
              value={settings.cwop_longitude ?? -99.174564}
              onChange={(e) => update('cwop_longitude', parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-700 border border-white/10 rounded px-2 py-1.5 text-sm text-slate-200"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Zona horaria (UTC offset)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="-12"
                max="14"
                value={settings.timezone_offset ?? -6}
                onChange={(e) => update('timezone_offset', parseInt(e.target.value) || 0)}
                className="w-20 bg-slate-700 border border-white/10 rounded px-2 py-1.5 text-sm text-slate-200"
              />
              <span className="text-xs text-slate-500">
                {(settings.timezone_offset ?? -6) >= 0 ? `UTC+${settings.timezone_offset ?? -6}` : `UTC${settings.timezone_offset ?? -6}`}
              </span>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Timeout estacion offline (min)</label>
            <input
              type="number"
              min="1"
              max="60"
              value={settings.alert_station_offline_minutes ?? 15}
              onChange={(e) => update('alert_station_offline_minutes', parseInt(e.target.value) || 15)}
              className="w-20 bg-slate-700 border border-white/10 rounded px-2 py-1.5 text-sm text-slate-200"
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3">Coordenadas para calculos de almanac (sol/luna). Timeout define cuando se considera la estacion offline.</p>
      </div>

      {/* Control de calidad */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="text-sm font-medium mb-3">Control de calidad (QC)</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Toggle enabled={settings.qc_enabled} onChange={(v) => update('qc_enabled', v)} label="QC habilitado" />
          <Toggle enabled={settings.qc_spike_enabled} onChange={(v) => update('qc_spike_enabled', v)} label="Filtro de picos" />
        </div>
        <p className="text-xs text-slate-500 mt-2">Filtra lecturas anomalas (picos, valores fuera de rango) antes de almacenar</p>
      </div>

      {/* Logs del sistema */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Logs del sistema</h2>
          <div className="flex items-center gap-2">
            <select
              value={logsFilter}
              onChange={(e) => setLogsFilter(e.target.value as typeof logsFilter)}
              className="text-xs bg-slate-700 border border-white/10 rounded px-2 py-1 text-slate-300"
            >
              <option value="all">Todos</option>
              <option value="warning">Warning+</option>
              <option value="error">Solo errores</option>
            </select>
            <button
              onClick={loadLogs}
              disabled={logsLoading}
              className="text-xs text-sky-400 hover:text-sky-300 disabled:text-slate-500"
            >
              {logsLoading ? 'Cargando...' : '↻ Actualizar'}
            </button>
          </div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-2 max-h-64 overflow-y-auto font-mono text-xs">
          {logs.length === 0 ? (
            <p className="text-slate-500 italic">Sin logs recientes</p>
          ) : (
            logs
              .filter(l => {
                if (logsFilter === 'all') return true
                if (logsFilter === 'warning') return l.level === 'WARNING' || l.level === 'ERROR'
                return l.level === 'ERROR'
              })
              .map((log, i) => (
                <div key={i} className="flex gap-2 py-0.5 border-b border-white/5 last:border-0">
                  <span className="text-slate-500 shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`shrink-0 ${
                    log.level === 'ERROR' ? 'text-red-400' :
                    log.level === 'WARNING' ? 'text-yellow-400' :
                    log.level === 'INFO' ? 'text-sky-400' : 'text-slate-400'
                  }`}>
                    {log.level.slice(0, 4)}
                  </span>
                  <span className="text-slate-300 break-all">{log.message}</span>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Links utiles */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <h2 className="text-sm font-medium mb-3">Enlaces</h2>
        <div className="flex flex-wrap gap-3">
          <a href="/pro" target="_blank" className="text-sky-400 hover:text-sky-300 text-sm">🌤️ Ver sitio publico</a>
          <a href="/guia.html" target="_blank" className="text-sky-400 hover:text-sky-300 text-sm">📖 Guia de la estacion</a>
          <a href="https://github.com/XE1E/ecowitt-weather-server-xe1e" target="_blank" className="text-sky-400 hover:text-sky-300 text-sm">📦 GitHub</a>
          <a href="/api/current" target="_blank" className="text-sky-400 hover:text-sky-300 text-sm">📡 API /current</a>
        </div>
      </div>

      {/* Stack */}
      <div className="bg-slate-800/30 rounded-xl border border-white/5 p-4">
        <h2 className="text-sm font-medium mb-2">Stack</h2>
        <div className="flex flex-wrap gap-2">
          {['FastAPI', 'InfluxDB', 'React', 'TypeScript', 'Tailwind CSS', 'Docker', 'Nginx'].map(tech => (
            <span key={tech} className="text-xs bg-slate-700/50 text-slate-300 px-2 py-1 rounded">{tech}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
