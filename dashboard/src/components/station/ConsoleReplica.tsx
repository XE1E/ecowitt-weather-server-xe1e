import { useEffect, useState, type ReactNode } from 'react'
import { useStationData } from '../../station-data'
import { useUnits } from '../../units'
import { deriveCondition, historicValue, moonIllumination } from '../../weather'
import { WeatherIcon } from '../WeatherIcon'
import { MeteoGlyph } from '../MeteoGlyph'
// Tipo compartido de la fila del histórico remoto: declara tanto el sensor
// integrado del GW1100 (*_indoor) como el WN32 exterior (*_outdoor). Antes había
// aquí una copia local que solo tenía los _indoor.
import type { RemoteHistRow } from '../../remote'
// Amanecer/atardecer: no se calculan en local como la fase lunar, vienen del
// pronóstico (Open-Meteo a través de nuestro backend, que además lo cachea).
import { fetchForecast, type AstroData } from '../../forecast'
import { LOCATION } from '../../config'

/**
 * Réplica de la consola física Ecowitt (rejilla 3×5, 1024×600).
 *
 * ÚNICA fuente de la vista: la usan la página `?page=consola` del kiosco (que
 * el renderer captura para el display ESP32-S3) y el tab "Consola" del
 * dashboard. Antes estaba duplicada en los dos archivos y cada ajuste visual
 * había que aplicarlo dos veces a mano; ahora se toca sólo aquí.
 */

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES_CORTO = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
const pad = (n: number) => String(n).padStart(2, '0')

// Hora local "HH:MM" de un ISO. Los `min_time`/`max_time` de /api/stats/daily SÍ
// traen offset (+00:00), así que Date los sitúa bien y getHours() devuelve la hora
// local del contenedor, que es la misma que ya muestra el reloj de la consola.
const hhmm = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// El `timestamp` de /api/current viene en UTC pero SIN sufijo de zona, y un ISO sin
// zona lo interpreta Date como hora LOCAL. Sin añadirle la 'Z' la antigüedad saldría
// desfasada las 6 h del huso: siempre negativa, y la consola nunca se daría por
// caída. Los que ya traen zona (+00:00 o Z) se dejan como están.
const parseUtc = (s?: string) => {
  if (!s) return null
  const d = new Date(/(Z|[+]\d\d:?\d\d|-\d\d:\d\d)$/.test(s) ? s : `${s}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// Minutos sin lectura nueva tras los que la consola avisa. La estación empuja cada
// ~16 s, así que 5 min son ~19 envíos perdidos: margen de sobra para no dar falsas
// alarmas por un push tardío y aun así enterarse pronto.
const STALE_MIN = 5
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const cardinal = (deg?: number) => (deg == null ? '--' : DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16])

// El rumbo se dibuja con sus letras tal cual: la fuente DSEG14 (catorce segmentos) las
// tiene todas a altura completa. Hubo aquí un `seg7()` que cambiaba O→0 y S→5 para
// esquivar los glifos a media altura de DSEG7; sobra desde que existe la clase `.seg14`.

// Geometría del compás ovalado. El aspecto del óvalo es intencional (la consola
// física es más ancha que alta): RX/RY también orientan el marcador de dirección.
const RX = 49       // óvalo exterior (aro con las marcas de grados)
const RY = 38
const RX_IN = 42    // óvalo interior
const RY_IN = 31
// Punta de la flecha de dirección: pegada al aro exterior. Más adentro se vería
// igual de bien pero taparía la lectura del centro en los rumbos E/O (la
// velocidad con su unidad, "24.3 km/h", llega casi al óvalo interior), y ese es
// el dato que no se puede perder; aquí sólo roza la letra cardinal en N/E/S/O
// exactos.
const ARX = RX - 1.5
const ARY = RY - 1.5

// La fase lunar sale de `moonIllumination` (weather.ts), la misma que usa el
// pronóstico: antes había aquí una copia de la fórmula, y tener dos podía
// hacerlas divergir con cualquier retoque. `illum` viene en % (0-100).

// Misma lógica de umbrales que UvSolarCard (tab Inicio), en hex para los estilos
// inline de la consola. UV: verde→fucsia. Solar: gris (noche)→rojo (pico).
function uvColor(uv: number): string {
  if (uv >= 11) return '#e879f9'
  if (uv >= 8) return '#f87171'
  if (uv >= 6) return '#fb923c'
  if (uv >= 3) return '#fde047'
  return '#34d399'
}

function solarColor(w: number): string {
  if (w >= 800) return '#f87171'
  if (w >= 550) return '#fb923c'
  if (w >= 250) return '#fcd34d'
  if (w >= 50) return '#fde047'
  return '#94a3b8'
}

// Números de la consola: la parte decimal (".4") en fuente más chica, como una
// consola física. Divide en el punto; si no hay decimal, devuelve el string tal cual.
function decNum(s: string): ReactNode {
  const i = s.indexOf('.')
  if (i < 0) return s
  return (
    <>
      {s.slice(0, i)}
      <span className="dec">{s.slice(i)}</span>
    </>
  )
}

// Dibuja la luna con la iluminación real (terminador elíptico correcto).
function MoonGlyph({ size = 42 }: { size?: number }) {
  const R = size / 2
  const { phase, illum, waxing } = moonIllumination(new Date())
  const rx = Math.max(0.4, Math.abs(R * Math.cos(2 * Math.PI * phase)))
  const gibbous = illum > 50
  const s1 = waxing ? 1 : 0
  const s2 = gibbous ? s1 : 1 - s1
  const litPath = `M0,${-R} A ${R} ${R} 0 0 ${s1} 0 ${R} A ${rx} ${R} 0 0 ${s2} 0 ${-R} Z`
  return (
    <svg width={size} height={size} viewBox={`${-R} ${-R} ${size} ${size}`}>
      <circle r={R} fill="#1b1b1b" />
      <path d={litPath} fill="#ffcf19" />
    </svg>
  )
}

// Marcador de DÓNDE se mide, no de qué tiempo hace. Es UNA sola casa en dos
// versiones: hueca = sensor a la intemperie, rellena = sensor bajo techo. Antes
// eran dos dibujos distintos --una casa sola y una casa con flecha, ésta en una
// caja más ancha-- y distinguirlos obligaba a leer el detalle de la flecha; el
// relleno se ve de golpe y a cualquier tamaño.
//
// Un ÚNICO tamaño (30) para las cuatro celdas que lo llevan: cuando cada una
// tenía el suyo (30, 32, 26) el glifo parecía cambiar de importancia según la
// celda, cuando lo que dice es siempre lo mismo.
//
// El de exterior era antes un sol amarillo relleno de Meteocons, y un sol
// conviviendo con la celda de condición ("NOCHE NUBLADA") se puede leer como
// estado del cielo en vez de como ubicación del sensor.
const LOC_STROKE = '#94a3b8'
const LOC_SIZE = 30

// Los dos `path` se rellenan o no según `filled`. Ninguno está cerrado
// explícitamente, pero SVG cierra el contorno al rellenar, así que el del techo da
// el triángulo y el del cuerpo el rectángulo: juntos, la silueta de la casa.
function HouseGlyph({ size = LOC_SIZE, filled = false }: { size?: number; filled?: boolean }) {
  const fill = filled ? LOC_STROKE : 'none'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={LOC_STROKE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l9-9 9 9" fill={fill} />
      <path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10" fill={fill} />
    </svg>
  )
}

// Estado de batería de un sensor: la pila se dibuja llena y verde, o casi vacía y
// roja. Sólo distingue OK / baja porque es lo único que mandan el WS69 y los WN31
// --Ecowitt los reporta como bandera 0/1, no como voltaje-- y por eso el relleno
// tiene dos posiciones y no un nivel continuo. El WN32 exterior SÍ reportará nivel
// cuando se instale, y entonces este mismo dibujo puede llevar relleno proporcional.
//
// `name` identifica el sensor y va SIEMPRE en el `title`; `showLabel` decide si además
// se dibuja al lado. Se oculta en EXT, donde la línea de mín/máx va centrada y ocupa
// casi toda la franja de abajo: ahí sólo cabe la pila. No se pierde información,
// porque cada celda tiene una sola batería, la del sensor que le da sus datos.
//
// `level` va de 0 a 1 y el relleno es PROPORCIONAL, no de dos posiciones. Con los
// sensores de hoy sólo tomará los extremos --Ecowitt manda una bandera OK/baja para el
// WS69 y los WN31-- pero el WN32 exterior puede reportar nivel, y así el dibujo ya
// está listo sin tocarlo. Ver `battLevel`.
function BatteryGlyph({ level, name, showLabel = true }: { level: number; name: string; showLabel?: boolean }) {
  const f = Math.max(0.08, Math.min(1, level))
  const ok = f > 0.25
  const c = ok ? '#22c55e' : '#ef4444'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      title={`batería ${name}: ${ok ? 'OK' : 'baja'} (${Math.round(f * 100)}%)`}>
      {showLabel && <span style={{ color: 'var(--lbl)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>{name}</span>}
      <svg width="18" height="10" viewBox="0 0 18 10">
        <rect x="0.6" y="0.6" width="13" height="8.8" rx="1.6" fill="none" stroke={c} strokeWidth="1.2" />
        <rect x="2.2" y="2.2" width={9.8 * f} height="5.6" fill={c} />
        <rect x="14.2" y="3" width="3" height="4" rx="1" fill={c} />
      </svg>
    </span>
  )
}

// Traduce lo que llegue de un campo `battery_*` a un relleno de 0 a 1.
//
// Hoy el receiver convierte a BOOLEANO todas las baterías salvo las de su lista de
// voltaje (wh40/wh57/wh68/wh80/wh90), y `wh32batt` NO está en esa lista: la del WN32
// llegará como OK/baja, no como nivel. Si al instalarlo resulta que reporta voltaje,
// basta añadirlo allí y aquí ya se interpreta el número.
//
// Se aceptan las tres formas por si acaso: booleano, la bandera cruda 0/1 de Ecowitt
// (donde 0 = normal, al revés de lo que sugiere) y un voltaje. El voltaje se mapea
// sobre 0.9-1.6 V, el rango útil de una pila alcalina AA; queda por calibrar cuando el
// sensor esté puesto y se vea qué manda de verdad.
const battLevel = (v: unknown): number | null => {
  if (typeof v === 'boolean') return v ? 1 : 0.08
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v <= 1) return v === 0 ? 1 : 0.08
    return Math.max(0.08, Math.min(1, (v - 0.9) / 0.7))
  }
  return null
}

interface DailyRain { date: string; rain: number | null }

// Inicial del día de la semana de una fecha ISO.
// `new Date('2026-08-06')` se interpreta como MEDIANOCHE UTC, y en UTC-6 eso cae en el
// día ANTERIOR: las letras saldrían corridas una posición. Construyendo la fecha por
// partes es local y no hay desfase.
const dowLetter = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return '?'
  return DIAS_CORTO[new Date(y, m - 1, d).getDay()].charAt(0)
}

// Histograma de la lluvia de los últimos 7 días. Las tres cifras de la celda dicen
// "llueve ahora", "cuánto en este chubasco" y "cuánto va del mes"; esto añade el reparto,
// que es lo que una cifra sola no puede dar: si los 16 mm del mes cayeron de golpe ayer
// o repartidos toda la semana.
function RainHistogram({ data, fmt }: { data: DailyRain[]; fmt: (mm: number) => string }) {
  const known = data.map((d) => d.rain).filter((v): v is number => v != null)
  const peak = known.length ? Math.max(...known) : 0
  // SUELO de 10 mm en la escala: sin él, una semana de llovizna --0.2 mm el día más
  // lluvioso-- dibujaría una barra a tope y parecería un diluvio. Con suelo, la altura
  // significa siempre lo mismo mientras no se pase de 10.
  const scale = Math.max(peak, 10)
  const BAR_H = 34
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, width: '100%' }}>
      {data.map((d, i) => {
        const v = d.rain
        const hoy = i === data.length - 1
        // Tres casos que NO son lo mismo y se ven distintos: sin resumen guardado
        // (gris), cero lluvia (una uña del color de la lluvia, para que el día exista)
        // y con lluvia (proporcional, con 3 px de mínimo para que nunca desaparezca).
        const alto = v == null ? 3 : v <= 0 ? 2 : Math.max(3, (v / scale) * BAR_H)
        const color = v == null ? '#3a3a3a' : 'var(--r)'
        const opacidad = v == null ? 1 : v <= 0 ? 0.35 : hoy ? 1 : 0.75
        return (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}
            title={`${d.date}: ${v == null ? 'sin dato' : fmt(v)}`}>
            {/* El valor SÓLO encima de la barra más alta. Da la escala del gráfico sin
                gastar un eje ni un rótulo aparte, y se coloca solo en el único sitio
                donde hace falta mirarlo. */}
            <div style={{ height: 11, fontSize: 10, fontWeight: 700, color: 'var(--w)', lineHeight: 1 }}>
              {v != null && v > 0 && v === peak ? fmt(v) : ''}
            </div>
            <div style={{ height: BAR_H, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: alto, borderRadius: 2, background: color, opacity: opacidad }} />
            </div>
            {/* Hoy en blanco y el resto en gris: sin eso hay que contar las barras para
                saber cuál es cuál. */}
            <div style={{ fontSize: 10, fontWeight: 700, lineHeight: 1, marginTop: 3,
                          color: hoy ? 'var(--w)' : 'var(--lbl)' }}>
              {dowLetter(d.date)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Barra de nivel: dónde cae un valor dentro de su escala. Es la misma idea que el riel
// del barómetro de PRES, que ya demostró que funciona: SOLAR, UV e ICA ya se pintan con
// el color de su categoría, pero ese color sólo se entiende si uno recuerda los cortes,
// y la barra lo vuelve legible sin recordar nada.
//
// Con divs y no en SVG: un SVG estirado con preserveAspectRatio="none" deformaría las
// esquinas redondeadas, y aquí el ancho lo pone la celda.
function LevelBar({ value, max, color }: { value?: number | null; max: number; color: string }) {
  const f = value == null ? 0 : Math.max(0, Math.min(1, value / max))
  return (
    <div style={{ width: '100%', height: 7, borderRadius: 4, background: '#141414',
                  border: '1px solid #5a5a5a', overflow: 'hidden' }}>
      <div style={{ width: `${f * 100}%`, height: '100%', background: color, opacity: 0.85 }} />
    </div>
  )
}

// Salida y puesta del sol, para la celda de la luna. Las flechas dicen cuál es
// cuál sin gastar una palabra: sube = amanece, baja = atardece.
function SunTimes({ sunrise, sunset }: { sunrise?: string; sunset?: string }) {
  const row = (up: boolean, iso?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* Triángulo a 14 y no a 11: a 11 competía en peso con los dos puntos del reloj
          de al lado y costaba ver hacia dónde apuntaba, que es TODO lo que dice. */}
      <svg width="14" height="14" viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
        <path d={up ? 'M6 1.5 L10.5 7.5 L1.5 7.5 Z' : 'M6 10.5 L10.5 4.5 L1.5 4.5 Z'} fill="#ffcf19" />
      </svg>
      <span className="seg" style={{ color: '#ffcf19', fontSize: 17, fontWeight: 800, lineHeight: 1 }}>
        {hhmm(iso) || '--:--'}
      </span>
    </div>
  )
  // gap 10 y no 5: las dos horas se leían como un bloque de cuatro cifras pegadas.
  // Hay alto de sobra en la celda para separarlas.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {row(true, sunrise)}
      {row(false, sunset)}
    </div>
  )
}

// Escala horizontal de tendencia de presión, la del WS2910: dónde cae la variación
// de las últimas 3 h en un riel de ±5 mb. La flecha de la celda dice el SENTIDO;
// esto dice CUÁNTO, que es lo que enseña el barómetro de una consola física.
//
// El rango se fija en hPa y sólo se convierten los rótulos: 5 hPa son 0.15 inHg, y
// un riel rotulado ±5 en modo imperial estaría mintiendo. El valor fuera de rango
// se pinza contra el extremo en vez de salirse del riel: ±5 hPa en 3 h ya es un
// cambio brusco, y lo que importa entonces es "está al tope", no cuánto lo pasa.
const PS_R = 5          // rango del riel, en hPa
// 221 = 335 de caja menos 62 de sangría (el barómetro) y 52 de margen derecho. Se
// estrechó desde 261: a lo ancho de la celda entera las marcas quedaban muy
// separadas y el riel parecía una regla, no un indicador. Con 40 px menos el paso
// entre marcas baja de ~24 a ~20 px y el conjunto se lee de golpe.
const PS_W = 221
// 32 y no 30: con los rótulos a 12 px su borde superior sube hasta y≈22, y las
// marcas mayores bajan hasta y=21. Los 2 px extra se le quitan al margen inferior
// del contenedor (bottom 4 en vez de 6), así el riel no se acerca al número.
const PS_H = 32

function PressureScale({ delta, endLabel }: { delta: number | null; endLabel: string }) {
  const x0 = 12
  const x1 = PS_W - 12
  const mid = (x0 + x1) / 2
  const half = (x1 - x0) / 2
  const xOf = (v: number) => mid + (Math.max(-PS_R, Math.min(PS_R, v)) / PS_R) * half
  const x = xOf(delta ?? 0)
  // Mismos umbrales y colores que TrendGlyph (±1 hPa), para que la barra y la
  // flecha de la celda nunca se contradigan.
  const color = delta == null || Math.abs(delta) <= 1 ? '#94a3b8' : delta > 0 ? '#22c55e' : '#ef4444'
  return (
    <svg width="100%" height={PS_H} viewBox={`0 0 ${PS_W} ${PS_H}`} fill="none">
      {/* Riel y marcas en BLANCO, no en grises: sobre el fondo negro de la consola
          los #3f3f46 / #71717a de la primera versión casi no se veían. El interior
          sí se queda oscuro, que es lo que hace resaltar el relleno de color. La
          jerarquía entre marca mayor y menor la dan ahora el alto y el grosor, no
          el color. */}
      <rect x={x0} y={8} width={x1 - x0} height={9} rx={4.5} fill="#141414" stroke="#eaeaea" strokeWidth="1" />
      {/* Marca cada 1 hPa; más alta y gruesa en -5, 0 y +5 */}
      {Array.from({ length: 2 * PS_R + 1 }, (_, i) => i - PS_R).map((v) => {
        const tx = xOf(v)
        const major = v % PS_R === 0
        return (
          <line key={v} x1={tx} y1={major ? 4 : 6.5} x2={tx} y2={major ? 21 : 18.5}
            stroke="#eaeaea" strokeWidth={major ? 1.6 : 1} />
        )
      })}
      {/* Relleno del centro al valor: da la magnitud sin tener que leer la escala */}
      {delta != null && Math.abs(x - mid) > 0.5 && (
        <rect x={Math.min(mid, x)} y={9.5} width={Math.abs(x - mid)} height={6} fill={color} opacity={0.55} />
      )}
      {/* Puntero a ±7 y con la punta en y=8, no ±5 y 7: es lo que dice DÓNDE cae la
          variación, o sea el dato del riel, y a 5 px se perdía entre las marcas. Ahora
          su punta toca el borde del riel en vez de quedarse a 1 px. */}
      {delta != null && <polygon points={`${x - 7},0 ${x + 7},0 ${x},8`} fill={color} />}
      {/* Los extremos se rotulan "≤-5" y "≥+5", no "-5" y "+5": el valor se PINZA
          contra el tope --±5 hPa en 3 h ya es un cambio brusco y lo que importa
          entonces es "está al tope"-- así que la marca del extremo representa ese
          valor Y TODO LO QUE HAYA MÁS ALLÁ. Sin los símbolos, un riel al máximo se
          leía como "exactamente 5". */}
      <text x={x0} y={PS_H - 1} fill="#eaeaea" fontSize="12" fontWeight="700" textAnchor="start">{'≤'}-{endLabel}</text>
      <text x={mid} y={PS_H - 1} fill="#eaeaea" fontSize="12" fontWeight="700" textAnchor="middle">0</text>
      <text x={x1} y={PS_H - 1} fill="#eaeaea" fontSize="12" fontWeight="700" textAnchor="end">{'≥'}+{endLabel}</text>
    </svg>
  )
}

type Trend = 'up' | 'down' | 'stable'

// Flechita de tendencia (sube / baja / estable) reutilizada por varias celdas.
function TrendGlyph({ trend, width = 20, height = 24, style }: {
  trend: Trend; width?: number; height?: number; style?: React.CSSProperties
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 24" fill="none" style={style}>
      {trend === 'up' && <path d="M10 4 L18 14 L13 14 L13 20 L7 20 L7 14 L2 14 Z" fill="#22c55e" />}
      {trend === 'down' && <path d="M10 20 L18 10 L13 10 L13 4 L7 4 L7 10 L2 10 Z" fill="#ef4444" />}
      {trend === 'stable' && <path d="M4 10 L16 10 L16 14 L4 14 Z" fill="#94a3b8" />}
    </svg>
  )
}

interface Props {
  /**
   * 'kiosk' → 1024×600 fijos, sin bordes redondeados, con `data-kiosk-ready`
   * para que el renderer sepa cuándo capturar.
   * 'page'  → escala al ancho disponible manteniendo la relación 1024/600.
   */
  mode?: 'kiosk' | 'page'
  /** Sólo en modo kiosco: valor que se publica en `data-kiosk-ready`. */
  ready?: boolean
}

interface ImecaData {
  available: boolean
  imeca?: number
  category?: string
  color?: string
}

export function ConsoleReplica({ mode = 'page', ready = true }: Props) {
  const { data, history, stats } = useStationData()
  const u = useUnits()
  const [now, setNow] = useState(() => new Date())
  const [imeca, setImeca] = useState<ImecaData | null>(null)
  const [remote, setRemote] = useState<Record<string, number> | null>(null)
  const [remoteHistory, setRemoteHistory] = useState<RemoteHistRow[]>([])
  const [astro, setAstro] = useState<AstroData | null>(null)
  const [rain7, setRain7] = useState<DailyRain[]>([])

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  // Estación remota (GW1100): valores actuales…
  useEffect(() => {
    const load = () => fetch('/api/current?station=gw1100').then((r) => (r.ok ? r.json() : null))
      .then(setRemote).catch(() => {})
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [])
  // …e histórico corto, para calcular sus tendencias.
  useEffect(() => {
    const load = () => fetch('/api/history?start=-4h&station=gw1100').then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setRemoteHistory(j.data || [])).catch(() => {})
    load()
    const i = setInterval(load, 60000)
    return () => clearInterval(i)
  }, [])

  // Lluvia diaria de la semana, para el histograma. Cada 10 min: el único día que
  // puede cambiar es hoy, y su barra no necesita ir al segundo.
  useEffect(() => {
    const load = () => fetch('/api/rain/daily?days=7').then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.data) setRain7(j.data) }).catch(() => {})
    load()
    const i = setInterval(load, 10 * 60000)
    return () => clearInterval(i)
  }, [])

  // Astronomía del pronóstico, sólo para el amanecer/atardecer de la celda de la
  // luna. Cada 30 min: son dos horas fijas del día, no hace falta más.
  useEffect(() => {
    const load = () => fetchForecast().then((r) => setAstro(r.astro)).catch(() => {})
    load()
    const i = setInterval(load, 30 * 60000)
    return () => clearInterval(i)
  }, [])

  // ICA (IMECA estimado). Se pide aparte porque no va en el contexto de la
  // estación: es un dato externo. Cada 30 min, como su caché en el servidor.
  useEffect(() => {
    const load = () => fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setImeca).catch(() => {})
    load()
    const i = setInterval(load, 30 * 60000)
    return () => clearInterval(i)
  }, [])

  const cond = data ? deriveCondition(data) : { icon: '', label: '' }
  const dir = data?.wind_direction

  // ¿Sigue llegando el dato, o la consola está enseñando números congelados? Hasta
  // ahora no lo miraba nunca: si la estación deja de empujar, /api/current sigue
  // sirviendo la última lectura y la consola la muestra indefinidamente, con el
  // reloj corriendo al lado, que es justo lo que la hace parecer fresca.
  // `now` se refresca cada segundo, así que esto se reevalúa solo.
  const lastSeen = parseUtc(data?.timestamp) ?? parseUtc(data?.received_at)
  const staleMin = lastSeen ? Math.floor((now.getTime() - lastSeen.getTime()) / 60000) : null
  // Exige HABER tenido lectura: con `staleMin == null` contando como caída, la consola
  // gritaba "SIN DATOS" durante el primer segundo de cada carga, antes de que llegara
  // el primer /api/current. Cuando de verdad no hay nada, las celdas ya salen todas en
  // "--", que lo dice sin necesidad de alarma.
  const stale = staleMin != null && staleMin >= STALE_MIN
  const tDay = stats?.temperature_outdoor   // mín/máx del día para la celda EXT
  const hDay = stats?.humidity_outdoor      // …y para HUMEDAD, que los muestra igual

  const getTrend = (current: number | undefined | null, previous: number | null, threshold: number): Trend => {
    if (current == null || previous == null) return 'stable'
    const diff = current - previous
    if (diff > threshold) return 'up'
    if (diff < -threshold) return 'down'
    return 'stable'
  }

  // Temp/humedad: comparar con hace 1 hora, presión: con hace 3 horas
  const tempTrend = getTrend(data?.temperature_outdoor, historicValue(history, (r) => r.temperature_outdoor, 1), 0.5)  // ±0.5°C
  const humTrend = getTrend(data?.humidity_outdoor, historicValue(history, (r) => r.humidity_outdoor, 1), 3)           // ±3%
  const press3h = historicValue(history, (r) => r.pressure_relative, 3)
  const pressTrend = getTrend(data?.pressure_relative, press3h, 1)                                                     // ±1 hPa
  // Variación de 3 h en hPa para el riel de PRES. En crudo, sin convertir: la
  // escala razona en hPa y sólo traduce los rótulos.
  const pressDelta = data?.pressure_relative != null && press3h != null
    ? data.pressure_relative - press3h
    : null
  // 5 hPa son "5" en mb y "0.15" en inHg. u.press ya redondea con los decimales
  // que toca en cada sistema, pero en métrico devolvería "5.0" y sobra el decimal.
  const pressEndLabel = u.pressU === 'inHg' ? u.press(PS_R) : String(PS_R)

  // Estación remota: tiene DOS sensores de temperatura/humedad y ahora cada uno
  // tiene su celda fija, en vez de una sola celda camaleónica que mostraba el
  // exterior si el WN32 reportaba y si no caía al interior, cambiándose la
  // etiqueta sola. Con dos celdas se ven los dos a la vez y cada rótulo dice
  // siempre lo mismo; cuando un sensor no reporta, su celda muestra "--", que es
  // información (ese sensor está callado) y no una sustitución silenciosa.
  //
  // REMOTA GW1100 = sensor integrado del gateway, interior del sitio remoto.
  const remoteInT = remote?.temperature_indoor
  const remoteInH = remote?.humidity_indoor
  // REMOTA WN32 = sensor exterior conectado al gateway, el dato meteorológico.
  const remoteOutT = remote?.temperature_outdoor
  const remoteOutH = remote?.humidity_outdoor
  // Batería del WN32. Según el firmware la reporta como `wh32batt` o como `wh26batt`
  // (el sensor es un WH26), y el receiver mapea las dos, así que se prueban ambas.
  // Hoy la remota no manda ninguna de las dos --el GW1100 va a corriente y todavía no
  // tiene el sensor colgado-- así que la pila aparecerá al emparejarlo.
  const remoteOutBatt = battLevel(
    (remote as Record<string, unknown> | null)?.battery_wh32
    ?? (remote as Record<string, unknown> | null)?.battery_wh26
  )

  // Tendencias estación remota (mismos umbrales que las locales: ±0.5 °C, ±3 %,
  // ±1 hPa; temp/humedad contra hace 1 h y presión contra hace 3 h).
  // Del sensor interior NO se calculan: su celda no muestra flechas, porque lo de
  // adentro se mueve poco y su subida o bajada no dice nada del tiempo.
  const remoteOutTempTrend = getTrend(remoteOutT, historicValue(remoteHistory, (r) => r.temperature_outdoor, 1), 0.5)
  const remoteOutHumTrend = getTrend(remoteOutH, historicValue(remoteHistory, (r) => r.humidity_outdoor, 3), 3)
  const remotePressTrend = getTrend(remote?.pressure_relative, historicValue(remoteHistory, (r) => r.pressure_relative, 3), 1)

  const chTemp = data?.temperature_ch1
  const chHum = data?.humidity_ch1
  const hasCh1 = chTemp != null || chHum != null
  const sTemp = hasCh1 ? chTemp : remote?.temperature_indoor
  const sHum = hasCh1 ? chHum : remote?.humidity_indoor

  // Marcador de dirección del viento. Recorre la ELIPSE: antes giraba sobre un
  // CÍRCULO, así que en el N sobresalía del óvalo y en el E quedaba flotando muy
  // adentro. Ahora la punta va sobre el óvalo (posición paramétrica) y el giro
  // sigue la NORMAL al borde, para que apunte perpendicular al óvalo en
  // cualquier rumbo. El tamaño de la flecha es constante (~1.8× la anterior):
  // RX/RY sólo definen dónde se coloca y cuánto gira.
  const windMarker = (() => {
    if (dir == null) return null
    const t = (dir * Math.PI) / 180
    const x = 50 + ARX * Math.sin(t)
    const y = 40 - ARY * Math.cos(t)
    const rot = (Math.atan2(RY * Math.sin(t), RX * Math.cos(t)) * 180) / Math.PI
    return (
      <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)})`}>
        <polygon points="0,0 -4.8,12.5 0,9 4.8,12.5" fill="#22c55e" />
      </g>
    )
  })()

  const css = `
    @font-face{font-family:'DSEG7';src:url('/fonts/DSEG7Classic-Bold.woff2') format('woff2');font-display:block}
    /* DSEG14: sólo para el RUMBO del viento. Con siete segmentos no se pueden dibujar
       la N ni la O a altura completa; con catorce sí, porque añaden diagonales. Ver
       public/fonts/README.md. */
    @font-face{font-family:'DSEG14';src:url('/fonts/DSEG14Classic-Bold.woff2') format('woff2');font-display:block}
    .cns{--t:#f97316;--h:#3b82f6;--p:#a78bfa;--r:#38bdf8;--v:#22c55e;--y:#ffcf19;--w:#eaeaea;--lbl:#8a8a8a;--red:#ff4128;
      --brd-main:#fbbf24;--brd-jardin:#4ade80;--brd-remota:#6b7280;--brd-derivada:#ffffff;--brd-reloj:#ff4128;
      font-family:'Roboto Condensed','Arial Narrow','Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .cns .lbl{color:var(--lbl);font-size:18px;font-weight:700;letter-spacing:2px;line-height:1}
    .cns .lbl .ac{color:var(--t)} .cns .lbl .acg{color:var(--v)}
    .cns .big{font-weight:800;line-height:.82;letter-spacing:-1px}
    /* Números en fuente 7-segmentos (DSEG). Clases de glow por variable meteorológica */
    .cns .seg,.cns .big,.cns .gt,.cns .gh,.cns .gp,.cns .gr,.cns .gv,.cns .gy{font-family:'DSEG7','Roboto Condensed',monospace}
    /* Catorce segmentos, para TEXTO con letras. Va aparte de la clase .seg a propósito:
       esa es para cifras y arrastra DSEG7.
       (Ojo: nada de comillas invertidas en estos comentarios; todo este CSS es una
       plantilla de JavaScript delimitada por ellas y una suelta la corta en seco.) */
    .cns .seg14{font-family:'DSEG14','Roboto Condensed',monospace}
    .cns .gt{color:var(--t);text-shadow:0 0 12px rgba(249,115,22,.55)}
    .cns .gh{color:var(--h);text-shadow:0 0 12px rgba(59,130,246,.55)}
    .cns .gp{color:var(--p);text-shadow:0 0 12px rgba(167,139,250,.55)}
    .cns .gr{color:var(--r);text-shadow:0 0 12px rgba(56,189,248,.55)}
    .cns .gv{color:var(--v);text-shadow:0 0 12px rgba(34,197,94,.55)}
    .cns .gy{color:var(--y);text-shadow:0 0 12px rgba(255,207,25,.5)}
    .cns .gw{color:var(--w);text-shadow:0 0 10px rgba(234,234,234,.35)}
    .cns .u{font-weight:700;vertical-align:top;font-family:'Roboto Condensed','Arial Narrow',system-ui,sans-serif} .cns .ured{color:var(--red)}
    .cns .dec{font-size:0.6em}          /* decimales en tamaño más chico */
    /* Las cifras grandes (EXT y VEL) llevan el decimal a la MITAD del entero, no al
       0.6em del resto: a ese tamaño y sobre 76 px el decimal competía con los
       enteros. La proporción es la de una consola física, donde el decimal se lee
       como accesorio del número. Los mín/máx conservan el .dec de 0.6em. */
    .cns .decxs .dec{font-size:0.5em}
    .cns .rt{text-align:right}          /* valor pegado al borde derecho */
    .cns .cell{background:#000;position:relative;padding:9px 12px;overflow:hidden;min-width:0;min-height:0;border-radius:12px;border:2px solid transparent}
    .cns .cell.main{border-color:var(--brd-main)}
    .cns .cell.jardin{border-color:var(--brd-jardin)}
    .cns .cell.remota{border-color:var(--brd-remota)}
    /* derivada = lo que no es una lectura cruda de un sensor de la estación: la
       condición del cielo, la luna, y solar/UV/ICA (el ICA ni siquiera es nuestro,
       lo estima el backend). Rocío y sensación SALIERON de este grupo: se derivan de
       la temperatura y la humedad de la principal, así que llevan su amarillo. */
    .cns .cell.derivada{border-color:var(--brd-derivada)}
    /* El reloj lleva el contorno MÁS GRUESO de la consola (4 px contra 2): es puro
       adorno, y se lo puede permitir porque es la única celda que no muestra una
       magnitud, así que engrosarla no le quita sitio a ningún número. */
    .cns .cell.reloj{border-color:var(--brd-reloj);border-width:4px}
    .cns .col{display:flex;flex-direction:column}
    .cns .ctr{margin-top:auto;margin-bottom:auto}
    .cns .bt{display:flex;justify-content:space-between;align-items:flex-start}
  `

  const kiosk = mode === 'kiosk'

  return (
    <div
      {...(kiosk ? { 'data-kiosk-ready': ready ? 'true' : 'false' } : {})}
      className={kiosk ? 'cns' : 'cns rounded-xl overflow-hidden mx-auto'}
      style={kiosk
        ? { width: 1024, height: 600, background: '#000', overflow: 'hidden' }
        : { maxWidth: 1024, background: '#000' }}
    >
      <style>{css}</style>
      <div style={{
        display: 'grid', gap: 3,
        ...(kiosk ? { width: 1024, height: 600 } : { width: '100%', aspectRatio: '1024 / 600' }),
        gridTemplateColumns: '1fr 1fr 1fr',
        /* Filas 1 y 2 IGUALES (1.23fr cada una, mismo total que el 1.32/1.14 de
           antes): EXT y HUMEDAD muestran ahora lo mismo --valor grande arriba y una
           línea de mín/máx abajo-- y con la fila 2 más baja el mín/máx de HUMEDAD
           quedaba a 3 px del valor mientras el de EXT tenía 26. Se puede repartir a
           la mitad sin efectos: la celda del VIENTO abarca las dos filas, así que
           sólo le importa la suma.
           Filas 3, 4 y 5 IGUALES por el mismo criterio, y con la misma cuenta: los
           1.18/1.0/0.92 de antes sumaban 3.10, así que a cada una le toca 3.10/3 =
           1.0333. Repartir a partes iguales en vez de bajar a 0 la 5 y subir la 3 es
           lo que deja las filas 1 y 2 EXACTAS: mientras el total de las tres no se
           mueva de 3.10, la fracción de las dos de arriba no cambia y ni el valor de
           EXT ni su mín/máx se enteran.
           A cambio, la fila 3 pierde ~15 px (la 4 gana 3.5 y la 5 gana 12). Las tres
           celdas de la 3 centran su contenido con flex o con `ctr`, así que se
           reacomodan solas sin tocar ni un tamaño de fuente; la única que lo notó fue
           la del icono del clima, que cuelga del borde de arriba --ver el `size` del
           WeatherIcon, medido sobre la captura--. */
        gridTemplateRows: '1.23fr 1.23fr 1.0333fr 1.0333fr 1.0333fr',
        background: '#000',
      }}>
        {/* Fila 1 */}
        {/* SIN rótulo "EXT". El termómetro de abajo a la izquierda ya dice qué mide y
            la casa hueca de arriba a la derecha dónde lo mide, así que la palabra sólo
            repetía el dibujo. Lo mismo en HUMEDAD, PRES y VIENTO.
            El número NO se mueve: el rótulo era un hijo en flujo de 18 px, así que su
            marginTop pasa de -13 a +5 y la cifra se queda exactamente donde estaba,
            que es una posición medida contra el mín/máx de abajo. El hueco que deja
            queda libre por si algún día se quiere subir o agrandar la lectura. */}
        <div className="cell col main">
          {/* El marcador va ABSOLUTO: dentro del flex hacía crecer la fila del
              encabezado al alto del icono y empujaba el valor hacia abajo.
              `right: 6` y no 0: este glifo es de trazo y llega hasta el borde de su
              caja, a diferencia del sol de Meteocons que traía aire por dentro. */}
          <div style={{ position: 'absolute', top: 6, right: 6 }} title="sensor exterior">
            <HouseGlyph />
          </div>
          {/* El termómetro se CENTRA a lo alto, en la banda que va del borde de arriba
              hasta donde empieza el mín/máx (de ahí el `bottom: 30`). Pegado al borde
              superior se veía apretado, y centrarlo en la celda ENTERA no vale: a 72 px
              su bulbo bajaría hasta y≈101 y el mín/máx arranca en y≈98, con lo que se
              tocarían en x 46-84. Centrado en la banda queda en y 14-86, con aire por
              arriba y por abajo y sin rozar nada.
              Ya no puede estorbar al valor: el rótulo se fue y el número, aunque
              centrado en la celda, empieza en x≈100 mientras el icono acaba en x≈84.
              Mismo criterio en HUMEDAD y en PRES. */}
          <div style={{ position: 'absolute', top: 0, bottom: 30, left: 12, display: 'flex', alignItems: 'center' }}>
            <MeteoGlyph name="thermometer" size={72} color="#f97316" title="temperatura" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={tempTrend} />
          </div>
          {/* Batería del WS69, el mástil exterior: es de donde sale la temperatura de
              esta celda, y también el viento, la lluvia y el solar/UV. Va abajo a la
              derecha, donde el mín/máx --que va centrado-- deja hueco. */}
          {data?.battery_wh65 != null && (
            <div style={{ position: 'absolute', bottom: 7, right: 8 }}>
              <BatteryGlyph level={data.battery_wh65 ? 1 : 0.08} name="WS69" showLabel={false} />
            </div>
          )}
          {/* Centrado, no pegado a la derecha: la temperatura es el dato principal
              de la consola y con los mín/máx debajo forman un bloque.
              SIN la clase `ctr`: su margin:auto centra en el espacio libre y baja el
              valor hasta el bloque de mín/máx, que va absoluto abajo; se posiciona
              con marginTop y no con centrado automático.
              66 px es el TECHO de esta celda, medido sobre la captura y no calculado:
              la tinta del DSEG mide ~1.03× el cuerpo, y entre la etiqueta (acaba en
              y≈27) y el mín/máx (empieza en y≈98) hay 69 px. A 76 la tinta medía 78 y
              el decimal aterrizaba encima del MÁX; a 66 mide 68 y quedan ~16 px de
              aire. Para subirlo más habría que agrandar la fila, y las de abajo no
              tienen holgura que ceder.
              A -13 el dibujo de los dígitos empieza en y≈14 y se cruza con la banda
              de la etiqueta EXT, pero no con la etiqueta: ella vive en x 12-50 y el
              número arranca en x≈100. */}
          <div className="big gt decxs" style={{ fontSize: 66, textAlign: 'center', marginTop: 5 }}>
            {decNum(u.temp(data?.temperature_outdoor))}<span className="u" style={{ fontSize: 24, color: 'var(--t)' }}>{u.tempU}</span>
          </div>
          {/* Mín/máx en UNA línea, con la etiqueta al lado y no encima: en dos
              columnas con rótulo propio no cabían sin rozar el valor. Los dígitos
              a 24 px, que es el suelo práctico del 7-segmentos a distancia, y su
              decimal por `decNum` con el .dec normal de 0.6em (~14 px): sin él las
              cuatro cifras pesaban igual que el valor grande de arriba, y es el
              mismo recurso de escalonado que usa toda la consola. */}
          {/* La HORA de cada extremo, en esta misma línea: es el sitio donde caben sin
              robarle nada al valor grande. Subir la lectura no era opción --los rótulos
              que se quitaron eran laterales, así que su hueco no da alto-- y de ahí que
              el termómetro se fuera arriba para dejar libre esta franja.
              La hora va en gris (--lbl) y a 11 px, por debajo del blanco de MÍN/MÁX:
              es la coordenada del dato, no el dato. */}
          <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MÍN</span>
            <span className="gt seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {decNum(u.temp(tDay?.min ?? undefined))}
            </span>
            <span style={{ color: 'var(--w)', fontSize: 11, fontWeight: 700 }}>{hhmm(tDay?.min_time)}</span>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginLeft: 8 }}>MÁX</span>
            <span className="gt seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {decNum(u.temp(tDay?.max ?? undefined))}
            </span>
            <span style={{ color: 'var(--w)', fontSize: 11, fontWeight: 700 }}>{hhmm(tDay?.max_time)}</span>
          </div>
        </div>

        <div className="cell main" style={{ gridRow: 'span 2', padding: '7px 9px', display: 'flex', flexDirection: 'column' }}>
          {/* Donde estaba el rótulo "VIENTO" van ahora los GRADOS del rumbo, que se
              habían quedado sin sitio al mudarse la velocidad al centro del óvalo.
              Aquí recuperan el suyo sin quitárselo a nada: la palabra "VIENTO" era
              redundante --el compás, la manga que hubo antes y las etiquetas
              PROMEDIO/RÁFAGA ya dicen de qué va la celda--.
              Cuerpo 24, el de los decimales de PROMEDIO y RÁFAGA (40 × 0.6em): los
              grados son el dato de apoyo del rumbo, que ya se lee en letras arriba a
              la derecha y en la flecha del compás, así que van en el mismo peso que la
              consola usa para lo accesorio. */}
          {/* Grados y rumbo comparten UNA fila en flujo, uno a cada extremo. Antes el
              rumbo iba absoluto en `top: 4` y salía más alto que los grados y con la
              coronilla de las letras cortada por el `overflow: hidden` de la celda:
              DSEG7 dibuja por encima de su caja de línea cuando el line-height es 1, y
              ahí arriba ya no quedaba celda. En la misma fila comparten línea base por
              construcción y no hay nada que cuadrar a mano. */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                        color: 'var(--v)', fontWeight: 800, marginTop: -4, lineHeight: 1.15 }}>
            <span>
              <span className="seg" style={{ fontSize: 24 }}>{dir != null ? Math.round(dir) : '--'}</span>
              <span style={{ fontSize: 15, verticalAlign: 'super' }}>°</span>
            </span>
            {/* El rumbo va en DSEG14 --catorce segmentos-- y con sus LETRAS de verdad.
                En DSEG7 la N y la O sólo alcanzan 34 px de tinta sobre 60 y la S sale
                sin la barra de arriba, así que "OSO" se leía "oSo"; sustituirlas por
                cifras parecidas (O→0, S→5) igualaba la altura pero escribía "0S0". Con
                catorce segmentos hay diagonales y las cuatro letras salen completas: N
                58 px, E/S/O 60. Medido sobre los archivos, no supuesto.
                Sigue siendo la estética de display: los catorce segmentos son lo que
                usan los rótulos alfanuméricos de los aparatos de verdad, y las cifras de
                la consola siguen en siete. El más ancho de los 16 rumbos es NNE con 57
                px a cuerpo 24, así que cabe de sobra. */}
            <span className="seg14" style={{ fontSize: 24, letterSpacing: 1 }}>
              {cardinal(dir)}
            </span>
          </div>
          {/* El RUMBO en el sitio que ocupaba la manga de viento. La manga era
              decorativa --repetía lo que ya dice el nombre de la celda-- y este
              rincón es el único hueco grande que no pisa el óvalo, así que la letra
              cardinal se lee sin tener que interpretar la flecha del compás.
              Sigue ABSOLUTO por lo de siempre: dentro del flex hacía crecer esta
              fila y el compás de abajo (flex:1) perdía ese alto.
              `textAlign: right` + `right` fijo y no centrado: así "NNE" (3 letras) y
              "N" (1) comparten el borde derecho y la palabra no se mueve al cambiar
              el viento, el mismo anclaje que PROMEDIO/RÁFAGA. */}
          {/* Compás ovalado grande: ocupa el centro de las 2 filas fusionadas */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0, marginTop: -18 }}>
            <svg viewBox="0 0 100 80" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block', position: 'absolute', inset: 0, transform: 'scale(1.2) translateY(2%)', transformOrigin: 'center center' }}>
              {/* Óvalo exterior más visible */}
              <ellipse cx="50" cy="40" rx={RX} ry={RY} stroke="#555" strokeWidth="1.5" fill="none" />
              {/* Marcas de grados cada 30° */}
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
                const rad = (deg - 90) * Math.PI / 180
                const x1 = 50 + 44 * Math.cos(rad)
                const y1 = 40 + 34 * Math.sin(rad)
                const x2 = 50 + RX * Math.cos(rad)
                const y2 = 40 + RY * Math.sin(rad)
                const isMajor = deg % 90 === 0
                return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={isMajor ? '#888' : '#555'} strokeWidth={isMajor ? 2 : 1} />
              })}
              {/* Óvalo interior */}
              <ellipse cx="50" cy="40" rx={RX_IN} ry={RY_IN} stroke="#444" strokeWidth="1" fill="none" />
              {/* La flecha va ANTES de las letras cardinales: cuando el rumbo cae
                  justo en N/E/S/O las dos comparten el mismo punto del aro, y así
                  la letra queda encima y sigue legible. */}
              {windMarker}
              {/* Letras cardinales más grandes */}
              <text x="50" y="8" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">N</text>
              <text x="98" y="44" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">E</text>
              <text x="50" y="77" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">S</text>
              <text x="2" y="44" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">O</text>
            </svg>
            {/* 52.4% y no 50%: el transform vive en el <svg>, no en este contenedor,
                así que el centro de la elipse quedó 2.4% más abajo que el centro de la
                caja (su translateY(2%) amplificado por el scale(1.2)). Con 50% el
                número flotaba arriba del óvalo. Los 3 px extra son la corrección medida:
                la caja de línea del DSEG7 no está centrada sobre su dibujo. */}
            {/* En el centro va la VELOCIDAD, no los grados. Los grados eran el único
                dato que la flecha del compás ya daba --y mejor, porque un rumbo se
                entiende señalado y no leído como número-- mientras la velocidad, que
                no se puede dibujar, vivía en una celda aparte. Con el cambio el óvalo
                dice las dos cosas: la flecha el rumbo, el número cuánto sopla.
                La unidad va DEBAJO del número, no en línea: dentro del óvalo el ancho
                es lo escaso --el hueco útil son ~164 px-- mientras que a lo alto sobra
                sitio, así que apilarlas deja la cifra sola en su renglón y le quita el
                riesgo de tocar el aro. `decxs` para que el decimal sea la mitad del
                entero, como en EXT.
                66 px: el mismo cuerpo que la temperatura de EXT y la humedad, así las
                tres cifras grandes de la consola pesan igual y ninguna se impone.
                Comprobado que cabe, y medido en vez de tanteado: el óvalo interior mide
                221 px de ancho (buscando su trazo gris sobre la captura) y el caso más
                largo posible es "99.9", porque el viento no llega a tres cifras. A 52 px
                "6.5" medía 56 px de tinta, o sea ~1.08× el cuerpo por cada
                entero-con-decimal, de donde "99.9" a 66 pide unos 110 px: la mitad del
                óvalo. El techo real no es el ancho sino la cola de la flecha del compás,
                que en los rumbos N/S entra hasta ~63 px del centro. El tamaño del óvalo
                NO se toca. */}
            <div className="gv" style={{ position: 'absolute', top: '52.4%', left: '50%', transform: 'translate(-50%,-50%) translateY(3px)', fontWeight: 800, textAlign: 'center', whiteSpace: 'nowrap' }}>
              <div className="seg decxs" style={{ fontSize: 66, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_speed, 1))}
              </div>
              <div className="u" style={{ fontSize: 20, color: 'var(--v)', lineHeight: 1, marginTop: 3 }}>{u.windU}</div>
            </div>
          </div>
          {/* PROM + RÁFAGA en una línea, al pie de la celda del viento */}
          {/* PROMEDIO a la izquierda y RÁFAGA a la derecha: deja libre el centro, que
              es justo por donde baja el punto más bajo del óvalo, así el óvalo cabe
              sin tener que achicarlo.

              Cada bloque ANCLADO a su lado (`flex: 1` + textAlign left/right) y no
              centrado: con textAlign center la etiqueta se recentra sobre el valor,
              de modo que al pasar de "9.8" a "24.3" la etiqueta se movía sola. Con
              el anclaje, etiqueta y valor comparten borde y las cifras crecen hacia
              el centro, donde hay hueco, sin desacomodar nada. */}
          <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 2 }}>
            {/* PROMEDIO muestra `wind_speed_avg10m`, la media de 10 min, y no
                `wind_speed`, que es la lectura INSTANTÁNEA. Con el campo instantáneo
                este rótulo mentía, y además repetía clavado el número del centro del
                óvalo --el mismo dato dos veces en la misma celda--.
                El promedio lo calcula el servidor sobre las muestras guardadas: la
                estación no manda ninguno (ver `get_wind_avg10m` en el receiver). */}
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>PROMEDIO</div>
              <div className="gv seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_speed_avg10m, 1))}<span className="u" style={{ fontSize: 16, color: 'var(--v)' }}>{u.windU}</span>
              </div>
            </div>
            {/* RÁFAGA muestra el MÁXIMO DEL DÍA (`wind_gust_max_daily`), no la ráfaga
                del instante. Un día de viento se recuerda por su pico, y la ráfaga
                instantánea casi siempre marcaba lo mismo que la velocidad --o 0.0--, con
                lo que la celda gastaba una de sus tres cifras en repetir otra.
                El rótulo dice "DÍA" para no repetir el pecado de PROMEDIO, que estuvo
                mintiendo por llamar promedio a una lectura instantánea. Es la misma
                palabra que ya usa LLUVIA para su acumulado del día. */}
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>RÁFAGA DÍA</div>
              <div className="gv seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_gust_max_daily, 1))}<span className="u" style={{ fontSize: 16, color: 'var(--v)' }}>{u.windU}</span>
              </div>
            </div>
          </div>
        </div>

        {/* HUMEDAD en fila 1 columna 3. Ocupa el sitio de la celda VEL, que
            desapareció: su velocidad se mudó al centro del óvalo y su rumbo al rincón
            donde estaba la manga, así que no le quedaba nada propio que mostrar.
            La celda no cambia por dentro. Las filas 1 y 2 miden lo mismo (1.23fr),
            así que todas las medidas de esta celda --cuerpo 66, unidad 24, el mín/máx
            anclado abajo-- siguen valiendo tal cual; sólo cambia de vecinos. */}
        <div className="cell col main">
          {/* Sin rótulo "HUMEDAD": la gota lo dice. Mismo apaño que en EXT para que el
              número no se mueva --marginTop de -13 a +5-- y misma subida de la gota al
              borde de arriba, para dejarle la franja de abajo a las horas. */}
          <div style={{ position: 'absolute', top: 0, bottom: 30, left: 12, display: 'flex', alignItems: 'center' }}>
            <MeteoGlyph name="humidity" size={65} color="#3b82f6" title="humedad" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={humTrend} />
          </div>
          {/* Misma receta que EXT --centrado, mismo cuerpo, unidad a 24, mín/máx abajo
              y los mismos márgenes-- para que las dos se lean como pareja. Antes eran
              pareja en vertical (columna izquierda, filas 1 y 2); ahora lo son en
              horizontal, en los dos extremos de la fila 1, con el compás en medio. Las
              medidas coinciden igual porque ambas filas medían ya 1.23fr. */}
          <div className="big gh" style={{ fontSize: 66, textAlign: 'center', marginTop: 5 }}>
            {/* "--" y no 0: la humedad no pasa por los formateadores de unidades
                (que ya distinguen la ausencia), así que hay que hacerlo aquí. */}
            {decNum(data?.humidity_outdoor != null ? data.humidity_outdoor.toFixed(0) : '--')}<span className="u" style={{ fontSize: 24, color: 'var(--h)' }}>%</span>
          </div>
          {/* Horas igual que en EXT. Aquí sobra más sitio, porque la humedad son dos
              cifras sin decimal y no lleva pila de batería: la del sensor que la mide
              es la del WS69, que ya se ve en EXT, y repetirla sería ruido. */}
          <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MÍN</span>
            <span className="gh seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {hDay?.min != null ? hDay.min.toFixed(0) : '--'}
            </span>
            <span style={{ color: 'var(--w)', fontSize: 11, fontWeight: 700 }}>{hhmm(hDay?.min_time)}</span>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginLeft: 8 }}>MÁX</span>
            <span className="gh seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {hDay?.max != null ? hDay.max.toFixed(0) : '--'}
            </span>
            <span style={{ color: 'var(--w)', fontSize: 11, fontWeight: 700 }}>{hhmm(hDay?.max_time)}</span>
          </div>
        </div>

        {/* Fila 2 */}
        {/* PRES baja de la fila 3 a la fila 2, al sitio que dejó HUMEDAD. Por dentro
            no cambia nada. La fila 2 mide 1.23fr contra los 1.18fr de la 3, así que
            gana ~5 px de alto: el riel del barómetro va anclado al borde de abajo
            (`bottom: 4`) y la lectura al de arriba, de modo que los píxeles de sobra
            caen en el aire de en medio, que es justo donde había menos. */}
        <div className="cell col main">
          {/* Sin rótulo "PRES": el barómetro de abajo a la izquierda lo dice. De paso
              se acaba el apretón que obligó a abreviar "PRESIÓN" a "PRES" --la lectura
              llega hasta x≈82 y la palabra entera se le echaba encima--.
              El número no se mueve: marginTop de -12 a +6, los 18 px del rótulo. */}
          {/* El barómetro, como el termómetro y la gota, CENTRADO a lo alto en la banda
              libre: aquí lo que la limita por abajo es el riel (que va en `bottom: 4` y
              mide 32), de ahí el `bottom: 40`. Queda en y 22-68.
              Convive con la lectura porque están uno al lado del otro, no encima: el
              glifo acaba en x≈58 y la cifra más larga de la consola ("1025.8" con su
              unidad, alineada a la derecha) empieza en x≈56. Por eso sigue a 46 px y no
              más grande.
              `bottom: 30` y no 40: con 40 la banda acababa donde arranca el riel y el
              glifo quedaba un poco alto respecto al hueco que ocupa a la vista. Diez
              píxeles menos de exclusión lo bajan 5, que es lo que le faltaba. */}
          <div style={{ position: 'absolute', top: 0, bottom: 30, left: 12, display: 'flex', alignItems: 'center' }}>
            <MeteoGlyph name="barometer" size={46} color="#a78bfa" title="presión" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={pressTrend} />
          </div>
          {/* Lectura arriba, a la misma altura que EXT y HUMEDAD (su tinta empieza en
              y≈17), para dejar libre la franja de abajo. Sin `ctr`: se posiciona con
              marginTop, no con centrado automático, igual que las otras dos. */}
          <div className="big gp rt" style={{ marginTop: 6, fontSize: 56, paddingRight: 32 }}>
            {decNum(u.press(data?.pressure_relative, 1))}<span className="u" style={{ fontSize: 24, color: 'var(--p)' }}> {u.pressU}</span>
          </div>
          {/* Riel CENTRADO ahora que el barómetro se fue de la esquina de abajo. El
              62/52 de antes era la sangría que le dejaba a ese glifo; 57 y 57 dan
              exactamente el mismo ancho de riel (335 - 114 = 221 px, el que se eligió a
              propósito) y de paso queda simétrico bajo la lectura. */}
          <div style={{ position: 'absolute', bottom: 4, left: 57, right: 57 }}>
            <PressureScale delta={pressDelta} endLabel={pressEndLabel} />
          </div>
        </div>

        {/* LLUVIA en fila 2 columna 3 */}
        <div className="cell main">
          <div style={{ color: 'var(--r)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>LLUVIA</div>
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <MeteoGlyph name="raindrops" size={46} color="#38bdf8" title="lluvia" />
          </div>
          {/* Tres valores con etiqueta, igual que PROMEDIO/RÁFAGA en la celda del
              viento: EVENTO es lo caído en el chubasco (`rain_event`), TASA la
              intensidad de ahora en mm/h (`rain_rate`) y DÍA el acumulado del día
              (`rain_daily`). Sin etiqueta, tres cifras de lluvia son indistinguibles
              entre sí.

              EVENTO y no "AHORA", que es lo que decía antes: `rain_event` SOBREVIVE al
              cambio de día. Verificado en el histórico de producción --el 4 ago 2026 la
              consola mostraba evento 6.8 mm con tasa 0.0 y día 0.0, porque esos 6.8 mm
              cayeron la noche anterior y el contador del día se reinició a medianoche
              mientras el del evento no--. Rotularlo "AHORA" leía como que estaba
              lloviendo cuando no. Lo reinicia la estación, no el servidor: medido sobre
              14 días, casi siempre ~24 h después de que deja de llover. La tarjeta web
              (`PrecipitationCard`) ya lo llamaba "Evento". */}
          {/* HISTOGRAMA de los últimos 7 días, a la derecha de la gota y al pie de la
              celda. Las tres cifras de arriba dicen "llueve ahora", "cuánto en este
              chubasco" y "cuánto va del mes"; ninguna dice cómo se repartió, que es la
              diferencia entre 16 mm caídos de golpe ayer y 16 mm repartidos toda la
              semana. Empieza en x=66 y la gota acaba en x≈58, así que conviven igual
              que el barómetro y el riel en PRES. */}
          {rain7.length > 0 && (
            <div style={{ position: 'absolute', bottom: 4, left: 66, right: 12 }}>
              <RainHistogram data={rain7} fmt={(mm) => u.rain(mm)} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-evenly',
                        gap: 2, marginTop: -6, paddingLeft: 46 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>EVENTO</div>
              <div className="gr seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, marginTop: 7 }}>
                {decNum(u.rain(data?.rain_event))}<span className="u" style={{ fontSize: 14, color: 'var(--r)' }}>{u.rainU}</span>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>TASA</div>
              <div className="gr seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, marginTop: 7 }}>
                {decNum(u.rain(data?.rain_rate))}<span className="u" style={{ fontSize: 14, color: 'var(--r)' }}>/h</span>
              </div>
            </div>
            {/* La tercera cifra pasa del acumulado del DÍA al del MES. Las tres
                responden ahora a tres preguntas distintas: TASA dice si está lloviendo
                ahora, EVENTO cuánto ha caído en este chubasco, y MES cuánto llevamos.
                Con DÍA, en seca las tres marcaban 0.0 casi siempre y la celda no decía
                nada; el mensual está vivo todo el año. Lo calcula el receiver
                (`get_rain_accumulations`) si el aparato no lo manda. */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>MES</div>
              <div className="gr seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, marginTop: 7 }}>
                {decNum(u.rain(data?.rain_monthly))}<span className="u" style={{ fontSize: 14, color: 'var(--r)' }}>{u.rainU}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fila 3 */}
        {/* ROCÍO/SENSACIÓN sube de la columna 3 a la columna 1, al sitio que dejó PRES,
            y se queda en la MISMA fila 3, así que no cambia ni de alto ni por dentro:
            sólo se corre de lado.
            Contorno AMARILLO (clase `main`) y no blanco: los dos valores se derivan de
            la temperatura y la humedad de la estación principal, así que se agrupan con
            el resto de lo que mide ella. El blanco queda para SOLAR/UV/ICA y para la
            condición y la luna. */}
        <div className="cell main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'flex-start', width: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>ROCÍO</div>
              <div className="gt seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, marginTop: 4 }}>
                {decNum(u.temp(data?.dew_point))}<span className="u" style={{ fontSize: 16, color: 'var(--t)' }}>{u.tempU}</span>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>SENSACIÓN</div>
              <div className="gt seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, marginTop: 4 }}>
                {decNum(u.temp(data?.feels_like))}<span className="u" style={{ fontSize: 16, color: 'var(--t)' }}>{u.tempU}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Condición (2/3) y luna (1/3) como DOS celdas con contorno blanco. La
            condición sola dejaba media celda vacía, y la luna estaba apretada
            entre SOLAR y UV, cuyo sitio ocupa ahora el ICA. */}
        {/* La condición cede ancho (de 2fr a 1.3fr) para que en la celda de al lado
            entren, al lado de la luna, el amanecer y el atardecer. Puede permitírselo:
            su icono trae mucho aire por dentro --el dibujo ocupa ~50 px de una caja de
            108, medido-- así que estrechar la celda no lo achica. El rótulo baja a 13 px
            por lo mismo, para que una condición larga ("NOCHE PARCIALMENTE NUBLADA") no
            se parta en dos renglones en el ancho nuevo. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 3, minWidth: 0, minHeight: 0 }}>
          <div className="cell derivada" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 }}>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1.05, textAlign: 'center' }}>{cond.label || 'CLIMA'}</div>
            <div style={{ marginTop: -10 }}><WeatherIcon name={cond.icon} size={108} className="weather-main-icon" /></div>
          </div>
          {/* SOL Y LUNA. Sin rótulo, por lo mismo que EXT o PRES: el disco lunar y las
              flechas de salida y puesta se explican solos, y la palabra "LUNA" ya se
              habría quedado corta al entrar el sol. Ese renglón que se ahorra es justo
              el que necesitan las dos horas.
              Padding lateral de 6 y no los 12 de `.cell`: en 146 px de celda, la luna y
              las dos horas piden ~122 y con 12 por lado no caben. */}
          <div className="cell derivada" style={{ padding: '6px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <MoonGlyph size={50} />
            <SunTimes sunrise={astro?.sunrise} sunset={astro?.sunset} />
          </div>
        </div>

        {/* CELDA NUEVA: REMOTA WN32 (exterior del sitio remoto), en fila 3 columna 3,
            el hueco que dejó ROCÍO/SENSACIÓN al bajar a la columna 1.
            Contorno GRIS (clase `remota`, --brd-remota) igual que las otras dos celdas
            de la estación remota: el color del borde es lo que agrupa de un vistazo
            qué lecturas vienen de allá y cuáles de aquí.
            Queda habilitada aunque el WN32 todavía no esté instalado: mientras no
            reporte muestra "--", que dice la verdad --ese sensor está callado-- en vez
            de rellenar el hueco con el interior, que es lo que hacía la celda de abajo
            antes de fijarla. Copia la maquetación de esa celda (cuerpo 46, unidad 20)
            para que las dos se lean como pareja pese a estar en filas distintas. */}
        <div className="cell col remota">
          <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA <span style={{ color: 'var(--p)' }}>WN32</span></div>
          {/* Casa HUECA = a la intemperie. Es la única celda de la estación remota que
              mide afuera, y el hueco frente al relleno de la de abajo es lo que lo dice.
              Absoluto por lo mismo que en EXT: si no, baja los valores. */}
          <div style={{ position: 'absolute', top: 6, right: 8 }} title="sensor exterior">
            <HouseGlyph />
          </div>
          {/* Pila del WN32, abajo a la derecha como en EXT y JARDÍN. Aquí es la única que
              puede llevar NIVEL y no sólo OK/baja --de ahí el relleno proporcional de
              `BatteryGlyph`-- aunque con el receiver de hoy llegará como bandera: ver la
              nota de `battLevel`. Sólo se dibuja cuando el sensor reporta; mientras no
              esté instalado, una pila pintada sería un dato inventado. */}
          {remoteOutBatt != null && (
            <div style={{ position: 'absolute', bottom: 7, right: 10 }}>
              <BatteryGlyph level={remoteOutBatt} name="WN32" />
            </div>
          )}
          {/* Tendencias en temperatura y humedad, colgadas a la derecha de cada valor,
              igual que las de EXT y HUMEDAD. Se dibujan siempre, también sin lectura:
              mientras el WN32 no esté instalado se verá la barra gris de "sin cambios"
              al lado de un "--". */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 40, marginTop: -6 }}>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutT != null ? decNum(u.temp(remoteOutT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              <TrendGlyph trend={remoteOutTempTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
            </span>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutH != null ? remoteOutH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
              <TrendGlyph trend={remoteOutHumTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
            </span>
          </div>
        </div>

        {/* Fila 4 */}
        <div className="cell col main">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#fbbf24', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>INTERIOR</span>
            {/* Casa RELLENA = bajo techo. Este es el tamaño (30) que ahora usan las
                cuatro celdas con glifo de ubicación. */}
            <HouseGlyph filled />
          </div>
          {/* marginTop: la fila se salia 1 px por abajo y los dígitos rozaban el borde */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: -10 }}>
            <span className="gt" style={{ fontSize: 46, fontWeight: 800 }}>
              {decNum(u.temp(data?.temperature_indoor))}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
            </span>
            <span className="gh" style={{ fontSize: 46, fontWeight: 800 }}>
              {data?.humidity_indoor != null ? data.humidity_indoor.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
            </span>
          </div>
        </div>

        {/* SOLAR / UV / ICA pasan de ser tres bloques flotando en una celda a TRES
            celdas con contorno blanco propio, como ya hacían la condición y la luna.
            Los anchos NO son iguales, sino 4fr / 2fr / 3fr, en proporción a las cifras
            que cada una puede llegar a mostrar: SOLAR cuatro (hasta 1234 W/m²), UV dos
            y el ICA tres (167; con suerte nunca 200). Repartir a tercios le daba a UV,
            que casi siempre muestra un solo dígito, el mismo sitio que a SOLAR, y con
            `space-evenly` los tres números se movían de lado cada vez que uno cambiaba
            de número de cifras.
            Los tres cuelgan del borde de ARRIBA (`flex-start`) y no van centrados: así
            los rótulos quedan a la misma altura entre sí y los números también, y el
            renglón de la unidad de SOLAR cuelga por debajo sin descolocar a nadie.
            ANCHOS Y CUERPO, medidos sobre el propio archivo de la fuente y no estimados
            desde una captura --que es lo que se hizo primero y salió corto--: DSEG7 Bold
            avanza 33 px por cifra a cuerpo 40, así que los casos peores piden "1234" =
            132, "12" = 66 y "167" = 99. Sumando márgenes, bordes, sangrías y los dos
            huecos, eso son 363 px y la celda mide 339: A CUERPO 40 NO CABEN LOS TRES.
            Con el número a 38 el avance baja a 31.4 y los casos peores quedan en 125 /
            63 / 94, que con los anchos 4.25 / 2.4 / 3.35 dejan ~7 px de holgura a cada
            una. La diferencia entre 38 y 40 no se ve; un número desbordado sí.
            Sangría lateral de 3 y no los 12 de `.cell`, por lo mismo. Y los tres llevan
            `nowrap` de cinturón: si alguna cifra volviera a quedar al límite, preferimos
            que asome --se nota y se arregla-- a que parta el renglón, que fue el defecto
            que tenía UV y que no se lee de ninguna manera. */}
        <div style={{ display: 'grid', gridTemplateColumns: '4.25fr 2.4fr 3.35fr', gap: 3, minWidth: 0, minHeight: 0 }}>
          <div className="cell derivada" style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: '#f59e0b', fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>SOLAR</div>
            <div className="gw seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, marginTop: 3, whiteSpace: 'nowrap', color: data?.solar_radiation != null ? solarColor(data.solar_radiation) : undefined }}>
              {data?.solar_radiation != null ? decNum(data.solar_radiation.toFixed(0)) : '--'}
            </div>
            {/* La unidad DEBAJO, como el km/h del óvalo: en línea se comía el ancho que
                necesitan las cuatro cifras del caso peor. */}
            <div className="u" style={{ fontSize: 14, color: 'var(--w)', lineHeight: 1, marginTop: 2 }}>W/m²</div>
            {/* Barra al pie con `marginTop: auto`, que se come el aire sobrante y la pega
                abajo sin fijarla en absoluto. Escala a 1000 W/m²: el pico despejado a
                esta latitud y altitud ronda esa cifra, así que un mediodía limpio llena
                la barra y el ojo aprende el tope en un día. */}
            <div style={{ marginTop: 'auto', width: '100%', paddingTop: 4 }}>
              <LevelBar value={data?.solar_radiation} max={1000}
                color={data?.solar_radiation != null ? solarColor(data.solar_radiation) : '#5a5a5a'} />
            </div>
          </div>
          <div className="cell derivada" style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>UV</div>
            <div className="gw seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, marginTop: 3, whiteSpace: 'nowrap', color: data?.uv_index != null ? uvColor(data.uv_index) : undefined }}>
              {data?.uv_index ?? '--'}
            </div>
            {/* Escala a 12: es donde acaba la escala UV de la OMS (11+ ya es "extremo",
                el tramo fucsia de `uvColor`), así que la barra llena coincide con el
                color más alto y las dos señales dicen lo mismo. */}
            <div style={{ marginTop: 'auto', width: '100%', paddingTop: 4 }}>
              <LevelBar value={data?.uv_index} max={12}
                color={data?.uv_index != null ? uvColor(data.uv_index) : '#5a5a5a'} />
            </div>
          </div>
          {/* ICA en el sitio que dejó la luna. El color lo decide el backend
              según la categoría de la norma, así que el número se lee de un
              vistazo sin tener que recordar los cortes. */}
          <div className="cell derivada" style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>ICA</div>
            <div className="gw seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, marginTop: 3, whiteSpace: 'nowrap', color: imeca?.color || undefined }}>
              {imeca?.available && imeca.imeca != null ? imeca.imeca : '--'}
            </div>
            {/* Escala a 200 IMECA: es el tope que la norma mexicana considera "muy mala"
                y el techo que esperamos no ver nunca, el mismo con el que se
                dimensionaron las tres cifras de esta celda. */}
            <div style={{ marginTop: 'auto', width: '100%', paddingTop: 4 }}>
              <LevelBar value={imeca?.available ? imeca.imeca : null} max={200}
                color={imeca?.color || '#5a5a5a'} />
            </div>
          </div>
        </div>

        {/* REMOTA GW1100: se queda donde estaba y ahora es FIJA al sensor integrado
            del gateway, que es interior. Antes esta misma celda se disfrazaba --si el
            WN32 reportaba mostraba el exterior y cambiaba su propio rótulo-- porque era
            la única celda para los dos sensores remotos. Con la celda WN32 de la fila 3
            ya no hace falta: cada sensor tiene la suya y el rótulo no se mueve. */}
        <div className="cell col remota">
          <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA <span style={{ color: 'var(--p)' }}>GW1100</span></div>
          {/* Casa RELLENA = bajo techo, al mismo tamaño que la hueca de la celda de
              arriba: puestas una encima de la otra, el relleno es lo único que cambia y
              se lee de un vistazo cuál de los dos sensores remotos es cada una.
              Absoluto por lo mismo que en EXT: si no, baja los valores. */}
          <div style={{ position: 'absolute', top: 6, right: 8 }} title="sensor interior">
            <HouseGlyph filled />
          </div>
          {/* SIN flechitas de tendencia: una lectura de interior no las necesita --lo
              de adentro se mueve poco y despacio, y la subida o bajada no dice nada
              del tiempo--. Es el mismo criterio que ya seguían las celdas INTERIOR y
              JARDÍN, que tampoco las llevan; quedan para lo que se mide a la
              intemperie (EXT, HUMEDAD, PRES y la WN32 de arriba).
              Al no haber flecha, el `paddingRight: 16` que le hacía sitio se va con
              ella y los dos valores quedan centrados de verdad en la celda.
              mismo ajuste que INTERIOR: se salia 1 px por abajo */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 40, marginTop: -6 }}>
            <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
              {remoteInT != null ? decNum(u.temp(remoteInT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
            </span>
            <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
              {remoteInH != null ? remoteInH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
            </span>
          </div>
        </div>

        {/* Fila 5 */}
        <div className="cell col jardin">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>JARDÍN</span>
            <span style={{ color: 'var(--lbl)', fontSize: 12, fontWeight: 600 }}>CH1</span>
          </div>
          {/* Batería del WN31 de este canal. Aquí SÍ lleva el nombre al lado: la franja
              de abajo está libre --los dos valores van centrados con `ctr`-- así que
              cabe sin apretar nada. */}
          {data?.battery_ch1 != null && (
            <div style={{ position: 'absolute', bottom: 7, right: 10 }}>
              <BatteryGlyph level={data.battery_ch1 ? 1 : 0.08} name="WN31" />
            </div>
          )}
          {/* marginTop -10 = misma altura que INTERIOR */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: -10 }}>
            <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
              {sTemp != null ? decNum(u.temp(sTemp)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
            </span>
            <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
              {sHum != null ? sHum.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
            </span>
          </div>
        </div>

        <div className="cell reloj" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {/* El título va aquí, en el hueco que dejan "HORA" y "FECHA": esas dos
              etiquetas sobraban --un reloj y una fecha se reconocen solos-- y esta
              es la única celda que no muestra una magnitud, así que el nombre de la
              estación no compite con ningún dato. */}
          {/* Este renglón es el nombre de la estación… hasta que deja de llegar dato.
              Entonces se convierte en el AVISO, en rojo y diciendo cuánto lleva callada.
              Aprovecha el sitio del nombre en vez de pedir uno nuevo, que en esta celda
              no hay; y es el lugar correcto porque la avería no es de una magnitud
              concreta sino de todas a la vez, y porque el reloj de al lado es
              precisamente lo que hace que la pantalla parezca fresca cuando no lo está.
              El nombre no se pierde: sigue en el título de la página del kiosco. */}
          {stale ? (
            /* El triángulo va en SVG y no como emoji ⚠: el Chromium del renderer corre
               en un contenedor sin fuente de emoji en color, y ahí el carácter saldría
               como un cuadro vacío. Todos los demás iconos de la consola ya son SVG por
               la misma razón. */
            <div style={{ color: 'var(--red)', fontSize: 16, fontWeight: 800, letterSpacing: 1, lineHeight: 1, marginTop: -2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width="15" height="14" viewBox="0 0 16 15" style={{ flexShrink: 0 }}>
                <path d="M8 0.5 L15.5 14 L0.5 14 Z" fill="none" stroke="var(--red)" strokeWidth="1.6" strokeLinejoin="round" />
                <rect x="7.1" y="5" width="1.8" height="5" rx="0.9" fill="var(--red)" />
                <rect x="7.1" y="11" width="1.8" height="1.8" rx="0.9" fill="var(--red)" />
              </svg>
              SIN DATOS · {staleMin} MIN
            </div>
          ) : (
            <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: 1.5, textAlign: 'center', marginTop: -2 }}>
              Estación Clima XE1E
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 26, marginTop: 4 }}>
            <div className="gw seg" style={{ fontSize: 46, fontWeight: 800 }}>{pad(now.getHours())}:{pad(now.getMinutes())}</div>
            <div style={{ textAlign: 'center', lineHeight: 1.02 }}>
              <div className="gw" style={{ fontSize: 26, fontWeight: 800 }}>{DIAS_CORTO[now.getDay()].toUpperCase()}</div>
              <div className="gw" style={{ fontSize: 26, fontWeight: 800 }}>{now.getDate()} {MESES_CORTO[now.getMonth()]}</div>
            </div>
          </div>
        </div>

        <div className="cell col remota">
          <div style={{ color: 'var(--p)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>PRESIÓN <span style={{ color: 'var(--p)' }}>GW1100</span></div>
          {/* El mismo barómetro redondo que la celda PRES, en el mismo sitio y tamaño:
              las dos muestran presión y ahora se reconocen como pareja sin leer el
              rótulo. Aquí sobra el hueco que allá ocupa el riel de tendencia. */}
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <MeteoGlyph name="barometer" size={46} color="#a78bfa" title="presión" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={remotePressTrend} />
          </div>
          <div className="big gp ctr rt" style={{ marginTop: 8, fontSize: 46, paddingRight: 32 }}>
            {remote?.pressure_relative != null ? decNum(u.press(remote.pressure_relative, 1)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--p)' }}> {u.pressU}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
