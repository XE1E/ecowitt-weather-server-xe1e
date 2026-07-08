import { useState, useEffect } from 'react'

interface Settings {
  alerts_enabled: boolean
  alert_temp_high: number
  alert_temp_low: number
  alert_wind_high: number
  alert_rain_rate: number
  alert_station_offline_minutes: number
  telegram_enabled: boolean
  telegram_bot_token_masked: string | null
  telegram_chat_id: string | null
  waqi_token_masked: string | null
}

const inputCls = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-slate-100'

export function AdminPage() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('admin_token'))
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [s, setS] = useState<Settings | null>(null)
  const [tg, setTg] = useState('')
  const [waqi, setWaqi] = useState('')
  const [msg, setMsg] = useState('')

  const logout = () => { sessionStorage.removeItem('admin_token'); setToken(null); setS(null) }

  const loadAll = async (tk: string) => {
    const r = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${tk}` } })
    if (r.status === 401) { logout(); return }
    if (r.ok) setS(await r.json())
  }

  useEffect(() => { if (token) loadAll(token) }, [token])

  const login = async () => {
    setErr('')
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password: pass }),
    })
    if (!r.ok) { setErr('Credenciales inválidas o panel deshabilitado'); return }
    const j = await r.json()
    sessionStorage.setItem('admin_token', j.token)
    setToken(j.token)
  }

  const save = async () => {
    if (!s || !token) return
    setMsg('')
    const payload: Record<string, unknown> = {
      alerts_enabled: s.alerts_enabled,
      alert_temp_high: Number(s.alert_temp_high),
      alert_temp_low: Number(s.alert_temp_low),
      alert_wind_high: Number(s.alert_wind_high),
      alert_rain_rate: Number(s.alert_rain_rate),
      alert_station_offline_minutes: Number(s.alert_station_offline_minutes),
      telegram_enabled: s.telegram_enabled,
      telegram_chat_id: s.telegram_chat_id,
    }
    if (tg) payload.telegram_bot_token = tg
    if (waqi) payload.waqi_token = waqi
    const r = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    if (r.status === 401) { logout(); return }
    setMsg(r.ok ? 'Guardado y aplicado ✓' : 'Error al guardar')
    setTg(''); setWaqi('')
    if (r.ok) loadAll(token)
  }

  // --- Login ---
  if (!token) {
    return (
      <div className="max-w-sm mx-auto">
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Administración</h2>
        <div className="card space-y-3">
          <input className={inputCls} placeholder="Usuario" value={user} onChange={(e) => setUser(e.target.value)} />
          <input className={inputCls} type="password" placeholder="Contraseña" value={pass}
            onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button onClick={login} className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 py-2 text-sm font-semibold">
            Entrar
          </button>
        </div>
      </div>
    )
  }

  if (!s) return <div className="text-slate-400">Cargando ajustes…</div>

  const num = (k: keyof Settings) => (
    <input type="number" className={inputCls} value={s[k] as number}
      onChange={(e) => setS({ ...s, [k]: e.target.value })} />
  )
  const toggle = (k: keyof Settings, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      {label}
    </label>
  )

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-300">Administración</h2>
        <button onClick={logout} className="text-xs text-slate-400 hover:text-slate-200 border border-white/10 rounded-lg px-2 py-1">
          Cerrar sesión
        </button>
      </div>

      <div className="card space-y-4">
        <div>
          <p className="card-title">Alertas</p>
          {toggle('alerts_enabled', 'Alertas activadas')}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            <label className="text-xs text-slate-400">Temp alta (°C){num('alert_temp_high')}</label>
            <label className="text-xs text-slate-400">Temp baja (°C){num('alert_temp_low')}</label>
            <label className="text-xs text-slate-400">Viento (km/h){num('alert_wind_high')}</label>
            <label className="text-xs text-slate-400">Lluvia (mm/h){num('alert_rain_rate')}</label>
            <label className="text-xs text-slate-400">Estación caída (min){num('alert_station_offline_minutes')}</label>
          </div>
        </div>

        <div className="border-t border-white/10 pt-3">
          <p className="card-title">Telegram</p>
          {toggle('telegram_enabled', 'Telegram activado')}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <label className="text-xs text-slate-400">Bot token (dejar en blanco = conservar)
              <input className={inputCls} placeholder={s.telegram_bot_token_masked ?? 'sin configurar'}
                value={tg} onChange={(e) => setTg(e.target.value)} />
            </label>
            <label className="text-xs text-slate-400">Chat ID
              <input className={inputCls} value={s.telegram_chat_id ?? ''}
                onChange={(e) => setS({ ...s, telegram_chat_id: e.target.value })} />
            </label>
          </div>
        </div>

        <div className="border-t border-white/10 pt-3">
          <p className="card-title">Calidad del aire (WAQI)</p>
          <label className="text-xs text-slate-400">Token (dejar en blanco = conservar)
            <input className={inputCls} placeholder={s.waqi_token_masked ?? 'sin configurar'}
              value={waqi} onChange={(e) => setWaqi(e.target.value)} />
          </label>
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 pt-3">
          <button onClick={save} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold">
            Guardar
          </button>
          {msg && <span className="text-sm text-emerald-300">{msg}</span>}
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-3">
        Los cambios se aplican al vuelo (sin reiniciar). Los tokens se guardan en el servidor y se muestran enmascarados.
      </p>
    </div>
  )
}
