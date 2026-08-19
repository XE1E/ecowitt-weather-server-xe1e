import { useState, useEffect, useCallback } from 'react'
import { useAdminAuth } from '../../admin-auth'

/**
 * Panel de la cámara del exterior: control de la CAPTURA (la hace la Pi, que lee su
 * config de aquí), del ANÁLISIS del cielo con IA (Gemini/Claude, con su intervalo para
 * no agotar la cuota gratuita), retención de fotos y presencia en el kiosco. Además un
 * bloque de ESTADO que dice de un vistazo por qué no captura o no analiza.
 *
 * Carga de /api/camera/diag (estado + config) y guarda en /api/admin/settings (las
 * claves de cámara ya están en EDITABLE_KEYS, con coerción de tipos en el servidor).
 */

interface Diag {
  capture: {
    enabled: boolean
    interval_min: number
    hour_start: number
    hour_end: number
    status: { available?: boolean; captured_at?: string; age_seconds?: number; stale?: boolean }
  }
  analysis: {
    enabled: boolean
    interval_min: number
    provider_setting: string
    active_provider: string | null
    has_gemini_key: boolean
    has_anthropic_key: boolean
    model_gemini: string
    model_anthropic: string
    last_attempt: { ok: boolean | null; at: string | null; provider: string | null; error: string | null }
    last_saved: { sky_condition?: string; cloud_coverage_pct?: number; description?: string; analyzed_at?: string } | null
  }
  timelapse: {
    enabled: boolean
    ffmpeg: boolean
    fps: number
    width: number
    min_frames: number
    retention_days: number
    disk_bytes: number
    days: { date: string; frames: number; video: boolean; bytes: number; seconds: number; stale: boolean }[]
  }
  retention_days: number
  stale_seconds: number
  kiosk_camera_enabled: boolean
}

interface Form {
  camera_capture_enabled: boolean
  camera_capture_interval_min: number
  camera_capture_hour_start: number
  camera_capture_hour_end: number
  camera_analysis_enabled: boolean
  camera_analysis_interval_min: number
  camera_analysis_provider: string
  camera_analysis_model_gemini: string
  camera_analysis_model_anthropic: string
  camera_retention_days: number
  kiosk_camera_enabled: boolean
  camera_timelapse_enabled: boolean
  camera_timelapse_fps: number
  camera_timelapse_min_frames: number
  camera_timelapse_retention_days: number
  gemini_api_key: string
  anthropic_api_key: string
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!enabled)} className={`w-9 h-5 rounded-full cursor-pointer transition-colors relative flex-shrink-0 ${enabled ? 'bg-sky-600' : 'bg-slate-600'}`}>
      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
    </div>
  )
}

function Num({ value, onChange, min, max, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50" />
      {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
    </span>
  )
}

function Key({ value, onChange, has, placeholder }: { value: string; onChange: (v: string) => void; has: boolean; placeholder: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative flex-1 max-w-md">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={has ? '•••••••• (configurada — deja en blanco para conservar)' : placeholder}
        className="w-full rounded bg-slate-900/50 border border-white/10 px-2 py-1 pr-8 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50" />
      <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">{show ? '🙈' : '👁️'}</button>
    </div>
  )
}

function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

const PROVIDERS = [
  { v: 'auto', label: 'Automático (prefiere Gemini, gratis)' },
  { v: 'gemini', label: 'Google Gemini (gratis)' },
  { v: 'anthropic', label: 'Anthropic Claude (de pago)' },
]

export function AdminCamara() {
  const { fetchWithAuth } = useAdminAuth()
  const [diag, setDiag] = useState<Diag | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [rehaciendo, setRehaciendo] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)

  const cargar = useCallback(async () => {
    const r = await fetchWithAuth('/api/camera/diag')
    if (!r.ok) { setLoading(false); return }
    const d: Diag = await r.json()
    setDiag(d)
    setForm({
      camera_capture_enabled: d.capture.enabled,
      camera_capture_interval_min: d.capture.interval_min,
      camera_capture_hour_start: d.capture.hour_start,
      camera_capture_hour_end: d.capture.hour_end,
      camera_analysis_enabled: d.analysis.enabled,
      camera_analysis_interval_min: d.analysis.interval_min,
      camera_analysis_provider: d.analysis.provider_setting,
      camera_analysis_model_gemini: d.analysis.model_gemini,
      camera_analysis_model_anthropic: d.analysis.model_anthropic,
      camera_retention_days: d.retention_days,
      kiosk_camera_enabled: d.kiosk_camera_enabled,
      camera_timelapse_enabled: d.timelapse.enabled,
      camera_timelapse_fps: d.timelapse.fps,
      camera_timelapse_min_frames: d.timelapse.min_frames,
      camera_timelapse_retention_days: d.timelapse.retention_days,
      gemini_api_key: '',
      anthropic_api_key: '',
    })
    setLoading(false)
  }, [fetchWithAuth])

  useEffect(() => { cargar() }, [cargar])

  const up = <K extends keyof Form>(k: K, v: Form[K]) => setForm((p) => (p ? { ...p, [k]: v } : p))

  const guardar = async () => {
    if (!form) return
    setSaving(true); setMsg(null)
    // Las claves vacías NO se mandan (blanco = conservar la actual).
    const body: Record<string, unknown> = { ...form }
    if (!form.gemini_api_key) delete body.gemini_api_key
    if (!form.anthropic_api_key) delete body.anthropic_api_key
    try {
      const r = await fetchWithAuth('/api/admin/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (r.ok) { setMsg({ t: 'ok', x: 'Guardado' }); setTimeout(() => setMsg(null), 2000); cargar() }
      else setMsg({ t: 'err', x: 'Error al guardar' })
    } catch { setMsg({ t: 'err', x: 'Error de conexión' }) }
    finally { setSaving(false) }
  }

  const analizarAhora = async () => {
    setAnalyzing(true); setMsg(null)
    try {
      const r = await fetchWithAuth('/api/camera/analyze-now', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        const res = j.result || {}
        setMsg(res.ok ? { t: 'ok', x: `Analizado (${res.provider || '?'})` }
                      : { t: 'err', x: `Falló: ${res.error || 'error'}` })
        setTimeout(cargar, 500)
      } else setMsg({ t: 'err', x: j.detail || 'No se pudo analizar' })
    } catch { setMsg({ t: 'err', x: 'Error de conexión' }) }
    finally { setAnalyzing(false) }
  }

  const rehacerTimelapse = async () => {
    // Hoy y no ayer: es el que se queda corto segun entran capturas, y el que uno
    // quiere ver recien montado tras cambiar los fps.
    const hoy = new Date()
    const fecha = [
      hoy.getFullYear(),
      String(hoy.getMonth() + 1).padStart(2, '0'),
      String(hoy.getDate()).padStart(2, '0'),
    ].join('-')
    setRehaciendo(true); setMsg(null)
    try {
      const r = await fetchWithAuth('/api/camera/timelapse/' + fecha, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        setMsg({ t: 'ok', x: 'Video de hoy rehecho (' + (j.frames_used ?? '?') + ' capturas)' })
        cargar()
      } else setMsg({ t: 'err', x: j.detail || 'No se pudo generar' })
    } catch { setMsg({ t: 'err', x: 'Error de conexion' }) }
    finally { setRehaciendo(false) }
  }

  if (loading || !form || !diag) return <div className="text-slate-400">Cargando...</div>

  const cap = diag.capture.status
  const la = diag.analysis.last_attempt
  const capActiva = form.camera_capture_hour_start === form.camera_capture_hour_end
    ? '24 h' : `${form.camera_capture_hour_start}:00–${form.camera_capture_hour_end}:00`

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">📷 Cámara</h1>
          <p className="text-slate-400 text-sm">Captura del exterior y análisis del cielo con IA</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-sm ${msg.t === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.x}</span>}
          <button onClick={guardar} disabled={saving} className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* ESTADO / DIAGNÓSTICO */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">Estado</span>
          <button onClick={analizarAhora} disabled={analyzing}
            className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {analyzing ? 'Analizando...' : '✨ Analizar ahora'}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-xs text-slate-500">Última foto</div>
            <div className="text-sm font-medium mt-0.5">
              {cap.available ? haceCuanto(cap.captured_at) : 'sin foto'}
              {cap.stale && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">ANTIGUA</span>}
            </div>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-xs text-slate-500">Último análisis</div>
            <div className="text-sm font-medium mt-0.5">
              {la.ok === null ? '—' : la.ok
                ? <span className="text-emerald-400">✓ {haceCuanto(la.at)}</span>
                : <span className="text-red-400">✕ {haceCuanto(la.at)}</span>}
            </div>
            {la.error && <div className="text-[11px] text-red-400/90 mt-1 leading-tight">{la.error}</div>}
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-xs text-slate-500">Proveedor activo</div>
            <div className="text-sm font-medium mt-0.5 capitalize">
              {diag.analysis.active_provider || <span className="text-amber-400">sin API key</span>}
            </div>
          </div>
        </div>
        {diag.analysis.last_saved?.description && (
          <div className="text-xs text-slate-400 mt-3 border-t border-white/5 pt-2">
            <span className="text-slate-500">Último resultado guardado:</span> {diag.analysis.last_saved.description}
          </div>
        )}
      </div>

      {/* CAPTURA */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <Toggle enabled={form.camera_capture_enabled} onChange={(v) => up('camera_capture_enabled', v)} />
          <span className="text-sm font-medium">Captura de fotos</span>
          <span className="text-xs text-slate-500 ml-auto">Activa: {capActiva}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Cada</span>
            <Num value={form.camera_capture_interval_min} onChange={(v) => up('camera_capture_interval_min', v)} min={1} max={120} suffix="min" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Horario (de–a)</span>
            <Num value={form.camera_capture_hour_start} onChange={(v) => up('camera_capture_hour_start', v)} min={0} max={23} suffix="h" />
            <span className="text-slate-500">–</span>
            <Num value={form.camera_capture_hour_end} onChange={(v) => up('camera_capture_hour_end', v)} min={0} max={23} suffix="h" />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          La captura la hace la Raspberry Pi de casa; aquí sólo se le dice cuándo. De noche la cámara ve
          negro: acotar el horario ahorra cuota de análisis y disco. Con de = a captura las 24 h.
        </p>
      </div>

      {/* ANÁLISIS */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <Toggle enabled={form.camera_analysis_enabled} onChange={(v) => up('camera_analysis_enabled', v)} />
          <span className="text-sm font-medium">Análisis del cielo con IA</span>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Analizar cada</span>
            <Num value={form.camera_analysis_interval_min} onChange={(v) => up('camera_analysis_interval_min', v)} min={0} max={180} suffix="min" />
            <span className="text-xs text-amber-300/80">← controla la cuota gratuita (0 = en cada foto)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Proveedor</span>
            <select value={form.camera_analysis_provider} onChange={(e) => up('camera_analysis_provider', e.target.value)}
              className="rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white focus:outline-none focus:border-sky-500/50">
              {PROVIDERS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Modelo Gemini</span>
            <input value={form.camera_analysis_model_gemini} onChange={(e) => up('camera_analysis_model_gemini', e.target.value)}
              className="w-56 rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white focus:outline-none focus:border-sky-500/50" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Gemini API key</span>
            <Key value={form.gemini_api_key} onChange={(v) => up('gemini_api_key', v)} has={diag.analysis.has_gemini_key} placeholder="clave de Google AI Studio" />
            <a href="https://aistudio.google.com/apikey" target="_blank" className="text-sky-400 text-xs whitespace-nowrap">Obtener →</a>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Claude API key</span>
            <Key value={form.anthropic_api_key} onChange={(v) => up('anthropic_api_key', v)} has={diag.analysis.has_anthropic_key} placeholder="opcional, de pago" />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Analizar en cada foto (5 min) agota el tier gratuito de Gemini (~288/día) y deja el análisis
          congelado. 15 min deja ~72-96/día, holgado. Gemini es gratis; Claude da mejor calidad pero es de pago.
        </p>
      </div>

      {/* FOTOS + KIOSCO */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Guardar fotos</span>
            <Num value={form.camera_retention_days} onChange={(v) => up('camera_retention_days', v)} min={1} max={90} suffix="días" />
          </div>
          <div className="flex items-center gap-3">
            <Toggle enabled={form.kiosk_camera_enabled} onChange={(v) => up('kiosk_camera_enabled', v)} />
            <span className="text-sm">Mostrar en el kiosco</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Con "Mostrar en el kiosco" apagado, la celda de sol y luna de la consola vuelve a llevar al
          pronóstico y la cámara no aparece en el menú del display.
        </p>
      </div>

      {/* TIMELAPSE */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Toggle enabled={form.camera_timelapse_enabled} onChange={(v) => up('camera_timelapse_enabled', v)} />
            <span className="text-sm font-medium">Timelapse diario</span>
          </div>
          <button onClick={rehacerTimelapse} disabled={rehaciendo || !diag.timelapse.ffmpeg}
            className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {rehaciendo ? 'Montando...' : '🎬 Rehacer el de hoy'}
          </button>
        </div>

        {/* ffmpeg es un fallo de DESPLIEGUE, no de datos: si la imagen se reconstruye
            sin el, las fotos siguen llegando y lo unico que pasa es que no hay video. */}
        {!diag.timelapse.ffmpeg && (
          <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
            El contenedor no tiene <code>ffmpeg</code>: no se puede generar ningun video. Reconstruye la
            imagen del receiver (su Dockerfile ya lo instala).
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Velocidad</span>
            <Num value={form.camera_timelapse_fps} onChange={(v) => up('camera_timelapse_fps', v)} min={1} max={60} suffix="fps" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Minimo</span>
            <Num value={form.camera_timelapse_min_frames} onChange={(v) => up('camera_timelapse_min_frames', v)} min={2} max={200} suffix="capturas" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">Guardar videos</span>
            <Num value={form.camera_timelapse_retention_days} onChange={(v) => up('camera_timelapse_retention_days', v)} min={0} max={3650} suffix="dias" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-28">En disco</span>
            <span className="text-sm text-slate-300">
              {diag.timelapse.disk_bytes ? (diag.timelapse.disk_bytes / (1024 * 1024)).toFixed(1) + ' MB' : '--'}
              <span className="text-xs text-slate-500"> en {diag.timelapse.days.filter((d) => d.video).length} video(s)</span>
            </span>
          </div>
        </div>

        {!!diag.timelapse.days.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {diag.timelapse.days.slice(0, 8).map((d) => (
              <span key={d.date}
                title={d.frames + ' capturas' + (d.video ? ' - ' + d.seconds + 's - ' + (d.bytes / (1024 * 1024)).toFixed(1) + ' MB' : ' - sin video')}
                className={'text-xs px-2 py-1 rounded-lg border ' + (d.video
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-white/5 border-white/10 text-slate-400')}>
                {d.date.slice(5)} {d.video ? d.seconds + 's' : d.frames + 'f'}
              </span>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-500 mt-2">
          Se monta en el servidor con ffmpeg: hoy se refresca cada media hora segun entran capturas y
          ayer se cierra solo. Los videos se guardan <span className="text-slate-400">aparte de las
          fotos</span> y con retencion propia, mucho mas larga: un dia de fotos ocupa ~25 MB y su
          video ~6 MB, asi que el timelapse es lo que puede sobrevivir meses (90 dias ~ 540 MB).
          Cambiar los fps solo afecta a los videos que se monten a partir de entonces.
        </p>
      </div>
    </div>
  )
}
