/**
 * Estadísticas del kiosco: los extremos de un periodo, en cuatro vistas.
 *
 * HOY sale del resumen del día que ya trae el contexto; MES, AÑO y SIEMPRE salen de
 * `/api/climate/records`, que devuelve los tres paquetes en una sola petición --así
 * moverse entre esas tres vistas no vuelve a pegarle al backend, sólo cambia qué
 * trozo se pinta--.
 *
 * SIEMPRE añade además la efeméride del día (`/api/climate/onthisday`): qué pasó un
 * día como hoy en años anteriores, que es lo que convierte una tabla de récords en
 * algo que apetece mirar.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStationData } from '../../station-data'
import { useUnits } from '../../units'
import { CONSOLE_CSS } from '../../components/station/console-css'
import { STATS_VIEWS, STATS_KEYS, statsSlug, VARIABLES, type StatsKey } from '../../kiosk-nav'
import { useNavZones, NavDebugOverlay } from './nav-zones'
import { KioskBar, KioskHead, esCifra, type Boton } from './chrome'

/** Un extremo tal como lo devuelve el backend: valor y cuándo pasó. */
interface Best { value?: number; date?: string }
interface Resumen {
  days?: number
  mean_temp?: number
  high?: Best; low?: Best
  rain_total?: number; rain_days?: number; rain_max_day?: Best; rain_rate_max?: Best
  wind_avg?: number; gust_max?: Best; wind_dir?: number
  hum_max?: number; hum_min?: number
  press_max?: Best | number; press_min?: Best | number
}
interface Records {
  all_time?: Record<string, Best | number>
  this_month?: Resumen
  this_year?: Resumen
}
interface OnThisDay {
  count?: number
  warmest?: Record<string, unknown>
  coldest?: Record<string, unknown>
  wettest?: Record<string, unknown>
}

/** Una línea de la tabla: rótulo, cifra, unidad y cuándo. */
interface Fila { k: string; v: string; u?: string; cuando?: string; glow: string }

/** dd/mm de una fecha ISO, que es todo lo que cabe y todo lo que hace falta. */
const dm = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '')
const f = (v: number | null | undefined, d = 1) =>
  v == null || Number.isNaN(v) ? '--' : v.toFixed(d)
/** Los extremos vienen como {value,date} o como número pelado según el endpoint. */
const val = (b?: Best | number) => (typeof b === 'number' ? b : b?.value)
const fecha = (b?: Best | number) => (typeof b === 'number' ? undefined : b?.date)

export function StatsPage({ s, slug }: { s: StatsKey; slug: string }) {
  const { stats } = useStationData()
  const u = useUnits()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [rec, setRec] = useState<Records | null>(null)
  const [otd, setOtd] = useState<OnThisDay | null>(null)
  const [pedido, setPedido] = useState(false)

  // HOY no necesita red: el resumen del día ya viaja en el contexto.
  const necesitaRed = s !== 'hoy'

  useEffect(() => {
    if (!necesitaRed) { setPedido(true); return }
    let vivo = true
    Promise.all([
      fetch('/api/climate/records').then((r) => (r.ok ? r.json() : null)),
      s === 'siempre'
        ? fetch('/api/climate/onthisday').then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
    ]).then(([a, b]) => {
      if (!vivo) return
      setRec(a); setOtd(b); setPedido(true)
    }).catch(() => vivo && setPedido(true))
    return () => { vivo = false }
  }, [s, necesitaRed])

  const { titulo, filas, pie } = useMemo(() => {
    const T = VARIABLES.temp.glow, H = VARIABLES.hum.glow, P = VARIABLES.press.glow
    const V = VARIABLES.wind.glow, R = VARIABLES.rain.glow

    if (s === 'hoy') {
      const g = (campo: string, k: 'min' | 'max') =>
        (stats?.[campo] as { min?: number; max?: number } | undefined)?.[k]
      return {
        titulo: 'HOY',
        filas: [
          { k: 'TEMPERATURA MÁX', v: u.temp(g('temperature_outdoor', 'max')), u: u.tempU, glow: T },
          { k: 'TEMPERATURA MÍN', v: u.temp(g('temperature_outdoor', 'min')), u: u.tempU, glow: T },
          { k: 'HUMEDAD MÁX', v: f(g('humidity_outdoor', 'max'), 0), u: '%', glow: H },
          { k: 'HUMEDAD MÍN', v: f(g('humidity_outdoor', 'min'), 0), u: '%', glow: H },
          { k: 'PRESIÓN MÁX', v: u.press(g('pressure_relative', 'max')), u: u.pressU, glow: P },
          { k: 'PRESIÓN MÍN', v: u.press(g('pressure_relative', 'min')), u: u.pressU, glow: P },
          { k: 'RÁFAGA MÁX', v: u.wind(g('wind_gust', 'max')), u: u.windU, glow: V },
          { k: 'LLUVIA', v: u.rain(g('rain_daily', 'max')), u: u.rainU, glow: R },
        ] as Fila[],
        pie: 'MÍNIMAS Y MÁXIMAS DEL DÍA EN CURSO',
      }
    }

    if (s === 'siempre') {
      const a = rec?.all_time || {}
      const cuantos = otd?.count ?? 0
      return {
        titulo: 'RÉCORDS DE SIEMPRE',
        filas: [
          { k: 'MÁS CALOR', v: u.temp(val(a.temp_max)), u: u.tempU, cuando: dm(fecha(a.temp_max)), glow: T },
          { k: 'MÁS FRÍO', v: u.temp(val(a.temp_min)), u: u.tempU, cuando: dm(fecha(a.temp_min)), glow: T },
          { k: 'RÁFAGA MÁXIMA', v: u.wind(val(a.gust_max)), u: u.windU, cuando: dm(fecha(a.gust_max)), glow: V },
          { k: 'DÍA MÁS LLUVIOSO', v: u.rain(val(a.rain_max_day)), u: u.rainU, cuando: dm(fecha(a.rain_max_day)), glow: R },
          { k: 'PRESIÓN MÁXIMA', v: u.press(val(a.press_max)), u: u.pressU, cuando: dm(fecha(a.press_max)), glow: P },
          { k: 'PRESIÓN MÍNIMA', v: u.press(val(a.press_min)), u: u.pressU, cuando: dm(fecha(a.press_min)), glow: P },
          { k: 'HUMEDAD MÁXIMA', v: f(val(a.hum_max), 0), u: '%', cuando: dm(fecha(a.hum_max)), glow: H },
          { k: 'HUMEDAD MÍNIMA', v: f(val(a.hum_min), 0), u: '%', cuando: dm(fecha(a.hum_min)), glow: H },
        ] as Fila[],
        pie: `${typeof a.days === 'number' ? a.days : '--'} DÍAS REGISTRADOS`
          + (cuantos ? ` · UN DÍA COMO HOY, ${cuantos} ${cuantos === 1 ? 'AÑO' : 'AÑOS'} ATRÁS` : ''),
      }
    }

    const r: Resumen = (s === 'mes' ? rec?.this_month : rec?.this_year) || {}
    return {
      titulo: s === 'mes' ? 'ESTE MES' : 'ESTE AÑO',
      filas: [
        { k: 'TEMPERATURA MEDIA', v: u.temp(r.mean_temp), u: u.tempU, glow: T },
        { k: 'MÁXIMA', v: u.temp(val(r.high)), u: u.tempU, cuando: dm(fecha(r.high)), glow: T },
        { k: 'MÍNIMA', v: u.temp(val(r.low)), u: u.tempU, cuando: dm(fecha(r.low)), glow: T },
        { k: 'LLUVIA ACUMULADA', v: u.rain(r.rain_total), u: u.rainU, glow: R },
        { k: 'DÍA MÁS LLUVIOSO', v: u.rain(val(r.rain_max_day)), u: u.rainU, cuando: dm(fecha(r.rain_max_day)), glow: R },
        { k: 'DÍAS CON LLUVIA', v: `${r.rain_days ?? '--'} de ${r.days ?? '--'}`, glow: R },
        { k: 'VIENTO MEDIO', v: u.wind(r.wind_avg), u: u.windU, glow: V },
        { k: 'RÁFAGA MÁXIMA', v: u.wind(val(r.gust_max)), u: u.windU, cuando: dm(fecha(r.gust_max)), glow: V },
      ] as Fila[],
      pie: `${r.days ?? 0} DÍAS CON REGISTRO`,
    }
  }, [s, rec, otd, stats, u])

  const botones: Boton[] = [
    { label: '‹ ATRÁS', to: s === 'mes' ? 'consola' : statsSlug('mes'), tipo: 'back' },
    ...STATS_KEYS.map((k) => ({ label: STATS_VIEWS[k].label, to: statsSlug(k), activo: k === s })),
  ]

  useNavZones(rootRef, slug)

  return (
    <div
      ref={rootRef}
      className="cns"
      data-kiosk-ready={pedido ? 'true' : 'false'}
      style={{
        width: 1024, height: 600, background: '#000', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        // Blanco como acento: estas pantallas no son de una variable concreta, son de
        // todas. Es el mismo criterio del contorno blanco de la consola para lo que no
        // es la lectura de un sensor.
        ['--acc' as string]: '#eaeaea',
      }}
    >
      <style>{CONSOLE_CSS}</style>
      <NavDebugOverlay nodo={rootRef} />

      <KioskHead titulo="ESTADÍSTICAS" sub={titulo} />

      {/* Dos columnas de cuatro filas: ocho cifras entran de sobra a un cuerpo que se
          lee de lejos, y en una sola columna habría que bajar a 20 px. */}
      <div style={{
        flex: 1, minHeight: 0, display: 'grid', gap: '0 26px', padding: '10px 18px 4px',
        gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'repeat(4, 1fr)',
      }}>
        {filas.map((fila) => (
          <div key={fila.k} style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 10, borderBottom: '1px solid #1a1a1a', minWidth: 0,
          }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1, color: '#8a8a8a',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {fila.k}
            </span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
              {/* La fecha del récord va ANTES de la cifra y en gris: si fuera detrás,
                  competiría con la unidad y las dos juntas empujarían el número. */}
              {fila.cuando && (
                <span style={{ fontSize: 14, fontWeight: 700, color: '#5a5a5a' }}>{fila.cuando}</span>
              )}
              {/* Fuera de DSEG cuando el valor trae letras ("12 de 28"): con siete
                  segmentos la e sale a media altura y se lee "12 dE 28". */}
              <span
                className={esCifra(fila.v) ? `seg ${fila.glow}` : fila.glow}
                style={esCifra(fila.v)
                  ? { fontSize: 30, fontWeight: 800 }
                  : { fontSize: 25, fontWeight: 800, fontFamily: 'inherit' }}
              >
                {fila.v}
              </span>
              {fila.u && <span className="u" style={{ fontSize: 15, color: '#8a8a8a' }}>{fila.u}</span>}
            </span>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 18px 6px', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: '#5a5a5a' }}>
        {pie}
      </div>

      <KioskBar botones={botones} />
    </div>
  )
}
