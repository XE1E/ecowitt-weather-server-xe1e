import { useEffect, useRef, useState } from 'react'
import { useStationData } from '../../station-data'
import { useUnits } from '../../units'
import { beaufort, deriveCondition, historicValue, humidexLabel, pressureKind, uvLabel } from '../../weather'
import { useHumidityComfort } from '../../hooks/useHumidityComfort'
import { WeatherIcon } from '../WeatherIcon'
import { MeteoGlyph } from '../MeteoGlyph'
// Tipo compartido de la fila del histórico remoto: declara tanto el sensor
// integrado del GW1100 (*_indoor) como el WN32 exterior (*_outdoor). Antes había
// aquí una copia local que solo tenía los _indoor.
import type { RemoteHistRow } from '../../remote'
// Amanecer/atardecer: no se calculan en local como la fase lunar, vienen del
// pronóstico (Open-Meteo a través de nuestro backend, que además lo cachea).
import { type AstroData, type ForecastHour } from '../../forecast'
import { LOCATION } from '../../config'
// El CSS vive aparte desde que las páginas de detalle del kiosco --a las que se
// llega tocando una celda de aquí-- comparten su estética.
import { CONSOLE_CSS } from './console-css'
// Qué celda lleva a qué pantalla. Sólo las claves: los rectángulos se miden del DOM.
import { CONSOLA_NAV } from '../../kiosk-nav'
import { useNavZones, NavDebugOverlay } from '../../pages/kiosk/nav-zones'
import { pollWhileVisible } from '../../poll'
import type { Imeca as ImecaData } from '../../api-types'
import {
  DIAS_CORTO,
  MESES_CORTO,
  pad,
  hhmm,
  parseUtc,
  STALE_MIN,
  cardinal,
  RX,
  RY,
  RX_IN,
  RY_IN,
  uvColor,
  solarColor,
  imecaLabel,
  decNum,
  MoonGlyph,
  HouseGlyph,
  SignalGlyph,
  BatteryGlyph,
  battLevel,
  AlertaViva,
  CeldaAlerta,
  celdaDeAlerta,
  textoAlerta,
  DailyRain,
  RainHistogram,
  UV_BANDS,
  HUMIDEX_BANDS,
  humidexColor,
  IMECA_BANDS,
  SOLAR_BANDS,
  LevelBar,
  SunTimes,
  PS_R,
  PressureScale,
  WarnGlyph,
  Trend,
  TrendGlyph,
} from './console/parts'
// Glifos, barras, escalas, colores y formatos: en ./console/parts.tsx.

/**
 * Réplica de la consola física Ecowitt (rejilla 3×5, 1024×600).
 *
 * ÚNICA fuente de la vista: la usan la página `?page=consola` del kiosco (que
 * el renderer captura para el display ESP32-S3) y el tab "Consola" del
 * dashboard. Antes estaba duplicada en los dos archivos y cada ajuste visual
 * había que aplicarlo dos veces a mano; ahora se toca sólo aquí.
 */


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

export function ConsoleReplica({ mode = 'page', ready = true }: Props) {
  const { data, history, stats, ownForecast, localForecast, forecast, forecastTried } = useStationData()
  const u = useUnits()
  // Contenedor raíz: de él cuelgan las celdas con `data-nav` que se miden para el
  // mapa de zonas del display.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [imeca, setImeca] = useState<ImecaData | null>(null)
  const [remote, setRemote] = useState<Record<string, number> | null>(null)
  const [remoteHistory, setRemoteHistory] = useState<RemoteHistRow[]>([])
  // Astronomía y horas del pronóstico: del proveedor (station-data), que ya lo pide
  // cada 30 min. Antes la consola lo pedía otra vez por su cuenta.
  const astro: AstroData | null = forecast?.astro ?? null
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
  const horas: ForecastHour[] = forecast?.hours ?? []
  // ¿La celda de sol y luna abre la cámara? Lo decide el toggle del admin
  // (kiosk_camera_enabled). Por defecto sí; si el fetch falla o tarda, se mantiene el
  // comportamiento normal --mostrar la cámara-- que es el caso común.
  const [camaraKiosco, setCamaraKiosco] = useState(true)
  useEffect(() => {
    fetch('/api/kiosk/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j.camera_enabled === 'boolean') setCamaraKiosco(j.camera_enabled) })
      .catch(() => {})
  }, [])

  // La consola muestra HH:MM (sin segundos): basta con avanzar al cambiar el minuto.
  // Antes era cada segundo y redibujaba las ~2,600 líneas del componente 60 veces
  // por minuto (también en el kiosco).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const siguiente = () => {
      t = setTimeout(() => { setNow(new Date()); siguiente() }, 60000 - (Date.now() % 60000) + 50)
    }
    siguiente()
    return () => clearTimeout(t)
  }, [])

  // Estación remota (GW1100): valores actuales…
  useEffect(() => {
    const load = () => fetch('/api/current?station=gw1100').then((r) => (r.ok ? r.json() : null))
      .then(setRemote).catch(() => {})
    return pollWhileVisible(load, 30000)
  }, [])
  // …e histórico corto, para calcular sus tendencias.
  useEffect(() => {
    const load = () => fetch('/api/history?start=-4h&station=gw1100').then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setRemoteHistory(j.data || [])).catch(() => {})
    return pollWhileVisible(load, 60000)
  }, [])

  // Lluvia diaria de la semana, para el histograma. Cada 10 min: el único día que
  // puede cambiar es hoy, y su barra no necesita ir al segundo.
  useEffect(() => {
    const load = () => fetch('/api/rain/daily?days=7').then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.data) setRain7(j.data) }).catch(() => {})
    return pollWhileVisible(load, 10 * 60000)
  }, [])

  // El pronóstico lo trae el proveedor; aquí sólo se marca que ya se intentó.
  useEffect(() => {
    if (forecastTried) setCargado((c) => (c.fc ? c : { ...c, fc: true }))
  }, [forecastTried])

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
    return pollWhileVisible(load, 30 * 60000)
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
    return pollWhileVisible(load, 60000)
  }, [])

  // ICA (IMECA estimado). Se pide aparte porque no va en el contexto de la
  // estación: es un dato externo. Cada 30 min, como su caché en el servidor.
  useEffect(() => {
    const load = () => fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setImeca).catch(() => {})
      .finally(() => setCargado((c) => (c.imeca ? c : { ...c, imeca: true })))
    return pollWhileVisible(load, 30 * 60000)
  }, [])

  // Condición actual: SIEMPRE usar deriveCondition (basado en sensores).
  // El consenso del backend solo aporta storm_approaching, no anula los sensores.
  const cond = (() => {
    if (!data) return { icon: '', label: '', stormApproaching: false, source: 'none' }

    // Contexto extendido para deriveCondition: tendencia de presión + código
    // WMO de la hora más cercana (respaldo cuando el sensor no puede opinar:
    // sol bajo o de noche, ver weather.ts).
    const nowMs = Date.now()
    let horaCercana: ForecastHour | undefined
    let mejorDiff = Infinity
    for (const h of horas) {
      const diff = Math.abs(new Date(h.time).getTime() - nowMs)
      if (diff < mejorDiff) { mejorDiff = diff; horaCercana = h }
    }
    const condCtx = {
      pressureDelta3h: localForecast?.delta_3h,
      forecastCode: mejorDiff < 90 * 60 * 1000 ? horaCercana?.code : undefined,
      cloudCoverPct: mejorDiff < 90 * 60 * 1000 ? horaCercana?.cloudCover : undefined,
      precipProb: mejorDiff < 90 * 60 * 1000 ? horaCercana?.precipProb : undefined,
    }
    const derived = deriveCondition(data, condCtx)

    // Solo tomar la señal de tormenta de "nuestro pronóstico" (estación +
    // cámara + vecinas, ver forecaster.own_forecast) -- NO del
    // consenso con Open-Meteo/WeatherAPI, que quedó fuera de esta decisión.
    const stormApproaching = ownForecast?.storm_likely ?? false

    return { ...derived, stormApproaching, source: 'sensor' }
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
  /**
   * ¿Está lloviendo AHORA? Lo usan la gota de la celda de LLUVIA --hueca o maciza-- y
   * el badge de pronóstico de PRES, que antes lo calculaba por su cuenta. Un solo sitio
   * para que el icono y el texto no puedan decir cosas distintas.
   *
   * PROVISIONAL: `rain_rate > 0` es lo que se puede saber hoy, y falla justo en el caso
   * que motiva el detector de lluvia --la llovizna que no llega a voltear el balancín--.
   * Cuando el detector exista, se cambia aquí y lo heredan los dos sitios.
   */
  const lloviendo = (data?.rain_rate ?? 0) > 0

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
  const pDay = stats?.pressure_relative     // …y para PRES, min/max en el riel

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

  // Caritas de confort de humedad, con histéresis propia por celda (ver el hook):
  // EXTERIOR y JARDÍN comparten tabla (sensación térmica), INTERIOR usa la de
  // ASHRAE 55, más estricta.
  const extComfort = useHumidityComfort(data?.humidity_outdoor, 'exterior')
  const intComfort = useHumidityComfort(data?.humidity_indoor, 'interior')
  const jardinComfort = useHumidityComfort(sHum, 'exterior')

  // Marcador de dirección del viento. Recorre la ELIPSE: antes giraba sobre un
  // CÍRCULO, así que en el N sobresalía del óvalo y en el E quedaba flotando muy
  // adentro. Ahora la punta va sobre el óvalo INTERIOR (posición paramétrica) y el giro
  // sigue la NORMAL al borde, para que apunte perpendicular al óvalo en
  // cualquier rumbo. El puntero es corto y chato, apuntando hacia el centro.
  const windMarker = (() => {
    if (dir == null) return null
    const t = (dir * Math.PI) / 180
    const x = 50 + RX_IN * Math.sin(t)
    const y = 40 - RY_IN * Math.cos(t)
    const rot = (Math.atan2(RY * Math.sin(t), RX * Math.cos(t)) * 180) / Math.PI
    return (
      <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)})`}>
        <polygon points="0,0 -4.8,7 0,5 4.8,7" fill="#22c55e" />
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
            <span className="gy seg" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
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
                    cx={50 + RX * Math.cos(rad)} cy={40 + RY * Math.sin(rad)}
                    r={2.2} fill="#ef4444" fillOpacity="0.95"
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
          {/* Casa hueca = sensor exterior, igual que en EXT */}
          <div style={{ position: 'absolute', top: 6, right: 6 }} title="sensor exterior">
            <HouseGlyph />
          </div>
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
          {/* Carita de confort de la humedad relativa: va en el hueco que sobra entre
              el valor (que aquí acaba mucho antes que en EXT, ver la nota de arriba
              sobre "60 px libres") y el aviso/flecha, que arrancan en right:38. A
              right:56 queda pegada a ese lado del hueco --lejos del valor-- aunque
              rocen el triángulo de aviso si llega a encenderse, que es el caso raro.
              Sólo en EXTERIOR: es la única de las dos humedades con flecha de
              tendencia, que es donde se pidió que fuera "de buen tamaño". */}
          {extComfort && (
            <div style={{ position: 'absolute', top: 'calc(50% - 3px)', right: 56, transform: 'translateY(-50%)', fontSize: 34, lineHeight: 1 }}
                 title={extComfort.label}>
              {extComfort.emoji}
            </div>
          )}
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
            <MeteoGlyph name="barometer" size={46} color={alertaCol('pres', '#7f00b2')} title="presión" />
          </div>
          {/* REL/ABS pegado al borde de arriba del barómetro (que aquí cae en y≈27,
              ver la nota de arriba sobre el `bottom:30`): dice si esta lectura es la
              corregida a nivel del mar o el crudo del aparato. Ver `pressureKind`. */}
          {(() => {
            const kind = pressureKind(data?.pressure_relative, data?.pressure_absolute)
            return kind && (
              <div style={{ position: 'absolute', top: 14, left: 12, width: 46, textAlign: 'center',
                            color: 'var(--w)', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1 }}>
                {kind}
              </div>
            )
          })()}
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
            let icon = '🌤️', text = 'Estable'
            // Prioridad 1: si está lloviendo, decirlo. Misma fuente que la gota de la
            // celda de LLUVIA (`lloviendo`), para que no puedan contradecirse.
            if (lloviendo) { icon = '🌧️'; text = 'Lloviendo' }
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
            <PressureScale delta={pressDelta} endLabel={pressEndLabel} imperial={u.pressU === 'inHg'} minDay={pDay?.min} maxDay={pDay?.max} />
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
          {/* La gota dice SI LLUEVE AHORA, no cuánto: hueca cuando no cae nada, maciza
              mientras llueve. Es el único sitio de la celda que responde a esa pregunta
              --las tres cifras son acumulados y una tasa-- y se lee de un vistazo desde
              lejos, que es para lo que está el kiosco.

              De momento lo decide `rain_rate > 0`, que es lo que hay. Su límite conocido
              es el mismo que motiva el detector de lluvia: con llovizna fina el balancín
              no bascula, la tasa se queda en 0 y la gota seguirá hueca aunque esté
              cayendo agua. Cuando el detector esté en marcha, esta condición pasa a ser
              él --con el `precipitation_visible` de la cámara como apoyo-- y este es el
              único punto que hay que tocar. Ver docs/internal/PLAN-DETECTOR-LLUVIA.md. */}
          {/* 48 y no 44, y a 10/14 en vez de 12/16: la caja de tinta de `raindrops` creció
              6 unidades en cada eje para dejarle sitio al trazo del contorno (ver TINTA en
              MeteoGlyph). A igualdad de `size` eso encogería el dibujo un 8 %, así que el
              tamaño sube en la misma proporción --48/71 = 44/65-- y el sitio se corre 2 px
              arriba y a la izquierda, que son las 3 unidades de aire nuevas. Resultado: las
              gotas se ven exactamente donde y como estaban, pero sin recortarse. */}
          <div style={{ position: 'absolute', top: 14, left: 4, overflow: 'visible' }}>
            <MeteoGlyph name="raindrops" size={48} color={alertaCol('lluvia', '#38bdf8')}
              title={lloviendo ? 'lluvia' : 'sin lluvia'} outline={!lloviendo} />
          </div>
          {/* Tres valores con etiqueta, igual que PROMEDIO/RÁFAGA en la celda del
              viento: 24 H es lo caído en las últimas 24h (`rain_24h`), TASA la
              intensidad de ahora en mm/h (`rain_rate`) y MES el acumulado mensual.
              Sin etiqueta, tres cifras de lluvia son indistinguibles entre sí.

              Se usaba EVENTO (`rain_event`), pero su reset depende de la consola Ecowitt
              (~24h sin lluvia) y en la práctica confundía más de lo que ayudaba. Luego
              fueron 2 HORAS, que en la práctica pasaba demasiado tiempo en cero para
              merecer un tercio de la celda.

              Es la ventana MÓVIL de 24 h, no `rain_daily`: el diario se reinicia a
              medianoche, así que a las 00:30 diría casi cero aunque hubiera llovido
              toda la tarde. Lo calcula el servidor integrando `rain_rate`. */}
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
              la izquierda para dejarle su hueco a la gota.

              Con 24H/TASA en dos enteros y MES en tres, las tres cifras no cabían: se
              recortaban contra el borde derecho. El sobrante era pequeño (medio dígito,
              ~12 px sobre 309 de ancho útil), así que en vez de tocar el tamaño de la
              fuente se pegan los dos bordes: la gota sube de left:10 a left:4 y este
              padding baja de 48 a 42 en la misma proporción (mismo margen relativo con
              el borde de la gota que ya se veía bien), el padding derecho pasa de 4 a 0
              y el gap entre las tres columnas de 8 a 4. Se recuperan 18 px. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 4, paddingLeft: 42, paddingRight: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>24 H</div>
              <div className="gr seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, marginTop: 7 }}>
                {decNum(u.rain(data?.rain_24h))}<span className="u" style={{ fontSize: 14, color: 'var(--r)' }}>{u.rainU}</span>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--w)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>TASA</div>
              <div className="gr seg" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, marginTop: 7 }}>
                {decNum(u.rain(data?.rain_rate))}<span className="u" style={{ fontSize: 14, color: 'var(--r)' }}>/h</span>
              </div>
            </div>
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
            HUMIDEX se calcula a cualquier temperatura desde 2026-09-11 (ver
            calculate_derived_values); con frío sale cerca de la temperatura, no "--". */}
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
            <div className="gy seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, margin: 'auto 0',
                                             whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
              {decNum(u.temp(data?.dew_point))}<span className="u" style={{ fontSize: 15, color: 'var(--y)' }}>{u.tempU}</span>
            </div>
          </div>
          {/* Rótulo arriba y valor centrado en lo que queda, como ROCÍO. */}
          <div className="cell main" data-nav={CONSOLA_NAV.derivadas}
            style={{ padding: '8px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
            <div style={{ color: alertaCol('sensacion', 'var(--w)'), fontSize: 16, fontWeight: 700, letterSpacing: 1, lineHeight: 1 }}>SENSACIÓN</div>
            <div className="gy seg" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, margin: 'auto 0',
                                             whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
              {decNum(u.temp(data?.feels_like))}<span className="u" style={{ fontSize: 15, color: 'var(--y)' }}>{u.tempU}</span>
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
            {/* Mismo trato que el MÁXIMO de SOLAR y UV: negrita y 2 px más abajo. El
                desplazamiento va en los dos estados --también cuando muestra el nivel en
                palabras-- para que el rótulo no salte de sitio al conmutar. */}
            {(data?.humidex != null || humidexDeAyer) && (
              <div className="u" style={{ fontSize: 12, lineHeight: 1, marginTop: 5, whiteSpace: 'nowrap',
                                          fontWeight: 800,
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
          <div className="cell derivada" data-nav={CONSOLA_NAV.condiciones}
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
                La descripción va a su derecha, alineada a la izquierda y en hasta tres
                renglones --"NOCHE PARCIALMENTE NUBLADA (CAMBIANDO)" cabe--. El icono a 56 px
                y el texto a 12 px con lineHeight 1.15 dejan espacio para las 3 filas sin
                salirse de la celda. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          width: '100%', marginTop: 2, marginBottom: -8 }}>
              <span style={{ flexShrink: 0 }}>
                <WeatherIcon name={cond.icon} size={56} className="weather-main-icon" />
              </span>
              <div style={{ color: '#fff', fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: 0.4, lineHeight: 1.15, textAlign: 'left', minWidth: 0 }}>
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
                temperatura va en NARANJA (convención del proyecto para temperaturas), la
                hora en blanco y la probabilidad en el AZUL DE LA LLUVIA (`--r`), el mismo
                de la celda de LLUVIA y de su histograma. */}
            {proximas.length > 0 && (
              <div style={{ marginTop: 'auto', marginBottom: 4, display: 'flex', width: '100%' }}>
                {proximas.map((h) => (
                  <div key={h.time} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                    {/* La hora, sin minutos: son horas en punto del pronóstico.
                        En BLANCO porque es información esencial --sin ella las tres cifras de su
                        columna no significan nada--. La temperatura va en naranja (convención del
                        proyecto) para distinguirla visualmente. */}
                    <div style={{ color: 'var(--w)', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
                      {new Date(h.time).getHours()}
                    </div>
                    <div style={{ color: '#f97316', fontSize: 19, fontWeight: 800, lineHeight: 1.02 }}>
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
          {/* Esta celda es la que abre la CÁMARA. Si el toggle del admin la tiene
              apagada cae al pronóstico, que es a donde llevaba antes: así la celda
              nunca queda sin destino. */}
          <div className="cell derivada" data-nav={camaraKiosco ? CONSOLA_NAV.luna : CONSOLA_NAV.condiciones} style={{ padding: '4px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
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
          <div style={{ position: 'absolute', top: 6, left: 12, color: celdasEnAlerta.has('remotaExtT') || celdasEnAlerta.has('remotaExtH') ? 'var(--alarma)' : 'var(--w)',
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
          {/* Lecturas centradas verticalmente */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: 20 }}>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gt seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutT != null ? decNum(u.temp(remoteOutT)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--t)' }}>{u.tempU}</span>
              </span>
              <TrendGlyph trend={remoteOutTempTrend} width={20} height={24} style={{ position: 'absolute', top: 18, right: -4 }} />
            </span>
            <span style={{ position: 'relative', paddingRight: 16 }}>
              <span className="gh seg" style={{ fontSize: 46, fontWeight: 800 }}>
                {remoteOutH != null ? remoteOutH.toFixed(0) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--h)' }}>%</span>
              </span>
              <TrendGlyph trend={remoteOutHumTrend} width={20} height={24} style={{ position: 'absolute', top: 18, right: -4 }} />
            </span>
          </div>
        </div>

        {/* Fila 4 */}
        <div className="cell col main" data-nav={CONSOLA_NAV.interior}>
          <div style={{ position: 'absolute', top: 6, left: 12, color: alertaCol('interior', '#fbbf24'), fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>INTERIOR</div>
          {/* Casa RELLENA = bajo techo. Este es el tamaño (30) que ahora usan las
              cuatro celdas con glifo de ubicación. */}
          <div style={{ position: 'absolute', top: 6, right: 8 }}>
            <HouseGlyph filled />
          </div>
          {/* Carita de confort de la humedad interior, debajo de la casita: esta celda
              no lleva flecha de tendencia, así que no hay hueco "entre valor y flecha"
              como en HUMEDAD --el sitio libre es este, bajo el glifo de ubicación,
              mismo criterio de columna que ya usa la señal RF en EXT.
              top:60 y no top:40: la casita ocupa hasta y≈36 y la celda acaba en
              y≈103 (misma altura que JARDÍN); 55 la deja un pelín más arriba que el
              centro exacto del hueco, que a ojo quedaba mejor que 60. */}
          {intComfort && (
            <div style={{ position: 'absolute', top: 55, right: 8, fontSize: 22, lineHeight: 1 }}
                 title={intComfort.label}>
              {intComfort.emoji}
            </div>
          )}
          {/* Lecturas centradas verticalmente */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: 20 }}>
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
            {/* El rótulo MÁXIMO en BLANCO PURO, igual que la cifra que acompaña, y en
                negrita. El blanco es lo que dice "esto no es una lectura viva": no está en
                la rampa de colores de la celda, así que de un vistazo se sabe que ese
                número es de antes. Rótulo y cifra van juntos. Mismo criterio en UV y
                HUMIDEX.

                Se probó en rojo, primero `--red` (#ff4128) y luego el rojo puro (#ff1414),
                y se descartó: el anaranjado se confundía con el ámbar de la propia celda, y
                el puro desentonaba con el resto de la consola. El blanco ya cumple su
                trabajo; lo que le faltaba al rótulo era peso, no color.

                PESO 800 SIEMPRE, no sólo cuando dice MÁXIMO. La clase `.u` trae 700, así
                que un 800 suelto en un estado hacía que el rótulo cambiara de grosor al
                conmutar, y dejaba a MÁXIMO más gordo que el REGULAR de IMECA de al lado.
                Los cuatro rótulos de lectura --W/m² y MÁXIMO en SOLAR, el nivel de UV, la
                categoría de IMECA y el de HUMIDEX-- van al mismo peso pase lo que pase. */}
            <div className="u" style={{ fontSize: 14, lineHeight: 1, marginTop: 4,
                                        fontWeight: 800,
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
                63.4 y quedan 4.6 px de holgura. OJO: esa medida es a peso 700; los
                rótulos pasaron a 800 y Roboto Condensed ensancha un 1-2 % al subir de
                grosor, o sea ~1 px sobre "MODERADO". Sigue entrando, pero la holgura baja
                a ~3.5 px y ya no hay sitio para otro aumento. Comprobar de día, que es
                cuando la celda muestra el nivel en vez de MÁXIMO. La diferencia de un píxel entre celdas
                vecinas no se ve; una palabra recortada sí, que es el mismo criterio con el
                que las cifras de esta fila se quedaron en 38 en vez de 40. IMECA lleva el
                13 también, aunque le sobre sitio, para que las dos CATEGORÍAS pesen igual
                entre sí --lo de SOLAR es una unidad, otra cosa--. */}
            {/* De noche el nivel en palabras cede su renglón al rótulo MÁXIMO, en blanco como
                la cifra. "MÁXIMO" mide ~55 px a cuerpo 13 y el interior de esta celda son 68,
                así que entra igual que "MODERADO", que es el caso peor de los niveles. */}
            {uvDeNoche ? (
              <div className="u" style={{ fontSize: 13, color: '#fff', lineHeight: 1, marginTop: 4,
                                          fontWeight: 800, whiteSpace: 'nowrap' }}>
                MÁXIMO
              </div>
            ) : data?.uv_index != null && (
              <div className="u" style={{ fontSize: 13, color: 'var(--w)', lineHeight: 1, marginTop: 4,
                                          fontWeight: 800, whiteSpace: 'nowrap' }}>
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
              <div className="u" style={{ fontSize: 13, color: 'var(--w)', lineHeight: 1, marginTop: 4,
                                          fontWeight: 800, whiteSpace: 'nowrap' }}>
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
          <div style={{ position: 'absolute', top: 6, left: 12, color: alertaCol('remotaInt', 'var(--w)'), fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA</div>
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
          {/* Lecturas centradas verticalmente */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: 20 }}>
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
          <div style={{ position: 'absolute', top: 6, left: 12, color: 'var(--v)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>JARDÍN</div>
          <div style={{ position: 'absolute', top: 8, right: 12, color: 'var(--lbl)', fontSize: 12, fontWeight: 600 }}>CH1</div>
          {/* Batería del WN31 de este canal. Aquí SÍ lleva el nombre al lado: la franja
              de abajo está libre --los dos valores van centrados con `ctr`-- así que
              cabe sin apretar nada. */}
          {data?.battery_ch1 != null && (
            <div style={{ position: 'absolute', bottom: 7, right: 10 }}>
              <BatteryGlyph level={data.battery_ch1 ? 1 : 0.08} name="WN31" />
            </div>
          )}
          {/* Misma carita de confort que INTERIOR, mismo criterio de columna: pero
              aquí SÍ hay algo debajo (la pila WN31, `bottom:7`), así que en vez de
              bajar hasta el borde de la celda se centra en el hueco entre el "CH1"
              de arriba y esa pila. */}
          {jardinComfort && (
            <div style={{ position: 'absolute', top: 38, right: 10, fontSize: 22, lineHeight: 1 }}
                 title={jardinComfort.label}>
              {jardinComfort.emoji}
            </div>
          )}
          {/* Lecturas centradas verticalmente */}
          <div className="ctr" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 16, marginTop: 20 }}>
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
          <div style={{ position: 'absolute', top: 6, left: 12, color: 'var(--w)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>REMOTA</div>
          {/* El mismo barómetro redondo que la celda PRES, en el mismo sitio y tamaño:
              las dos muestran presión y ahora se reconocen como pareja sin leer el
              rótulo. Aquí sobra el hueco que allá ocupa el riel de tendencia. */}
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <MeteoGlyph name="barometer" size={46} color={alertaCol('remotaP', '#7f00b2')} title="presión" />
          </div>
          {/* Mismo REL/ABS que PRES, mismo criterio: aquí el barómetro cuelga de
              `bottom:10` así que su borde de arriba cae en y≈47 (celda de ~103 px de
              alto útil, ver JARDÍN/INTERIOR) y la etiqueta va justo encima. */}
          {(() => {
            const kind = pressureKind(remote?.pressure_relative, remote?.pressure_absolute)
            return kind && (
              <div style={{ position: 'absolute', top: 35, left: 12, width: 46, textAlign: 'center',
                            color: 'var(--w)', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1 }}>
                {kind}
              </div>
            )
          })()}
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
          <div className="big gp ctr rt" style={{ marginTop: 28, fontSize: 46, paddingRight: 66 }}>
            {remote?.pressure_relative != null ? decNum(u.press(remote.pressure_relative, 1)) : '--'}<span className="u" style={{ fontSize: 20, color: 'var(--p)' }}> {u.pressU}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
