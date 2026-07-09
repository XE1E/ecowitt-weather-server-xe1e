import { useState, useEffect } from 'react'

interface Settings {
  alerts_enabled: boolean
  alert_temp_high: number
  alert_temp_low: number
  alert_wind_high: number
  alert_gust_high: number
  alert_rain_rate: number
  alert_rain_daily: number
  alert_pressure_high: number
  alert_pressure_low: number
  alert_station_offline_minutes: number
  alert_battery_enabled: boolean
  alert_sensor_lost_enabled: boolean
  telegram_enabled: boolean
  telegram_bot_token_masked: string | null
  telegram_chat_id: string | null
  waqi_token_masked: string | null
  // Control de calidad
  qc_enabled: boolean
  qc_spike_enabled: boolean
  // Calibración
  cal_enabled: boolean
  cal_temp_offset: number
  cal_humidity_offset: number
  cal_pressure_offset: number
  cal_wind_mult: number
  cal_rain_mult: number
  // Redes públicas
  wu_enabled: boolean
  wu_station_id: string | null
  wu_station_key_masked: string | null
  pws_enabled: boolean
  pws_station_id: string | null
  pws_password_masked: string | null
  windy_enabled: boolean
  windy_api_key_masked: string | null
  owm_enabled: boolean
  owm_api_key_masked: string | null
  owm_station_id: string | null
  cwop_enabled: boolean
  cwop_callsign: string | null
  cwop_passcode_masked: string | null
  cwop_latitude: number
  cwop_longitude: number
}

const inputCls = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-slate-100'

export function AdminPage() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('admin_token'))
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [s, setS] = useState<Settings | null>(null)
  // Campos secretos: si se escriben, sobreescriben; si quedan vacíos, se conservan
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [tg, setTg] = useState('')
  const [msg, setMsg] = useState('')

  const logout = () => { sessionStorage.removeItem('admin_token'); setToken(null); setS(null) }
  const setSecret = (k: string, v: string) => setSecrets((p) => ({ ...p, [k]: v }))

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
      alert_gust_high: Number(s.alert_gust_high),
      alert_rain_rate: Number(s.alert_rain_rate),
      alert_rain_daily: Number(s.alert_rain_daily),
      alert_pressure_high: Number(s.alert_pressure_high),
      alert_pressure_low: Number(s.alert_pressure_low),
      alert_station_offline_minutes: Number(s.alert_station_offline_minutes),
      alert_battery_enabled: s.alert_battery_enabled,
      alert_sensor_lost_enabled: s.alert_sensor_lost_enabled,
      telegram_enabled: s.telegram_enabled,
      telegram_chat_id: s.telegram_chat_id,
      // QC
      qc_enabled: s.qc_enabled,
      qc_spike_enabled: s.qc_spike_enabled,
      // Calibración
      cal_enabled: s.cal_enabled,
      cal_temp_offset: Number(s.cal_temp_offset),
      cal_humidity_offset: Number(s.cal_humidity_offset),
      cal_pressure_offset: Number(s.cal_pressure_offset),
      cal_wind_mult: Number(s.cal_wind_mult),
      cal_rain_mult: Number(s.cal_rain_mult),
      // Redes públicas
      wu_enabled: s.wu_enabled,
      wu_station_id: s.wu_station_id,
      pws_enabled: s.pws_enabled,
      pws_station_id: s.pws_station_id,
      windy_enabled: s.windy_enabled,
      owm_enabled: s.owm_enabled,
      owm_station_id: s.owm_station_id,
      cwop_enabled: s.cwop_enabled,
      cwop_callsign: s.cwop_callsign,
      cwop_latitude: Number(s.cwop_latitude),
      cwop_longitude: Number(s.cwop_longitude),
    }
    // Secretos: solo si el usuario escribió algo
    if (tg) payload.telegram_bot_token = tg
    for (const [k, v] of Object.entries(secrets)) if (v) payload[k] = v

    const r = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    if (r.status === 401) { logout(); return }
    setMsg(r.ok ? 'Guardado y aplicado ✓' : 'Error al guardar')
    setTg(''); setSecrets({})
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

  const num = (k: keyof Settings, step = 'any') => (
    <input type="number" step={step} className={inputCls} value={s[k] as number}
      onChange={(e) => setS({ ...s, [k]: e.target.value })} />
  )
  const toggle = (k: keyof Settings, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      {label}
    </label>
  )
  const text = (k: keyof Settings, ph = '') => (
    <input className={inputCls} placeholder={ph} value={(s[k] as string) ?? ''}
      onChange={(e) => setS({ ...s, [k]: e.target.value })} />
  )
  const secret = (k: string, masked: string | null) => (
    <input className={inputCls} placeholder={masked ?? 'sin configurar'} value={secrets[k] ?? ''}
      onChange={(e) => setSecret(k, e.target.value)} />
  )

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-300">Administración</h2>
        <button onClick={logout} className="text-xs text-slate-400 hover:text-slate-200 border border-white/10 rounded-lg px-2 py-1">
          Cerrar sesión
        </button>
      </div>

      <div className="card space-y-5">
        {/* Alertas */}
        <section>
          <p className="card-title">Alertas</p>
          {toggle('alerts_enabled', 'Alertas activadas')}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            <label className="text-xs text-slate-400">Temp alta (°C){num('alert_temp_high')}</label>
            <label className="text-xs text-slate-400">Temp baja (°C){num('alert_temp_low')}</label>
            <label className="text-xs text-slate-400">Viento (km/h){num('alert_wind_high')}</label>
            <label className="text-xs text-slate-400">Ráfaga (km/h){num('alert_gust_high')}</label>
            <label className="text-xs text-slate-400">Lluvia (mm/h){num('alert_rain_rate')}</label>
            <label className="text-xs text-slate-400">Lluvia diaria (mm){num('alert_rain_daily')}</label>
            <label className="text-xs text-slate-400">Presión alta (hPa){num('alert_pressure_high')}</label>
            <label className="text-xs text-slate-400">Presión baja (hPa){num('alert_pressure_low')}</label>
            <label className="text-xs text-slate-400">Estación caída (min){num('alert_station_offline_minutes')}</label>
          </div>
          <div className="mt-2 space-y-1">
            {toggle('alert_battery_enabled', 'Avisar batería baja (WN31 / WS69)')}
            {toggle('alert_sensor_lost_enabled', 'Avisar sensor sin contacto')}
          </div>
        </section>

        {/* Control de calidad */}
        <section className="border-t border-white/10 pt-4">
          <p className="card-title">Control de calidad</p>
          {toggle('qc_enabled', 'Descartar lecturas fuera de rango (recomendado)')}
          {toggle('qc_spike_enabled', 'Filtro de picos: descartar saltos imposibles entre lecturas')}
        </section>

        {/* Calibración */}
        <section className="border-t border-white/10 pt-4">
          <p className="card-title">Calibración de sensores</p>
          {toggle('cal_enabled', 'Aplicar calibración')}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            <label className="text-xs text-slate-400">Offset temp (°C){num('cal_temp_offset')}</label>
            <label className="text-xs text-slate-400">Offset humedad (%){num('cal_humidity_offset')}</label>
            <label className="text-xs text-slate-400">Offset presión (hPa){num('cal_pressure_offset')}</label>
            <label className="text-xs text-slate-400">Factor viento (×){num('cal_wind_mult')}</label>
            <label className="text-xs text-slate-400">Factor lluvia (×){num('cal_rain_mult')}</label>
          </div>
        </section>

        {/* Telegram */}
        <section className="border-t border-white/10 pt-4">
          <p className="card-title">Telegram</p>
          {toggle('telegram_enabled', 'Telegram activado')}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <label className="text-xs text-slate-400">Bot token (en blanco = conservar)
              <input className={inputCls} placeholder={s.telegram_bot_token_masked ?? 'sin configurar'}
                value={tg} onChange={(e) => setTg(e.target.value)} />
            </label>
            <label className="text-xs text-slate-400">Chat ID{text('telegram_chat_id')}</label>
          </div>
        </section>

        {/* Calidad del aire */}
        <section className="border-t border-white/10 pt-4">
          <p className="card-title">Calidad del aire (WAQI)</p>
          <label className="text-xs text-slate-400">Token (en blanco = conservar)
            {secret('waqi_token', s.waqi_token_masked)}
          </label>
        </section>

        {/* Redes públicas */}
        <section className="border-t border-white/10 pt-4">
          <p className="card-title">Publicar a redes públicas</p>
          <div className="space-y-4 mt-1">
            <div>
              {toggle('wu_enabled', 'Weather Underground')}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                <label className="text-xs text-slate-400">Station ID{text('wu_station_id')}</label>
                <label className="text-xs text-slate-400">Station key (en blanco = conservar){secret('wu_station_key', s.wu_station_key_masked)}</label>
              </div>
            </div>
            <div>
              {toggle('pws_enabled', 'PWSWeather')}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                <label className="text-xs text-slate-400">Station ID{text('pws_station_id')}</label>
                <label className="text-xs text-slate-400">Password (en blanco = conservar){secret('pws_password', s.pws_password_masked)}</label>
              </div>
            </div>
            <div>
              {toggle('windy_enabled', 'Windy.com')}
              <label className="text-xs text-slate-400 block mt-1">API key (en blanco = conservar){secret('windy_api_key', s.windy_api_key_masked)}</label>
            </div>
            <div>
              {toggle('owm_enabled', 'OpenWeatherMap')}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                <label className="text-xs text-slate-400">Station ID{text('owm_station_id')}</label>
                <label className="text-xs text-slate-400">API key (en blanco = conservar){secret('owm_api_key', s.owm_api_key_masked)}</label>
              </div>
            </div>
            <div>
              {toggle('cwop_enabled', 'CWOP / APRS (entra a modelos de NOAA)')}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
                <label className="text-xs text-slate-400">Indicativo{text('cwop_callsign', 'XE1E')}</label>
                <label className="text-xs text-slate-400">Passcode (en blanco = conservar){secret('cwop_passcode', s.cwop_passcode_masked)}</label>
                <label className="text-xs text-slate-400">Latitud{num('cwop_latitude')}</label>
                <label className="text-xs text-slate-400">Longitud{num('cwop_longitude')}</label>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Passcode: usa <code>-1</code> para designadores CWxxxx; si es indicativo de radioaficionado, tu passcode APRS.
              </p>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3 border-t border-white/10 pt-4">
          <button onClick={save} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold">
            Guardar
          </button>
          {msg && <span className="text-sm text-emerald-300">{msg}</span>}
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-3">
        Los cambios se aplican al vuelo (sin reiniciar). Las claves/tokens se guardan en el servidor y se muestran enmascarados.
      </p>
    </div>
  )
}
