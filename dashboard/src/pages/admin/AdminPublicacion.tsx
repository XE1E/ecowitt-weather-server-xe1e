import { useState, useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAdminAuth } from '../../admin-auth'
import { Toggle, TextField } from '../../components/admin-ui'

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
  wow_be_enabled: boolean
  wow_be_site_id: string | null
  wow_be_auth_key: string | null
  wow_be_auth_key_masked: string | null
  wow_be_interval: number
  weathercloud_enabled: boolean
  weathercloud_id: string | null
  weathercloud_key: string | null
  weathercloud_key_masked: string | null
  weathercloud_interval: number
  windy_enabled: boolean
  windy_station_id: string | null
  windy_station_password: string | null
  windy_station_password_masked: string | null
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
  awekas_enabled: boolean
  awekas_username: string | null
  awekas_password: string | null
  awekas_password_masked: string | null
  awekas_interval: number
  opensensemap_enabled: boolean
  opensensemap_box_id: string | null
  opensensemap_access_token: string | null
  opensensemap_access_token_masked: string | null
  opensensemap_sensor_ids: Record<string, string> | null
  opensensemap_interval: number
}

// Nuestro nombre de campo (en `data`, ya en métrico) -> etiqueta corta y el
// sensorId que openSenseMap asignó a ESE sensor al crear la senseBox en su
// web (no hay upsert por nombre, hay que copiarlo de ahí). Un campo sin
// sensorId simplemente no se publica -- config parcial es válida.
const OPENSENSEMAP_FIELDS: [string, string][] = [
  ['temperature_outdoor', 'Temperatura'],
  ['humidity_outdoor', 'Humedad'],
  ['pressure_relative', 'Presión'],
  ['wind_speed', 'Viento'],
  ['wind_direction', 'Dirección'],
  ['wind_gust', 'Ráfaga'],
  ['rain_hourly', 'Lluvia (h)'],
  ['solar_radiation', 'Radiación solar'],
  ['uv_index', 'UV'],
]

// Coordenadas de la estación: una sola, la de Sistema (antes CWOP y AWEKAS tenían
// cada una sus propios campos). Aquí sólo se muestran.
function Ubicacion({ lat, lon }: { lat: number; lon: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <span>Ubicación</span>
      <span className="font-mono text-slate-300">{lat?.toFixed(5)}, {lon?.toFixed(5)}</span>
      <Link to="/admin/sistema" className="text-sky-400 hover:underline">cambiar en Sistema →</Link>
    </div>
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

type PubKey = keyof PubSettings

interface NetField { key: PubKey; label: string; placeholder: string; secret?: boolean }
interface Network {
  name: string
  enabled: PubKey
  interval: PubKey
  link: [href: string, text: string]
  fields: NetField[]
  labelW?: string
  note?: ReactNode
  footnote?: ReactNode
}

// Redes que se configuran igual: interruptor, ID y clave (la clave nunca vuelve del
// servidor: se muestra enmascarada y vacío = conservarla) e intervalo. Antes eran 6
// bloques copiados; AWEKAS, CWOP y openSenseMap tienen campos propios y van aparte.
const NETWORKS: Network[] = [
  {
    name: 'Weather Underground', enabled: 'wu_enabled', interval: 'wu_interval',
    link: ['https://www.wunderground.com/member/devices', 'Obtener ID →'],
    fields: [
      { key: 'wu_station_id', label: 'Station ID', placeholder: 'ICDMX123' },
      { key: 'wu_station_key', label: 'Key', placeholder: 'API key', secret: true },
    ],
  },
  {
    name: 'PWSWeather', enabled: 'pws_enabled', interval: 'pws_interval',
    link: ['https://www.pwsweather.com/register.php', 'Registrar →'],
    note: <>PWSWeather renombró el campo "Password" a "Station Specific API Key" --
      se genera en la página de tu estación en pwsweather.com (Edit Station,
      al fondo). Va en el mismo campo de abajo, el protocolo no cambió.</>,
    fields: [
      { key: 'pws_station_id', label: 'Station ID', placeholder: 'STATIONID' },
      { key: 'pws_password', label: 'API Key', placeholder: 'Station Specific API Key', secret: true },
    ],
  },
  {
    // Sucesor de Met Office WOW, retirado en 2026
    name: 'WOW-BE', enabled: 'wow_be_enabled', interval: 'wow_be_interval',
    link: ['https://wow.meteo.be/en/connect-your-station/', 'Registrar →'],
    note: <>Sucesor de Met Office WOW (retirado en 2026) -- acepta estaciones de cualquier país.
      Crea tu cuenta en wow.meteo.be y registra la estación para obtener el Site ID y la
      Authentication Key.</>,
    fields: [
      { key: 'wow_be_site_id', label: 'Site ID', placeholder: 'UUID del sitio' },
      { key: 'wow_be_auth_key', label: 'Auth Key', placeholder: 'Authentication Key', secret: true },
    ],
  },
  {
    name: 'Weathercloud', enabled: 'weathercloud_enabled', interval: 'weathercloud_interval',
    link: ['https://weathercloud.net/en/register', 'Registrar →'],
    fields: [
      { key: 'weathercloud_id', label: 'Wid', placeholder: 'Weathercloud ID' },
      { key: 'weathercloud_key', label: 'Key', placeholder: 'API key', secret: true },
    ],
    footnote: <>Plan gratis: mínimo 10 min entre envíos (1 min solo Pro/Premium).</>,
  },
  {
    name: 'Windy.com', enabled: 'windy_enabled', interval: 'windy_interval', labelW: 'w-24',
    link: ['https://stations.windy.com/stations', 'Mis estaciones →'],
    note: <>API v2: entra a "Mis estaciones" en windy.com y copia el <code>Station ID</code> y la{' '}
      <code>Station password</code> de tu estación (ya no se usa API key de cuenta).</>,
    fields: [
      { key: 'windy_station_id', label: 'Station ID', placeholder: 'Station ID' },
      { key: 'windy_station_password', label: 'Password', placeholder: 'Station password', secret: true },
    ],
  },
  {
    name: 'OpenWeatherMap', enabled: 'owm_enabled', interval: 'owm_interval',
    link: ['https://home.openweathermap.org/stations', 'Crear estacion →'],
    fields: [
      { key: 'owm_api_key', label: 'API Key', placeholder: 'API key', secret: true },
      { key: 'owm_station_id', label: 'Station ID', placeholder: 'Station ID' },
    ],
  },
]

function NetworkCard({ net, settings, update }: {
  net: Network
  settings: PubSettings
  update: <K extends PubKey>(key: K, value: PubSettings[K]) => void
}) {
  const val = settings as unknown as Record<string, unknown>
  const on = !!val[net.enabled]
  // Configurada si cada campo tiene valor; una clave guardada cuenta aunque no vuelva.
  const ok = net.fields.every((f) => !!val[f.key] || (!!f.secret && !!val[`${f.key}_masked`]))
  const w = net.labelW ?? 'w-16'
  return (
    <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
      <div className="flex items-center gap-3 mb-3">
        <Toggle enabled={on} onChange={(v) => update(net.enabled, v as never)} />
        <span className="text-sm font-medium">{net.name}</span>
        {on && <CfgBadge ok={ok} />}
        <a href={net.link[0]} target="_blank" rel="noopener noreferrer" className="text-sky-400 text-xs ml-auto">{net.link[1]}</a>
      </div>
      {on && (
        <div className="grid gap-2">
          {net.note && <p className="text-xs text-slate-500">{net.note}</p>}
          {net.fields.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <span className={`text-xs text-slate-400 ${w}`}>{f.label}</span>
              <TextField
                value={(val[f.key] as string | null) ?? null}
                onChange={(v) => update(f.key, v as never)}
                placeholder={f.placeholder}
                type={f.secret ? 'password' : 'text'}
                masked={f.secret ? (val[`${f.key}_masked`] as string | null | undefined) : undefined}
              />
            </div>
          ))}
          <IntervalField value={val[net.interval] as number} onChange={(v) => update(net.interval, v as never)} />
          {net.footnote && <p className="text-xs text-slate-500">{net.footnote}</p>}
        </div>
      )}
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

  const updateSensorId = (field: string, value: string) => {
    setSettings((prev) => (prev
      ? { ...prev, opensensemap_sensor_ids: { ...prev.opensensemap_sensor_ids, [field]: value } }
      : prev))
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
        {/* Las 6 redes con la misma forma (ID + clave + intervalo): ver NETWORKS. */}
        {NETWORKS.map((net) => (
          <NetworkCard key={net.enabled} net={net} settings={settings} update={update} />
        ))}

        {/* AWEKAS */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.awekas_enabled} onChange={(v) => update('awekas_enabled', v)} />
            <span className="text-sm font-medium">AWEKAS</span>
            {settings.awekas_enabled && <CfgBadge ok={!!settings.awekas_username && (!!settings.awekas_password || !!settings.awekas_password_masked)} />}
            <a href="https://www.awekas.at/" target="_blank" className="text-sky-400 text-xs ml-auto">Registrar →</a>
          </div>
          {settings.awekas_enabled && (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">Usuario</span>
                <TextField value={settings.awekas_username} onChange={(v) => update('awekas_username', v)} placeholder="Usuario AWEKAS" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16">Password</span>
                <TextField value={settings.awekas_password} onChange={(v) => update('awekas_password', v)} placeholder="Password" type="password" masked={settings.awekas_password_masked} />
              </div>
              <Ubicacion lat={settings.cwop_latitude} lon={settings.cwop_longitude} />
              <IntervalField value={settings.awekas_interval} onChange={(v) => update('awekas_interval', v)} />
            </div>
          )}
        </div>

        {/* CWOP */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.cwop_enabled} onChange={(v) => update('cwop_enabled', v)} />
            <span className="text-sm font-medium">CWOP / APRS-IS</span>
            {settings.cwop_enabled && <CfgBadge ok={!!settings.cwop_callsign} />}
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
              <div className="sm:col-span-2"><Ubicacion lat={settings.cwop_latitude} lon={settings.cwop_longitude} /></div>
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

        {/* openSenseMap */}
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <Toggle enabled={settings.opensensemap_enabled} onChange={(v) => update('opensensemap_enabled', v)} />
            <span className="text-sm font-medium">openSenseMap</span>
            {settings.opensensemap_enabled && (
              <CfgBadge ok={!!settings.opensensemap_box_id
                && (!!settings.opensensemap_access_token || !!settings.opensensemap_access_token_masked)} />
            )}
            <span className="text-xs text-slate-500">(red ciudadana, senseBox)</span>
            <a href="https://opensensemap.org/" target="_blank" className="text-sky-400 text-xs ml-auto">Crear senseBox →</a>
          </div>
          {settings.opensensemap_enabled && (
            <div className="grid gap-2">
              <p className="text-xs text-slate-500">
                Crea la caja desde la web de openSenseMap (modelo "otro", <code>useAuth</code> activado)
                y pega aquí el <code>box_id</code> y el <code>access_token</code> que te dio. Cada
                sensor de la caja tiene su propio ID -- cópialo de su página y pégalo abajo; los
                campos sin ID no se publican.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-24">Box ID</span>
                <TextField value={settings.opensensemap_box_id} onChange={(v) => update('opensensemap_box_id', v)} placeholder="ID de la senseBox" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-24">Access Token</span>
                <TextField value={settings.opensensemap_access_token} onChange={(v) => update('opensensemap_access_token', v)}
                  placeholder="Access token" type="password" masked={settings.opensensemap_access_token_masked} />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {OPENSENSEMAP_FIELDS.map(([field, label]) => (
                  <div key={field} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-24 shrink-0">{label}</span>
                    <TextField value={settings.opensensemap_sensor_ids?.[field] ?? ''} onChange={(v) => updateSensorId(field, v)}
                      placeholder="sensorId" />
                  </div>
                ))}
              </div>
              <IntervalField value={settings.opensensemap_interval} onChange={(v) => update('opensensemap_interval', v)} />
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
