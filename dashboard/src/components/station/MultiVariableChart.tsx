import { useState, useEffect, useMemo } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useUnits } from '../../units'
import type { HistoryData } from '../../types'

interface DataPoint {
  x: string
  k?: string          // clave de agrupacion (puede diferir de la etiqueta visible)
  temp?: number | null
  pressure?: number | null
  /**
   * Serie de lluvia GRAFICADA. Cambia de magnitud con el modo, a proposito:
   *   day/2day -> intensidad (rain_rate, mm/h): el maximo de la hora.
   *   week     -> acumulado (rain_daily, mm): lo que cayo ese dia.
   * En una vista semanal interesa cuanto llovio cada dia, no el pico de
   * intensidad. Antes se SUMABAN las tasas horarias, que no da ni mm ni mm/h
   * (lloviznar a 2 mm/h todo el dia daba una barra de 2880).
   */
  rain?: number | null
  rate?: number | null      // rain_rate crudo (metrico)
  daily?: number | null     // rain_daily crudo (metrico)
  wind?: number | null
  humidity?: number | null
}

interface Props {
  /** Ventana de datos: 'day' = 24 h, '2day' = 48 h, 'week' = 7 d. */
  mode: 'day' | '2day' | 'week'
  /**
   * Modo kiosco (pagina 5 del display de 1024x600, que el servidor captura como
   * JPEG): sin scroll horizontal ni tooltip, y con fuentes mas grandes para que
   * se lea a distancia.
   */
  kiosk?: boolean
  /**
   * Alto de la caja. Solo se usa con kiosk; si no, manda la clase h-96/md:h-80.
   * Acepta '100%' para llenar el hueco que deje el padre, que es lo que hace el
   * kiosco: el espacio libre entre el header y la barra de pestañas es de ~426 px
   * y un alto fijo mayor recorta la leyenda.
   */
  height?: number | string
  /** Se llama al terminar de cargar (bien o mal). El kiosco lo usa para avisar
   *  al renderer que ya puede capturar la pantalla. */
  onLoaded?: () => void
}

const nf = (v: number) => Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })

// Colores
const COL = {
  temp: '#f97316',    // naranja
  press: '#a78bfa',   // morado
  rain: '#38bdf8',    // azul claro
  wind: '#22c55e',    // verde
  hum: '#3b82f6',     // azul oscuro
}

export function MultiVariableChart({ mode, kiosk = false, height = 400, onLoaded }: Props) {
  const u = useUnits()
  const [data, setData] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const start = mode === 'day' ? '-24h' : mode === '2day' ? '-48h' : '-7d'
    fetch(`/api/history?start=${start}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((json) => {
        const raw = json.data || []
        const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

        const points: DataPoint[] = raw.map((p: HistoryData) => {
          const d = new Date(p._time)
          let label: string
          let key: string
          if (mode === 'week') {
            label = `${d.getDate()} ${MES[d.getMonth()]}`
            key = label
          } else {
            label = `${d.getHours().toString().padStart(2, '0')}:00`
            // En 48 h la misma hora aparece dos veces (ayer y hoy). Si se agrupa
            // por la etiqueta, ambos puntos colapsan en uno y la grafica sale
            // con la mitad de los datos: la clave incluye el dia.
            key = mode === '2day' ? `${d.getMonth()}-${d.getDate()} ${label}` : label
          }
          return {
            x: label,
            k: key,
            temp: p.temperature_outdoor ?? null,
            pressure: p.pressure_relative ?? null,
            rate: p.rain_rate ?? null,
            daily: p.rain_daily ?? null,
            wind: p.wind_speed ?? null,
            humidity: p.humidity_outdoor ?? null,
          }
        })

        const grouped = mode === 'week' ? groupByDay(points) : groupByHour(points)
        setData(grouped)
        setLoading(false)
        onLoaded?.()
      })
      .catch(() => { setLoading(false); onLoaded?.() })
    // onLoaded queda fuera de las deps a proposito: si el padre la recrea en
    // cada render, incluirla dispararia un fetch en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // `data` se guarda siempre en METRICO (como llega del API) y se convierte aqui
  // al sistema activo. Asi cambiar de unidades no obliga a volver a pedir datos.
  // Antes no se convertia NADA: los valores iban en metrico y solo el tooltip
  // consultaba el sistema, de modo que en imperial decia "28.6 °F" sobre 28.6 °C.
  const shown = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        temp: d.temp == null ? null : u.tempN(d.temp),
        pressure: d.pressure == null ? null : u.pressN(d.pressure),
        wind: d.wind == null ? null : u.windN(d.wind),
        // La lluvia es acumulado (mm) en semana e intensidad (mm/h) en dia: la
        // conversion a imperial es /25.4 en ambos casos, pero la unidad difiere.
        rain: d.rain == null ? null : (mode === 'week' ? u.rainN(d.rain) : u.rateN(d.rain)),
        // humedad: % en los dos sistemas
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, u.system, mode]
  )

  // Calcular dominios dinámicos basados en los datos
  const domains = useMemo(() => {
    if (shown.length === 0) {
      return {
        temp: [u.tempN(0), u.tempN(30)].map(Math.round),
        press: [u.pressN(1000), u.pressN(1030)],
        rain: [0, u.system === 'imperial' ? 0.2 : 5],
        wind: [0, Math.round(u.windN(15))],
        hum: [0, 100],
      }
    }

    // Rango MINIMO de cada eje, en la unidad activa. Ojo con la temperatura: es
    // un DELTA, y tempN es afín (multiplica y suma 32), asi que no sirve aqui —
    // 5 °C de rango son 9 °F, no 41. Presion y viento si son multiplicativos.
    const minTemp = u.system === 'imperial' ? 5 * 9 / 5 : 5
    const minPress = u.pressN(5)

    // Redondeo de los limites del eje. No vale redondear a entero siempre: la
    // presion en inHg vive en ~30.2 y floor/ceil daria un eje [30, 31] con casi
    // todos los ticks repetidos. Los decimales salen del ancho del rango.
    const snap = (v: number, range: number, dir: 'down' | 'up') => {
      const dec = range >= 20 ? 0 : range >= 2 ? 1 : 2
      const f = Math.pow(10, dec)
      return (dir === 'down' ? Math.floor(v * f) : Math.ceil(v * f)) / f
    }

    const calcDomain = (values: (number | null | undefined)[], padding = 0.1, minRange = 5) => {
      const valid = values.filter((v): v is number => v != null)
      if (valid.length === 0) return [0, 10]
      const min = Math.min(...valid)
      const max = Math.max(...valid)
      const range = Math.max(max - min, minRange)
      const pad = range * padding
      return [snap(min - pad, range, 'down'), snap(max + pad, range, 'up')]
    }

    const calcDomainPress = (values: (number | null | undefined)[]) => {
      const valid = values.filter((v): v is number => v != null)
      if (valid.length === 0) return [u.pressN(1000), u.pressN(1030)]
      const min = Math.min(...valid)
      const max = Math.max(...valid)
      const range = Math.max(max - min, minPress)
      return [snap(min - range * 0.2, range, 'down'), snap(max + range * 0.2, range, 'up')]
    }

    const maxOf = (values: (number | null | undefined)[]) => {
      const valid = values.filter((v): v is number => v != null)
      return valid.length ? Math.max(...valid) : 0
    }
    const rainTop = maxOf(shown.map((d) => d.rain)) * 1.3
    const windTop = maxOf(shown.map((d) => d.wind)) * 1.3

    return {
      temp: calcDomain(shown.map((d) => d.temp), 0.15, minTemp),
      press: calcDomainPress(shown.map((d) => d.pressure)),
      rain: [0, Math.max(u.system === 'imperial' ? 0.1 : 2, snap(rainTop, rainTop, 'up'))],
      wind: [0, Math.max(u.system === 'imperial' ? 2 : 3, snap(windTop, windTop, 'up'))],
      hum: calcDomain(shown.map((d) => d.humidity), 0.1, 20),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  // Generar ticks dinámicos. Los decimales siguen al PASO: con la presión en
  // inHg el paso es ~0.1 y redondear a entero dejaría los 5 ticks repetidos.
  const genTicks = (domain: number[], count: number) => {
    const [min, max] = domain
    const step = (max - min) / (count - 1)
    const dec = step >= 5 ? 0 : step >= 1 ? 1 : 2
    const f = Math.pow(10, dec)
    return Array.from({ length: count }, (_, i) => Math.round((min + step * i) * f) / f)
  }

  if (loading) {
    return kiosk
      ? <div style={{ height }} className="flex items-center justify-center text-slate-400 text-[20px]">Cargando...</div>
      : <div className="h-96 md:h-80 flex items-center justify-center text-slate-400">Cargando...</div>
  }

  // Tamaños: en el kiosco la imagen se ve a distancia en una pantalla de 7", y
  // los ejes van mas anchos porque las fuentes mas grandes necesitan sitio.
  const fsX = kiosk ? 14 : 10
  const fsY = kiosk ? 13 : 9
  const fsL = kiosk ? 13 : 10
  const w = (base: number, k: number) => (kiosk ? k : base)
  // 48 barras en ~880 px: si son de 12 px se empastan.
  const barSize = mode === 'week' ? 8 : kiosk ? 7 : 12
  // Con 48 puntos hay que saltarse etiquetas o el eje X queda ilegible.
  const xInterval = kiosk ? (mode === '2day' ? 3 : 1) : undefined

  // La serie de lluvia cambia de magnitud con el modo, asi que su nombre y su
  // unidad tambien: acumulado del dia en semana, intensidad en dia/48 h.
  const rainName = mode === 'week' ? 'Precipitación' : 'Intensidad de lluvia'
  const rainUnit = mode === 'week' ? u.rainU : u.rateU
  // Unidad por nombre de serie, para el tooltip. Sale del sistema activo, igual
  // que los datos y las etiquetas de los ejes: los tres tienen que coincidir.
  const UNITS: Record<string, string> = {
    Temperatura: u.tempU,
    'Presión atmosférica': u.pressU,
    [rainName]: rainUnit,
    'Velocidad del viento': u.windU,
    Humedad: '%',
  }

  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
  }
  const cursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }

  // Ancho mínimo para scroll horizontal (CSS anula en desktop)
  const minW = data.length > 12 ? `${Math.max(600, data.length * 40)}px` : '600px'

  const chart = (
        <ComposedChart data={shown} margin={{ top: 20, right: kiosk ? 20 : 70, left: kiosk ? 10 : 70, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />

          <XAxis
            dataKey="x"
            interval={xInterval}
            tick={{ fill: '#94a3b8', fontSize: fsX }}
            axisLine={{ stroke: 'rgba(148,163,184,0.3)' }}
            tickLine={{ stroke: 'rgba(148,163,184,0.3)' }}
          />

          {/* Eje izquierdo 1: Temperatura °C (naranja) */}
          <YAxis
            yAxisId="temp"
            orientation="left"
            domain={domains.temp}
            ticks={genTicks(domains.temp, 6)}
            tick={{ fill: COL.temp, fontSize: fsY }}
            axisLine={{ stroke: COL.temp }}
            tickLine={{ stroke: COL.temp }}
            label={{ value: u.tempU, position: 'top', offset: 12, fill: COL.temp, fontSize: fsL }}
            width={w(25, 34)}
          />

          {/* Eje izquierdo 2: Presión hPa (morado) */}
          <YAxis
            yAxisId="press"
            orientation="left"
            domain={domains.press}
            ticks={genTicks(domains.press, 5)}
            tick={{ fill: COL.press, fontSize: fsY }}
            axisLine={{ stroke: COL.press }}
            tickLine={{ stroke: COL.press }}
            label={{ value: u.pressU, position: 'top', offset: 12, fill: COL.press, fontSize: fsL }}
            width={w(32, 46)}
          />

          {/* Eje izquierdo 3: Precipitación mm (azul claro) */}
          <YAxis
            yAxisId="rain"
            orientation="left"
            domain={domains.rain}
            ticks={genTicks(domains.rain, 6)}
            tick={{ fill: COL.rain, fontSize: fsY }}
            axisLine={{ stroke: COL.rain }}
            tickLine={{ stroke: COL.rain }}
            label={{ value: rainUnit, position: 'top', offset: 12, fill: COL.rain, fontSize: fsL }}
            width={w(20, 28)}
          />

          {/* Eje derecho 1: Viento km/h (verde) */}
          <YAxis
            yAxisId="wind"
            orientation="right"
            domain={domains.wind}
            ticks={genTicks(domains.wind, 6)}
            tick={{ fill: COL.wind, fontSize: fsY }}
            axisLine={{ stroke: COL.wind }}
            tickLine={{ stroke: COL.wind }}
            label={{ value: u.windU, position: 'top', offset: 12, fill: COL.wind, fontSize: fsL }}
            width={w(28, 40)}
          />

          {/* Eje derecho 2: Humedad % (azul oscuro) */}
          <YAxis
            yAxisId="hum"
            orientation="right"
            domain={domains.hum}
            ticks={genTicks(domains.hum, 6)}
            tick={{ fill: COL.hum, fontSize: fsY }}
            axisLine={{ stroke: COL.hum }}
            tickLine={{ stroke: COL.hum }}
            label={{ value: '%', position: 'top', offset: 12, fill: COL.hum, fontSize: fsL }}
            width={w(28, 36)}
          />

          {/* El tooltip no aporta nada en el kiosco: es una captura, nadie pasa
              el cursor por encima. */}
          {!kiosk && (
            <Tooltip
              cursor={cursor}
              {...tip}
              formatter={(v: number, name: string) => [`${nf(v)} ${UNITS[name] ?? ''}`, name]}
            />
          )}

          <Legend
            verticalAlign="bottom"
            height={kiosk ? 34 : 28}
            wrapperStyle={{ fontSize: kiosk ? 15 : 11, paddingTop: 5 }}
            iconType="circle"
            iconSize={kiosk ? 11 : 8}
          />

          {/* Barras de precipitación (azul claro) */}
          {/* En el kiosco la animación de entrada tiene que ir APAGADA: el
              renderer captura la pantalla en cuanto la página avisa que tiene
              datos, y con la animación activa la foto sale en el frame 0, con
              ejes y rejilla dibujados pero las líneas y barras todavía en cero. */}
          <Bar
            yAxisId="rain"
            dataKey="rain"
            name={rainName}
            fill={COL.rain}
            opacity={0.85}
            radius={[2, 2, 0, 0]}
            barSize={barSize}
            isAnimationActive={!kiosk}
          />

          {/* Línea de temperatura (naranja) */}
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            name="Temperatura"
            stroke={COL.temp}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={!kiosk}
          />

          {/* Línea de presión (morado) */}
          <Line
            yAxisId="press"
            type="monotone"
            dataKey="pressure"
            name="Presión atmosférica"
            stroke={COL.press}
            strokeWidth={2}
            dot={false}
            isAnimationActive={!kiosk}
          />

          {/* Línea de viento (verde) */}
          <Line
            yAxisId="wind"
            type="monotone"
            dataKey="wind"
            name="Velocidad del viento"
            stroke={COL.wind}
            strokeWidth={2}
            dot={false}
            isAnimationActive={!kiosk}
          />

          {/* Línea de humedad (azul oscuro) */}
          <Line
            yAxisId="hum"
            type="monotone"
            dataKey="humidity"
            name="Humedad"
            stroke={COL.hum}
            strokeWidth={2}
            dot={false}
            isAnimationActive={!kiosk}
          />
        </ComposedChart>
  )

  // Kiosco: caja de alto fijo, sin scroll (el JPEG no se puede desplazar).
  if (kiosk) {
    return (
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-96 md:h-80 overflow-x-auto chart-scroll">
      <div style={{ minWidth: minW, height: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    </div>
  )
}

function groupByHour(points: DataPoint[]): DataPoint[] {
  const map = new Map<string, DataPoint[]>()
  const order: string[] = []
  for (const p of points) {
    const key = p.k ?? p.x
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(p)
  }
  return order.map((key) => {
    const pts = map.get(key)!
    return {
      // La etiqueta visible viene del punto, NO de la clave: en 48 h la clave
      // lleva el dia ("6-15 14:00") y en el eje solo debe salir "14:00".
      x: pts[0].x,
      k: key,
      temp: avg(pts.map((p) => p.temp)),
      pressure: avg(pts.map((p) => p.pressure)),
      // Intensidad: el pico de la hora (promediarla la diluiria a casi nada).
      rain: maxOrNull(pts.map((p) => p.rate)),
      wind: avg(pts.map((p) => p.wind)),
      humidity: avg(pts.map((p) => p.humidity)),
    }
  })
}

function groupByDay(points: DataPoint[]): DataPoint[] {
  const map = new Map<string, DataPoint[]>()
  const order: string[] = []
  for (const p of points) {
    const key = p.k ?? p.x
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(p)
  }
  return order.map((key) => {
    const pts = map.get(key)!
    return {
      x: pts[0].x,
      k: key,
      temp: avg(pts.map((p) => p.temp)),
      pressure: avg(pts.map((p) => p.pressure)),
      // Acumulado del dia: rain_daily es el contador de la consola, que se
      // reinicia a medianoche local, asi que su MAXIMO del dia = lo que llovio.
      rain: maxOrNull(pts.map((p) => p.daily)),
      wind: avg(pts.map((p) => p.wind)),
      humidity: avg(pts.map((p) => p.humidity)),
    }
  })
}

function avg(arr: (number | null | undefined)[]): number | null {
  const valid = arr.filter((v): v is number => v != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

/** Maximo, o null si no hay ningun valor: null es "sin dato", no "cero". */
function maxOrNull(arr: (number | null | undefined)[]): number | null {
  const valid = arr.filter((v): v is number => v != null)
  return valid.length ? Math.max(...valid) : null
}
