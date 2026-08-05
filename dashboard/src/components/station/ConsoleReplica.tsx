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
// igual de bien pero taparía el número de grados del centro en los rumbos E/O
// (el número de 3 dígitos llega casi al óvalo interior), y ese es el dato que
// no se puede perder; aquí sólo roza la letra cardinal en N/E/S/O exactos.
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
  const pressTrend = getTrend(data?.pressure_relative, historicValue(history, (r) => r.pressure_relative, 3), 1)       // ±1 hPa

  // Celda REMOTA: la estación remota tiene DOS sensores. Con el WN32 conectado
  // interesa el exterior del sitio remoto, que es el dato meteorológico; si aún
  // no está, se muestra el integrado del GW1100, que es interior. La etiqueta
  // dice cuál de los dos se está viendo: sin aclararlo son indistinguibles, y
  // hasta ahora esta celda mostraba el interior rotulado solo "REMOTA GW1100".
  const remoteIsOutdoor = remote?.temperature_outdoor != null
  const remoteT = remoteIsOutdoor ? remote?.temperature_outdoor : remote?.temperature_indoor
  const remoteH = remoteIsOutdoor ? remote?.humidity_outdoor : remote?.humidity_indoor
  const remoteTag = remoteIsOutdoor ? 'WN32' : 'GW1100'
  const remoteField = remoteIsOutdoor ? 'temperature_outdoor' : 'temperature_indoor'
  const remoteHumField = remoteIsOutdoor ? 'humidity_outdoor' : 'humidity_indoor'

  // Tendencias estación remota
  const remoteTempTrend = getTrend(remoteT, historicValue(remoteHistory, (r) => r[remoteField], 1), 0.5)
  const remoteHumTrend = getTrend(remoteH, historicValue(remoteHistory, (r) => r[remoteHumField], 3), 3)
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
    /* EXT lleva el decimal aún más chico que el resto: es la cifra más grande de
       la consola y a 0.6em el ".5" pesaba tanto como un entero. Va como variante
       propia y no tocando .dec, que lo comparten todas las demás celdas. */
    .cns .decxs .dec{font-size:0.42em}
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
        gridTemplateRows: '1.32fr 1.14fr 1.18fr 1.0fr 0.92fr',
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
              76 px y marginTop NEGATIVO van juntos: agrandar la cifra sola la hace
              crecer hacia abajo y se come el aire que la separa de mín/máx, así que
              sube lo mismo que engordó. Con el decimal a 0.42em (`decxs`) el bloque
              mide ~157 px de ancho aun a 76, y su borde izquierdo cae en x≈89, libre
              del termómetro (acaba en x≈84). */}
          <div className="big gt decxs" style={{ fontSize: 76, textAlign: 'center', marginTop: -8 }}>
            {decNum(u.temp(data?.temperature_outdoor))}<span className="u" style={{ fontSize: 24, color: 'var(--t)' }}>{u.tempU}</span>
          </div>
          {/* Mín/máx en UNA línea, con la etiqueta al lado y no encima: en dos
              columnas con rótulo propio no cabían sin rozar el valor. Los dígitos
              a 24 px, que es el suelo práctico del 7-segmentos a distancia. */}
          <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', gap: 7, justifyContent: 'center', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--lbl)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MÍN</span>
            <span className="gt seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {u.temp(tDay?.min ?? undefined)}
            </span>
            <span style={{ color: 'var(--lbl)', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginLeft: 10 }}>MÁX</span>
            <span className="gt seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {u.temp(tDay?.max ?? undefined)}
            </span>
          </div>
        </div>

        <div className="cell main" style={{ gridRow: 'span 2', padding: '7px 9px', display: 'flex', flexDirection: 'column' }}>
          {/* El título se fue a la celda del reloj: aquí parecía parte del viento. */}
          <div style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1, marginTop: -4 }}>VIENTO</div>
          {/* La manga va ABSOLUTA: dentro del flex hacía crecer esta fila al alto del
              icono, y como el compás de abajo es flex:1, le robaba ese alto y el
              óvalo salía más chico. Mismo caso que el sol de EXT y REMOTA. */}
          {/* Sube a la altura de la etiqueta: al quitar el título de esta celda,
              VIENTO subió y la manga se quedó descolgada. */}
          <div style={{ position: 'absolute', top: 6, right: 10 }}>
            <MeteoGlyph name="windsock" size={52} color="#22c55e" title="viento" />
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
            <div className="gv" style={{ position: 'absolute', top: '52.4%', left: '50%', transform: 'translate(-50%,-50%) translateY(3px)', fontWeight: 800 }}>
              <span className="seg" style={{ fontSize: 52 }}>{dir != null ? Math.round(dir) : '--'}</span><span style={{ fontSize: 28, verticalAlign: 'super' }}>°</span>
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

        <div className="cell col main">
          <div style={{ color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>VEL</div>
          {/* Este se queda CENTRADO: la bajada al pie era para los glifos grandes de
              Meteocons, y aqui abajo a la izquierda ya vive el rumbo. */}
          <div style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)' }}>
            <svg width="30" height="22" viewBox="0 0 34 24" fill="none">
              <path d="M2 8 H20 a4 4 0 1 0 -4 -4" stroke="#22c55e" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M2 15 H25 a4.5 4.5 0 1 1 -4.5 4.5" stroke="#22c55e" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ position: 'absolute', bottom: 8, left: 12 }}>
            <span style={{ color: 'var(--v)', fontSize: 24, fontWeight: 800 }}>{cardinal(dir)}</span>
          </div>
          <div className="big gv ctr rt" style={{ fontSize: 104, marginTop: -10 }}>
            {decNum(u.wind(data?.wind_speed, 1))}<span className="u" style={{ fontSize: 26, color: 'var(--v)' }}> {u.windU}</span>
          </div>
        </div>

        {/* Fila 2 */}
        <div className="cell col main">
          <div style={{ color: 'var(--h)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>HUMEDAD</div>
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <MeteoGlyph name="humidity" size={65} color="#3b82f6" title="humedad" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={humTrend} />
          </div>
          <div className="big gh ctr rt" style={{ fontSize: 80, lineHeight: 0.8, paddingRight: 32, marginTop: -10 }}>
            {/* "--" y no 0: la humedad no pasa por los formateadores de unidades
                (que ya distinguen la ausencia), así que hay que hacerlo aquí. */}
            {decNum(data?.humidity_outdoor != null ? data.humidity_outdoor.toFixed(0) : '--')}<span className="u" style={{ fontSize: 34, color: 'var(--h)' }}>%</span>
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
        <div className="cell col main">
          <div style={{ color: 'var(--p)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>PRESIÓN</div>
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            {/* 46 y no 58: presión es la cifra más larga de la consola (1027.4) y a 58
                el barómetro le quedaba encima. */}
            <MeteoGlyph name="barometer" size={46} color="#a78bfa" title="presión" />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={pressTrend} />
          </div>
          <div className="big gp ctr rt" style={{ marginTop: 16, fontSize: 56, paddingRight: 32 }}>
            {decNum(u.press(data?.pressure_relative, 1))}<span className="u" style={{ fontSize: 24, color: 'var(--p)' }}> {u.pressU}</span>
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
          <div className="cell" style={{ borderColor: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6, gap: 2 }}>
            <div style={{ color: 'var(--w)', fontSize: 15, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>LUNA</div>
            <MoonGlyph size={62} />
          </div>
        </div>

        {/* ROCÍO/SENSACIÓN en fila 3 columna 3 */}
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

        <div className="cell col remota">
          <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA <span style={{ color: 'var(--p)' }}>{remoteTag}</span></div>
          {/* Absoluto por lo mismo que en EXT: si no, baja los valores. */}
          <div style={{ position: 'absolute', top: 6, right: 8 }} title="sensor exterior">
            <OutdoorGlyph height={26} />
          </div>
          {/* mismo ajuste que INTERIOR: se salia 1 px por abajo */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 40, marginTop: -6 }}>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteT != null ? decNum(u.temp(remoteT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              <TrendGlyph trend={remoteTempTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
            </span>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteH != null ? remoteH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
              <TrendGlyph trend={remoteHumTrend} width={14} height={18} style={{ position: 'absolute', top: 12, right: -2 }} />
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
