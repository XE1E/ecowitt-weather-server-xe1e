/**
 * Piezas de la réplica de la consola (ConsoleReplica.tsx): glifos, barras, escalas,
 * colores y formatos. Antes vivían en el mismo archivo que el componente (~2,600 líneas).
 */
// Módulo de piezas: exporta componentes JUNTO con colores/constantes/formatos, a propósito.
/* eslint-disable react-refresh/only-export-components */
import { useId, type ReactNode } from 'react'
import { moonIllumination } from '../../../weather'
import moonPhoto from '../../../assets/moon.png'

export const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const MESES_CORTO = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
export const pad = (n: number) => String(n).padStart(2, '0')

// Hora local "HH:MM" de un ISO. Los `min_time`/`max_time` de /api/stats/daily SÍ
// traen offset (+00:00), así que Date los sitúa bien y getHours() devuelve la hora
// local del contenedor, que es la misma que ya muestra el reloj de la consola.
export const hhmm = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// El `timestamp` de /api/current viene en UTC pero SIN sufijo de zona, y un ISO sin
// zona lo interpreta Date como hora LOCAL. Sin añadirle la 'Z' la antigüedad saldría
// desfasada las 6 h del huso: siempre negativa, y la consola nunca se daría por
// caída. Los que ya traen zona (+00:00 o Z) se dejan como están.
export const parseUtc = (s?: string) => {
  if (!s) return null
  const d = new Date(/(Z|[+]\d\d:?\d\d|-\d\d:\d\d)$/.test(s) ? s : `${s}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// Minutos sin lectura nueva tras los que la consola avisa. La estación empuja cada
// ~16 s, así que 5 min son ~19 envíos perdidos: margen de sobra para no dar falsas
// alarmas por un push tardío y aun así enterarse pronto.
export const STALE_MIN = 5
export const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
export const cardinal = (deg?: number) => (deg == null ? '--' : DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16])

// El rumbo se dibuja con sus letras tal cual: la fuente DSEG14 (catorce segmentos) las
// tiene todas a altura completa. Hubo aquí un `seg7()` que cambiaba O→0 y S→5 para
// esquivar los glifos a media altura de DSEG7; sobra desde que existe la clase `.seg14`.

// Geometría del compás ovalado. El aspecto del óvalo es intencional (la consola
// física es más ancha que alta): RX/RY también orientan el marcador de dirección.
export const RX = 49       // óvalo exterior (aro con las marcas de grados)
export const RY = 38
export const RX_IN = 42    // óvalo interior
export const RY_IN = 31

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
export function uvColor(uv: number): string {
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
export const SOLAR_STEPS: { from: number; color: string }[] = [
  { from: 0, color: '#94a3b8' },
  { from: 50, color: '#eab308' },
  { from: 250, color: '#f59e0b' },
  { from: 550, color: '#f97316' },
  { from: 800, color: '#ef4444' },
]
export function solarColor(w: number): string {
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
export const IMECA_CORTO: Record<string, string> = { 'Extremadamente mala': 'Extrema' }
export const imecaLabel = (cat: string) => (IMECA_CORTO[cat] ?? cat).toUpperCase()

// Números de la consola: la parte decimal (".4") en fuente más chica, como una
// consola física. Divide en el punto; si no hay decimal, devuelve el string tal cual.
export function decNum(s: string): ReactNode {
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
export function MoonGlyph({ size = 42, illum, waxing }:
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
      </defs>
      {/* La parte en sombra, en gris cálido y no en el casi negro de antes (#1b1b1b): sobre
          el negro de la celda ese tono no se distinguía del fondo, así que no se veía el
          DISCO completo y la fase se leía como una mancha suelta en vez de como una esfera
          parcialmente iluminada. Con el disco visible, el terminador se nota. */}
      {/* FOTO REAL en vez de manchas dibujadas a mano: las de antes (ver historial) nunca
          pasaban por relieve lunar de verdad, por más que se afinara la mezcla. La textura
          (cráteres, mares, los rayos de Tycho) va con `mix-blend-mode: multiply` ENCIMA del
          degradado de color de cada cara: donde la foto es clara, el multiply casi no toca
          el color de abajo; donde es oscura, lo apaga. Así el color y el relieve esférico
          los sigue dando el degradado (sombra/luz) y la foto sólo aporta el detalle fino.
          `isolation: isolate` en cada grupo es necesario: sin un contexto de mezcla propio,
          el multiply compondría contra lo que hay DETRÁS de todo el SVG en la página (el
          fondo casi negro de la celda), no contra el degradado que se acaba de pintar, y la
          luna saldría casi negra entera. */}
      <g style={{ isolation: 'isolate' }} clipPath={`url(#disco-${uid})`}>
        <circle r={R} fill={`url(#sombra-${uid})`} />
        <image href={moonPhoto} x={-R} y={-R} width={2 * R} height={2 * R}
          preserveAspectRatio="xMidYMid slice" style={{ mixBlendMode: 'multiply' }} />
      </g>
      {!oscura && (
        <g style={{ isolation: 'isolate' }} clipPath={`url(#luzclip-${uid})`}>
          <path d={litPath} fill={`url(#luz-${uid})`} />
          <image href={moonPhoto} x={-R} y={-R} width={2 * R} height={2 * R}
            preserveAspectRatio="xMidYMid slice" style={{ mixBlendMode: 'multiply' }} />
        </g>
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
export const LOC_STROKE = '#94a3b8'
export const LOC_SIZE = 30

// Los dos `path` se rellenan o no según `filled`. Ninguno está cerrado
// explícitamente, pero SVG cierra el contorno al rellenar, así que el del techo da
// el triángulo y el del cuerpo el rectángulo: juntos, la silueta de la casa.
export function HouseGlyph({ size = LOC_SIZE, filled = false }: { size?: number; filled?: boolean }) {
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
export function SignalGlyph({ level, name, height = 13 }: { level: number; name: string; height?: number }) {
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
export function BatteryGlyph({ level, name, showLabel = true }: { level: number; name: string; showLabel?: boolean }) {
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
export const battLevel = (v: unknown): number | null => {
  if (typeof v === 'boolean') return v ? 1 : 0.08
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v <= 1) return v === 0 ? 1 : 0.08
    return Math.max(0.08, Math.min(1, (v - 0.9) / 0.7))
  }
  return null
}

/** Alerta viva tal como la sirve `/api/alerts`: su clave y el mensaje ya redactado. */
export interface AlertaViva { key: string; message: string }

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
export type CeldaAlerta =
  | 'ext' | 'hum' | 'pres' | 'viento' | 'lluvia' | 'rocio' | 'sensacion' | 'solar' | 'uv'
  | 'interior' | 'remotaExtT' | 'remotaExtH' | 'remotaInt' | 'remotaP'

export function celdaDeAlerta(key: string): CeldaAlerta | null {
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
export const sinEmoji = (s: string) =>
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
export const textoAlerta = (msg: string) => sinEmoji(msg).replace(/\s*\([^)]*\)\s*/g, ' ').trim()

export interface DailyRain { date: string; rain: number | null }

// Inicial del día de la semana de una fecha ISO.
// `new Date('2026-08-06')` se interpreta como MEDIANOCHE UTC, y en UTC-6 eso cae en el
// día ANTERIOR: las letras saldrían corridas una posición. Construyendo la fecha por
// partes es local y no hay desfase.
export const dowLetter = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return '?'
  return DIAS_CORTO[new Date(y, m - 1, d).getDay()].charAt(0)
}

// Histograma de la lluvia de los últimos 7 días. Las tres cifras de la celda dicen
// "llueve ahora", "cuánto en este chubasco" y "cuánto va del mes"; esto añade el reparto,
// que es lo que una cifra sola no puede dar: si los 16 mm del mes cayeron de golpe ayer
// o repartidos toda la semana.
export function RainHistogram({ data, fmt }: { data: DailyRain[]; fmt: (mm: number) => string }) {
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

export type Band = { to: number; color: string }

// Bandas de las escalas que SÍ tienen cortes oficiales.
//
// UV: los cinco tramos de la OMS, mismos cortes que `uvColor`.
// IMECA: los cinco de la NADF-009-AIRE-2017. Los colores son los que devuelve el backend
// en `imeca.color` (ver `receiver/app/services/imeca.py`); aquí hace falta la tabla
// COMPLETA y no sólo el color del valor de ahora, porque el riel dibuja toda la escala.
export const UV_BANDS: Band[] = [
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
export const HUMIDEX_BANDS: Band[] = [
  { to: 30, color: '#22c55e' },
  { to: 40, color: '#eab308' },
  { to: 46, color: '#f97316' },
  { to: 54, color: '#ef4444' },
]
export function humidexColor(h: number): string {
  if (h >= 54) return '#d946ef'
  if (h >= 46) return '#ef4444'
  if (h >= 40) return '#f97316'
  if (h >= 30) return '#eab308'
  return '#22c55e'
}

export const IMECA_BANDS: Band[] = [
  { to: 50, color: '#22c55e' },
  { to: 100, color: '#eab308' },
  { to: 150, color: '#f97316' },
  { to: 200, color: '#ef4444' },
]
// SOLAR: las bandas salen de `SOLAR_STEPS`, la misma tabla que colorea el dígito. El
// último tramo se cierra en el tope de la escala (1000 W/m², el pico despejado a esta
// latitud y altitud).
export const SOLAR_BANDS: Band[] = SOLAR_STEPS.map((s, i) => ({
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
export function LevelBar({ value, max, bands, hint = true }:
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
export function SunTimes({ sunrise, sunset }: { sunrise?: string; sunset?: string }) {
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
export const PS_R = 5          // rango del riel, en hPa
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
export const PS_W = 333
// Margen a cada lado DENTRO del viewBox, donde viven el "≤" y el "≥". Era 12, que dejaba
// los símbolos a 2 px del riel: pegados, y montándose sobre sus extremos redondeados. A 18
// quedan 6 px de aire a cada lado.
//
// El precio es que el trazo visible del riel baja de 311 a 297 px y deja de medir lo mismo
// que el histograma de LLUVIA (309 con el borde de 3 px), que era el motivo de haberlo
// ensanchado en su día. Se acepta: que los dos gráficos midan igual es una finura que
// nadie mira, y dos símbolos aplastados contra el borde sí se ven.
export const PS_M = 18
// 34 y no 32: los rótulos se mudan ARRIBA del riel y el puntero ABAJO, así que el
// alto ya no lo fija el texto sino la suma riel + puntero. El puntero mide 13 y su
// punta arranca en y=21 (borde de abajo del riel), o sea que necesita hasta y=34.
// Los 2 px de más se los come el aire de en medio de la celda, no el margen
// inferior (que sigue en `bottom: 4`).
// +12 para el renglón de min/max del día arriba del riel.
//
// 32 y no 30: el min/max subió de 12 a 14 px y a 12 de margen ya no cabía. Con la
// línea base en PS_TOP-1 y una altura de mayúscula de ~0.72 em, 14 px necesitan
// llegar hasta y≈0.9; con PS_TOP=10 el número se salía por arriba del viewBox y
// Chromium lo recortaba. Los 2 px se añaden ARRIBA (PS_TOP) y el alto total los
// acompaña para que el renglón de cifras de abajo no se salga por el otro lado.
export const PS_H = 32
export const PS_TOP = 12  // espacio arriba para min/max

export function PressureScale({ delta, endLabel, imperial, minDay, maxDay }: {
  delta: number | null; endLabel: string; imperial: boolean; minDay?: number | null; maxDay?: number | null
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
      {/* Min/max del día en amarillo arriba del riel. A 14 y no 12: son dos lecturas
          de pleno derecho --la horquilla del día-- y al tamaño anterior se leían como
          una nota al pie. El alto del viewBox va con ellas, ver PS_H. */}
      {minDay != null && (
        <text x={x0} y={PS_TOP - 1} fill="#facc15" fontSize="14" fontWeight="700" textAnchor="start">
          {imperial ? (minDay * 0.0295299830714).toFixed(2) : minDay.toFixed(1)}
        </text>
      )}
      {maxDay != null && (
        <text x={x1} y={PS_TOP - 1} fill="#facc15" fontSize="14" fontWeight="700" textAnchor="end">
          {imperial ? (maxDay * 0.0295299830714).toFixed(2) : maxDay.toFixed(1)}
        </text>
      )}
      {/* Riel compacto: coordenadas ajustadas con offset PS_TOP */}
      <rect x={x0} y={PS_TOP + 2} width={x1 - x0} height={7} rx={3.5} fill="#141414" stroke="#eaeaea" strokeWidth="1" />
      {/* Marcas cada 1 hPa */}
      {Array.from({ length: 2 * PS_R + 1 }, (_, i) => i - PS_R).map((v) => {
        const tx = xOf(v)
        const major = v % PS_R === 0
        return (
          <line key={v} x1={tx} y1={PS_TOP + (major ? 1 : 3)} x2={tx} y2={PS_TOP + (major ? 9 : 7.5)}
            stroke="#eaeaea" strokeWidth={major ? 1.4 : 0.8} />
        )
      })}
      {/* Relleno del centro al valor */}
      {delta != null && Math.abs(x - mid) > 0.5 && (
        <rect x={Math.min(mid, x)} y={PS_TOP + 3.5} width={Math.abs(x - mid)} height={4} fill={color} />
      )}
      {/* Números debajo del riel */}
      {Array.from({ length: 2 * PS_R + 1 }, (_, i) => i - PS_R).map((v) => {
        const t = tickLabel(v)
        return t == null ? null : (
          <text key={v} x={xOf(v)} y={PS_TOP + 18} fill="#eaeaea" fontSize={t.length > 2 ? 7 : 9}
            fontWeight="700" textAnchor="middle">{t}</text>
        )
      })}
      {/* Símbolos ≤ y ≥ pegados al riel */}
      <text x={x0 - 3} y={PS_TOP + 10} fill="#eaeaea" fontSize="13" fontWeight="700" textAnchor="end">{'≤'}</text>
      <text x={x1 + 3} y={PS_TOP + 10} fill="#eaeaea" fontSize="13" fontWeight="700" textAnchor="start">{'≥'}</text>
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
export function WarnGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size * 14 / 16} viewBox="0 0 16 15" style={{ flexShrink: 0 }}>
      <path d="M8 0.5 L15.5 14 L0.5 14 Z" fill="none" stroke="var(--alarma)" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="7.1" y="5" width="1.8" height="5" rx="0.9" fill="var(--alarma)" />
      <rect x="7.1" y="11" width="1.8" height="1.8" rx="0.9" fill="var(--alarma)" />
    </svg>
  )
}

export type Trend = 'up' | 'down' | 'stable'

// Flechita de tendencia (sube / baja / estable) reutilizada por varias celdas.
export function TrendGlyph({ trend, width = 24, height = 28, style }: {
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
