import { useState, useEffect } from 'react'
import { useUnits } from '../units'
import { LOCATION } from '../config'
import { HistoryDayDetail } from '../components/station/HistoryDayDetail'
import { HistoryCharts, HistPoint } from '../components/station/HistoryCharts'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

interface Rec { value: number; date: string }
interface NoaaDay {
  date: string
  mean_temp?: number | null; high?: number | null; low?: number | null
  rain?: number | null; wind_avg?: number | null; gust_max?: number | null; wind_dir?: number | null
  hum_avg?: number | null; dew_avg?: number | null; press_avg?: number | null
  uv_max?: number | null; solar_max?: number | null
}
interface Period {
  days: number; mean_temp?: number | null; high?: Rec | null; low?: Rec | null
  rain_total?: number; rain_days?: number; wind_max?: Rec | null; gust_max?: Rec | null; wind_dir?: number | null
  wind_avg?: number | null; hum_avg?: number | null; dew_avg?: number | null; press_avg?: number | null
  uv_max?: number | null; solar_max?: number | null
}
interface YearMonth extends Period { month: number }
interface MonthData { year: number; month: number; days: NoaaDay[]; summary: Period }
interface YearData { year: number; months: YearMonth[]; summary: Period }

type Gran = 'day' | 'month' | 'year'

export function HistoryPage() {
  const u = useUnits()
  const now = new Date()
  const todayIso = now.toISOString().slice(0, 10)

  const [gran, setGran] = useState<Gran>('month')
  const [pDay, setPDay] = useState(todayIso)
  const [pMonth, setPMonth] = useState(now.getMonth() + 1)
  const [pYear, setPYear] = useState(now.getFullYear())
  const [sel, setSel] = useState<{ gran: Gran; day: string; month: number; year: number }>({
    gran: 'month', day: todayIso, month: now.getMonth() + 1, year: now.getFullYear(),
  })
  const [month, setMonth] = useState<MonthData | null>(null)
  const [year, setYear] = useState<YearData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    if (sel.gran === 'day') { setLoading(false); return }
    setLoading(true)
    const url = sel.gran === 'month'
      ? `/api/climate/noaa?year=${sel.year}&month=${sel.month}`
      : `/api/climate/noaa?year=${sel.year}`
    fetch(url).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (cancel) return
      if (sel.gran === 'month') { setMonth(j); setYear(null) } else { setYear(j); setMonth(null) }
      setLoading(false)
    }).catch(() => !cancel && setLoading(false))
    return () => { cancel = true }
  }, [sel])

  // Conversores a unidades de visualización (numéricos)
  const tN = (v?: number | null) => (v == null ? null : Math.round(u.tempN(v) * 10) / 10)
  const wN = (v?: number | null) => (v == null ? null : +u.wind(v))
  const pN = (v?: number | null) => (v == null ? null : +u.press(v))
  const rN = (v?: number | null) => (v == null ? 0 : +u.rain(v))

  const apply = () => setSel({ gran, day: pDay, month: pMonth, year: pYear })

  // --- Vista de DÍA: delega en el detalle diario ---
  if (sel.gran === 'day') {
    return (
      <div className="space-y-4">
        <Header gran={gran} setGran={setGran} pDay={pDay} setPDay={setPDay} pMonth={pMonth} setPMonth={setPMonth}
          pYear={pYear} setPYear={setPYear} apply={apply} maxYear={now.getFullYear()} />
        <HistoryDayDetail key={sel.day} date={sel.day} onBack={() => { setGran('month'); setSel({ ...sel, gran: 'month' }) }} />
      </div>
    )
  }

  const isMonth = sel.gran === 'month'
  const s = isMonth ? month?.summary : year?.summary
  const hasData = !!s && s.days > 0

  // Puntos para las gráficas
  const monthPoints: HistPoint[] = (month?.days ?? []).map((d) => ({
    x: d.date.slice(8),
    max: tN(d.high), min: tN(d.low), prom: tN(d.mean_temp),
    vmed: wN(d.wind_avg), vmax: wN(d.gust_max), dir: d.wind_dir ?? null,
    hum: d.hum_avg ?? null, dew: tN(d.dew_avg),
    uv: d.uv_max ?? null, solar: d.solar_max ?? null,
    pprom: pN(d.press_avg), lluvia: rN(d.rain),
  }))
  const yearPoints: HistPoint[] = (year?.months ?? []).map((m) => ({
    x: MES_ABR[m.month - 1],
    max: tN(m.high?.value), min: tN(m.low?.value), prom: tN(m.mean_temp),
    vmed: wN(m.wind_avg), vmax: wN(m.gust_max?.value), dir: m.wind_dir ?? null,
    hum: m.hum_avg ?? null, dew: tN(m.dew_avg),
    uv: m.uv_max ?? null, solar: m.solar_max ?? null,
    pprom: pN(m.press_avg), lluvia: rN(m.rain_total),
  }))

  const points = isMonth ? monthPoints : yearPoints
  const labelFmt = isMonth
    ? (l: string) => `${l} de ${MESES[sel.month - 1].toLowerCase()} ${sel.year}`
    : (l: string) => `${l} ${sel.year}`

  const downloadCsv = () => {
    let header: string, body: string[]
    if (isMonth) {
      header = 'fecha,temp_max,temp_min,temp_prom,hum_prom,lluvia,viento_max,presion_prom,uv_max,solar_max'
      body = (month?.days ?? []).map((d) => [d.date, d.high ?? '', d.low ?? '', d.mean_temp ?? '', d.hum_avg ?? '', d.rain ?? '', d.gust_max ?? '', d.press_avg ?? '', d.uv_max ?? '', d.solar_max ?? ''].join(','))
    } else {
      header = 'mes,temp_max,temp_min,temp_prom,lluvia_total,dias_lluvia,viento_max'
      body = (year?.months ?? []).map((m) => [MESES[m.month - 1], m.high?.value ?? '', m.low?.value ?? '', m.mean_temp ?? '', m.rain_total ?? '', m.rain_days ?? '', m.gust_max?.value ?? ''].join(','))
    }
    const url = URL.createObjectURL(new Blob([[header, ...body].join('\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `historia_xe1e_${sel.year}${isMonth ? '-' + String(sel.month).padStart(2, '0') : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const stat = (label: string, value: string, cls: string) => (
    <div className="card text-center py-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
    </div>
  )

  const heading = isMonth ? `${MESES[sel.month - 1]} ${sel.year}` : `Año ${sel.year}`

  return (
    <div className="space-y-4">
      <Header gran={gran} setGran={setGran} pDay={pDay} setPDay={setPDay} pMonth={pMonth} setPMonth={setPMonth}
        pYear={pYear} setPYear={setPYear} apply={apply} maxYear={now.getFullYear()} />

      <div className="card"><p className="text-lg font-semibold">{heading}</p></div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-slate-400">Cargando…</div>
      ) : !hasData ? (
        <div className="card text-slate-400">
          No hay datos registrados para {heading}. El histórico se irá llenando conforme la estación acumule lecturas.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {stat('Temperatura máxima', s!.high ? `${u.temp(s!.high.value)} ${u.tempU}` : '--', 'text-orange-300')}
            {stat('Temperatura mínima', s!.low ? `${u.temp(s!.low.value)} ${u.tempU}` : '--', 'text-sky-300')}
            {stat('Promedio', s!.mean_temp != null ? `${u.temp(s!.mean_temp)} ${u.tempU}` : '--', 'text-slate-100')}
            {stat('Precipitación total', s!.rain_total != null ? `${u.rain(s!.rain_total)} ${u.rainU}` : '--', 'text-violet-300')}
            {stat('Viento máximo', (s!.gust_max ?? s!.wind_max) ? `${u.wind((s!.gust_max ?? s!.wind_max)!.value)} ${u.windU}` : '--', 'text-emerald-300')}
            {stat('Días lluviosos', String(s!.rain_days ?? 0), 'text-blue-300')}
          </div>

          <HistoryCharts data={points} labelFormatter={labelFmt} onCsv={downloadCsv} />

          {/* Tabla: días del mes (clic → detalle) o meses del año (clic → mes) */}
          <div className="card overflow-x-auto">
            {isMonth ? (
              <table className="w-full text-sm min-w-[520px] tabular-nums">
                <thead>
                  <tr className="text-slate-400 text-xs border-b border-white/10">
                    <th className="text-left py-1.5">Día</th><th className="text-right">Máx</th><th className="text-right">Mín</th>
                    <th className="text-right">Prom</th><th className="text-right">Humedad</th><th className="text-right">Lluvia</th><th className="text-right">Viento máx</th>
                  </tr>
                </thead>
                <tbody>
                  {(month?.days ?? []).map((d) => (
                    <tr key={d.date} onClick={() => { setPDay(d.date); setGran('day'); setSel({ ...sel, gran: 'day', day: d.date }) }}
                      className="border-b border-white/5 cursor-pointer hover:bg-white/5">
                      <td className="py-1.5 text-slate-300">{d.date.slice(8)} ›</td>
                      <td className="text-right text-orange-300">{d.high != null ? u.temp(d.high) : '--'}</td>
                      <td className="text-right text-sky-300">{d.low != null ? u.temp(d.low) : '--'}</td>
                      <td className="text-right">{d.mean_temp != null ? u.temp(d.mean_temp) : '--'}</td>
                      <td className="text-right text-cyan-300">{d.hum_avg != null ? `${Math.round(d.hum_avg)}%` : '--'}</td>
                      <td className="text-right text-blue-300">{d.rain != null ? u.rain(d.rain) : '--'}</td>
                      <td className="text-right text-emerald-300">{d.gust_max != null ? u.wind(d.gust_max) : '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm min-w-[520px] tabular-nums">
                <thead>
                  <tr className="text-slate-400 text-xs border-b border-white/10">
                    <th className="text-left py-1.5">Mes</th><th className="text-right">Máx</th><th className="text-right">Mín</th>
                    <th className="text-right">Prom</th><th className="text-right">Lluvia</th><th className="text-right">Días lluvia</th>
                  </tr>
                </thead>
                <tbody>
                  {(year?.months ?? []).map((m) => (
                    <tr key={m.month} onClick={() => { setPMonth(m.month); setGran('month'); setSel({ ...sel, gran: 'month', month: m.month }) }}
                      className="border-b border-white/5 cursor-pointer hover:bg-white/5">
                      <td className="py-1.5 text-slate-300">{MESES[m.month - 1]} ›</td>
                      <td className="text-right text-orange-300">{m.high ? u.temp(m.high.value) : '--'}</td>
                      <td className="text-right text-sky-300">{m.low ? u.temp(m.low.value) : '--'}</td>
                      <td className="text-right">{m.mean_temp != null ? u.temp(m.mean_temp) : '--'}</td>
                      <td className="text-right text-blue-300">{m.rain_total != null ? u.rain(m.rain_total) : '--'}</td>
                      <td className="text-right">{m.rain_days ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      <p className="text-xs text-slate-500">Datos de la estación (InfluxDB) · temperaturas en {u.tempU}. Pasa el cursor sobre las gráficas para ver los valores.</p>
    </div>
  )
}

// Cabecera con selector de granularidad + controles
function Header(props: {
  gran: Gran; setGran: (g: Gran) => void
  pDay: string; setPDay: (v: string) => void
  pMonth: number; setPMonth: (v: number) => void
  pYear: number; setPYear: (v: number) => void
  apply: () => void; maxYear: number
}) {
  const { gran, setGran, pDay, setPDay, pMonth, setPMonth, pYear, setPYear, apply, maxYear } = props
  const gbtn = (g: Gran, label: string) =>
    <button onClick={() => setGran(g)} className={`px-3 py-1.5 rounded-lg text-sm ${gran === g ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/15'}`}>{label}</button>
  const inp = 'bg-white/5 border border-white/10 rounded-lg text-sm px-2 py-1.5 text-slate-200'
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 className="text-lg font-semibold text-slate-300">Historia</h2>
        <p className="text-xs text-slate-400">Historial meteorológico para {LOCATION.label}.</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">{gbtn('day', 'Día')}{gbtn('month', 'Mes')}{gbtn('year', 'Año')}</div>
        {gran === 'day' && <input type="date" value={pDay} onChange={(e) => setPDay(e.target.value)} className={inp} />}
        {gran === 'month' && (
          <select value={pMonth} onChange={(e) => setPMonth(Number(e.target.value))} className={inp}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        )}
        {gran !== 'day' && (
          <input type="number" value={pYear} min={2020} max={maxYear} onChange={(e) => setPYear(Number(e.target.value))} className={`w-20 ${inp}`} />
        )}
        <button onClick={apply} className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">Ver</button>
      </div>
    </div>
  )
}
