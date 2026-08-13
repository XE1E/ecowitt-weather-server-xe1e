import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useStationData } from '../../station-data'
import { useUnits } from '../../units'
import { beaufort, deriveCondition, historicValue, humidexLabel, moonIllumination, uvLabel } from '../../weather'
import { WeatherIcon } from '../WeatherIcon'
import { MeteoGlyph } from '../MeteoGlyph'
// Tipo compartido de la fila del histórico remoto: declara tanto el sensor
// integrado del GW1100 (*_indoor) como el WN32 exterior (*_outdoor). Antes había
// aquí una copia local que solo tenía los _indoor.
import type { RemoteHistRow } from '../../remote'
// Amanecer/atardecer: no se calculan en local como la fase lunar, vienen del
// pronóstico (Open-Meteo a través de nuestro backend, que además lo cachea).
import { fetchForecast, type AstroData, type ForecastHour } from '../../forecast'
import { LOCATION } from '../../config'
// El CSS vive aparte desde que las páginas de detalle del kiosco --a las que se
// llega tocando una celda de aquí-- comparten su estética.
import { CONSOLE_CSS } from './console-css'
// Qué celda lleva a qué pantalla. Sólo las claves: los rectángulos se miden del DOM.
import { CONSOLA_NAV } from '../../kiosk-nav'
import { useNavZones, NavDebugOverlay } from '../../pages/kiosk/nav-zones'

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
// Cortes del índice UV de la OMS. Los tonos son los SATURADOS (500 de la escala) y no
// los pastel de la primera versión (400): sobre el negro de la consola los pastel se
// apagan, y este color tiene que verse desde el otro lado de la habitación.
//
// La tabla de abajo usa los mismos cortes, así que el número y su riel no pueden
// contradecirse: si el dígito está naranja, la banda naranja es la que está encendida.
function uvColor(uv: number): string {
  if (uv >= 11) return '#d946ef'
  if (uv >= 8) return '#ef4444'
  if (uv >= 6) return '#f97316'
  if (uv >= 3) return '#eab308'
  return '#22c55e'
}

// Cortes de la radiación solar. NO son una escala oficial --no existe una para los W/m²--
// sino el código de la casa, y por eso vive en un solo sitio: la tabla `SOLAR_BANDS` de
// más abajo se construye de aquí, así que el dígito y su riel usan los mismos cortes y
// los mismos tonos y no pueden contradecirse.
//
// El primer tramo es gris y no un color del degradado: por debajo de 50 W/m² no hay sol
// del que hablar, y un gris lo dice mejor que un amarillo apagado.
const SOLAR_STEPS: { from: number; color: string }[] = [
  { from: 0, color: '#94a3b8' },
  { from: 50, color: '#eab308' },
  { from: 250, color: '#f59e0b' },
  { from: 550, color: '#f97316' },
  { from: 800, color: '#ef4444' },
]
function solarColor(w: number): string {
  let c = SOLAR_STEPS[0].color
  for (const s of SOLAR_STEPS) if (w >= s.from) c = s.color
  return c
}

// Categoría del IMECA tal como la manda el backend, lista para el renglón de la celda.
//
// Sólo hay una que no cabe: la celda tiene ~100 px de interior y "EXTREMADAMENTE MALA"
// mide ~130 a cuerpo 14, así que se abrevia. Las otras cuatro entran tal cual --la más
// larga es "MUY MALA", ~55 px--. Se abrevia por NOMBRE y no por longitud para que el
// recorte sea una decisión explícita y no una sorpresa el día que la norma cambie de
// palabras; si llega una desconocida y larga, el `nowrap` de la celda la deja asomar,
// que se ve y se corrige, en vez de partirla en dos renglones.
const IMECA_CORTO: Record<string, string> = { 'Extremadamente mala': 'Extrema' }
const imecaLabel = (cat: string) => (IMECA_CORTO[cat] ?? cat).toUpperCase()

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

// Mapa de manchas, en coordenadas normalizadas (-1..1 sobre el radio) y con su radio
// en la misma escala. Pretenden evocar los mares lunares: Mare Imbrium arriba a la
// izquierda, Oceanus Procellarum a la izquierda, Mare Serenitatis y Tranquillitatis
// al centro-derecha, etc. A 74 px no cabe el detalle real, pero la distribución y
// densidad dan la impresión correcta. Vive fuera del componente porque ahora la
// dibujan DOS capas, la de la cara iluminada y la de la sombra, y las dos tienen que
// usar la misma lista o el relieve no coincidiría a los lados del terminador.
const MARES = [
  // Manchas principales (mares grandes)
  [-0.32, -0.30, 0.24],   // Mare Imbrium (arriba izq)
  [0.08, -0.42, 0.16],    // Mare Serenitatis (arriba centro)
  [0.30, -0.12, 0.20],    // Mare Crisium (derecha)
  [-0.18, 0.22, 0.17],    // Mare Nubium (abajo izq)
  [0.04, 0.04, 0.13],     // Mare Vaporum (centro)
  [-0.38, 0.00, 0.14],    // Oceanus Procellarum parte (izquierda)
  // Manchas secundarias (mares menores y cráteres)
  [0.22, -0.38, 0.10],    // Lacus Somniorum
  [-0.10, -0.52, 0.09],   // Mare Frigoris borde
  [0.38, 0.18, 0.11],     // Mare Fecunditatis
  [-0.44, -0.22, 0.10],   // borde oeste
  [0.14, 0.32, 0.12],     // Mare Nectaris
  [-0.26, 0.44, 0.09],    // borde sur
  [0.32, 0.38, 0.08],     // cráter sur-este
  [-0.50, 0.24, 0.07],    // borde oeste bajo
] as const

// Dibuja la luna con la iluminación real (terminador elíptico correcto).
function MoonGlyph({ size = 42, illum, waxing }:
  { size?: number; illum?: number; waxing?: boolean }) {
  const R = size / 2
  // Un solo identificador para los seis recursos del dibujo (cuatro degradados, dos
  // recortes y el desenfoque): `useId` de React trae dos puntos, que en `url(#...)` no
  // valen.
  const uid = useId().replace(/:/g, '')
  // Iluminación y sentido: si el servidor los manda se usan ESOS, que salen de pyephem para
  // las coordenadas y la elevación del sitio. El cálculo del navegador
  // (`moonIllumination`) queda de respaldo para cuando el almanaque no responde: es un mes
  // sinódico constante desde una luna nueva de referencia, o sea una aproximación.
  const local = moonIllumination(new Date())
  const ilum = illum ?? local.illum
  const crece = waxing ?? local.waxing
  // El radio horizontal del terminador se deduce de la ILUMINACIÓN, sin necesitar la fase:
  //   illum = (1 - cos(2π·fase))/2 · 100   =>   |cos(2π·fase)| = |1 - 2·illum/100|
  // Que es exactamente lo que calculaba antes desde `phase`, así que el dibujo no cambia;
  // sólo la procedencia del número.
  const rx = Math.max(0.4, R * Math.abs(1 - 2 * (ilum / 100)))
  const gibbous = ilum > 50
  const s1 = crece ? 1 : 0
  const s2 = gibbous ? s1 : 1 - s1
  const litPath = `M0,${-R} A ${R} ${R} 0 0 ${s1} 0 ${R} A ${rx} ${R} 0 0 ${s2} 0 ${-R} Z`
  // Con iluminación 0 los dos arcos degeneran --se recorren dos veces por el mismo lado-- y
  // el resultado es media luna encendida en plena luna NUEVA. Antes no podía pasar porque el
  // cálculo local devuelve un float que nunca da 0 exacto; el almanaque, en cambio,
  // REDONDEA a entero, así que 0 es alcanzable. Sin luz no se dibuja luz.
  const oscura = ilum < 1
  // Las manchas, a la opacidad que se le pida. La misma función para las dos caras: lo
  // ÚNICO que cambia entre ellas es cuánto se marcan.
  const mares = (op: number) => MARES.map(([cx, cy, r], i) => (
    <circle key={i} cx={cx * R} cy={cy * R} r={r * R} fill={`rgba(0,0,0,${op})`} />
  ))
  return (
    // flexShrink 0: sin él, en una fila que se pasa de ancho flex encoge el disco en vez
    // de respetar `size`, y pasa calladamente --se pidieron 76 px y se dibujaron 63,
    // medido--. Mejor que el ajuste se note en el vecino y se corrija a mano.
    <svg width={size} height={size} viewBox={`${-R} ${-R} ${size} ${size}`} style={{ flexShrink: 0 }}>
      <defs>
        {/* SOMBRA y LUZ como degradados y no como dos colores planos: con el plano, el
            disco se veía como dos recortes de cartulina pegados, y lo que se quiere es
            una ESFERA. Los tonos de antes (#3c3a33 y #e6d18f) siguen siendo el punto
            medio de cada uno, así que la luna no cambia de color, sólo gana relieve.
            `userSpaceOnUse`: el centro del degradado se fija en el disco y no en la caja
            de la figura que lo usa. Con las unidades por defecto, el de la luz se
            comprimía dentro de la uña de un creciente y la sombreaba al revés --el brillo
            caía en el filo del terminador en vez de en el limbo--. Medido en la maqueta,
            no supuesto.
            El foco va arriba y a la izquierda del centro, no en el centro: una esfera
            iluminada desde un lado nunca tiene su punto más claro en medio, y ese
            descentrado es lo que hace que se lea como bola. */}
        <radialGradient id={`sombra-${uid}`} gradientUnits="userSpaceOnUse"
          cx={-0.15 * R} cy={-0.2 * R} r={1.15 * R}>
          <stop offset="0" stopColor="#474439" />
          <stop offset="0.7" stopColor="#3a382f" />
          <stop offset="1" stopColor="#2c2b25" />
        </radialGradient>
        {/* El amarillo de la luna es más pálido que el del sol (--y, #ffcf19), a propósito
            y no por descuido: son dos astros distintos en la misma celda y la luna no
            brilla, refleja. El sol se queda vivo. */}
        <radialGradient id={`luz-${uid}`} gradientUnits="userSpaceOnUse"
          cx={-0.1 * R} cy={-0.25 * R} r={1.25 * R}>
          <stop offset="0" stopColor="#f4e6b6" />
          <stop offset="0.6" stopColor="#e6d18f" />
          <stop offset="1" stopColor="#bda468" />
        </radialGradient>
        {/* Caída de luz junto al TERMINADOR: ahí el sol pega de refilón y la superficie se
            apaga, que es el rasgo que hace que un cuarto parezca una bola y no un
            semicírculo pintado.
            Va en las unidades POR DEFECTO (la caja de la figura que lo usa) y se pinta
            sobre una copia del propio trozo iluminado, así que el degradado sigue al
            terminador en cualquier fase sin tener que calcular dónde cae. Sobre un
            rectángulo del tamaño del SVG --como se probó primero-- se medía sobre el disco
            entero, y en cuarto y en creciente la caída se quedaba en la mitad en sombra:
            no hacía nada.
            Acaba en 0.32 y no a mitad de camino: al terminador le toca el apagón, pero el
            resto de la cara tiene que quedarse limpio o el conjunto se ve nublado. */}
        <linearGradient id={`term-${uid}`} x1={crece ? 0 : 1} y1="0" x2={crece ? 1 : 0} y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="0.32" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        {/* Oscurecimiento del LIMBO, sobre las dos caras a la vez: el borde del disco es
            superficie vista de canto y siempre sale más apagada. Es lo que redondea la
            silueta; sin él, con los otros dos degradados puestos, el canto seguía siendo
            un recorte limpio. Sólo el último 14% del radio, para no meter viñeta. */}
        <radialGradient id={`limbo-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0.86" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </radialGradient>
        <clipPath id={`disco-${uid}`}><circle r={R} /></clipPath>
        <clipPath id={`luzclip-${uid}`}><path d={oscura ? '' : litPath} /></clipPath>
        {/* Manchas DESENFOCADAS: a canto vivo eran seis burbujas de compás. Con ~1.3 px de
            difuminado a tamaño de consola se funden entre ellas y leen como terreno.
            El desenfoque va antes del recorte --SVG aplica el filtro y LUEGO el
            clip-path-- así que no se sale del disco ni cruza el terminador. */}
        <filter id={`difu-${uid}`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation={0.035 * R} />
        </filter>
      </defs>
      {/* La parte en sombra, en gris cálido y no en el casi negro de antes (#1b1b1b): sobre
          el negro de la celda ese tono no se distinguía del fondo, así que no se veía el
          DISCO completo y la fase se leía como una mancha suelta en vez de como una esfera
          parcialmente iluminada. Con el disco visible, el terminador se nota. */}
      <circle r={R} fill={`url(#sombra-${uid})`} />
      {/* Manchas de la CARA EN SOMBRA. Antes iban recortadas a la parte iluminada y la
          sombra quedaba lisa; ahora las llevan las dos, que es lo que se ve en el cielo
          --el disco entero está manchado, no sólo lo que le da el sol--.
          Se marcan MÁS que las de la luz (0.35 contra 0.28) por dos razones: el gris de la
          sombra tiene menos recorrido hasta el negro que el amarillo de la luz, y el panel
          del kiosco aplasta los tonos oscuros (ver la nota del fondo de las celdas en
          `console-css.ts`), así que una diferencia fina ahí no llega a verse. Van sobre el
          disco COMPLETO, no sobre la sombra recortada: la cara iluminada las tapa después
          con su propio relleno, y así no hay que construir un segundo recorte. */}
      <g clipPath={`url(#disco-${uid})`} filter={`url(#difu-${uid})`}>{mares(0.35)}</g>
      {!oscura && <path d={litPath} fill={`url(#luz-${uid})`} />}
      {/* Manchas de la CARA ILUMINADA, recortadas a ella. Al usar la misma lista que la
          capa de la sombra, cada mancha continúa al otro lado del terminador: es la misma
          luna, con una parte alumbrada y otra no. */}
      {!oscura && (
        <g clipPath={`url(#luzclip-${uid})`} filter={`url(#difu-${uid})`}>{mares(0.28)}</g>
      )}
      {!oscura && <path d={litPath} fill={`url(#term-${uid})`} />}
      <circle r={R} fill={`url(#limbo-${uid})`} />
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

// Señal RF del enlace con un sensor: cuatro barras crecientes, encendidas hasta el
// nivel que manda el aparato. Es el PRIMER indicador de señal de todo el frontend --el
// parser mapeaba `*sig` desde hace tiempo y nadie lo pintaba-- y va aquí, junto a la
// casita, porque las dos cosas hablan del sensor y no de la magnitud.
//
// La escala es la de Ecowitt: 0-4, donde 0 es "el sensor está dado de alta pero no llega
// nada". El color sigue el criterio del resto de la consola --que el tono diga lo mismo
// que la forma-- con los cortes de `LevelBar`: 4-3 verde, 2 ámbar, 1-0 rojo. Las barras
// apagadas se quedan en un gris que se ve en el panel del kiosco (#52525b): con el
// #3f3f46 de la primera versión, en una pantalla que aplasta los oscuros, un nivel 1 y
// un nivel 4 se parecían demasiado.
//
// QUIÉN LA MANDA: los gateways (GW1100/GW3000), uno por sensor emparejado. La consola
// WS2910 NO manda señal de nada --verificado contra /api/current: no trae un solo campo
// `signal_*`, sólo `battery_wh65` y `battery_ch1`-- así que en la celda EXT este glifo
// queda listo pero no se dibuja hasta que el dato exista. Es el mismo criterio que la
// pila: nada pintado sin lectura detrás.
function SignalGlyph({ level, name, height = 13 }: { level: number; name: string; height?: number }) {
  const n = Math.max(0, Math.min(4, Math.round(level)))
  const color = n >= 3 ? '#22c55e' : n === 2 ? '#eab308' : '#ef4444'
  const w = 3           // ancho de barra
  const g = 2           // hueco entre barras
  const total = 4 * w + 3 * g
  return (
    <svg width={total} height={height} viewBox={`0 0 ${total} ${height}`}>
      {/* Como elemento `<title>` y no como atributo: en `<svg>` React no acepta `title`
          como prop. Sólo se ve en el tab de la web; en el kiosco es una imagen. */}
      <title>{`señal ${name}: ${n}/4`}</title>
      {[0, 1, 2, 3].map((i) => {
        // Cada barra un 25% más alta que la anterior, la última a tope: la altura dice
        // el nivel incluso a quien no distinga los colores.
        const h = height * (0.34 + 0.22 * i)
        return (
          <rect key={i} x={i * (w + g)} y={height - h} width={w} height={h} rx={1}
            fill={i < n ? color : '#52525b'} />
        )
      })}
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

/** Alerta viva tal como la sirve `/api/alerts`: su clave y el mensaje ya redactado. */
interface AlertaViva { key: string; message: string }

/**
 * Qué celda de la consola le toca a una alerta.
 *
 * La clave viene del motor (`alerts.py`) y trae la estación como PREFIJO cuando no es
 * la principal: `gw1100:humidity_high`. Ese prefijo es lo que decide si la alerta pinta
 * en las celdas de aquí o en las tres de la remota, que es justo la confusión que habría
 * si sólo se mirara la categoría.
 *
 * Rocío y sensación tienen celda propia --la de derivadas-- aunque el motor los mete en
 * la familia "temp": ahí es donde se leen sus cifras, así que ahí es donde hay que mirar.
 *
 * Batería, sensor perdido y estación caída devuelven null a propósito: la pila ya se
 * pone roja sola, y la caída de la estación tiene su propio aviso en el reloj. Duplicarlo
 * teñiría media consola por algo que ya se ve.
 */
type CeldaAlerta =
  | 'ext' | 'hum' | 'pres' | 'viento' | 'lluvia' | 'rocio' | 'sensacion' | 'solar' | 'uv'
  | 'interior' | 'remotaExtT' | 'remotaExtH' | 'remotaInt' | 'remotaP'

function celdaDeAlerta(key: string): CeldaAlerta | null {
  const i = key.indexOf(':')
  const esRemota = i >= 0
  const r = esRemota ? key.slice(i + 1) : key
  if (esRemota) {
    if (r.startsWith('pressure_')) return 'remotaP'
    if (r.startsWith('humidity_indoor')) return 'remotaInt'
    // Lo que evalúa campos `*_outdoor` es del WN32. Su celda tiene DOS lecturas y cada una
    // lleva su propio triángulo, así que aquí se separan: la humedad a la derecha y la
    // familia de la temperatura --con rocío y sensación, que salen de ella-- a la izquierda.
    if (r.startsWith('humidity_')) return 'remotaExtH'
    if (r.startsWith('temp_') || r.startsWith('dew_') || r.startsWith('feels_')) return 'remotaExtT'
    return null
  }
  if (r.startsWith('dew_')) return 'rocio'
  if (r.startsWith('feels_')) return 'sensacion'
  if (r.startsWith('temp_')) return 'ext'
  if (r.startsWith('humidity_indoor')) return 'interior'
  if (r.startsWith('humidity_')) return 'hum'
  if (r.startsWith('pressure_')) return 'pres'
  if (r === 'wind_high' || r === 'gust_high') return 'viento'
  if (r.startsWith('rain_')) return 'lluvia'
  if (r === 'uv_high') return 'uv'
  if (r === 'solar_high') return 'solar'
  return null
}

/**
 * El mensaje del motor empieza por un EMOJI ("🌡️ Temperatura alta: 27 °C").
 *
 * En el kiosco eso sale como un cuadro vacío: el Chromium del renderer corre en un
 * contenedor sin fuente de emoji en color, y es la misma razón por la que todos los
 * iconos de la consola son SVG (ver el triángulo del aviso "SIN DATOS").
 *
 * Se quitan los emoji y se conservan las FLECHAS ↓ ↑, que están en las fuentes normales
 * y son parte del mensaje de las reglas de tendencia: "↓ Temperatura cayendo 3.2°C/60min".
 */
const sinEmoji = (s: string) =>
  s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')  // pictogramas
    .replace(/\uFE0F/g, '')                                  // selector de variación
    .replace(/\s+/g, ' ')
    .trim()

/**
 * El mensaje, recortado para el renglón del reloj.
 *
 * Se le quita el UMBRAL entre paréntesis --"Presión alta: 1024.4 hPa (≥ 1008 hPa)"--. No es
 * capricho de espacio: con él, un mensaje de la estación remota (que además lleva delante su
 * rótulo entre corchetes) se partía en DOS renglones y su tinta acababa pegada al borde de
 * arriba, a 0 px, medido en la captura. Y el umbral es justo la parte que no hace falta a la
 * distancia a la que se mira esta pantalla: lo que se necesita saber es "la presión está
 * alta y va por 1024.4". El umbral sigue entero en el correo y en la web, que es donde se
 * consulta y se ajusta.
 */
const textoAlerta = (msg: string) => sinEmoji(msg).replace(/\s*\([^)]*\)\s*/g, ' ').trim()

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
  // 40 px de RANURA. El relleno tiene su propio techo, 6 px más bajo: sin él el día del
  // pico llegaba al borde de arriba y quedaba a 3 px de las cifras de la celda --medido--,
  // que es lo que hacía ver el gráfico apretado. Con techo, la ranura tiene una tapa
  // visible y ninguna barra parece escaparse hacia los números.
  const BAR_H = 40
  const FILL_MAX = 34
  // La ranura de cada día, tenue: sin ella un día de 0.2 mm era un hilo de 3 px sobre el
  // negro, indistinguible de cero y de "sin dato". Contra su hueco sí se compara.
  const RANURA = '#ffffff12'
  const cols = (render: (d: DailyRain, i: number) => React.ReactNode) => (
    <div style={{ display: 'flex', gap: 2, width: '100%', alignItems: 'flex-end' }}>
      {data.map((d, i) => (
        <div key={d.date} style={{ flex: 1, minWidth: 0 }}>{render(d, i)}</div>
      ))}
    </div>
  )
  return (
    <div style={{ width: '100%' }}>
      {/* Línea de base continua bajo las ranuras, para que el cero tenga sitio. Va en el
          contenedor de la fila y no en cada columna: con los huecos de 2 px, un borde por
          columna se vería discontinuo. */}
      <div style={{ borderBottom: '1px solid #6b6b6b' }}>
        {cols((d) => {
          const v = d.rain
          // Tres casos que NO son lo mismo y se ven distintos: sin resumen guardado
          // (gris), cero lluvia (una uña del color de la lluvia, para que el día exista)
          // y con lluvia (proporcional, con 3 px de mínimo para que nunca desaparezca).
          const alto = v == null ? 3 : v <= 0 ? 2 : Math.max(3, (v / scale) * FILL_MAX)
          const color = v == null ? '#3a3a3a' : 'var(--r)'
          // Saturado y sin atenuar cuando hay lluvia: el 0.75 de antes apagaba seis de
          // los siete días. Cuál es hoy lo dice su letra en blanco, no un medio tono.
          const opacidad = v == null ? 1 : v <= 0 ? 0.45 : 1
          // Se rotula CADA día con lluvia, que es lo que permite comparar sin estimar
          // alturas. Dentro de la barra si es bastante alta para contenerlo; si no,
          // ENCIMA, que ahora cabe: el relleno tiene techo, así que sobre una barra baja
          // queda toda la ranura libre. Antes sólo se rotulaba el pico porque el rótulo
          // sólo podía ir dentro. Si no cabe de ninguna forma, el dato sigue en el `title`.
          const dentro = v != null && v > 0 && alto >= 17
          const encima = v != null && v > 0 && !dentro && BAR_H - alto >= 13
          return (
            <div style={{ height: BAR_H, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                          background: RANURA, borderRadius: '2px 2px 0 0' }}
              title={`${d.date}: ${v == null ? 'sin dato' : fmt(v)}`}>
              {encima && (
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--r)', lineHeight: 1,
                              textAlign: 'center', marginBottom: 2 }}>
                  {fmt(v as number)}
                </div>
              )}
              <div style={{ width: '100%', height: alto, borderRadius: 2, background: color, opacity: opacidad,
                            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'hidden' }}>
                {dentro && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#06283d', lineHeight: 1, marginTop: 3 }}>
                    {fmt(v as number)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* Hoy DESTACADO y el resto más apagado: sin eso hay que contar las barras para saber
          cuál es cuál. Fila aparte, con el mismo hueco, para que cada letra caiga bajo su
          ranura.
          Los días pasados suben del `--lbl` (#8a8a8a) a #bdbdbd: a 11 px sobre negro ese gris
          de rótulo se apagaba, y en el panel del kiosco --que aplasta los tonos bajos-- casi
          desaparecía; son la referencia para leer las barras, no una etiqueta que se pueda
          ignorar. Y HOY va en blanco y en 800, así que se distingue por color Y por peso, no
          sólo por un tono. */}
      <div style={{ marginTop: 3 }}>
        {cols((d, i) => (
          <div style={{ fontSize: 11, lineHeight: 1, textAlign: 'center',
                        fontWeight: i === data.length - 1 ? 800 : 700,
                        color: i === data.length - 1 ? 'var(--w)' : '#bdbdbd' }}>
            {dowLetter(d.date)}
          </div>
        ))}
      </div>
    </div>
  )
}

type Band = { to: number; color: string }

// Bandas de las escalas que SÍ tienen cortes oficiales.
//
// UV: los cinco tramos de la OMS, mismos cortes que `uvColor`.
// IMECA: los cinco de la NADF-009-AIRE-2017. Los colores son los que devuelve el backend
// en `imeca.color` (ver `receiver/app/services/imeca.py`); aquí hace falta la tabla
// COMPLETA y no sólo el color del valor de ahora, porque el riel dibuja toda la escala.
const UV_BANDS: Band[] = [
  { to: 3, color: '#22c55e' },
  { to: 6, color: '#eab308' },
  { to: 8, color: '#f97316' },
  { to: 11, color: '#ef4444' },
  { to: 12, color: '#d946ef' },
]
// HUMIDEX: los tramos de Environment Canada, los mismos que nombra `humidexLabel`, así que
// la palabra, el color del número y la banda encendida no pueden contradecirse.
//
// La escala llega a 60 aunque el índice no exista por debajo de 20: el riel arranca en 0 como
// todos los demás y eso deja el primer tramo largo, pero un riel que empezara en 20 mentiría
// sobre lo que significa "vacío". A cambio, en esta ubicación --2250 m-- el valor vive casi
// siempre en el primer tramo, y eso ya es información: aquí el bochorno es la excepción.
const HUMIDEX_BANDS: Band[] = [
  { to: 30, color: '#22c55e' },
  { to: 40, color: '#eab308' },
  { to: 46, color: '#f97316' },
  { to: 54, color: '#ef4444' },
]
function humidexColor(h: number): string {
  if (h >= 54) return '#d946ef'
  if (h >= 46) return '#ef4444'
  if (h >= 40) return '#f97316'
  if (h >= 30) return '#eab308'
  return '#22c55e'
}

const IMECA_BANDS: Band[] = [
  { to: 50, color: '#22c55e' },
  { to: 100, color: '#eab308' },
  { to: 150, color: '#f97316' },
  { to: 200, color: '#ef4444' },
]
// SOLAR: las bandas salen de `SOLAR_STEPS`, la misma tabla que colorea el dígito. El
// último tramo se cierra en el tope de la escala (1000 W/m², el pico despejado a esta
// latitud y altitud).
const SOLAR_BANDS: Band[] = SOLAR_STEPS.map((s, i) => ({
  to: SOLAR_STEPS[i + 1]?.from ?? 1000,
  color: s.color,
}))

// Riel de nivel: dónde cae un valor dentro de su escala, CON LOS CORTES A LA VISTA.
//
// La primera versión rellenaba una fracción de un color plano. La longitud decía cuánto,
// pero el color no decía nada: de día la barra se veía llena y del mismo color a UV 3 que
// a UV 11, y para saber qué significaba el valor seguía habiendo que recordar los cortes
// --justo lo que esta función decía querer evitar y no conseguía--.
//
// Ahora el riel pinta las bandas de la escala atenuadas (ahí están los cortes, sin gastar
// una leyenda) y las enciende a color pleno hasta donde llega el valor. Los huecos de 2 px
// entre bandas son lo que hace visible cada corte.
//
// La atenuación va en el ALFA del color de fondo y no en `opacity` del contenedor: con
// `opacity` el relleno encendido, que es hijo, se atenuaría también.
//
// Con divs y no en SVG: un SVG estirado con preserveAspectRatio="none" deformaría las
// esquinas redondeadas, y aquí el ancho lo pone la celda.
function LevelBar({ value, max, bands, hint = true }:
  { value?: number | null; max: number; bands: Band[]; hint?: boolean }) {
  const v = value == null ? null : Math.max(0, Math.min(max, value))
  let from = 0
  return (
    <div style={{ width: '100%', height: 9, borderRadius: 4, background: '#141414',
                  border: '1px solid #eaeaea', overflow: 'hidden', display: 'flex', gap: 2 }}>
      {bands.map((b, i) => {
        const to = Math.min(b.to, max)
        const span = Math.max(0, to - from)
        // Cuánto de ESTA banda cubre el valor, de 0 a 1. Calcularlo por banda evita
        // recortar una capa superpuesta, que en divs pide saber el ancho en píxeles.
        const cover = v == null || span === 0 ? 0 : Math.max(0, Math.min(1, (v - from) / span))
        from = to
        return (
          // Alfa 26 (15%) y no 40 (25%): a 25 el amarillo y el naranja apagados tiraban a
          // oliva y el riel se veía sucio. A 15 leen como un fantasma de la escala y el
          // tramo encendido resalta. Los cortes se siguen viendo por los huecos de 2 px,
          // que dejan ver el oscuro del riel.
          <div key={i} style={{ flex: span, minWidth: 0, background: hint ? `${b.color}26` : 'transparent' }}>
            <div style={{ width: `${cover * 100}%`, height: '100%', background: b.color }} />
          </div>
        )
      })}
    </div>
  )
}

// Salida y puesta del sol, para la celda de la luna. Las flechas dicen cuál es
// cuál sin gastar una palabra: sube = amanece, baja = atardece.
function SunTimes({ sunrise, sunset }: { sunrise?: string; sunset?: string }) {
  // Glifo ENCIMA de su hora, no al lado. El cambio no es estético: en esta celda la luna
  // estaba limitada por el ANCHO mientras sobraban ~40 px de ALTO --medido: interior de
  // 138x91 con un disco de 50--. Apilando, el bloque de las horas pasa de 85 px de ancho
  // (glifo 24 + hueco 4 + cifras 57) a los 57 de las cifras, y esos 28 px liberados se los
  // queda el disco lunar, que crece la mitad. El alto que cuesta ya estaba desocupado.
  //
  // Cada glifo va sobre SU hora y no los dos por fuera (uno arriba y otro abajo de las dos
  // cifras): así la pareja es inequívoca sin tener que suponer que el de arriba es el de
  // arriba.
  const row = (up: boolean, iso?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      {/* Sol sobre el horizonte, no un triángulo suelto: el triángulo decía la dirección
          pero no de QUÉ, así que había que deducir del contexto que hablaba del sol.
          Va como SVG y no como glifo de fuente a propósito: los únicos caracteres que
          existen para esto son emoji (🌅/🌇), y en el Chromium del servidor eso es apostar
          a que la fuente esté instalada --ya pasó con DSEG-- y además entrarían a todo
          color, fuera de la estética de la consola. Aquí el dibujo es determinista y
          comparte el amarillo del resto de la celda.
          Hubo una flecha al lado del sol para decir cuál era cuál; se quitó porque competía
          con el dibujo en un icono de 24 px. La diferencia la lleva ahora el sol mismo. */}
      {/* Sube 3 px con `transform` y no con el hueco del flex ni con un margen: el
          transform no participa en el flujo, así que el sol se separa de su hora sin
          arrastrarla hacia abajo. Con `gap` o `marginBottom` se habrían movido los dos. */}
      <svg width="24" height="17" viewBox="0 0 24 17"
        style={{ flexShrink: 0, transform: 'translateY(-3px)' }}>
        {/* Horizonte, igual en los dos */}
        <line x1="1.5" y1="14" x2="22.5" y2="14" stroke="#ffcf19" strokeWidth="1.5" strokeLinecap="round" />
        {/* El SOL es lo que distingue amanecer de atardecer, sin flecha: asomando ALTO
            --media circunferencia de r 5.5-- o HUNDIDO y achatado --un casquete de un
            círculo de r 8 cuyo centro está bajo la línea, así que sólo se ve una tajada--.
            La hora de al lado remata la duda: nadie confunde las 06:15 con las 19:09.
            Medio sol y no entero: entero se leía como una luna llena, que es justo lo que
            hay dibujado al lado en esta misma celda. */}
        <path d={up
          ? 'M6.5 14 A 5.5 5.5 0 0 1 17.5 14 Z'
          : 'M5.5 14 A 8 8 0 0 1 18.5 14 Z'} fill="#ffcf19" />
        {/* Rayos largos al amanecer y cortos al atardecer, que refuerza lo mismo que la
            altura del sol: al final del día queda menos luz. */}
        {(up
          ? [[7.1, 7.7, 5.2, 5.8], [12, 7.4, 12, 4.6], [16.9, 7.7, 18.8, 5.8]]
          : [[7.4, 10.4, 6, 9], [12, 9.6, 12, 7.6], [16.6, 10.4, 18, 9]]
        ).map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="#ffcf19" strokeWidth="1.4" strokeLinecap="round" />
        ))}
      </svg>
      {/* 14 y no 17: las horas ceden cuerpo para que el disco lunar crezca, que es lo que
          se mira en esta celda. A 14 el bloque de las cuatro cifras baja de ~57 px de ancho
          a ~47 y sigue leyéndose de lejos --las horas de mín/máx de otras celdas andan por
          ahí--. Es la decisión explícita: antes achicar el número que la luna. */}
      <span className="seg" style={{ color: '#ffcf19', fontSize: 14, fontWeight: 800, lineHeight: 1 }}>
        {hhmm(iso) || '--:--'}
      </span>
    </div>
  )
  // gap 8 entre las dos parejas contra 3 dentro de cada pareja: hay que separar pareja de
  // pareja MÁS de lo que separa el glifo de su hora, o las cuatro filas se leen como una
  // lista y se pierde a qué hora pertenece cada sol. Los dos valores subieron juntos (era
  // 1 y 6) porque a 1 el sol quedaba pegado a las cifras. El alto lo permite: las dos
  // parejas piden 82 px de los 95 que tiene el interior de la celda.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
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
// El contenedor de este riel NO lleva sangría propia: se estira a la caja de la celda sin
// sus bordes, y todo el margen se reserva dentro del viewBox (PS_M), donde además viven el
// "≤" y el "≥". Si se le pusiera sangría al contenedor, los dos márgenes se sumarían y el
// riel saldría bastante más corto de lo que la cuenta dice --ya pasó, medido--.
//
// El ancho de hoy deshace un estrechamiento antiguo (261 → 221) que buscaba lo contrario:
// a lo ancho de la celda las marcas quedan muy separadas y el riel tira a parecer una
// regla más que un indicador. Aquí el paso entre marcas es de ~30 px, que es el punto en
// el que los once rótulos de -5 a 5 caben sin contarse.
//
// 333 = la caja de la celda SIN sus bordes (339 menos 3+3). Estuvo en 335 mientras el
// borde medía 2 px; al subirlo a 3 el viewBox declaraba dos píxeles que ya no existían y
// todo el dibujo se escalaba para caber, descolocando las cuentas de abajo.
const PS_W = 333
// Margen a cada lado DENTRO del viewBox, donde viven el "≤" y el "≥". Era 12, que dejaba
// los símbolos a 2 px del riel: pegados, y montándose sobre sus extremos redondeados. A 18
// quedan 6 px de aire a cada lado.
//
// El precio es que el trazo visible del riel baja de 311 a 297 px y deja de medir lo mismo
// que el histograma de LLUVIA (309 con el borde de 3 px), que era el motivo de haberlo
// ensanchado en su día. Se acepta: que los dos gráficos midan igual es una finura que
// nadie mira, y dos símbolos aplastados contra el borde sí se ven.
const PS_M = 18
// 34 y no 32: los rótulos se mudan ARRIBA del riel y el puntero ABAJO, así que el
// alto ya no lo fija el texto sino la suma riel + puntero. El puntero mide 13 y su
// punta arranca en y=21 (borde de abajo del riel), o sea que necesita hasta y=34.
// Los 2 px de más se los come el aire de en medio de la celda, no el margen
// inferior (que sigue en `bottom: 4`).
const PS_H = 20

function PressureScale({ delta, endLabel, imperial }: {
  delta: number | null; endLabel: string; imperial: boolean
}) {
  const x0 = PS_M
  const x1 = PS_W - PS_M
  const mid = (x0 + x1) / 2
  const half = (x1 - x0) / 2
  const xOf = (v: number) => mid + (Math.max(-PS_R, Math.min(PS_R, v)) / PS_R) * half
  const x = xOf(delta ?? 0)
  // Mismos umbrales y colores que TrendGlyph (±1 hPa), para que la barra y la
  // flecha de la celda nunca se contradigan.
  const color = delta == null || Math.abs(delta) <= 1 ? '#94a3b8' : delta > 0 ? '#22c55e' : '#ef4444'
  // Rótulo de cada marca. En métrico van los once (-5 … 5): el paso entre marcas es
  // de ~31 px y un "-5" a 11 px mide 10, así que caben de sobra y el riel se lee sin
  // contar marcas. En imperial NO: ahí la escala son 0.15 inHg y numerarlas todas
  // daría 0.03 / 0.06 / 0.09…, cinco caracteres cada una en 31 px de hueco. Se
  // quedan sólo los extremos y el cero, como estaban.
  const tickLabel = (v: number) => {
    if (v === 0) return '0'
    if (Math.abs(v) === PS_R) return (v < 0 ? '-' : '') + endLabel
    return imperial ? null : String(v)
  }
  return (
    <svg width="100%" height={PS_H} viewBox={`0 0 ${PS_W} ${PS_H}`} fill="none">
      {/* Riel compacto: coordenadas ajustadas para caber en 20px */}
      <rect x={x0} y={2} width={x1 - x0} height={7} rx={3.5} fill="#141414" stroke="#eaeaea" strokeWidth="1" />
      {/* Marcas cada 1 hPa */}
      {Array.from({ length: 2 * PS_R + 1 }, (_, i) => i - PS_R).map((v) => {
        const tx = xOf(v)
        const major = v % PS_R === 0
        return (
          <line key={v} x1={tx} y1={major ? 1 : 3} x2={tx} y2={major ? 9 : 7.5}
            stroke="#eaeaea" strokeWidth={major ? 1.4 : 0.8} />
        )
      })}
      {/* Relleno del centro al valor */}
      {delta != null && Math.abs(x - mid) > 0.5 && (
        <rect x={Math.min(mid, x)} y={3.5} width={Math.abs(x - mid)} height={4} fill={color} />
      )}
      {/* Números debajo del riel */}
      {Array.from({ length: 2 * PS_R + 1 }, (_, i) => i - PS_R).map((v) => {
        const t = tickLabel(v)
        return t == null ? null : (
          <text key={v} x={xOf(v)} y={18} fill="#eaeaea" fontSize={t.length > 2 ? 7 : 9}
            fontWeight="700" textAnchor="middle">{t}</text>
        )
      })}
      {/* Símbolos ≤ y ≥ a los lados */}
      <text x={2} y={9} fill="#eaeaea" fontSize="10" fontWeight="700" textAnchor="start">{'≤'}</text>
      <text x={PS_W - 2} y={9} fill="#eaeaea" fontSize="10" fontWeight="700" textAnchor="end">{'≥'}</text>
    </svg>
  )
}

/**
 * Triángulo de aviso con su "!" dentro. Estaba escrito a mano dentro de la celda del
 * reloj; ahora lo llevan también las celdas que avisan, así que vive aquí.
 *
 * En SVG y no como emoji ⚠: el Chromium del renderer corre en un contenedor sin fuente
 * de emoji en color y saldría como un cuadro vacío. Es la misma razón por la que todos
 * los iconos de la consola son dibujos.
 *
 * El trazo NO escala con el tamaño --se queda en 1.6 del viewBox de 16-- porque a 21 px
 * un borde proporcionalmente más gordo se come el hueco interior y el "!" deja de leerse.
 */
function WarnGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size * 14 / 16} viewBox="0 0 16 15" style={{ flexShrink: 0 }}>
      <path d="M8 0.5 L15.5 14 L0.5 14 Z" fill="none" stroke="var(--alarma)" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="7.1" y="5" width="1.8" height="5" rx="0.9" fill="var(--alarma)" />
      <rect x="7.1" y="11" width="1.8" height="1.8" rx="0.9" fill="var(--alarma)" />
    </svg>
  )
}

type Trend = 'up' | 'down' | 'stable'

// Flechita de tendencia (sube / baja / estable) reutilizada por varias celdas.
function TrendGlyph({ trend, width = 24, height = 28, style }: {
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
  const { data, history, stats, consensus, localForecast } = useStationData()
  const u = useUnits()
  // Contenedor raíz: de él cuelgan las celdas con `data-nav` que se miden para el
  // mapa de zonas del display.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [imeca, setImeca] = useState<ImecaData | null>(null)
  const [remote, setRemote] = useState<Record<string, number> | null>(null)
  const [remoteHistory, setRemoteHistory] = useState<RemoteHistRow[]>([])
  const [astro, setAstro] = useState<AstroData | null>(null)
  const [moon, setMoon] = useState<{ illumination?: number; waxing?: boolean } | null>(null)
  const [rain7, setRain7] = useState<DailyRain[]>([])
  const [alertas, setAlertas] = useState<AlertaViva[]>([])
  /**
   * Qué cargas de ESTA celda ya se intentaron, para no dejar que el renderer capture
   * media consola.
   *
   * El `ready` que llega por prop sólo espera a `/api/current` (ver `KioskPage`), así que
   * el renderer podía disparar la foto antes de que llegaran el pronóstico, el almanaque
   * y el IMECA: la primera captura tras recrear los contenedores salía sin la tira de
   * horas, sin amanecer/atardecer y con el IMECA en `---`, porque sus cachés en el
   * servidor estaban frías. Antes del pronóstico horario eso sólo dejaba en blanco dos
   * horas y un número; ahora se llevaría la tira, que es lo primero que se mira.
   *
   * Se marca que la carga TERMINÓ, no que trajo dato: si el IMECA estuviera caído de
   * verdad, esperar a que traiga algo dejaría la pantalla SIN IMAGEN --el renderer acaba
   * por tiempo-- en vez de con un `---`, que es lo correcto. Cada efecto marca su casilla
   * tanto si responde como si falla.
   */
  const [cargado, setCargado] = useState({ fc: false, luna: false, imeca: false })
  const [horas, setHoras] = useState<ForecastHour[]>([])

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
    const load = () => fetchForecast()
      .then((r) => { setAstro(r.astro); setHoras(r.hours) })
      .catch(() => {})
      .finally(() => setCargado((c) => (c.fc ? c : { ...c, fc: true })))
    load()
    const i = setInterval(load, 30 * 60000)
    return () => clearInterval(i)
  }, [])

  // Fase lunar del ALMANAQUE del servidor (pyephem, para las coordenadas y la elevación del
  // sitio) en vez del cálculo del navegador, que es un mes sinódico constante desde una luna
  // nueva de referencia. El dibujo del disco sólo necesita dos campos --iluminación y si
  // crece--, y el terminador se deduce de la iluminación.
  //
  // Se pide aparte, como el IMECA: el amanecer y el atardecer de esta misma celda vienen de
  // `fetchForecast` (Open-Meteo), que no trae la luna. Cada 30 min basta: la fase no cambia
  // a la vista en menos, y su caché en el servidor es de 10.
  useEffect(() => {
    const load = () => fetch('/api/almanac')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMoon(d?.available ? d.moon : null))
      .catch(() => {})
      .finally(() => setCargado((c) => (c.luna ? c : { ...c, luna: true })))
    load()
    const i = setInterval(load, 30 * 60000)
    return () => clearInterval(i)
  }, [])

  // Alertas VIVAS. La consola tenía el motor de alertas al lado y no lo miraba: su único
  // aviso era "SIN DATOS". Cada minuto basta --el motor ya trae histéresis propia, así que
  // una alerta no aparece y desaparece entre dos sondeos-- y es lo mismo que cuesta la
  // remota.
  useEffect(() => {
    const load = () => fetch('/api/alerts')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setAlertas(Array.isArray(j?.active) ? j.active : []))
      .catch(() => {})
    load()
    const i = setInterval(load, 60000)
    return () => clearInterval(i)
  }, [])

  // ICA (IMECA estimado). Se pide aparte porque no va en el contexto de la
  // estación: es un dato externo. Cada 30 min, como su caché en el servidor.
  useEffect(() => {
    const load = () => fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setImeca).catch(() => {})
      .finally(() => setCargado((c) => (c.imeca ? c : { ...c, imeca: true })))
    load()
    const i = setInterval(load, 30 * 60000)
    return () => clearInterval(i)
  }, [])

  // Condición actual: preferir el consenso si está disponible (combina estación +
  // presión + Open-Meteo + WeatherAPI). Si no, fallback a deriveCondition local.
  const cond = (() => {
    // Si el consenso tiene condición actual, usarla
    if (consensus?.current) {
      const c = consensus.current
      const isDay = (data?.solar_radiation ?? 0) > 5 || (now.getHours() >= 7 && now.getHours() < 19)
      const suffix = isDay ? 'day' : 'night'
      // Mapear código WMO a icono (simplificado)
      const iconMap: Record<number, string> = {
        0: `clear-${suffix}`, 1: `clear-${suffix}`, 2: `partly-cloudy-${suffix}`,
        3: `overcast-${suffix}`, 45: `fog-${suffix}`, 48: `fog-${suffix}`,
        51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
        61: `overcast-${suffix}-rain`, 63: `overcast-${suffix}-rain`, 65: `overcast-${suffix}-rain`,
        80: `partly-cloudy-${suffix}-rain`, 81: `partly-cloudy-${suffix}-rain`, 82: `overcast-${suffix}-rain`,
        95: 'thunderstorms-rain', 96: 'thunderstorms-rain', 99: 'thunderstorms-rain',
      }
      return {
        icon: iconMap[c.code] ?? `partly-cloudy-${suffix}`,
        label: c.label,
        stormApproaching: c.storm_approaching,
        source: c.source,
      }
    }

    // Fallback: código WMO de la hora actual del pronóstico para deriveCondition
    const currentForecastCode = (() => {
      if (!horas.length) return undefined
      const nowMs = now.getTime()
      let best = horas[0]
      let bestDiff = Infinity
      for (const h of horas) {
        const diff = Math.abs(new Date(h.time).getTime() - nowMs)
        if (diff < bestDiff) { bestDiff = diff; best = h }
      }
      return bestDiff < 90 * 60 * 1000 ? best.code : undefined
    })()

    return data ? { ...deriveCondition(data, currentForecastCode), stormApproaching: false, source: 'local' } : { icon: '', label: '', stormApproaching: false, source: 'none' }
  })()
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
  /**
   * De noche, SOLAR y UV enseñan el MÁXIMO DEL DÍA en vez de su cero.
   *
   * Con el sol puesto esas dos celdas marcan 0 y dejan de decir nada durante media jornada,
   * que en una pantalla de pared son muchas horas de dos celdas apagadas. La idea no cuesta
   * ni un píxel de sitio: la cifra grande muestra el máximo y el renglón donde van la unidad
   * (SOLAR) o el nivel en palabras (UV) dice "MÁXIMO". Al amanecer, con la primera lectura
   * por encima de cero, las dos vuelven solas a lo normal.
   *
   * Se exige que el máximo sea MAYOR QUE CERO, no sólo que la lectura esté a cero: los stats
   * son del día en curso y a las 00:05 el máximo también es 0, así que sin esa condición se
   * anunciaría "0 MÁXIMO" toda la madrugada. Mientras el máximo sea 0 se sigue viendo la
   * lectura normal, que es igual de honesta.
   *
   * El corte es "menor que 1" y no "igual a 0" porque el UV llega entero pero la radiación
   * puede quedarse en decimales de crepúsculo (0.4 W/m²) y entonces nunca conmutaría.
   */
  const uvMaxDia = stats?.uv_index?.max ?? null
  const solarMaxDia = stats?.solar_radiation?.max ?? null
  const uvDeNoche = data?.uv_index != null && data.uv_index < 1 && uvMaxDia != null && uvMaxDia > 0
  const solarDeNoche = data?.solar_radiation != null && data.solar_radiation < 1
    && solarMaxDia != null && solarMaxDia > 0

  /**
   * El HUMIDEX también enseña el máximo del día cuando no hay valor vivo, con el mismo
   * criterio que SOLAR y UV. Aquí el caso no es la noche sino el FRÍO: el receiver no calcula
   * el índice por debajo de 20 °C (no significa nada ahí), así que el campo desaparece y la
   * celda se pasaba media jornada en "--". Con esto, en cuanto el día ha apretado, sigue
   * diciendo cuánto apretó.
   */
  const humidexMaxDia = stats?.humidex?.max ?? null
  const humidexDeAyer = data?.humidex == null && humidexMaxDia != null && humidexMaxDia > 0

  // Hora del pico de ráfaga del día, para el rótulo de RÁFAGA DÍA.
  const gustMaxTime = hhmm(stats?.wind_gust?.max_time)
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
  // Señal RF del WN32, 0-4. Se prueban las dos claves por lo mismo que la batería, y
  // llega del GATEWAY: el nivel es lo que el GW1100 sí sabe medir de sus sensores
  // emparejados. Verificado contra /api/current?station=gw1100 el 2026-08-08: hoy no
  // trae ningún `signal_*` porque no tiene sensores colgados; aparecerá con el WN32.
  const sigNum = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const remoteOutSig = sigNum(
    (remote as Record<string, unknown> | null)?.signal_wh32
    ?? (remote as Record<string, unknown> | null)?.signal_wh26
  )
  // Señal del WS69, el mástil de la estación principal. Se lee con `as` porque el tipo
  // `WeatherData` no declara los `signal_*` --nadie los usaba hasta ahora--.
  //
  // OJO: la consola WS2910 NO los manda. Verificado contra /api/current el 2026-08-08:
  // ni un campo `signal_*`, sólo `battery_wh65` y `battery_ch1`. Así que este glifo
  // queda montado pero NO se dibujará mientras la principal sea la WS2910; se vería
  // solo si algún día el dato llega por un gateway. Preferimos dejarlo listo y que no
  // se pinte, antes que inventar una señal a partir de otra cosa.
  const outSig = sigNum(
    (data as Record<string, unknown> | null | undefined)?.signal_wh65
    ?? (data as Record<string, unknown> | null | undefined)?.signal_ws69
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

  // Celdas con alguna alerta viva. Se marca TIÑENDO DE ROJO el glifo de identidad de la
  // celda --el termómetro, la gota, el barómetro-- o su rótulo si no tiene glifo, en vez
  // de meter un triángulo en una esquina: no queda ni una esquina libre en esta rejilla
  // (medido celda por celda), el glifo se ve desde el otro lado del cuarto y así no se
  // pierde el dibujo que dice qué mide la celda. El texto de la alerta va en el renglón
  // del reloj, que ya hace ese papel con "SIN DATOS".
  const celdasEnAlerta = new Set<string>()
  for (const a of alertas) {
    const c = celdaDeAlerta(a.key)
    if (c) celdasEnAlerta.add(c)
  }
  // Color de un glifo o rótulo: el suyo, o el rojo de la alarma si su celda está avisando.
  const alertaCol = (celda: CeldaAlerta, base: string) =>
    celdasEnAlerta.has(celda) ? 'var(--alarma)' : base

  // Próximas horas del pronóstico. `fetchForecast` ya devuelve las horas desde ahora con
  // su icono de día o de noche resuelto, así que aquí sólo se descartan las pasadas --la
  // lista incluye la hora en curso-- y se toman cuatro.
  const proximas = horas
    .filter((h) => new Date(h.time).getTime() > now.getTime())
    .slice(0, 4)

  // Listo de verdad: lo que dice el padre (hay lectura de la estación) Y que las tres
  // cargas propias de esta pantalla se hayan intentado ya. Ver `cargado`.
  const propioListo = cargado.fc && cargado.luna && cargado.imeca

  /**
   * Rumbo DOMINANTE de las últimas 24 h, para marcarlo en el aro del compás.
   *
   * El compás dice de dónde sopla AHORA, y en una pantalla de pared eso se mira cien veces
   * al día sin saber nunca si ese rumbo es el de siempre o una rareza. Esto lo añade sin
   * pedir un dato nuevo al servidor: sale del histórico de 24 h que la consola ya tiene
   * cargado.
   *
   * Usa el mismo método que la Rosa de Vientos del backend: divide en 16 sectores de 22.5°
   * y devuelve el centro del sector con más lecturas (ignorando calmas bajo 0.5 km/h).
   */
  const rumboDominante = (() => {
    const sectors = Array(16).fill(0)
    let total = 0
    for (const r of history) {
      const d = typeof r.wind_direction === 'number' ? r.wind_direction : null
      const v = typeof r.wind_speed === 'number' ? r.wind_speed : 0
      if (d == null || v <= 0.5) continue
      const idx = Math.round(((d % 360 + 360) % 360) / 22.5) % 16
      sectors[idx]++
      total++
    }
    if (total < 20) return null
    const maxIdx = sectors.indexOf(Math.max(...sectors))
    if (sectors[maxIdx] === 0) return null
    return maxIdx * 22.5
  })()

  const kiosk = mode === 'kiosk'

  // Mapa de zonas táctiles, sólo en el display: se miden las celdas marcadas con
  // `data-nav` y se publica el resultado para que el renderer lo devuelva en la
  // cabecera. En la web no se hace nada --ahí se navega con el ratón--.
  useNavZones(rootRef, 'consola', kiosk)

  return (
    <div
      ref={rootRef}
      {...(kiosk ? { 'data-kiosk-ready': ready && propioListo ? 'true' : 'false' } : {})}
      className={kiosk ? 'cns' : 'cns rounded-xl overflow-hidden mx-auto'}
      style={kiosk
        ? { width: 1024, height: 600, background: '#000', overflow: 'hidden' }
        : { maxWidth: 1024, background: '#000' }}
    >
      <style>{CONSOLE_CSS}</style>
      {kiosk && <NavDebugOverlay nodo={rootRef} />}
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
        {/* `data-nav`: a qué pantalla lleva tocar esta celda en el display. Sólo la
            clave; el rectángulo lo mide `nav-zones.tsx` del DOM ya renderizado, así
            que mover la celda no rompe su zona. En la web el atributo es inerte. */}
        <div className="cell col main" data-nav={CONSOLA_NAV.ext}>
          {/* El marcador va ABSOLUTO: dentro del flex hacía crecer la fila del
              encabezado al alto del icono y empujaba el valor hacia abajo.
              `right: 6` y no 0: este glifo es de trazo y llega hasta el borde de su
              caja, a diferencia del sol de Meteocons que traía aire por dentro. */}
          <div style={{ position: 'absolute', top: 6, right: 6 }} title="sensor exterior">
            <HouseGlyph />
          </div>
          {/* Señal del WS69 a la IZQUIERDA de la casita, centrada con ella: la casa dice
              dónde mide el sensor y esto cómo llega su enlace, así que las dos van juntas.
              `top: 10` para que las barras arranquen a la ALTURA DEL TEJADO y no centradas:
              la casa va en `top: 6` con 30 px de caja, pero su dibujo empieza dentro --el
              vértice del tejado cae en y=3 de un viewBox de 24, o sea en y≈10-- así que ése
              es el borde de arriba que se ve. Centrada (top 15) la señal parecía colgada.
              Con la WS2910 no se dibujará nunca, porque no manda el campo; ver `outSig`. */}
          {outSig != null && (
            <div style={{ position: 'absolute', top: 10, right: 42 }}>
              <SignalGlyph level={outSig} name="WS69" />
            </div>
          )}
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
            <MeteoGlyph name="thermometer" size={72} color={alertaCol('ext', '#f97316')} title="temperatura" />
          </div>
          {/* Triángulo de aviso A LA IZQUIERDA de la flecha de tendencia. Van juntos a
              propósito: los dos hablan de lo mismo --cómo está esta magnitud-- y ese es el
              único sitio de la celda con hueco a media altura.
              SITIO, medido sobre la captura: la flecha va en `right: 12` y mide 20, así que
              su borde izquierdo cae a 32 px del borde; a `right: 38` quedan 6 px entre las
              dos. El triángulo mide 30 px, que es el tope de esta celda: ocupa de x=268 a
              x=298 y la lectura acaba en 263, así que quedan 5 px de aire. En HUMEDAD cabría
              más --tiene 60 px libres contra los 41 de aquí-- pero las dos llevan el mismo
              para que se lean como pareja, que es como está maquetado todo lo demás.
              El teñido del glifo se queda: el color se ve de lejos y dice QUÉ falla; el
              triángulo dice que es un aviso y no una lectura curiosa. */}
          {celdasEnAlerta.has('ext') && (
            <div style={{ position: 'absolute', top: '50%', right: 38, transform: 'translateY(-50%)' }}>
              <WarnGlyph size={30} />
            </div>
          )}
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

        <div className="cell main" data-nav={CONSOLA_NAV.viento}
          style={{ gridRow: 'span 2', padding: '7px 9px', display: 'flex', flexDirection: 'column' }}>
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
                        color: alertaCol('viento', 'var(--v)'), fontWeight: 800, marginTop: -4, lineHeight: 1.15 }}>
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
              {/* Marcas cada 10° en TRES niveles, que es lo que hace que el aro parezca un
                  instrumento y no un aro con doce palitos: los cuatro rumbos cardinales
                  largos y claros, los 30° medios, y los 10° como pelo fino. Todas
                  arrancan a distinta profundidad hacia dentro y acaban en el óvalo
                  exterior, así que la jerarquía la dan el largo, el grosor y el tono a la
                  vez --con sólo el color no se distinguen a esta escala--. */}
              {Array.from({ length: 36 }, (_, i) => i * 10)
                // Los CUATRO cardinales no llevan marca: ahí va su letra, encima del riel,
                // y la marca quedaba debajo pisándola. La letra ya señala el rumbo mejor
                // que un palito, así que la marca no aportaba nada y sólo ensuciaba.
                .filter((deg) => deg % 90 !== 0)
                .map((deg) => {
                  const rad = (deg - 90) * Math.PI / 180
                  const media = deg % 30 === 0
                  const [rx, ry, color, ancho] = media
                    ? [44.5, 34.5, '#7c7c7c', 1.2]
                    : [46.5, 36, '#525252', 0.8]
                  return (
                    <line key={deg}
                      x1={50 + rx * Math.cos(rad)} y1={40 + ry * Math.sin(rad)}
                      x2={50 + RX * Math.cos(rad)} y2={40 + RY * Math.sin(rad)}
                      stroke={color} strokeWidth={ancho} />
                  )
                })}
              {/* Óvalo interior */}
              <ellipse cx="50" cy="40" rx={RX_IN} ry={RY_IN} stroke="#444" strokeWidth="1" fill="none" />
              {/* Marca del rumbo DOMINANTE de 24 h: un PUNTO metido dentro del riel del aro.
                  Fue un trazo radial apagado y no valía: a poca opacidad se confundía con los
                  palitos grises de los grados, que son también radiales. Un círculo no se
                  parece a nada más del dibujo --ni a las marcas ni a la flecha viva, que va en
                  cuña-- así que aguanta ir a color casi pleno sin competir con ella.
                  MEDIDAS: el riel va del óvalo interior (42×31) al exterior (49×38), o sea 7
                  unidades de ancho, y el punto se centra en su mitad (45.5×34.5) con r=3.2, que
                  lo deja del ancho del riel con tres décimas de aire a cada lado. Sin rótulo:
                  no cabe, y el verde ya lo ata al viento. Ver `rumboDominante`. */}
              {rumboDominante != null && (() => {
                const rad = ((rumboDominante - 90) * Math.PI) / 180
                return (
                  <circle
                    cx={50 + 45.5 * Math.cos(rad)} cy={40 + 34.5 * Math.sin(rad)}
                    r={3.2} fill="var(--v)" fillOpacity="0.85"
                  />
                )
              })()}
              {/* La flecha va ANTES de las letras cardinales: cuando el rumbo cae
                  justo en N/E/S/O las dos comparten el mismo punto del aro, y así
                  la letra queda encima y sigue legible. */}
              {windMarker}
              {/* Letras cardinales más grandes */}
              <text x="50" y="8" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">N</text>
              {/* E en 95.5 y O en 4.5, no en 98 y 2: el riel del óvalo va de rx 42 a 49
                  sobre cx 50, así que en el ecuador su banda ocupa x 92-99 a la derecha y
                  x 1-8 a la izquierda, y esos son sus centros. En 98 y 2 las dos letras
                  caían sobre el filo exterior y parecían escaparse del aro. */}
              <text x="95.5" y="44" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">E</text>
              <text x="50" y="77" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">S</text>
              <text x="4.5" y="44" fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle">O</text>
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
          <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 16 }}>
            {/* PROMEDIO con tamaño reducido igual que celda lluvia */}
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>PROMEDIO</div>
              <div className="gv seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_speed_avg10m, 1))}<span className="u" style={{ fontSize: 14, color: 'var(--v)' }}>{u.windU}</span>
              </div>
            </div>
            {/* RÁFAGA DÍA con tamaño reducido */}
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ position: 'relative', color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
                {gustMaxTime && (
                  <span style={{ position: 'absolute', bottom: '100%', right: 0, fontSize: 10,
                                 fontWeight: 700, letterSpacing: 0, lineHeight: 1.15, whiteSpace: 'nowrap',
                                 color: '#fff' }}>
                    {gustMaxTime}
                  </span>
                )}
                RÁFAGA DÍA
              </div>
              <div className="gv seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>
                {decNum(u.wind(data?.wind_gust_max_daily, 1))}<span className="u" style={{ fontSize: 14, color: 'var(--v)' }}>{u.windU}</span>
              </div>
            </div>
          </div>
          {/* Barra Beaufort */}
          {(() => {
            const bf = data?.wind_speed != null ? beaufort(data.wind_speed) : null
            return (
              <div style={{ position: 'absolute', bottom: 9, left: 9, right: 9 }}>
                <div style={{ fontSize: 10, color: '#fff', fontWeight: 700, marginBottom: 1, textAlign: 'center' }}>
                  {bf ? bf.label.toUpperCase() : ''}
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} style={{
                      height: 4,
                      flex: 1,
                      borderRadius: 1,
                      backgroundColor: i < (bf?.scale ?? 0) ? '#34d399' : 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)'
                    }} />
                  ))}
                </div>
              </div>
            )
          })()}
        </div>

        {/* HUMEDAD en fila 1 columna 3. Ocupa el sitio de la celda VEL, que
            desapareció: su velocidad se mudó al centro del óvalo y su rumbo al rincón
            donde estaba la manga, así que no le quedaba nada propio que mostrar.
            La celda no cambia por dentro. Las filas 1 y 2 miden lo mismo (1.23fr),
            así que todas las medidas de esta celda --cuerpo 66, unidad 24, el mín/máx
            anclado abajo-- siguen valiendo tal cual; sólo cambia de vecinos. */}
        <div className="cell col main" data-nav={CONSOLA_NAV.humedad}>
          {/* Sin rótulo "HUMEDAD": la gota lo dice. Mismo apaño que en EXT para que el
              número no se mueva --marginTop de -13 a +5-- y misma subida de la gota al
              borde de arriba, para dejarle la franja de abajo a las horas. */}
          <div style={{ position: 'absolute', top: 0, bottom: 30, left: 12, display: 'flex', alignItems: 'center' }}>
            <MeteoGlyph name="humidity" size={65} color={alertaCol('hum', '#2563eb')} title="humedad" />
          </div>
          {/* Triángulo de aviso A LA IZQUIERDA de la flecha de tendencia. Van juntos a
              propósito: los dos hablan de lo mismo --cómo está esta magnitud-- y ese es el
              único sitio de la celda con hueco a media altura.
              SITIO, medido sobre la captura: la flecha va en `right: 12` y mide 20, así que
              su borde izquierdo cae a 32 px del borde; a `right: 38` quedan 6 px entre las
              dos. El triángulo mide 21 px y no más porque en PRES es donde menos hueco hay
              --la lectura llegaba a 15 px de la flecha-- y las tres celdas lo llevan igual.
              El teñido del glifo se queda: el color se ve de lejos y dice QUÉ falla; el
              triángulo dice que es un aviso y no una lectura curiosa. */}
          {celdasEnAlerta.has('hum') && (
            <div style={{ position: 'absolute', top: '50%', right: 38, transform: 'translateY(-50%)' }}>
              <WarnGlyph size={30} />
            </div>
          )}
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
        <div className="cell col main" data-nav={CONSOLA_NAV.presion}>
          {/* Casa hueca = sensor exterior, igual que en EXT y HUMEDAD */}
          <div style={{ position: 'absolute', top: 6, right: 6 }} title="sensor exterior">
            <HouseGlyph />
          </div>
          {/* Sin rótulo "PRES": el barómetro de abajo a la izquierda lo dice. De paso
              se acaba el apretón que obligó a abreviar "PRESIÓN" a "PRES" --la lectura
              llega hasta x≈82 y la palabra entera se le echaba encima--.
              El número no se mueve: marginTop de -12 a +6, los 18 px del rótulo. */}
          {/* El barómetro, como el termómetro y la gota, CENTRADO a lo alto en la banda
              libre: aquí lo que la limita por abajo es el riel (que va en `bottom: 4` y
              mide 34), de ahí el `bottom: 40`. Queda en y 22-68.
              Convive con la lectura porque están uno al lado del otro, no encima: el
              glifo acaba en x≈58 y la cifra más larga de la consola ("1025.8" con su
              unidad, alineada a la derecha) empieza en x≈56. Por eso sigue a 46 px y no
              más grande.
              `bottom: 30` y no 40: con 40 la banda acababa donde arranca el riel y el
              glifo quedaba un poco alto respecto al hueco que ocupa a la vista. Diez
              píxeles menos de exclusión lo bajan 5, que es lo que le faltaba. */}
          <div style={{ position: 'absolute', top: 0, bottom: 30, left: 12, display: 'flex', alignItems: 'center' }}>
            <MeteoGlyph name="barometer" size={46} color={alertaCol('pres', '#8b5cf6')} title="presión" />
          </div>
          {/* Triángulo de aviso A LA IZQUIERDA de la flecha de tendencia. Van juntos a
              propósito: los dos hablan de lo mismo --cómo está esta magnitud-- y ese es el
              único sitio de la celda con hueco a media altura.
              SITIO, medido sobre la captura: la flecha va en `right: 12` y mide 20, así que
              su borde izquierdo cae a 32 px del borde; a `right: 38` quedan 6 px entre las
              dos. El triángulo mide 21 px y no más porque en PRES es donde menos hueco hay
              --la lectura llegaba a 15 px de la flecha-- y las tres celdas lo llevan igual.
              El teñido del glifo se queda: el color se ve de lejos y dice QUÉ falla; el
              triángulo dice que es un aviso y no una lectura curiosa. */}
          {/* Mismo sitio y mismo tamaño que en EXT y HUMEDAD: a la izquierda de la flecha y
              a 30 px. Estuvo un rato arriba a la derecha porque di por hecho que no cabía
              aquí, tomando el ancho de la lectura ENTERA; pero el "mb" va en lo alto de la
              cifra --`vertical-align: top`-- así que a la altura de la flecha lo último que
              hay a la derecha es el decimal, y queda hueco de sobra. */}
          {celdasEnAlerta.has('pres') && (
            <div style={{ position: 'absolute', top: '35%', right: 38, transform: 'translateY(-50%)' }}>
              <WarnGlyph size={30} />
            </div>
          )}
          <div style={{ position: 'absolute', top: '35%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={pressTrend} />
          </div>
          {/* Lectura ARRIBA, al nivel de la celda de temperatura, para dejar espacio
              al badge de pronóstico Zambretti entre la lectura y el riel. */}
          <div className="big gp rt" style={{ marginTop: 5, fontSize: 56, paddingRight: 32 }}>
            {decNum(u.press(data?.pressure_relative, 1))}<span className="u" style={{ fontSize: 24, color: 'var(--p)' }}> {u.pressU}</span>
          </div>
          {/* Badge de pronóstico: combina Zambretti (presión) con lluvia actual */}
          {(() => {
            if (!localForecast?.available) return null
            const t = localForecast.trend?.code
            const l = localForecast.level
            const raining = (data?.rain_rate ?? 0) > 0
            let icon = '🌤️', text = 'Estable'
            // Prioridad 1: si está lloviendo, decirlo
            if (raining) { icon = '🌧️'; text = 'Lloviendo' }
            // Prioridad 2: pronóstico por presión (Zambretti)
            else if (t === 'falling_fast') { icon = '🌧️'; text = 'Posible lluvia' }
            else if (t === 'falling' && l === 'low') { icon = '🌧️'; text = 'Inestable' }
            else if (t === 'falling') { icon = '⛅'; text = 'Nublándose' }
            else if (t === 'rising' && l === 'high') { icon = '☀️'; text = 'Buen tiempo' }
            else if (t === 'rising' || t === 'rising_fast') { icon = '🌤️'; text = 'Mejorando' }
            else if (l === 'high') { icon = '☀️'; text = 'Buen tiempo' }
            else if (l === 'low') { icon = '⛅'; text = 'Variable' }
            return (
              <div style={{ position: 'absolute', bottom: 26, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.08)',
                              borderRadius: 6, padding: '3px 10px' }}>
                  <span style={{ fontSize: 15 }}>{icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.8 }}>{text}</span>
                </div>
              </div>
            )
          })()}
          {/* Riel al ANCHO COMPLETO. Contenedor SIN sangría (left/right 0) porque la de
              12 px ya la pone el dibujo por dentro, con su x0/x1: puestas las dos, se
              sumaban y el riel salía 22 px más corto que el histograma de LLUVIA. Así los
              dos gráficos de la consola empiezan y acaban en la misma vertical de su
              celda. El ancho real lo fija PS_W, no este contenedor: el SVG lleva
              `preserveAspectRatio` por defecto y con un viewBox más estrecho que su caja
              se quedaría centrado sin estirarse. */}
          <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0 }}>
            <PressureScale delta={pressDelta} endLabel={pressEndLabel} imperial={u.pressU === 'inHg'} />
          </div>
        </div>

        {/* LLUVIA en fila 2 columna 3.
            SIN rótulo, como EXT, HUMEDAD y PRES: la gota lo dice. Quitarlo, subir las
            cifras al borde de arriba y mudar la gota allí libera la franja de abajo
            ENTERA para el histograma, que a 28 px de barra se veía de juguete. Ahora
            tiene 40 px de alto y los 311 px de ancho de la celda en vez de 245, así que
            las barras pasan de ~32 px a ~42 y el gráfico se lee de lejos. */}
        <div className="cell main" data-nav={CONSOLA_NAV.lluvia}>
          {/* La gota SUBE a la esquina de arriba, que es lo que despeja el ancho
              completo abajo. Se queda (no se quita, aunque el histograma la habría
              desalojado): sin ella y sin rótulo, nada diría que esta celda es de lluvia,
              y es el mismo papel que hacen el termómetro en EXT o el barómetro en PRES.
              44 y no 46: el hueco a la izquierda de las cifras es ese. */}
          {/* overflow: visible evita que la animación de escala recorte el glifo */}
          <div style={{ position: 'absolute', top: 16, left: 12, overflow: 'visible' }}>
            <MeteoGlyph name="raindrops" size={44} color={alertaCol('lluvia', '#38bdf8')} title="lluvia" />
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
          {/* Histograma a TODO EL ANCHO de la celda, al pie. Ya no tiene que esquivar la
              gota --que se mudó arriba-- ni al rótulo, que se fue. */}
          {rain7.length > 0 && (
            <div style={{ position: 'absolute', bottom: 4, left: 12, right: 12 }}>
              <RainHistogram data={rain7} fmt={(mm) => u.rain(mm)} />
            </div>
          )}
          {/* Las tres cifras arrancan pegadas al borde de arriba (sin marginTop
              negativo, que era para compensar el rótulo que ya no está) y sangradas por
              la izquierda para dejarle su hueco a la gota. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-evenly',
                        gap: 2, paddingLeft: 48, paddingRight: 4 }}>
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
        {/* Tres derivados de la temperatura, no dos. Al entrar HUMIDEX el cuerpo baja de
            40 a 34: medido sobre la fuente, el caso peor con unidad ("-5.2 °C" o
            "45.3 °C") mide ~90 px a 34, así que tres suman 270 en los 311 útiles y
            quedan ~41 px para las separaciones. A 40 sumaban 357 y no cabían.
            HUMIDEX aparece SÓLO con 20 °C o más: es un índice de bochorno y el receiver
            no lo calcula por debajo de eso (ver calculate_derived_values), así que de
            madrugada marcará "--" y eso es correcto, no una avería. */}
        {/* TRES CELDAS, una por derivado, en vez de una sola con tres columnas. El motivo es
            el humidex: al ser un ÍNDICE le toca su riel de escala, como a UV y al IMECA, y un
            riel dentro de una celda compartida se leería como si midiera las tres cifras.
            Partida, cada dato tiene su caja, su contorno y su sitio para lo que necesite.
            Estructura y medidas copiadas de la fila de SOLAR/UV/IMECA --rótulo, cifra, renglón
            de apoyo y riel al pie con `marginTop: auto`-- así que las dos filas de tres celdas
            de la consola se leen igual. Cada celda mide (342-6)/3 = 112 px, o sea 100 de
            interior con la sangría de 3, donde el caso peor ("SENSACIÓN", ~70 px) entra.
            Las tres conservan el contorno ÁMBAR: los tres se derivan de la temperatura y la
            humedad de la estación principal, así que siguen siendo suyos. Y las tres llevan el
            mismo `data-nav`, como ya hacen la condición y la luna: las tres van al detalle de
            temperatura, que es de donde salen. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3, minWidth: 0, minHeight: 0 }}>
          {/* El RÓTULO cuelga del borde de arriba, al mismo nivel que el de HUMIDEX --los tres
              rótulos de la fila tienen que caer en la misma línea-- y el VALOR se centra en el
              hueco que queda debajo, con `margin: auto 0`. Centrar la celda entera bajaba
              también el rótulo, que era el efecto que no se quería. */}
          <div className="cell main" data-nav={CONSOLA_NAV.derivadas}
            style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            {/* Mismos cuerpos que la fila de SOLAR/UV/IMECA --rótulo 16, cifra 38-- para que
                las dos filas de tres celdas pesen igual. Medido antes de subirlos: a 34 la
                cifra más ancha de estas tres ocupaba 79 px de los ~100 de interior, así que a
                38 quedan ~88 y siguen entrando. */}
            <div style={{ color: alertaCol('rocio', 'var(--w)'), fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>ROCÍO</div>
            {/* `width: 100%` + `textAlign: center` y no la caja que se encoge al contenido: así
                se centra la LÍNEA completa (cifra + unidad). Encogida, la tinta acababa corrida
                a la derecha --28 px de margen a la izquierda contra 9 a la derecha, medido en la
                captura-- porque la unidad y el decimal no pesan lo mismo a cada lado. */}
            <div className="gt seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, margin: 'auto 0',
                                             whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
              {decNum(u.temp(data?.dew_point))}<span className="u" style={{ fontSize: 15, color: 'var(--t)' }}>{u.tempU}</span>
            </div>
          </div>
          {/* Rótulo arriba y valor centrado en lo que queda, como ROCÍO. */}
          <div className="cell main" data-nav={CONSOLA_NAV.derivadas}
            style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: alertaCol('sensacion', 'var(--w)'), fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>SENSACIÓN</div>
            <div className="gt seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, margin: 'auto 0',
                                             whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
              {decNum(u.temp(data?.feels_like))}<span className="u" style={{ fontSize: 15, color: 'var(--t)' }}>{u.tempU}</span>
            </div>
          </div>
          <div className="cell main" data-nav={CONSOLA_NAV.derivadas}
            style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>HUMIDEX</div>
            {/* Sin unidad: el humidex es un índice, no una temperatura, aunque se exprese en
                una escala parecida. Ponerle °C invitaría a compararlo con las dos cifras de al
                lado como si midieran lo mismo.
                El NÚMERO va del color de su tramo --como UV y el IMECA, y no del naranja de la
                temperatura, que es lo que hacía antes por herencia de la clase `gt`--, así que
                el color, la palabra y la banda encendida del riel dicen los tres lo mismo.
                Sin valor vivo (por debajo de 20 °C el índice no existe) muestra el MÁXIMO DEL
                DÍA en blanco, igual que SOLAR y UV de noche: el blanco no está en la escala, así
                que se sabe que ese número no es de ahora. */}
            {/* `gw seg` con el color inline, el mismo patrón que SOLAR, UV e IMECA: la clase
                aporta la fuente de siete segmentos y el HALO --sin él, con sólo `seg`, esta
                cifra se veía apagada al lado de sus dos vecinas, que brillan por la clase
                `gt`-- y el color lo pone el nivel. */}
            <div className="gw seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, marginTop: 6, whiteSpace: 'nowrap',
                                         color: humidexDeAyer ? '#fff'
                                           : data?.humidex != null ? humidexColor(data.humidex) : 'var(--lbl)' }}>
              {data?.humidex != null ? decNum(data.humidex.toFixed(1))
                : humidexDeAyer ? decNum((humidexMaxDia as number).toFixed(1)) : '--'}
            </div>
            {(data?.humidex != null || humidexDeAyer) && (
              <div className="u" style={{ fontSize: 12, lineHeight: 1, marginTop: 3, whiteSpace: 'nowrap',
                                          color: humidexDeAyer ? '#fff' : 'var(--w)' }}>
                {humidexDeAyer ? 'MÁXIMO' : humidexLabel(data!.humidex as number).toUpperCase()}
              </div>
            )}
            {/* Riel con las bandas a la vista, como UV e IMECA: es lo que convierte el número
                en "y esto cuánto es". Sigue a la cifra que se está mostrando --si arriba va el
                máximo del día, el riel marca ese máximo-- o no cuadrarían. */}
            <div style={{ marginTop: 'auto', width: '100%', paddingTop: 4 }}>
              <LevelBar value={humidexDeAyer ? humidexMaxDia : data?.humidex} max={60} bands={HUMIDEX_BANDS} />
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
          {/* CELDA DE CIELO, en dos mitades. Arriba: icono a la izquierda y la
              descripción a su derecha. Abajo: la tira de horas a TODO EL ANCHO.
              La primera versión ponía el icono y la tira en la misma fila, y la tira se
              quedaba con lo que sobraba --unos 100 px para cuatro columnas-- así que sus
              cifras tenían que ir a 10-13 px y no se leían de lejos, que es el único sitio
              desde el que se mira esta pantalla. Repartiendo por mitades, la tira pasa de
              ~100 a 169 px de ancho y su temperatura de 13 a 19 px.
              Sangría lateral de 8 y no los 12 de `.cell`: son 8 px más de tira, y arriba no
              hacen falta porque el icono ya trae aire por dentro. */}
          <div className="cell derivada" data-nav={CONSOLA_NAV.cielo}
            style={{ display: 'flex', flexDirection: 'column', padding: '2px 8px' }}>
            {/* MITAD DE ARRIBA: icono y descripción, CENTRADOS como bloque --antes colgaban
                del borde izquierdo-- y separados 8 px.
                CUENTA BUENA DEL ALTO, y la de antes estaba mal: el contorno de esta celda va
                de y=266 a y=372 en la captura, así que su interior son 103 px --no 106-- y con
                la sangría de 2 quedan 99 para el contenido. Con el icono a 60 y la tira, el
                contenido pedía 105: se desbordaba 6 px y la fila de probabilidades salía
                CORTADA por el borde de abajo. El error venía de tomar como borde una
                referencia de un recorte y no el contorno medido de la celda.
                Cuentas de ahora: la fila del icono cede 14 px de maquetación
                (`marginBottom: -14`), así que ocupa 48 de los 62 que mide el dibujo; la tira
                pide 43 y se sube 4 más; total 95 de los 99. Los 14 px que la fila se descuenta
                no pisan la tira porque los iconos de Meteocons traen aire DENTRO de su
                lienzo: lo que se solapa es hueco, no dibujo. Comprobado en la captura.
                La TIRA se aprieta también: la hora a 11 px y el interlineado de la
                temperatura de 1.15 a 1.02, con lo que su caja baja de 47 a 43. Sus cifras NO
                cambian de tamaño; lo que se recorta es el aire entre los tres renglones. Que la sangría sea de 2 no acerca el dibujo al borde tanto como
                parece: los iconos de Meteocons traen su propio aire dentro del lienzo.
                Con la sangría en 7 y el icono en 52 la fila de probabilidades ya salió
                CORTADA una vez --tinta hasta y=109 de 110--, así que esto se mide en la
                captura cada vez que se toca.
                La descripción va a su derecha, alineada a la izquierda y en dos o tres
                renglones si hace falta --"NOCHE PARCIALMENTE NUBLADA" son 25 caracteres--:
                aquí partir el texto no estorba a nadie, porque el bloque tiene la altura del
                icono de al lado. Antes iba centrada arriba y una condición larga se partía
                igual, pero empujando todo lo de abajo. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          width: '100%', marginTop: -10, marginBottom: -14 }}>
              <span style={{ transform: 'translateY(5px)' }}>
                <WeatherIcon name={cond.icon} size={62} className="weather-main-icon" />
              </span>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: 0.5, lineHeight: 1.08, textAlign: 'left', minWidth: 0 }}>
                {cond.label || 'CLIMA'}
              </div>
            </div>
            {/* MITAD DE ABAJO: AHORA + las PRÓXIMAS CUATRO HORAS. La consola decía el tiempo
                que hace y en ningún sitio el que va a hacer: la probabilidad de lluvia por
                hora estaba en `/api/forecast` desde siempre --168 h-- y había que irse a la
                página 1 para verla. En una pantalla de pared, "¿llueve al rato?" es la
                pregunta que más veces se hace.
                `marginTop: auto` la pega al borde de abajo, y cada columna con `flex: 1` se
                reparte el ancho a partes iguales: así las cuatro caen en la misma rejilla
                aunque una diga "100%" y otra "9%".
                CUERPOS, con el ancho que hay (169/4 = 42 px por columna): temperatura a 19 px
                --el caso peor, "-10", mide 27-- hora a 12 y probabilidad a 13. La
                temperatura va en blanco y la probabilidad en el AZUL DE LA LLUVIA (`--r`),
                el mismo de la celda de LLUVIA y de su histograma, que es lo que dice qué es
                cada cifra sin gastar rótulos. */}
            {proximas.length > 0 && (
              <div style={{ marginTop: 'auto', marginBottom: 4, display: 'flex', width: '100%' }}>
                {proximas.map((h) => (
                  <div key={h.time} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                    {/* La hora, sin minutos: son horas en punto del pronóstico.
                        En un gris CLARO (#bdbdbd) y no en el `--lbl` (#8a8a8a) del resto de los
                        rótulos: aquí la hora no es una etiqueta que se pueda ignorar --sin ella
                        las tres cifras de su columna no significan nada-- y a 11 px sobre negro
                        el gris de rótulo se apagaba, más aún en el panel del kiosco, que aplasta
                        los tonos bajos. Sigue por debajo del blanco de la temperatura, que es lo
                        que manda en la columna. */}
                    <div style={{ color: '#bdbdbd', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
                      {new Date(h.time).getHours()}
                    </div>
                    <div style={{ color: 'var(--w)', fontSize: 19, fontWeight: 800, lineHeight: 1.02 }}>
                      {u.temp(h.temp, 0)}
                    </div>
                    <div style={{ color: 'var(--r)', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
                      {Math.round(h.precipProb)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* SOL Y LUNA. Sin rótulo, por lo mismo que EXT o PRES: el disco lunar y las
              flechas de salida y puesta se explican solos, y la palabra "LUNA" ya se
              habría quedado corta al entrar el sol. Ese renglón que se ahorra es justo
              el que necesitan las dos horas.
              Padding lateral de 6 y no los 12 de `.cell`: en 146 px de celda, la luna y
              las dos horas piden casi todo el interior y con 12 por lado no caben.
              CUENTA DEL ANCHO, medida y no estimada. El interior entre bordes son 139 px;
              con sangría de 4 quedan 131 para la fila. Las horas a cuerpo 14 ocupan ~47 y
              el hueco 5, así que al disco le quedan ~74. El tope por ALTO es 95 (109 de
              celda menos bordes y sangría), así que manda el ancho.
              La primera versión pidió 76 con sangría 6 y flex se los recortó a 63 sin
              avisar; de ahí el `flexShrink: 0` del disco y que las horas cedan cuerpo. */}
          <div className="cell derivada" data-nav={CONSOLA_NAV.cielo} style={{ padding: '4px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            {/* El disco baja de 74 a 64 px: al lado de las dos horas se veía desproporcionado.
                Va dentro de una caja de 74 --el tamaño de ANTES-- centrada: si se encogiera el
                glifo a secas, esta fila es un flex centrado y las horas se correrían 5 px hacia
                la izquierda. Con la caja fija, en esta celda no se mueve nada más. */}
            <div style={{ width: 74, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
              <MoonGlyph size={64} illum={moon?.illumination} waxing={moon?.waxing} />
            </div>
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
        <div className="cell col remota" data-nav={CONSOLA_NAV.remota}>
          {/* Sólo "REMOTA", sin el nombre del aparato. Las tres celdas de allá llevan el
              MISMO rótulo: lo que interesa de un vistazo es de qué SITIO viene la lectura
              --que es lo que agrupa el contorno azul-- y no qué caja la mide, que es un
              detalle de instalación. Lo que mide cada una lo dicen sus glifos: casa hueca
              = a la intemperie (ésta), casa rellena = bajo techo, barómetro = presión; el
              mismo criterio con el que EXT, HUMEDAD, PRES y LLUVIA se quedaron sin rótulo.
              Además el reparto de color anterior (procedencia en blanco, aparato en
              morado) gastaba el morado de la PRESIÓN en un nombre de equipo. */}
          <div style={{ color: celdasEnAlerta.has('remotaExtT') || celdasEnAlerta.has('remotaExtH') ? 'var(--alarma)' : 'var(--w)',
                        fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA</div>
          {/* Casa HUECA = a la intemperie. Es la única celda de la estación remota que
              mide afuera, y el hueco frente al relleno de la de abajo es lo que lo dice.
              Absoluto por lo mismo que en EXT: si no, baja los valores. */}
          <div style={{ position: 'absolute', top: 6, right: 8 }} title="sensor exterior">
            <HouseGlyph />
          </div>
          {/* DOS avisos en esta celda, uno por lectura, porque aquí hay dos magnitudes y un
              solo triángulo no diría cuál de las dos falla --es la única celda de la consola
              con dos lecturas y alarmas propias de cada una--.
              A 26 px y no a los 30 del resto: en esta celda los triángulos no van en una
              banda vacía sino entre cosas (el rótulo arriba, la casita, la pila), y a 30 se
              notaba apretado.
              SITIO, medido con el WN32 reportando: la lectura de temperatura ocupa x 66..153 y
              la de humedad x 192..275; la casita va en y 6..36 (x 294..324) y la pila abajo a
              la derecha. Así que el de temperatura entra a la izquierda en x 14..40 --52 px
              libres-- y el de humedad bajo la casita en x 296..322, entre ella y la pila. Los
              dos a `top: 44`, o sea a la altura del centro de las cifras (que van de y 34 a
              82), y a la misma altura entre ellos. */}
          {celdasEnAlerta.has('remotaExtT') && (
            <div style={{ position: 'absolute', top: 44, left: 14 }}>
              <WarnGlyph size={26} />
            </div>
          )}
          {celdasEnAlerta.has('remotaExtH') && (
            <div style={{ position: 'absolute', top: 44, right: 10 }}>
              <WarnGlyph size={26} />
            </div>
          )}
          {/* Señal del WN32 junto a la casita, igual que en EXT. Aquí SÍ va a haber dato:
              el nivel 0-4 lo mide el GW1100 de cada sensor que tiene emparejado. */}
          {remoteOutSig != null && (
            <div style={{ position: 'absolute', top: 10, right: 44 }}>
              <SignalGlyph level={remoteOutSig} name="WN32" />
            </div>
          )}
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
          {/* MISMOS números que INTERIOR y JARDÍN --gap 16, marginTop -10-- y no los 40 y
              -6 que tenía: las cuatro celdas de temperatura+humedad de la consola
              contienen lo mismo y ahora se maquetan igual. Medido sobre la captura con el
              WN32 reportando, esos 4 px de más abajo y 24 de más ancho eran justo lo que
              metía el rótulo "WN32" de la pila debajo del pie de las cifras de humedad: el
              aire entre valores y pila era -4 px en vertical y -13 en horizontal, contra
              -1 y -1 de JARDÍN, que es la referencia buena. */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: -10 }}>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutT != null ? decNum(u.temp(remoteOutT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              <TrendGlyph trend={remoteOutTempTrend} width={20} height={24} style={{ position: 'absolute', top: 10, right: -4 }} />
            </span>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutH != null ? remoteOutH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
              <TrendGlyph trend={remoteOutHumTrend} width={20} height={24} style={{ position: 'absolute', top: 10, right: -4 }} />
            </span>
          </div>
        </div>

        {/* Fila 4 */}
        <div className="cell col main" data-nav={CONSOLA_NAV.interior}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: alertaCol('interior', '#fbbf24'), fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>INTERIOR</span>
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
          <div className="cell derivada" data-nav={CONSOLA_NAV.solar} style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: alertaCol('solar', '#f59e0b'), fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>SOLAR</div>
            {/* De noche, el MÁXIMO DEL DÍA en BLANCO PURO --y no en el color de su banda-- para
                que no se confunda con una lectura viva: el blanco no está en la rampa de
                colores de esta celda, así que de un vistazo se sabe que ese número es de
                antes. Ver `solarDeNoche`. */}
            <div className="gw seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, marginTop: 3, whiteSpace: 'nowrap',
                                             color: solarDeNoche ? '#fff' : (data?.solar_radiation != null ? solarColor(data.solar_radiation) : undefined) }}>
              {solarDeNoche ? decNum((solarMaxDia as number).toFixed(0))
                : data?.solar_radiation != null ? decNum(data.solar_radiation.toFixed(0)) : '--'}
            </div>
            {/* La unidad DEBAJO, como el km/h del óvalo: en línea se comía el ancho que
                necesitan las cuatro cifras del caso peor. De noche este renglón es el que
                dice "MÁXIMO", también en blanco: rótulo y cifra van juntos. */}
            <div className="u" style={{ fontSize: 14, lineHeight: 1, marginTop: 2,
                                        color: solarDeNoche ? '#fff' : 'var(--w)' }}>
              {solarDeNoche ? 'MÁXIMO' : 'W/m²'}
            </div>
            {/* Barra al pie con `marginTop: auto`, que se come el aire sobrante y la pega
                abajo sin fijarla en absoluto. Escala a 1000 W/m²: el pico despejado a
                esta latitud y altitud ronda esa cifra, así que un mediodía limpio llena
                la barra y el ojo aprende el tope en un día. */}
            <div style={{ marginTop: 'auto', width: '100%', paddingTop: 4 }}>
              {/* Sin `hint`: las bandas de SOLAR son tonos ANÁLOGOS --amarillo, ámbar,
                  naranja, rojo-- y apagadas al 15% se funden en una mancha parduzca, así
                  que el riel no leía como escala sino como una barra llena de color
                  apagado. En UV e IMECA sí se dibuja, porque sus tonos son distintos entre
                  sí y ahí el fantasma de la escala se entiende. El relleno sigue usando
                  las cinco bandas, que es lo que hace que el riel y el dígito cambien de
                  color juntos. */}
              {/* El riel sigue a la cifra que se está mostrando: con el máximo arriba y el riel
                  vacío, los dos se contradirían. */}
              <LevelBar value={solarDeNoche ? solarMaxDia : data?.solar_radiation} max={1000} bands={SOLAR_BANDS} hint={false} />
            </div>
          </div>
          <div className="cell derivada" data-nav={CONSOLA_NAV.solar} style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: alertaCol('uv', 'var(--w)'), fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>UV</div>
            {/* Mismo cambio de noche que en SOLAR: el máximo del día, en blanco puro. */}
            <div className="gw seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, marginTop: 3, whiteSpace: 'nowrap',
                                             color: uvDeNoche ? '#fff' : (data?.uv_index != null ? uvColor(data.uv_index) : undefined) }}>
              {uvDeNoche ? Math.round(uvMaxDia as number) : (data?.uv_index ?? '--')}
            </div>
            {/* El NIVEL en el renglón donde SOLAR pone su unidad, y con su mismo formato
                --blanco, 14 px-- porque hace el mismo papel: decir qué significa la cifra
                de encima. En SOLAR la respuesta es la unidad; aquí un número desnudo no
                dice nada a nadie que no se sepa los cortes de la OMS de memoria, y el
                riel de abajo los enseña pero sin nombrarlos.
                En BLANCO y no en el color del nivel, que era la otra opción: el color ya
                lo llevan el dígito y el riel, y una tercera cosa del mismo tono convertía
                la celda en un bloque naranja. El blanco lo deja como lo que es, una
                etiqueta.
                Los cortes salen de `uvLabel` (weather.ts), la misma función que usa la
                tarjeta de Inicio y con los mismos umbrales que `uvColor` de este archivo:
                así el dígito naranja nunca puede coincidir con la palabra "Alto".
                CUERPO 13 y no los 14 del "W/m²" de SOLAR, y es una medida, no un gusto: el
                interior de esta celda son 68.0 px y "MODERADO" --que es el caso de casi
                cualquier mañana, no un extremo raro-- mide 68.2 a cuerpo 14. A 13 baja a
                63.4 y quedan 4.6 px de holgura. La diferencia de un píxel entre celdas
                vecinas no se ve; una palabra recortada sí, que es el mismo criterio con el
                que las cifras de esta fila se quedaron en 38 en vez de 40. IMECA lleva el
                13 también, aunque le sobre sitio, para que las dos CATEGORÍAS pesen igual
                entre sí --lo de SOLAR es una unidad, otra cosa--. */}
            {/* De noche el nivel en palabras cede su renglón al rótulo MÁXIMO, en blanco como
                la cifra. "MÁXIMO" mide ~55 px a cuerpo 13 y el interior de esta celda son 68,
                así que entra igual que "MODERADO", que es el caso peor de los niveles. */}
            {uvDeNoche ? (
              <div className="u" style={{ fontSize: 13, color: '#fff', lineHeight: 1, marginTop: 2, whiteSpace: 'nowrap' }}>
                MÁXIMO
              </div>
            ) : data?.uv_index != null && (
              <div className="u" style={{ fontSize: 13, color: 'var(--w)', lineHeight: 1, marginTop: 2, whiteSpace: 'nowrap' }}>
                {uvLabel(data.uv_index).toUpperCase()}
              </div>
            )}
            {/* Escala a 12: es donde acaba la escala UV de la OMS (11+ ya es "extremo",
                el tramo fucsia de `uvColor`), así que la barra llena coincide con el
                color más alto y las dos señales dicen lo mismo. */}
            <div style={{ marginTop: 'auto', width: '100%', paddingTop: 4 }}>
              <LevelBar value={uvDeNoche ? uvMaxDia : data?.uv_index} max={12} bands={UV_BANDS} />
            </div>
          </div>
          {/* ICA en el sitio que dejó la luna. El color lo decide el backend
              según la categoría de la norma, así que el número se lee de un
              vistazo sin tener que recordar los cortes. */}
          <div className="cell derivada" data-nav={CONSOLA_NAV.solar} style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            {/* IMECA y no "ICA": el número que muestra esta celda SIEMPRE ha sido el
                IMECA --se pide a /api/airquality/imeca-- y el rótulo se había quedado
                con el nombre genérico. Nombrarlo bien importa porque el IMECA tiene sus
                propios cortes, que son los que dibuja el riel de abajo. */}
            <div style={{ color: 'var(--w)', fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>IMECA</div>
            <div className="gw seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, marginTop: 3, whiteSpace: 'nowrap', color: imeca?.color || undefined }}>
              {imeca?.available && imeca.imeca != null ? imeca.imeca : '--'}
            </div>
            {/* La CATEGORÍA en el mismo renglón y formato que el nivel de UV y que la
                unidad de SOLAR. La manda el backend en `category` (`imeca.py`), que es de
                donde sale también el color del dígito: derivarla aquí de los cortes sería
                una segunda tabla que puede desincronizarse de la que colorea. */}
            {imeca?.available && imeca.category && (
              <div className="u" style={{ fontSize: 13, color: 'var(--w)', lineHeight: 1, marginTop: 2, whiteSpace: 'nowrap' }}>
                {imecaLabel(imeca.category)}
              </div>
            )}
            {/* Escala a 200 IMECA: es el tope que la norma mexicana considera "muy mala"
                y el techo que esperamos no ver nunca, el mismo con el que se
                dimensionaron las tres cifras de esta celda. */}
            <div style={{ marginTop: 'auto', width: '100%', paddingTop: 4 }}>
              <LevelBar value={imeca?.available ? imeca.imeca : null} max={200} bands={IMECA_BANDS} />
            </div>
          </div>
        </div>

        {/* Sensor INTEGRADO del gateway remoto, que mide bajo techo. Esta celda es FIJA a
            él: antes se disfrazaba --si el WN32 reportaba mostraba el exterior y cambiaba
            su propio rótulo-- porque era la única celda para los dos sensores de allá. Con
            la celda de la fila 3 ya no hace falta, cada sensor tiene la suya.
            Cuál de las dos es cada una lo dice el RELLENO de la casa, no el rótulo: las
            tres celdas remotas se llaman igual (ver la nota de la primera). */}
        <div className="cell col remota" data-nav={CONSOLA_NAV.remota}>
          <div style={{ color: alertaCol('remotaInt', 'var(--w)'), fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA</div>
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
          {/* gap 16 / marginTop -10, los de INTERIOR y JARDÍN: esta celda y la del WN32
              son pareja y las cuatro celdas de temperatura+humedad se maquetan igual. */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: -10 }}>
            <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
              {remoteInT != null ? decNum(u.temp(remoteInT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
            </span>
            <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
              {remoteInH != null ? remoteInH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
            </span>
          </div>
        </div>

        {/* Fila 5 */}
        <div className="cell col jardin" data-nav={CONSOLA_NAV.jardin}>
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

        {/* Sangría vertical de 4 y no los 9 de `.cell`: son 10 px de alto que necesita el
            aviso cuando ocupa DOS renglones. Cuentas medidas sobre la captura --interior de
            99 px-- : el texto a dos líneas pide 28, la fila del reloj 53 y su separación 6, o
            sea 87 de los 93 que quedan con esta sangría de 3. Con la de 9 sólo había 81 y el
            segundo renglón se salía por abajo.
            La fila del reloj medía 55 y no 53 porque la mandaba la CAJA DE LÍNEA de los dígitos
            de 46 px (1.2 de interlineado por defecto), no su tinta; con `lineHeight: 1` la caja
            se ajusta al dibujo y esos 2 px se van al aire de arriba, que es donde se notan. */}
        <div className="cell reloj" data-nav={CONSOLA_NAV.reloj} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3px 12px' }}>
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
          {/* Orden de prioridad del renglón: primero la CAÍDA de la estación, luego las
              ALERTAS vivas, y si no hay nada el nombre. La caída manda porque cuando no
              llega dato las alertas se evalúan sobre lecturas congeladas, así que anunciar
              "Temperatura alta" de un dato de hace una hora sería peor que no decir nada. */}
          {stale ? (
            /* El triángulo va en SVG y no como emoji ⚠: el Chromium del renderer corre
               en un contenedor sin fuente de emoji en color, y ahí el carácter saldría
               como un cuadro vacío. Todos los demás iconos de la consola ya son SVG por
               la misma razón. */
            <div style={{ color: 'var(--alarma)', fontSize: 16, fontWeight: 800, letterSpacing: 1, lineHeight: 1, marginTop: -2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <WarnGlyph />
              SIN DATOS · {staleMin} MIN
            </div>
          ) : alertas.length > 0 ? (
            /* Mismo triángulo y mismo rojo que la caída: para quien mira la pantalla las
               dos cosas son "algo va mal", y el texto ya dice cuál.
               Cuerpo 13 y hasta dos renglones: los mensajes del motor son frases enteras
               ("Presión cayendo 2.3 hPa/60min (fuerte) - posible tormenta") y en los 312 px
               de esta celda no entran en uno. La celda tiene sitio: el renglón del nombre
               mide 16 px y hasta el reloj hay ~30 libres.
               Con varias alertas se muestra la PRIMERA y se cuentan las demás: elegir "la
               más grave" no es posible sin inventar un orden --el motor no expone nivel--,
               y el "+N" al menos dice que hay más y que hay que ir a la web. */
            /* SIN el `marginTop: -2` que lleva el renglón del nombre: ese medio píxel de
               subida vale para una línea sola, pero el aviso ocupa dos y su tinta acababa a
               6 px del borde de arriba --medido--, o sea metida en la sangría de 9. */
            <div style={{ color: 'var(--alarma)', fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
                          lineHeight: 1.08, display: 'flex', alignItems: 'flex-start',
                          justifyContent: 'center', gap: 6, textAlign: 'left' }}>
              <div style={{ marginTop: 1 }}><WarnGlyph /></div>
              {/* Hasta DOS renglones. Con uno solo se cortaban mensajes de todos los días --el
                  rótulo de la estación entre corchetes ya se come media línea-- y con dos entran
                  completos: 13 px de cuerpo por ~288 de ancho son unos 50 caracteres por
                  renglón. El tope de dos es a propósito y no un descuido: un tercero volvería a
                  empujar el reloj fuera de la celda, así que si algún mensaje se pasa, se recorta
                  con puntos suspensivos (`WebkitLineClamp`, que es lo que Chromium entiende y
                  esto se dibuja en Chromium).
                  `minWidth: 0` es lo que permite que un hijo de flex se recorte en vez de
                  estirar la caja. */}
              <span style={{ minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2,
                             WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {textoAlerta(alertas[0].message)}
                {alertas.length > 1 && ` · +${alertas.length - 1}`}
              </span>
            </div>
          ) : (
            <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: 1.5, textAlign: 'center', marginTop: -2 }}>
              Estación Clima XE1E
            </div>
          )}
          {/* `marginTop` 6 y no 4: dos píxeles más de separación con el aviso, que ahora puede
              ocupar dos renglones y quedaba muy pegado al reloj. */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 26, marginTop: 6 }}>
            <div className="gw seg" style={{ fontSize: 46, fontWeight: 800, lineHeight: 1 }}>{pad(now.getHours())}:{pad(now.getMinutes())}</div>
            <div style={{ textAlign: 'center', lineHeight: 1.02 }}>
              <div className="gw" style={{ fontSize: 26, fontWeight: 800 }}>{DIAS_CORTO[now.getDay()].toUpperCase()}</div>
              <div className="gw" style={{ fontSize: 26, fontWeight: 800 }}>{now.getDate()} {MESES_CORTO[now.getMonth()]}</div>
            </div>
          </div>
        </div>

        <div className="cell col remota" data-nav={CONSOLA_NAV.remotaP}>
          {/* "REMOTA" y no "PRESIÓN REMOTA": lo que mide esta celda lo dicen el barómetro
              y los hPa, igual que arriba lo dicen el termómetro y los °C. Es como funciona
              el resto de la consola desde que EXT, HUMEDAD, PRES y LLUVIA se quedaron sin
              rótulo, y lo que hace que las tres celdas de allá se lean como un bloque. */}
          <div style={{ color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA</div>
          {/* El mismo barómetro redondo que la celda PRES, en el mismo sitio y tamaño:
              las dos muestran presión y ahora se reconocen como pareja sin leer el
              rótulo. Aquí sobra el hueco que allá ocupa el riel de tendencia. */}
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <MeteoGlyph name="barometer" size={46} color={alertaCol('remotaP', '#8b5cf6')} title="presión" />
          </div>
          {/* Aviso de esta celda, con el mismo sitio y tamaño que en EXT, HUMEDAD y PRES:
              a la izquierda de la flecha y a 30 px. Aquí la lectura SÍ estorbaba de verdad y
              hubo que correrla --ver el `paddingRight` de abajo--: a diferencia de PRES, en
              esta celda el bloque de la cifra cae a media altura, justo donde va el triángulo,
              y su "mb" llegaba hasta x=287 (medido) cuando el triángulo empieza en 268. */}
          {celdasEnAlerta.has('remotaP') && (
            <div style={{ position: 'absolute', top: '50%', right: 38, transform: 'translateY(-50%)' }}>
              <WarnGlyph size={30} />
            </div>
          )}
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)' }}>
            <TrendGlyph trend={remotePressTrend} />
          </div>
          {/* `paddingRight` 57 y no 32: los 25 px de más son el sitio del triángulo de aviso.
              MEDIDO sobre la captura, no calculado: la lectura ocupa de x=117 a x=287 --el
              bloque 267-287 es el "mb"-- y el triángulo empieza en 268, así que hay que dejarla
              acabando bastante antes. A 57 los números decían 6 px de separación y a la vista
              quedaba PEGADO: el "mb" y el triángulo caen a la misma altura --la unidad va con
              `vertical-align: top`-- así que se leían como un solo bloque. Con 66 la lectura va
              de 89 a 253 y quedan 15 px, que ya separan. El barómetro acaba en 56, así que
              todavía le sobran 33 px por la izquierda: aquí hay sitio, al contrario que en
              PRES, porque esta cifra es de cuerpo 46 y no 56. */}
          <div className="big gp ctr rt" style={{ marginTop: 8, fontSize: 46, paddingRight: 66 }}>
            {remote?.pressure_relative != null ? decNum(u.press(remote.pressure_relative, 1)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--p)' }}> {u.pressU}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
