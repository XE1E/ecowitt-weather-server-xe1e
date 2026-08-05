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
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const cardinal = (deg?: number) => (deg == null ? '--' : DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16])

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

// Par de marcadores de DÓNDE se mide, no de qué tiempo hace: la casa dice que la
// lectura viene de adentro y la casa con la flecha que viene de afuera. El de
// exterior era antes un sol amarillo relleno de Meteocons, y un sol conviviendo
// con la celda de condición ("NOCHE NUBLADA") se puede leer como estado del cielo
// en vez de como ubicación del sensor. Los dos comparten trazo, grosor y color
// para que se reconozcan como pareja de un vistazo.
const LOC_STROKE = '#94a3b8'

function IndoorGlyph({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={LOC_STROKE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10" />
    </svg>
  )
}

// Más ancho que alto (30×24 contra los 24×24 de la casa sola): la casa se dibuja
// algo más chica y corrida a la izquierda para hacerle sitio a la flecha, en vez
// de encoger el conjunto hasta que ninguna de las dos partes se distinga.
function OutdoorGlyph({ height = 30 }: { height?: number }) {
  return (
    <svg width={(height * 30) / 24} height={height} viewBox="0 0 30 24" fill="none"
      stroke={LOC_STROKE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 13 L8 6 L15 13" />
      <path d="M2.5 11v9a1 1 0 001 1h9a1 1 0 001-1v-9" />
      <path d="M17.5 13 H26" />
      <path d="M22.5 9.5 L26 13 L22.5 16.5" />
    </svg>
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
      {delta != null && <polygon points={`${x - 5},0 ${x + 5},0 ${x},7`} fill={color} />}
      <text x={x0} y={PS_H - 1} fill="#eaeaea" fontSize="12" fontWeight="700" textAnchor="start">-{endLabel}</text>
      <text x={mid} y={PS_H - 1} fill="#eaeaea" fontSize="12" fontWeight="700" textAnchor="middle">0</text>
      <text x={x1} y={PS_H - 1} fill="#eaeaea" fontSize="12" fontWeight="700" textAnchor="end">+{endLabel}</text>
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

  // Tendencias estación remota (mismos umbrales que las locales: ±0.5 °C, ±3 %,
  // ±1 hPa; temp/humedad contra hace 1 h y presión contra hace 3 h)
  const remoteInTempTrend = getTrend(remoteInT, historicValue(remoteHistory, (r) => r.temperature_indoor, 1), 0.5)
  const remoteInHumTrend = getTrend(remoteInH, historicValue(remoteHistory, (r) => r.humidity_indoor, 3), 3)
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
    .cns{--t:#f97316;--h:#3b82f6;--p:#a78bfa;--r:#38bdf8;--v:#22c55e;--y:#ffcf19;--w:#eaeaea;--lbl:#8a8a8a;--red:#ff4128;
      --brd-main:#fbbf24;--brd-jardin:#4ade80;--brd-remota:#6b7280;--brd-derivada:#ffffff;--brd-reloj:#ff4128;
      font-family:'Roboto Condensed','Arial Narrow','Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .cns .lbl{color:var(--lbl);font-size:18px;font-weight:700;letter-spacing:2px;line-height:1}
    .cns .lbl .ac{color:var(--t)} .cns .lbl .acg{color:var(--v)}
    .cns .big{font-weight:800;line-height:.82;letter-spacing:-1px}
    /* Números en fuente 7-segmentos (DSEG). Clases de glow por variable meteorológica */
    .cns .seg,.cns .big,.cns .gt,.cns .gh,.cns .gp,.cns .gr,.cns .gv,.cns .gy{font-family:'DSEG7','Roboto Condensed',monospace}
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
    /* derivada = valores calculados o secundarios (condición, rocío/sensación,
       solar+UV+luna), a diferencia de las lecturas crudas de cada sensor */
    .cns .cell.derivada{border-color:var(--brd-derivada)}
    .cns .cell.reloj{border-color:var(--brd-reloj)}
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
           sólo le importa la suma, y las filas 3-5 no se tocan. */
        gridTemplateRows: '1.23fr 1.23fr 1.18fr 1.0fr 0.92fr',
        background: '#000',
      }}>
        {/* Fila 1 */}
        <div className="cell col main">
          <div style={{ color: '#f97316', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>EXT</div>
          {/* El marcador va ABSOLUTO: dentro del flex hacía crecer la fila del
              encabezado al alto del icono y empujaba el valor hacia abajo.
              `right: 6` y no 0: este glifo es de trazo y llega hasta el borde de su
              caja, a diferencia del sol de Meteocons que traía aire por dentro. */}
          <div style={{ position: 'absolute', top: 6, right: 6 }} title="sensor exterior">
            <OutdoorGlyph height={30} />
          </div>
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <MeteoGlyph name="thermometer" size={72} color="#f97316" title="temperatura" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={tempTrend} />
          </div>
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
          <div className="big gt decxs" style={{ fontSize: 66, textAlign: 'center', marginTop: -13 }}>
            {decNum(u.temp(data?.temperature_outdoor))}<span className="u" style={{ fontSize: 24, color: 'var(--t)' }}>{u.tempU}</span>
          </div>
          {/* Mín/máx en UNA línea, con la etiqueta al lado y no encima: en dos
              columnas con rótulo propio no cabían sin rozar el valor. Los dígitos
              a 24 px, que es el suelo práctico del 7-segmentos a distancia, y su
              decimal por `decNum` con el .dec normal de 0.6em (~14 px): sin él las
              cuatro cifras pesaban igual que el valor grande de arriba, y es el
              mismo recurso de escalonado que usa toda la consola. */}
          <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', gap: 7, justifyContent: 'center', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MÍN</span>
            <span className="gt seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {decNum(u.temp(tDay?.min ?? undefined))}
            </span>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginLeft: 10 }}>MÁX</span>
            <span className="gt seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {decNum(u.temp(tDay?.max ?? undefined))}
            </span>
          </div>
        </div>

        <div className="cell main" style={{ gridRow: 'span 2', padding: '7px 9px', display: 'flex', flexDirection: 'column' }}>
          {/* El título se fue a la celda del reloj: aquí parecía parte del viento. */}
          <div style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1, marginTop: -4 }}>VIENTO</div>
          {/* El RUMBO en el sitio que ocupaba la manga de viento. La manga era
              decorativa --repetía lo que ya dice el nombre de la celda-- y este
              rincón es el único hueco grande que no pisa el óvalo, así que la letra
              cardinal se lee sin tener que interpretar la flecha del compás.
              Sigue ABSOLUTO por lo de siempre: dentro del flex hacía crecer esta
              fila y el compás de abajo (flex:1) perdía ese alto.
              `textAlign: right` + `right` fijo y no centrado: así "NNE" (3 letras) y
              "N" (1) comparten el borde derecho y la palabra no se mueve al cambiar
              el viento, el mismo anclaje que PROMEDIO/RÁFAGA. */}
          {/* SIN la clase `gv`: además del glow verde arrastra la fuente DSEG7, que es
              de 7 segmentos y sólo sabe dibujar cifras --"NO" salía como "no"--. El
              color va inline y la letra se queda en la Roboto Condensed de la consola,
              igual que lo hacía la celda VEL con este mismo rumbo. */}
          <div style={{ position: 'absolute', top: 4, right: 10, textAlign: 'right' }}>
            <span style={{ color: 'var(--v)', fontSize: 34, fontWeight: 800, letterSpacing: 1, lineHeight: 1 }}>
              {cardinal(dir)}
            </span>
          </div>
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
                entero, como en EXT. */}
            <div className="gv" style={{ position: 'absolute', top: '52.4%', left: '50%', transform: 'translate(-50%,-50%) translateY(3px)', fontWeight: 800, textAlign: 'center', whiteSpace: 'nowrap' }}>
              <div className="seg decxs" style={{ fontSize: 46, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_speed, 1))}
              </div>
              <div className="u" style={{ fontSize: 17, color: 'var(--v)', lineHeight: 1, marginTop: 3 }}>{u.windU}</div>
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
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>PROMEDIO</div>
              <div className="gv seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_speed, 1))}<span className="u" style={{ fontSize: 16, color: 'var(--v)' }}>{u.windU}</span>
              </div>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>RÁFAGA</div>
              <div className="gv seg" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_gust, 1))}<span className="u" style={{ fontSize: 16, color: 'var(--v)' }}>{u.windU}</span>
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
          <div style={{ color: 'var(--h)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>HUMEDAD</div>
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
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
          <div className="big gh" style={{ fontSize: 66, textAlign: 'center', marginTop: -13 }}>
            {/* "--" y no 0: la humedad no pasa por los formateadores de unidades
                (que ya distinguen la ausencia), así que hay que hacerlo aquí. */}
            {decNum(data?.humidity_outdoor != null ? data.humidity_outdoor.toFixed(0) : '--')}<span className="u" style={{ fontSize: 24, color: 'var(--h)' }}>%</span>
          </div>
          <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', gap: 7, justifyContent: 'center', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MÍN</span>
            <span className="gh seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {hDay?.min != null ? hDay.min.toFixed(0) : '--'}
            </span>
            <span style={{ color: 'var(--w)', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginLeft: 10 }}>MÁX</span>
            <span className="gh seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {hDay?.max != null ? hDay.max.toFixed(0) : '--'}
            </span>
          </div>
        </div>

        {/* Fila 2 */}
        {/* PRES baja de la fila 3 a la fila 2, al sitio que dejó HUMEDAD. Por dentro
            no cambia nada. La fila 2 mide 1.23fr contra los 1.18fr de la 3, así que
            gana ~5 px de alto: el riel del barómetro va anclado al borde de abajo
            (`bottom: 4`) y la lectura al de arriba, de modo que los píxeles de sobra
            caen en el aire de en medio, que es justo donde había menos. */}
        <div className="cell col main">
          {/* PRES y no PRESIÓN: al subir la lectura a la altura de EXT/HUMEDAD, el
              número llega hasta x≈82 y la palabra entera se le echaba encima. */}
          <div style={{ color: 'var(--p)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>PRES</div>
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            {/* 46 y no 58: presión es la cifra más larga de la consola (1027.4) y a 58
                el barómetro le quedaba encima. Se queda abajo a la izquierda pese al
                riel: el riel arranca en x=62 y el glifo acaba en x≈58, así que
                conviven como la gota y las tres cifras de LLUVIA. */}
            <MeteoGlyph name="barometer" size={46} color="#a78bfa" title="presión" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={pressTrend} />
          </div>
          {/* Lectura arriba, a la misma altura que EXT y HUMEDAD (su tinta empieza en
              y≈17), para dejar libre la franja de abajo. Sin `ctr`: se posiciona con
              marginTop, no con centrado automático, igual que las otras dos. */}
          <div className="big gp rt" style={{ marginTop: -12, fontSize: 56, paddingRight: 32 }}>
            {decNum(u.press(data?.pressure_relative, 1))}<span className="u" style={{ fontSize: 24, color: 'var(--p)' }}> {u.pressU}</span>
          </div>
          <div style={{ position: 'absolute', bottom: 4, left: 62, right: 52 }}>
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
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>DÍA</div>
              <div className="gr seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, marginTop: 7 }}>
                {decNum(u.rain(data?.rain_daily))}<span className="u" style={{ fontSize: 14, color: 'var(--r)' }}>{u.rainU}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fila 3 */}
        {/* ROCÍO/SENSACIÓN sube de la columna 3 a la columna 1, al sitio que dejó PRES,
            y se queda en la MISMA fila 3, así que no cambia ni de alto ni por dentro:
            sólo se corre de lado. */}
        <div className="cell derivada" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 3, minWidth: 0, minHeight: 0 }}>
          <div className="cell" style={{ borderColor: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 }}>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1 }}>{cond.label || 'CLIMA'}</div>
            <div style={{ marginTop: -10 }}><WeatherIcon name={cond.icon} size={108} className="weather-main-icon" /></div>
          </div>
          <div className="cell" style={{ borderColor: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 }}>
            <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>LUNA</div>
            {/* La luna se centra en el hueco que deja la etiqueta, no debajo de ella:
                colgada del `flex-start` quedaba pegada al rótulo con todo el aire
                junto abajo. El `flex:1` toma el alto sobrante y el `center` la
                reparte, así el disco queda a media celda. */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', minHeight: 0 }}>
              <MoonGlyph size={62} />
            </div>
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
            antes de fijarla. Copia la maquetación de esa celda (cuerpo 46, unidad 20,
            tendencia colgada a la derecha de cada valor) para que las dos se lean como
            pareja pese a estar en filas distintas. */}
        <div className="cell col remota">
          <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA <span style={{ color: 'var(--p)' }}>WN32</span></div>
          {/* Absoluto por lo mismo que en EXT: si no, baja los valores. */}
          <div style={{ position: 'absolute', top: 6, right: 8 }} title="sensor exterior">
            <OutdoorGlyph height={26} />
          </div>
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 40, marginTop: -6 }}>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutT != null ? decNum(u.temp(remoteOutT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              {/* La flechita SÓLO si hay lectura: sin sensor, `getTrend` devuelve
                  'stable' --su caso por defecto-- y se dibujaría la barra gris de
                  "sin cambios" junto a un "--", que es afirmar que algo se mantiene
                  estable cuando en realidad no se está midiendo. */}
              {remoteOutT != null && (
                <TrendGlyph trend={remoteOutTempTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
              )}
            </span>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutH != null ? remoteOutH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
              {remoteOutH != null && (
                <TrendGlyph trend={remoteOutHumTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
              )}
            </span>
          </div>
        </div>

        {/* Fila 4 */}
        <div className="cell col main">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#fbbf24', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>INTERIOR</span>
            {/* Misma casa de siempre, ahora desde el componente: es la mitad del par
                con OutdoorGlyph y tenerla suelta aquí dejaba el color y el grosor
                del trazo en dos sitios que había que acordarse de mover juntos. */}
            <IndoorGlyph size={30} />
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

        <div className="cell derivada" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'flex-start', width: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#f59e0b', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>SOLAR</div>
              <div className="gw seg" style={{ fontSize: 40, fontWeight: 800, marginTop: 2, color: data?.solar_radiation != null ? solarColor(data.solar_radiation) : undefined }}>
                {data?.solar_radiation != null ? decNum(data.solar_radiation.toFixed(0)) : '--'}<span className="u" style={{ fontSize: 14, color: 'var(--w)' }}> W/m²</span>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>UV</div>
              <div className="gw seg" style={{ fontSize: 40, fontWeight: 800, marginTop: 2, color: data?.uv_index != null ? uvColor(data.uv_index) : undefined }}>
                {data?.uv_index ?? '--'}
              </div>
            </div>
            {/* ICA en el sitio que dejó la luna. El color lo decide el backend
                según la categoría de la norma, así que el número se lee de un
                vistazo sin tener que recordar los cortes. */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>ICA</div>
              <div className="gw seg" style={{ fontSize: 40, fontWeight: 800, marginTop: 2, color: imeca?.color || undefined }}>
                {imeca?.available && imeca.imeca != null ? imeca.imeca : '--'}
              </div>
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
          {/* La casa SIN flecha: este glifo dice DÓNDE se mide, no qué tiempo hace (ver
              el par IndoorGlyph/OutdoorGlyph), y ahora que la celda es fija al sensor
              integrado la lectura es de interior. Con la casa con flecha decía
              "exterior" mientras mostraba un dato de adentro.
              Absoluto por lo mismo que en EXT: si no, baja los valores. */}
          <div style={{ position: 'absolute', top: 6, right: 8 }} title="sensor interior">
            <IndoorGlyph size={26} />
          </div>
          {/* mismo ajuste que INTERIOR: se salia 1 px por abajo */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 40, marginTop: -6 }}>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteInT != null ? decNum(u.temp(remoteInT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              {remoteInT != null && (
                <TrendGlyph trend={remoteInTempTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
              )}
            </span>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteInH != null ? remoteInH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
              {remoteInH != null && (
                <TrendGlyph trend={remoteInHumTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
              )}
            </span>
          </div>
        </div>

        {/* Fila 5 */}
        <div className="cell col jardin">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>JARDÍN</span>
            <span style={{ color: 'var(--lbl)', fontSize: 12, fontWeight: 600 }}>CH1</span>
          </div>
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
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: 1.5, textAlign: 'center', marginTop: -2 }}>
            Estación Clima XE1E
          </div>
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
