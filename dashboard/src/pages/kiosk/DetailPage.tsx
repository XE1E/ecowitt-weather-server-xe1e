/**
 * Pantalla de detalle del kiosco: una variable en un periodo.
 *
 * Es UNA plantilla para las 24 combinaciones (seis variables × cuatro periodos), no
 * 24 páginas. Lo que cambia entre ellas está declarado en `SERIES` y `KPIS` como
 * datos, no como código: añadir una variable es una entrada más en esos dos mapas.
 *
 * Hereda el lenguaje de la consola --negro, DSEG en las cifras, el color de cada
 * variable-- porque se llega tocando una celda: si la pantalla de destino tuviera
 * otra estética se leería como salir a otra aplicación, en vez de como abrir la
 * celda que acabas de tocar.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts'
import { useStationData } from '../../station-data'
import { useUnits, type Units } from '../../units'
import { CONSOLE_CSS } from '../../components/station/console-css'
import {
  VARIABLES, PERIODOS, PERIOD_KEYS, detSlug, statsSlug,
  type VarKey, type PeriodKey,
} from '../../kiosk-nav'
import { useNavZones, NavDebugOverlay } from './nav-zones'
import { KioskBar, KioskHead, Kpi, type Boton } from './chrome'

/** Fila del resumen diario tal como la devuelve /api/summaries/daily. */
interface DailyRow {
  date: string
  temp_min?: number; temp_max?: number; temp_avg?: number
  hum_min?: number; hum_max?: number; hum_avg?: number
  wind_avg?: number; wind_max?: number; gust_max?: number; wind_dir?: number
  rain_total?: number; rain_rate_max?: number
  press_min?: number; press_max?: number; press_avg?: number
  uv_max?: number; solar_max?: number
}

/** Punto ya listo para la gráfica: etiqueta del eje y hasta tres series. */
interface Punto { x: string; a?: number | null; b?: number | null; c?: number | null }

/**
 * Qué dibuja cada variable.
 *
 * `a` es siempre la serie principal. En los periodos por día, `a`/`b` son el máximo y
 * el mínimo del día --que es lo que de verdad cuenta una serie diaria: la banda entre
 * ambos-- y en 24 h hay una sola línea con el valor instantáneo.
 */
interface SerieDef {
  /** Campo del histórico de 24 h (una lectura cada pocos minutos). */
  vivo: (r: Record<string, unknown>) => number | null | undefined
  /** Campos del resumen diario: máximo, mínimo y (opcional) media. */
  dia: (r: DailyRow) => [number | undefined, number | undefined, number | undefined]
  /** 'banda' = área entre máx y mín; 'linea' = una sola; 'barra' = columnas. */
  forma: 'banda' | 'linea' | 'barra'
  /**
   * A las unidades del usuario. Recibe `porDia` porque la lluvia cambia de MAGNITUD
   * con el periodo --intensidad en 24 h, acumulado por día después-- y por tanto
   * también de conversión y de unidad.
   */
  conv: (v: number, u: Units, porDia: boolean) => number
  unidad: (u: Units, porDia: boolean) => string
}

const num = (v: unknown) => (typeof v === 'number' ? v : null)

const SERIES: Record<VarKey, SerieDef> = {
  temp: {
    vivo: (r) => num(r.temperature_outdoor),
    dia: (r) => [r.temp_max, r.temp_min, r.temp_avg],
    forma: 'banda',
    conv: (v, u) => u.tempN(v),
    unidad: (u) => u.tempU,
  },
  hum: {
    vivo: (r) => num(r.humidity_outdoor),
    dia: (r) => [r.hum_max, r.hum_min, r.hum_avg],
    forma: 'banda',
    conv: (v) => v,
    unidad: () => '%',
  },
  press: {
    vivo: (r) => num(r.pressure_relative),
    dia: (r) => [r.press_max, r.press_min, r.press_avg],
    forma: 'banda',
    conv: (v, u) => u.pressN(v),
    unidad: (u) => u.pressU,
  },
  wind: {
    vivo: (r) => num(r.wind_speed),
    dia: (r) => [r.gust_max, undefined, r.wind_avg],
    forma: 'linea',
    conv: (v, u) => u.windN(v),
    unidad: (u) => u.windU,
  },
  rain: {
    // En 24 h la lluvia se cuenta como INTENSIDAD (mm/h) y en los periodos por día
    // como acumulado (mm): sumar tasas horarias no da ni una cosa ni la otra. Es el
    // mismo criterio que ya sigue MultiVariableChart en la web.
    vivo: (r) => num(r.rain_rate),
    dia: (r) => [r.rain_total, undefined, undefined],
    forma: 'barra',
    conv: (v, u, porDia) => (porDia ? u.rainN(v) : u.rateN(v)),
    unidad: (u, porDia) => (porDia ? u.rainU : u.rateU),
  },
  sun: {
    vivo: (r) => num(r.solar_radiation),
    // Sólo la radiación. El UV iría de 0 a 12 contra los 0-1000 W/m² del mismo eje:
    // se vería como una raya pegada al suelo. Va en su propia cifra de la cabecera.
    dia: (r) => [r.solar_max, undefined, undefined],
    forma: 'linea',
    conv: (v) => v,
    unidad: () => 'W/m²',
  },
}

/**
 * Qué significan las dos series cuando hay dos. Sin esto, en viento se ven una línea
 * verde y otra gris punteada sin nada que diga cuál es cuál --y en el display no hay
 * tooltip al que recurrir--.
 */
const LEYENDA: Partial<Record<VarKey, [string, string]>> = {
  temp: ['MÁXIMA', 'MÍNIMA'],
  hum: ['MÁXIMA', 'MÍNIMA'],
  press: ['MÁXIMA', 'MÍNIMA'],
  wind: ['RÁFAGA', 'MEDIA'],
}

/** Una cifra de la cabecera. */
interface KpiVal { k: string; v: string; u?: string }

/** Formatea sin decimales sobrantes y con "--" cuando no hay dato. */
const f = (v: number | null | undefined, d = 1) =>
  v == null || Number.isNaN(v) ? '--' : v.toFixed(d)

export function DetailPage({ v, p, slug, ready: readyProp }: {
  v: VarKey; p: PeriodKey; slug: string; ready?: boolean
}) {
  const { data, history } = useStationData()
  const u = useUnits()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [dias, setDias] = useState<DailyRow[] | null>(null)
  const [rumbo, setRumbo] = useState<string | null>(null)
  // Aparte del rumbo: hay que saber si la petición YA VOLVIÓ, aunque sea sin dato.
  // Si se esperase a `rumbo`, un periodo sin viento dejaría la página sin marcar
  // "lista" y el renderer se comería los 15 s del tiempo de espera.
  const [rosaLista, setRosaLista] = useState(false)

  const def = VARIABLES[v]
  const serie = SERIES[v]
  const porDia = p !== '24h'

  // Los periodos por día salen de los RESÚMENES, no del histórico crudo: 30 días de
  // lecturas cada pocos minutos son miles de puntos para dibujar 30 barras.
  useEffect(() => {
    if (!porDia) { setDias(null); return }
    const n = p === '7d' ? 7 : p === '30d' ? 30 : 365
    let vivo = true
    fetch(`/api/summaries/daily?days=${n}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => vivo && setDias(j?.data ?? []))
      .catch(() => vivo && setDias([]))
    return () => { vivo = false }
  }, [p, porDia])

  // El rumbo dominante es media VECTORIAL, no un promedio de grados (entre 350° y
  // 10° el promedio aritmético da sur). Lo calcula el backend en /api/wind/rose.
  useEffect(() => {
    if (v !== 'wind') return
    const start = p === '24h' ? '-24h' : p === '7d' ? '-7d' : p === '30d' ? '-30d' : '-365d'
    let vivo = true
    setRosaLista(false)
    fetch(`/api/wind/rose?start=${start}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && setRumbo(j?.dominant ?? null))
      .catch(() => {})
      .finally(() => vivo && setRosaLista(true))
    return () => { vivo = false }
  }, [v, p])

  /** Puntos de la gráfica y extremos del periodo, en las unidades del usuario. */
  const { puntos, min, max, avg, total, diasCon } = useMemo(() => {
    const c = (x: number | undefined | null) => (x == null ? null : serie.conv(x, u, porDia))
    let pts: Punto[] = []

    if (!porDia) {
      // 24 h: se agrupa por hora para no dibujar 300 puntos en 1000 px.
      //
      // La clave del grupo es el INSTANTE de la hora, no la etiqueta "HH:00": con la
      // etiqueta, las 12:00 de ayer y las de hoy caerían en el mismo grupo. Se ordena
      // por esa clave porque el histórico no garantiza venir en orden --y si llega al
      // revés, la gráfica sale con el tiempo corriendo hacia atrás, que es
      // exactamente lo que pasó en la primera captura--.
      const porHora = new Map<number, { vals: number[]; x: string }>()
      for (const r of history || []) {
        const val = serie.vivo(r as unknown as Record<string, unknown>)
        if (val == null) continue
        const iso = r._time
        const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z')
        d.setMinutes(0, 0, 0)
        const k = d.getTime()
        const g = porHora.get(k) || { vals: [], x: `${String(d.getHours()).padStart(2, '0')}:00` }
        g.vals.push(val)
        porHora.set(k, g)
      }
      pts = Array.from(porHora.entries())
        .sort((a2, b2) => a2[0] - b2[0])
        .map(([, g]) => ({
          x: g.x,
          // La lluvia se queda con el PICO de la hora (una tasa media esconde el
          // chubasco); el resto, con la media de la hora.
          a: c(v === 'rain'
            ? Math.max(...g.vals)
            : g.vals.reduce((s, n2) => s + n2, 0) / g.vals.length),
        }))
    } else if (p === '12m') {
      // Una columna por mes, agregando los días de cada uno.
      //
      // La clave es AÑO-MES, no el número de mes: la ventana son los últimos 365
      // días, así que agosto del año pasado y el de éste caen dentro y agrupados sólo
      // por número acabarían sumados en la misma columna.
      const meses = new Map<string, DailyRow[]>()
      for (const r of dias || []) {
        const ym = String(r.date).slice(0, 7)
        meses.set(ym, [...(meses.get(ym) || []), r])
      }
      const MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
      pts = Array.from(meses.entries()).sort((x, y) => x[0].localeCompare(y[0]))
        .slice(-12)
        .map(([ym, rs]) => {
        const vs = rs.map((r) => serie.dia(r))
        const maxs = vs.map((t) => t[0]).filter((n2): n2 is number => n2 != null)
        const mins = vs.map((t) => t[1]).filter((n2): n2 is number => n2 != null)
        const avgs = vs.map((t) => t[2]).filter((n2): n2 is number => n2 != null)
        return {
          x: MES[Number(ym.slice(5, 7)) - 1],
          // La lluvia del mes es la SUMA de sus días; lo demás, el extremo del mes.
          a: c(v === 'rain' ? maxs.reduce((s, n2) => s + n2, 0) : maxs.length ? Math.max(...maxs) : undefined),
          b: c(mins.length ? Math.min(...mins) : undefined),
          c: c(avgs.length ? avgs.reduce((s, n2) => s + n2, 0) / avgs.length : undefined),
        }
      })
    } else {
      pts = (dias || []).map((r) => {
        const [mx, mn, av] = serie.dia(r)
        const d = String(r.date)
        return {
          // En 7 días caben las iniciales del día; en 30, sólo el número.
          x: p === '7d'
            ? ['D', 'L', 'M', 'M', 'J', 'V', 'S'][new Date(d + 'T12:00:00').getDay()]
            : d.slice(8),
          a: c(mx), b: c(mn), c: c(av),
        }
      })
    }

    const todos = pts.flatMap((q) => [q.a, q.b].filter((n2): n2 is number => n2 != null))
    const medios = pts.map((q) => q.c ?? q.a).filter((n2): n2 is number => n2 != null)
    return {
      puntos: pts,
      min: todos.length ? Math.min(...todos) : null,
      max: todos.length ? Math.max(...todos) : null,
      avg: medios.length ? medios.reduce((s, n2) => s + n2, 0) / medios.length : null,
      total: pts.reduce((s, q) => s + (q.a ?? 0), 0),
      diasCon: (dias || []).filter((r) => (r.rain_total ?? 0) >= 0.2).length,
    }
  }, [puntos_dep(history, dias), p, porDia, serie, u, v]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Las tres cifras de la cabecera, distintas por variable. */
  const kpis: KpiVal[] = useMemo(() => {
    const un = serie.unidad(u, porDia)
    switch (v) {
      case 'rain':
        return [
          // En 24 h el total del día ya lo lleva la lectura viva (`rain_daily`); no
          // se puede sumar la serie, que ahí son intensidades.
          { k: 'TOTAL', v: porDia ? f(total) : u.rain(data?.rain_daily), u: u.rainU },
          // En 12 meses cada columna es un MES, así que el máximo de la serie es el
          // del mes más lluvioso, no el de un día: rotularlo "MÁX DÍA" sería mentir.
          { k: p === '12m' ? 'MES MÁS LLUVIOSO' : porDia ? 'MÁX DÍA' : 'INTENSIDAD MÁX',
            v: f(max), u: un },
          { k: 'DÍAS CON LLUVIA', v: porDia ? `${diasCon} de ${(dias || []).length}` : '—' },
        ]
      case 'wind':
        return [
          { k: 'MEDIA', v: f(avg), u: un },
          { k: 'RÁFAGA MÁX', v: f(max), u: un },
          { k: 'RUMBO DOMINANTE', v: rumbo || '--' },
        ]
      case 'press':
        return [
          { k: 'MÍNIMA', v: f(min), u: un },
          { k: 'MÁXIMA', v: f(max), u: un },
          // Recorrido y no "variación": es máximo menos mínimo del periodo, no el
          // cambio entre principio y fin. Es una DIFERENCIA, así que se calcula sobre
          // valores ya convertidos y no vuelve a pasar por el conversor.
          { k: 'RECORRIDO', v: min != null && max != null ? f(max - min) : '--', u: un },
        ]
      case 'sun':
        return [
          { k: 'SOLAR MÁX', v: f(max, 0), u: un },
          { k: 'UV MÁX', v: f(porDia
            ? Math.max(0, ...(dias || []).map((r) => r.uv_max ?? 0))
            : (data?.uv_index ?? null), 0) },
          { k: 'MEDIA', v: f(avg, 0), u: un },
        ]
      default:
        return [
          { k: 'MÍNIMA', v: f(min), u: un },
          { k: 'MÁXIMA', v: f(max), u: un },
          { k: 'MEDIA', v: f(avg), u: un },
        ]
    }
  }, [v, p, porDia, total, max, min, avg, diasCon, dias, rumbo, data, u, serie])

  /** Botones del pie: atrás, los cuatro periodos y el salto a récords. */
  const botones: Boton[] = [
    { label: '‹ ATRÁS', to: p === '24h' ? 'consola' : detSlug(v, '24h'), tipo: 'back' },
    ...PERIOD_KEYS.map((k) => ({
      label: PERIODOS[k].label,
      to: detSlug(v, k),
      activo: k === p,
    })),
    { label: 'RÉCORDS', to: statsSlug('mes') },
  ]

  // Listo para capturar: en 24 h basta con el histórico del contexto; en los demás,
  // con que la petición de resúmenes haya vuelto (aunque venga vacía: mejor capturar
  // "sin datos" que dejar al display esperando quince segundos).
  //
  // El viento espera ADEMÁS a la rosa. Sin esto se capturaba con el rumbo en "--":
  // esa consulta recorre las lecturas crudas del periodo --diez mil en siete días--
  // y siempre llegaba después de los resúmenes. Visto en producción, no en local.
  const ready = readyProp
    ?? ((porDia ? dias != null : (history?.length ?? 0) > 0) && (v !== 'wind' || rosaLista))
  useNavZones(rootRef, slug)

  const vacio = puntos.length === 0

  return (
    <div
      ref={rootRef}
      className="cns"
      data-kiosk-ready={ready ? 'true' : 'false'}
      style={{
        width: 1024, height: 600, background: '#000', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        // `--acc` es el color de la variable: lo usan la cabecera, el botón activo y
        // la gráfica, así que toda la pantalla se tiñe cambiando una sola cosa.
        ['--acc' as string]: def.color,
      }}
    >
      <style>{CONSOLE_CSS}</style>
      <NavDebugOverlay nodo={rootRef} />

      <KioskHead
        titulo={def.label}
        sub={PERIODOS[p].label}
        // La leyenda sólo aparece cuando de verdad hay dos series dibujadas, o sea en
        // los periodos por día: en 24 h hay una sola línea y rotularla sobraría.
        extra={porDia && LEYENDA[v] && (
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {LEYENDA[v]!.map((txt, i) => (
              <span key={txt} style={{ display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 14, fontWeight: 700, letterSpacing: 1, color: '#8a8a8a' }}>
                <span style={{
                  width: 16, height: 0,
                  borderTop: `3px ${i === 0 || serie.forma === 'banda' ? 'solid' : 'dotted'} `
                    + (i === 0 || serie.forma === 'banda' ? def.color : '#8a8a8a'),
                }} />
                {txt}
              </span>
            ))}
          </span>
        )}
      />

      <div className="kpis">
        {kpis.map((k) => (
          <Kpi key={k.k} rotulo={k.k} valor={k.v} unidad={k.u} glow={def.glow} color={def.color} />
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '4px 14px 6px' }}>
        {vacio ? (
          // Degradar con gracia: decirlo, no dejar el hueco en blanco. Un periodo sin
          // resúmenes es lo normal recién estrenada la estación.
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#8a8a8a', fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>
            SIN DATOS PARA ESTE PERIODO
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={puntos} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              {/* Rejilla completa: las verticales caen en las mismas categorías que
                  rotula el eje X --una por hora, día o mes-- y sin ellas hay que
                  perseguir con la vista desde qué etiqueta sube cada pico. */}
              <CartesianGrid stroke="#1e1e1e" />
              {/* Una etiqueta de cada N para que no se toquen: 24 horas o 30 días no
                  caben rotuladas una a una a 15 px, y apretadas se leen peor que si
                  faltan. Siete días y doce meses sí caben enteros. */}
              <XAxis dataKey="x" stroke="#8a8a8a" tick={{ fontSize: 15, fontWeight: 700 }}
                tickLine={false} axisLine={{ stroke: '#333' }}
                interval={p === '24h' ? 2 : p === '30d' ? 3 : 0} />
              <YAxis stroke="#8a8a8a" tick={{ fontSize: 15, fontWeight: 700 }}
                tickLine={false} axisLine={false} width={56}
                domain={['auto', 'auto']} />
              {serie.forma === 'barra' && (
                // `isAnimationActive={false}`, como en las áreas y las líneas, y aquí no
                // es cosmético: Recharts crece las barras desde altura 0 durante 1.5 s y
                // el renderer captura en cuanto la página se declara lista, así que las
                // cuatro pantallas de LLUVIA salían con la rejilla vacía mientras sus
                // cifras de cabecera enseñaban el total del periodo.
                <Bar dataKey="a" fill={def.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              )}
              {serie.forma === 'banda' && (
                <>
                  {/* La banda es el ÁREA entre el máximo y el mínimo del día. Se pinta
                      como dos áreas superpuestas --la del mínimo tapa la parte de
                      abajo con el negro del fondo-- porque Recharts no tiene un área
                      entre dos series. */}
                  <Area dataKey="a" stroke={def.color} strokeWidth={2}
                    fill={def.color} fillOpacity={0.25} isAnimationActive={false} />
                  {porDia && <Area dataKey="b" stroke={def.color} strokeWidth={2}
                    fill="#000" fillOpacity={1} isAnimationActive={false} />}
                </>
              )}
              {serie.forma === 'linea' && (
                <>
                  <Line dataKey="a" stroke={def.color} strokeWidth={2.5} dot={false}
                    isAnimationActive={false} />
                  {porDia && <Line dataKey="c" stroke="#8a8a8a" strokeWidth={2} dot={false}
                    strokeDasharray="4 3" isAnimationActive={false} />}
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <KioskBar botones={botones} />
    </div>
  )
}

/**
 * Dependencia estable del `useMemo` de arriba.
 *
 * El histórico y los resúmenes son arrays nuevos en cada refresco aunque el contenido
 * no cambie, así que ponerlos como dependencia recalcularía la serie cada minuto sin
 * motivo. Con su longitud y su último instante basta para saber si hay algo nuevo.
 */
function puntos_dep(history: { _time: string }[] | undefined, dias: DailyRow[] | null) {
  const h = history?.length ? `${history.length}:${history[history.length - 1]._time}` : '0'
  const d = dias?.length ? `${dias.length}:${dias[dias.length - 1].date}` : String(dias == null ? 'n' : 0)
  return `${h}|${d}`
}
