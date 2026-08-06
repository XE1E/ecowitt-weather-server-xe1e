import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Thermometer, Home, Antenna, CalendarDays, TrendingUp, Monitor } from 'lucide-react'
import { MultiVariableChart } from '../components/station/MultiVariableChart'
import { ConsoleReplica } from '../components/station/ConsoleReplica'
import { parseSlug } from '../kiosk-nav'
import { DetailPage } from './kiosk/DetailPage'
import { StatsPage } from './kiosk/StatsPage'
import { MenuPage } from './kiosk/MenuPage'
import { CamaraPage } from './kiosk/CamaraPage'
import { useNavZones } from './kiosk/nav-zones'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { deriveCondition, relativeTime } from '../weather'
import { LOCATION } from '../config'
import { WeatherIcon } from '../components/WeatherIcon'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const pad = (n: number) => String(n).padStart(2, '0')

// Pestañas de la barra inferior. El ORDEN y el número deben coincidir con
// NUM_PAGES del firmware (que mapea el toque en la franja inferior a la pagina
// segun la X). Pagina N -> TABS[N-1].
//
// Iconos de LUCIDE y no de Meteocons, aunque el resto del sitio use Meteocons
// para lo meteorológico: esta barra es NAVEGACIÓN, y 4 de las 6 pestañas son
// conceptos que Meteocons no cubre (interior, calendario, gráfica, pantalla).
// Mezclar 2 de una galería con 4 de otra en la misma fila se vería peor que
// resolverla entera con una sola. Ver docs/CONVENCIONES.md.
const TABS = [
  { Icon: Thermometer, label: 'Estación' },
  { Icon: Home, label: 'Local' },
  { Icon: Antenna, label: 'Sensores' },
  { Icon: CalendarDays, label: '7 días' },
  { Icon: TrendingUp, label: '48 h' },
  { Icon: Monitor, label: 'Consola' },
]

interface Imeca { available: boolean; imeca?: number; category?: string; color?: string }
interface Local {
  latest: { temperature?: number; humidity?: number; pressure?: number; received_at?: string } | null
  min: { temperature?: number; humidity?: number; pressure?: number }
  max: { temperature?: number; humidity?: number; pressure?: number }
}

function Tile({ label, value, unit, sub, color }: {
  label: string; value: string; unit?: string; sub?: string; color?: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 flex flex-col justify-center">
      <p className="text-[15px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-[38px] leading-none font-bold mt-1" style={{ color: color || '#e2e8f0' }}>
        {value}<span className="text-[19px] font-medium text-slate-400 ml-1">{unit}</span>
      </p>
      {sub && <p className="text-[13px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}


/**
 * Página "kiosco" 1024×600 para el display ESP32-S3. El servidor la renderiza
 * (headless) y sirve la imagen; el ESP32 solo la baja y la pinta. `?page=N`
 * elige la página. `data-kiosk-ready` avisa al renderer cuándo capturar.
 * Barra de pestañas inferior fija (64px) para navegar por touch.
 */
export function KioskPage() {
  const { data, stats, forecast, loading } = useStationData()
  const u = useUnits()
  const [now, setNow] = useState(() => new Date())
  const [imeca, setImeca] = useState<Imeca | null>(null)
  const [local, setLocal] = useState<Local | null>(null)
  const [localFetched, setLocalFetched] = useState(false)
  const [remote, setRemote] = useState<Record<string, number> | null>(null)
  // La gráfica multivariable (página 5) trae sus propios datos de 48 h, así que
  // el "ready" del renderer tiene que esperarla a ella, no al history de 24 h
  // del contexto: si no, la captura sale con el "Cargando...".
  const [multiReady, setMultiReady] = useState(false)

  const page = new URLSearchParams(window.location.search).get('page') || '1'
  /** Contenedor de las páginas 1-5, del que se miden las zonas de su barra. */
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  useEffect(() => {
    fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setImeca).catch(() => {})
  }, [])
  useEffect(() => {
    const load = () => fetch('/api/kiosk/local').then((r) => (r.ok ? r.json() : null))
      .then((j) => { setLocal(j); setLocalFetched(true) }).catch(() => setLocalFetched(true))
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [])
  // Estación remota (GW1100): página de sensores. La página "consola" trae sus
  // propios datos remotos dentro de <ConsoleReplica>.
  useEffect(() => {
    if (page !== '3') return
    const load = () => fetch('/api/current?station=gw1100').then((r) => (r.ok ? r.json() : null))
      .then(setRemote).catch(() => {})
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [page])

  // Zonas de las páginas 1-5. Va aquí arriba y no junto a su `return` porque los
  // hooks no pueden ir después de un return condicional; sólo hace algo cuando
  // `rootRef` acaba apuntando a algo, o sea cuando se pinta el `shell`. Las demás
  // pantallas llevan su propio contenedor y llaman al hook por su cuenta.
  useNavZones(rootRef, page)

  const ready =
    page === '2' ? localFetched :
    page === '4' ? !!(forecast?.days?.length) :
    page === '5' ? multiReady :
    (!loading && !!data)   // páginas 1 y 3

  const header = (
    <div className="flex items-center justify-between px-8 pt-4 pb-1">
      <div>
        <p className="text-[22px] font-bold leading-tight">Clima XE1E · {LOCATION.name}</p>
        <p className="text-[13px] text-slate-400">{LOCATION.label}</p>
      </div>
      <div className="text-right leading-none">
        <p className="text-[15px] text-slate-300 mb-1">{DIAS[now.getDay()]} {now.getDate()} de {MESES[now.getMonth()]}</p>
        <p className="text-[40px] font-bold tabular-nums">{pad(now.getHours())}:{pad(now.getMinutes())}</p>
      </div>
    </div>
  )

  const tabBar = (
    <div className="flex border-t border-white/10" style={{ height: 64 }}>
      {TABS.map((t, i) => {
        const active = (parseInt(page) || 1) === i + 1
        // La última pestaña es la consola, que no es una página numerada.
        const destino = i === TABS.length - 1 ? 'consola' : String(i + 1)
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-center"
            // Estas páginas también publican sus zonas, en vez de dejar que el
            // firmware caiga a su reparto por la X. Así hay UNA sola forma de
            // navegar en todo el display, y de paso el toque fuera de la barra
            // lleva al menú (ver `parentOf`) en vez de no hacer nada.
            {...(active ? {} : { 'data-nav': destino })}
            style={{
              background: active ? 'rgba(56,189,248,0.15)' : 'transparent',
              borderTop: active ? '3px solid #38bdf8' : '3px solid transparent',
            }}>
            {/* 30 px: la barra mide 64 y hay que dejar sitio a la etiqueta. El
                trazo va a 2.2 para que aguante el reescalado del JPEG del display. */}
            <t.Icon size={30} strokeWidth={2.2}
              color={active ? '#38bdf8' : '#7c8b9c'} style={{ opacity: active ? 1 : 0.8 }} />
            <span className="text-[12px] mt-1" style={{ color: active ? '#e2e8f0' : '#64748b' }}>{t.label}</span>
          </div>
        )
      })}
    </div>
  )

  const shell = (children: ReactNode) => (
    <div
      ref={rootRef}
      data-kiosk-ready={ready ? 'true' : 'false'}
      className="text-slate-100 overflow-hidden flex flex-col"
      style={{
        width: 1024, height: 600,
        background: 'radial-gradient(1200px 600px at 70% -10%, #14304f 0%, #0b1220 55%, #070d17 100%)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      {header}
      <div className="flex-1 min-h-0">{children}</div>
      {tabBar}
    </div>
  )

  // ── Página "consola": réplica de la consola física Ecowitt, pantalla
  //    completa (sin header ni barra de pestañas), llena todo el ancho.
  //    La vista vive en <ConsoleReplica>, compartida con el tab "Consola"
  //    del dashboard, para que los ajustes se hagan en un solo lugar. ──
  if (page === 'consola') {
    return <ConsoleReplica mode="kiosk" ready={ready} />
  }

  // ── Pantallas del ÁRBOL nuevo, las que cuelgan de las celdas de la consola.
  //    Todas comparten marco (`chrome.tsx`) y estética con ella, y publican su
  //    propio mapa de zonas táctiles. El slug ya viene validado por el renderer;
  //    `parseSlug` cae a la consola ante cualquier cosa rara.
  //
  //    Van ANTES del enrutado de las páginas 1-5 y no reusan `shell()`: ésas
  //    llevan cabecera azul y barra de seis pestañas, que es justo lo que las
  //    nuevas no tienen. ──
  const nav = parseSlug(page)
  if (nav.kind === 'det') return <DetailPage v={nav.v} p={nav.p} slug={page} />
  if (nav.kind === 'stats') return <StatsPage s={nav.s} slug={page} />
  if (nav.kind === 'menu') return <MenuPage slug={page} />
  if (nav.kind === 'camara') return <CamaraPage slug={page} />

  // ── Página 2: sensor local del display (BME280) ──
  if (page === '2') {
    const L = local?.latest
    const mn = local?.min || {}
    const mx = local?.max || {}
    const bigCard = (label: string, value: string, unit: string, sub: string, color: string) => (
      <div className="flex-1 rounded-3xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-center">
        <p className="text-[28px] uppercase tracking-wider text-slate-300 font-semibold">{label}</p>
        <p className="text-[80px] leading-none font-bold mt-2" style={{ color }}>{value}<span className="text-[30px] text-slate-400 ml-1">{unit}</span></p>
        <p className="text-[24px] text-slate-300 mt-3">{sub}</p>
      </div>
    )
    return shell(
      <div className="h-full px-8 pt-1 pb-3 flex flex-col">
        <p className="text-[17px] text-slate-300 mb-2">📍 Sensor local del display · BME280</p>
        {!L ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-[20px]">
            Esperando datos del sensor local del display…
          </div>
        ) : (
          <>
            <div className="flex-1 flex gap-6 min-h-0">
              {bigCard('Temperatura', L.temperature != null ? `${u.temp(L.temperature)}` : '--', u.tempU,
                `mín ${mn.temperature != null ? u.temp(mn.temperature) : '--'}° · máx ${mx.temperature != null ? u.temp(mx.temperature) : '--'}°`, '#f97316')}
              {bigCard('Humedad', L.humidity != null ? `${L.humidity.toFixed(0)}` : '--', '%',
                `mín ${mn.humidity?.toFixed(0) ?? '--'}% · máx ${mx.humidity?.toFixed(0) ?? '--'}%`, '#3b82f6')}
              {bigCard('Presión', L.pressure != null ? `${u.press(L.pressure)}` : '--', u.pressU,
                `mín ${mn.pressure != null ? u.press(mn.pressure) : '--'} · máx ${mx.pressure != null ? u.press(mx.pressure) : '--'}`, '#a78bfa')}
            </div>
            <p className="text-[13px] text-slate-500 mt-2 text-center">
              Actualizado {L.received_at ? relativeTime(L.received_at) : '—'} · mín/máx de hoy
            </p>
          </>
        )}
      </div>
    )
  }

  // ── Página 3: sensores interior / jardín / remoto ──
  if (page === '3') {
    const chTemp = data?.temperature_ch1
    const chHum = data?.humidity_ch1

    const TempIcon = () => (
      <svg width="36" height="56" viewBox="0 0 24 48" fill="none">
        <rect x="8" y="8" width="8" height="32" rx="4" stroke="#f97316" strokeWidth="2" fill="none" />
        <circle cx="12" cy="36" r="6" fill="#f97316" />
        <line x1="12" y1="14" x2="12" y2="28" stroke="#f97316" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
    const HumIcon = () => (
      <svg width="32" height="44" viewBox="0 0 24 32" fill="none">
        <path d="M12 4 C12 4 4 14 4 20 C4 25.5 7.6 28 12 28 C16.4 28 20 25.5 20 20 C20 14 12 4 12 4 Z" stroke="#3b82f6" strokeWidth="2" fill="#3b82f6" fillOpacity="0.3" />
      </svg>
    )
    const BigSensorCard = ({ title, icon, values }: {
      title: string
      icon: string
      values: { label: string; value: string; color: string; iconEl?: React.ReactNode }[]
    }) => (
      <div className="flex-1 rounded-3xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-center p-6">
        <p className="text-[28px] text-slate-200 font-semibold mb-4">{icon} {title}</p>
        <div className="flex flex-col gap-6 items-center">
          {values.map((v, i) => (
            <div key={i} className="flex items-center gap-4">
              {v.iconEl}
              <div className="text-center">
                <p className="text-[72px] leading-none font-bold" style={{ color: v.color }}>{v.value}</p>
                <p className="text-[18px] text-slate-400 mt-1">{v.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )

    // Estación remota: DOS sensores distintos, y hay que rotularlos como tales.
    // El WN32 conectado al GW1100 es el EXTERIOR (llega como temperature_outdoor);
    // el sensor integrado del GW1100 es el INTERIOR (temperature_indoor). Antes se
    // usaba el integrado como exterior mediante la trampa `treat_indoor_as_outdoor`
    // del servidor; al retirarla, leer solo `_indoor` dejaría el exterior invisible.
    // Mismo criterio que <RemoteStationCard> en el dashboard.
    const RemoteCard = () => (
      <div className="flex-1 rounded-3xl border border-white/10 bg-white/[0.04] flex flex-col p-5">
        <p className="text-[28px] text-slate-200 font-semibold text-center mb-3">📡 Remota</p>

        <p className="text-[15px] uppercase tracking-wider text-slate-400 mb-1">Exterior · WN32</p>
        <div className="flex items-center justify-around mb-4">
          <div className="text-center">
            <p className="text-[46px] leading-none font-bold" style={{ color: '#fbbf24' }}>
              {remote?.temperature_outdoor != null ? `${u.temp(remote.temperature_outdoor)}°` : '--'}
            </p>
            <p className="text-[15px] text-slate-400 mt-1">Temp</p>
          </div>
          <div className="text-center">
            <p className="text-[46px] leading-none font-bold" style={{ color: '#22d3ee' }}>
              {remote?.humidity_outdoor != null ? `${remote.humidity_outdoor.toFixed(0)}%` : '--'}
            </p>
            <p className="text-[15px] text-slate-400 mt-1">Humedad</p>
          </div>
        </div>

        <div className="border-t border-white/10 pt-3">
          <p className="text-[15px] uppercase tracking-wider text-slate-400 mb-1">Interior · GW1100</p>
          <div className="flex items-center justify-around">
            <div className="text-center">
              <p className="text-[34px] leading-none font-bold" style={{ color: '#f97316' }}>
                {remote?.temperature_indoor != null ? `${u.temp(remote.temperature_indoor)}°` : '--'}
              </p>
              <p className="text-[13px] text-slate-400 mt-1">Temp</p>
            </div>
            <div className="text-center">
              <p className="text-[34px] leading-none font-bold" style={{ color: '#3b82f6' }}>
                {remote?.humidity_indoor != null ? `${remote.humidity_indoor.toFixed(0)}%` : '--'}
              </p>
              <p className="text-[13px] text-slate-400 mt-1">Humedad</p>
            </div>
            <div className="text-center">
              <p className="text-[34px] leading-none font-bold" style={{ color: '#a78bfa' }}>
                {remote?.pressure_relative != null ? u.press(remote.pressure_relative, 0) : '--'}
              </p>
              <p className="text-[13px] text-slate-400 mt-1">{u.pressU}</p>
            </div>
          </div>
        </div>
      </div>
    )

    return shell(
      <div className="h-full px-6 pt-1 pb-3 flex flex-col">
        <p className="text-[17px] text-slate-300 mb-2">🏠 Sensores · interior, jardín y remoto</p>
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Interior */}
          <BigSensorCard
            title="Interior"
            icon="🛋"
            values={[
              { label: 'Temperatura', value: data?.temperature_indoor != null ? `${u.temp(data.temperature_indoor)}°` : '--', color: '#f97316', iconEl: <TempIcon /> },
              { label: 'Humedad', value: data?.humidity_indoor != null ? `${data.humidity_indoor.toFixed(0)}%` : '--', color: '#3b82f6', iconEl: <HumIcon /> },
            ]}
          />
          {/* Jardín (CH1) */}
          <BigSensorCard
            title="Jardín"
            icon="🌿"
            values={[
              { label: 'Temperatura', value: chTemp != null ? `${u.temp(chTemp)}°` : '--', color: '#f97316', iconEl: <TempIcon /> },
              { label: 'Humedad', value: chHum != null ? `${chHum.toFixed(0)}%` : '--', color: '#3b82f6', iconEl: <HumIcon /> },
            ]}
          />
          {/* Remota: exterior (WN32) + interior (GW1100) */}
          <RemoteCard />
        </div>
      </div>
    )
  }

  // ── Página 4: pronóstico 7 días ──
  if (page === '4') {
    const days = forecast?.days?.slice(0, 7) ?? []
    return shell(
      <div className="h-full px-6 pt-1 pb-3 flex flex-col">
        <p className="text-[17px] text-slate-300 mb-2 px-2">📅 Pronóstico · 7 días</p>
        <div className="flex-1 flex gap-3 min-h-0">
          {days.length === 0 ? (
            <div className="w-full flex items-center justify-center text-slate-500 text-[20px]">Pronóstico no disponible</div>
          ) : days.map((d, i) => {
            const dt = new Date(d.date + 'T12:00:00')
            const name = i === 0 ? 'Hoy' : DIAS_CORTO[dt.getDay()]
            return (
              <div key={i} className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-between py-4">
                <span className="text-[19px] font-semibold text-slate-200">{name}</span>
                <span className="text-[13px] text-slate-500">{dt.getDate()}/{dt.getMonth() + 1}</span>
                <WeatherIcon name={d.icon} size={56} />
                <div className="text-center leading-tight">
                  <span className="text-[26px] font-bold">{u.temp(d.tempMax, 0)}°</span>
                  <span className="text-[19px] text-slate-400 ml-1">{u.temp(d.tempMin, 0)}°</span>
                </div>
                <span className="text-[15px] text-sky-300">💧 {d.precipProb ?? 0}%</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Página 5: resumen multivariable · últimas 48 h ──
  // Es LA MISMA gráfica del tab Historia del dashboard (MultiVariableChart),
  // reusada en modo kiosco y con ventana de 48 h en vez de 24 h. Al reusar el
  // componente, cualquier mejora que se le haga en el dashboard llega sola al
  // display, sin duplicar la lógica de ejes ni de agrupación por hora.
  if (page === '5') {
    return shell(
      <div className="h-full px-6 pt-1 pb-2 flex flex-col">
        <p className="text-[17px] text-slate-300 mb-1">📈 Resumen multivariable · últimas 48 h</p>
        <div className="flex-1 min-h-0">
          <MultiVariableChart mode="2day" kiosk height="100%" onLoaded={() => setMultiReady(true)} />
        </div>
      </div>
    )
  }

  // ── Página 1: estación ──
  const cond = data ? deriveCondition(data) : { icon: '', label: '' }
  const t = stats?.temperature_outdoor
  // `?? null`, NO `?? 0`: si el sensor no reporta hay que mostrar "--". Un 0 en
  // el display se lee como medición real (y una presión de 0 mb, como avería).
  const uv = data?.uv_index ?? null
  const hours = forecast?.hours?.slice(0, 6) ?? []

  return shell(
    <div className="h-full flex flex-col px-8 pt-2 pb-3 gap-3">
      <div className="flex-1 flex gap-6 min-h-0">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-center" style={{ width: 420 }}>
          <WeatherIcon name={cond.icon} size={120} />
          <div className="flex items-start mt-1">
            <span className="text-[110px] leading-none font-bold" style={{ color: '#f97316' }}>
              {data?.temperature_outdoor != null ? u.temp(data.temperature_outdoor) : '--'}
            </span>
            <span className="text-[36px] font-semibold text-slate-400 mt-3">{u.tempU}</span>
          </div>
          <p className="text-[22px] text-slate-300 mt-1">{cond.label}</p>
          <p className="text-[17px] text-slate-400 mt-2">
            Sensación {data?.feels_like != null ? `${u.temp(data.feels_like)}${u.tempU}` : '--'} ·
            {' '}máx {t?.max != null ? `${u.temp(t.max)}°` : '--'} / mín {t?.min != null ? `${u.temp(t.min)}°` : '--'}
          </p>
        </div>

        <div className="grid grid-cols-3 grid-rows-2 gap-4 flex-1">
          <Tile label="Humedad" value={data?.humidity_outdoor != null ? data.humidity_outdoor.toFixed(0) : '--'} unit="%" color="#3b82f6" />
          <Tile label="Presión" value={u.press(data?.pressure_relative, 0)} unit={u.pressU} color="#a78bfa" />
          <Tile label="Viento" value={u.wind(data?.wind_speed, 0)} unit={u.windU} sub={data?.wind_direction != null ? `${Math.round(data.wind_direction)}°` : undefined} color="#22c55e" />
          <Tile label="Lluvia hoy" value={u.rain(data?.rain_daily)} unit={u.rainU} color="#38bdf8" />
          <Tile label="Índice UV" value={uv != null ? `${uv}` : '--'} color={uv == null ? '#94a3b8' : uv >= 8 ? '#fca5a5' : uv >= 6 ? '#fdba74' : '#fde047'} />
          <Tile label="IMECA" value={imeca?.available && imeca.imeca != null ? `${imeca.imeca}` : '--'} sub={imeca?.category} color={imeca?.color || '#e2e8f0'} />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 flex justify-between" style={{ height: 128 }}>
        {hours.length === 0 ? (
          <div className="w-full flex items-center justify-center text-slate-500 text-[15px]">Pronóstico no disponible</div>
        ) : hours.map((h, i) => {
          const d = new Date(h.time)
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-between">
              <span className="text-[15px] text-slate-400">{pad(d.getHours())}:00</span>
              <WeatherIcon name={h.icon} size={36} />
              <span className="text-[21px] font-bold leading-none">{u.temp(h.temp)}°</span>
              <span className="text-[13px] text-sky-300 leading-none">💧 {h.precipProb ?? 0}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
