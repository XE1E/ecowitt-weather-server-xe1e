import { useState, useEffect } from 'react'
import { useUnits } from '../units'

interface Rec { value: number; date: string }
interface Period {
  days: number
  mean_temp?: number | null
  high?: Rec | null
  low?: Rec | null
  rain_total?: number
  rain_max_day?: Rec | null
  rain_days?: number
  wind_avg?: number | null
  wind_max?: Rec | null
  gust_max?: Rec | null
  hdd?: number
  cdd?: number
}
interface DailyRow {
  date: string
  temp_avg?: number | null
}
interface RecordsBundle {
  all_time: Record<string, Rec | null> & { days: number }
  monthly: Record<string, { temp_max?: Rec; temp_min?: Rec; rain_max_day?: Rec; gust_max?: Rec }>
  this_month: Period
  this_year: Period
  yesterday: DailyRow | null
}
interface NoaaDay {
  date: string; mean_temp?: number | null; high?: number | null; high_time?: string | null
  low?: number | null; low_time?: string | null; hdd?: number | null; cdd?: number | null
  rain?: number | null; wind_avg?: number | null; gust_max?: number | null
}
interface NoaaMonthRow extends Period { month: number }
interface Noaa {
  scope: 'month' | 'year'; year: number; month?: number
  days?: NoaaDay[]; months?: NoaaMonthRow[]; summary: Period
}

const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const YEAR_NOW = 2026

function fmtDay(d?: string) {
  if (!d) return '--'
  const dt = new Date(d + 'T12:00:00')
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}
function hhmm(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

export function ClimatePage() {
  const u = useUnits()
  const [rec, setRec] = useState<RecordsBundle | null>(null)
  const [year, setYear] = useState(YEAR_NOW)
  const [month, setMonth] = useState<number | null>(null) // null = anual
  const [noaa, setNoaa] = useState<Noaa | null>(null)
  const [loadingNoaa, setLoadingNoaa] = useState(false)

  useEffect(() => {
    fetch('/api/climate/records').then((r) => (r.ok ? r.json() : null)).then(setRec).catch(() => {})
  }, [])

  useEffect(() => {
    setLoadingNoaa(true)
    const q = month ? `year=${year}&month=${month}` : `year=${year}`
    fetch(`/api/climate/noaa?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setNoaa(j))
      .catch(() => setNoaa(null))
      .finally(() => setLoadingNoaa(false))
  }, [year, month])

  const hasData = rec && rec.all_time && rec.all_time.days > 0

  const periodCard = (title: string, p?: Period | null) => {
    if (!p || !p.days) return (
      <div className="card"><p className="card-title">{title}</p><p className="text-slate-500 text-sm">Sin datos aún</p></div>
    )
    return (
      <div className="card">
        <p className="card-title">{title} <span className="text-slate-500 font-normal text-xs">({p.days} d)</span></p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm mt-1">
          <span className="text-slate-400">Media</span><span className="text-right">{p.mean_temp != null ? `${u.temp(p.mean_temp)}${u.tempU}` : '--'}</span>
          <span className="text-slate-400">Máx</span><span className="text-right text-orange-300">{p.high ? `${u.temp(p.high.value)}${u.tempU}` : '--'}</span>
          <span className="text-slate-400">Mín</span><span className="text-right text-sky-300">{p.low ? `${u.temp(p.low.value)}${u.tempU}` : '--'}</span>
          <span className="text-slate-400">Lluvia</span><span className="text-right text-blue-300">{p.rain_total != null ? `${u.rain(p.rain_total)} ${u.rainU}` : '--'}</span>
          <span className="text-slate-400">Días lluvia</span><span className="text-right">{p.rain_days ?? '--'}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-300 mb-1">Climatología</h2>
      <p className="text-xs text-slate-500 mb-4">Resúmenes construidos desde el histórico diario de la estación.</p>

      {!hasData && (
        <div className="card text-slate-400">
          Aún no hay días registrados. La climatología se irá construyendo día a día conforme la estación acumule datos.
        </div>
      )}

      {hasData && (
        <>
          {/* Resúmenes rápidos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {periodCard('Ayer', rec!.yesterday ? { days: 1, mean_temp: rec!.yesterday.temp_avg } as Period : null)}
            {periodCard('Este mes', rec!.this_month)}
            {periodCard('Este año', rec!.this_year)}
          </div>

          {/* Récords por mes */}
          <h3 className="text-base font-semibold text-slate-300 mb-2">Récords por mes</h3>
          <div className="card overflow-x-auto mb-6">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-white/10">
                  <th className="text-left py-1.5">Mes</th>
                  <th className="text-right">Temp máx</th>
                  <th className="text-right">Temp mín</th>
                  <th className="text-right">Ráfaga máx</th>
                  <th className="text-right">Día más lluvioso</th>
                </tr>
              </thead>
              <tbody>
                {MES.map((m, i) => {
                  const r = rec!.monthly[String(i + 1)]
                  if (!r) return null
                  return (
                    <tr key={m} className="border-b border-white/5">
                      <td className="py-1.5 text-slate-300">{MES_LARGO[i]}</td>
                      <td className="text-right text-orange-300">{r.temp_max ? `${u.temp(r.temp_max.value)}${u.tempU}` : '--'}<span className="block text-[10px] text-slate-500">{fmtDay(r.temp_max?.date)}</span></td>
                      <td className="text-right text-sky-300">{r.temp_min ? `${u.temp(r.temp_min.value)}${u.tempU}` : '--'}<span className="block text-[10px] text-slate-500">{fmtDay(r.temp_min?.date)}</span></td>
                      <td className="text-right text-emerald-300">{r.gust_max ? `${u.wind(r.gust_max.value)} ${u.windU}` : '--'}</td>
                      <td className="text-right text-blue-300">{r.rain_max_day ? `${u.rain(r.rain_max_day.value)} ${u.rainU}` : '--'}<span className="block text-[10px] text-slate-500">{fmtDay(r.rain_max_day?.date)}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Reporte NOAA */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-base font-semibold text-slate-300">Reporte climatológico (estilo NOAA)</h3>
        <div className="flex items-center gap-1 flex-wrap">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="bg-white/5 border border-white/10 rounded-lg text-sm px-2 py-1">
            {[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setMonth(null)} className={`px-2 py-1 rounded-lg text-sm ${month === null ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'}`}>Anual</button>
          {MES.map((m, i) => (
            <button key={m} onClick={() => setMonth(i + 1)} className={`px-2 py-1 rounded-lg text-xs ${month === i + 1 ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>{m}</button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loadingNoaa ? (
          <p className="text-slate-400 text-sm py-4 text-center">Cargando…</p>
        ) : !noaa || (!noaa.days?.length && !noaa.months?.length) ? (
          <p className="text-slate-400 text-sm py-4 text-center">Sin datos para {month ? MES_LARGO[month - 1] + ' ' : ''}{year}.</p>
        ) : noaa.scope === 'month' ? (
          <table className="w-full text-sm min-w-[680px] tabular-nums">
            <caption className="text-slate-300 text-left mb-2 font-medium">{MES_LARGO[(noaa.month ?? 1) - 1]} {noaa.year}</caption>
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/10">
                <th className="text-left py-1">Día</th><th className="text-right">Media</th>
                <th className="text-right">Máx</th><th className="text-right">hora</th>
                <th className="text-right">Mín</th><th className="text-right">hora</th>
                <th className="text-right" title="Grados-día de calefacción">GD cal</th>
                <th className="text-right" title="Grados-día de refrigeración">GD ref</th>
                <th className="text-right">Lluvia</th><th className="text-right">Ráfaga</th>
              </tr>
            </thead>
            <tbody>
              {noaa.days!.map((d) => (
                <tr key={d.date} className="border-b border-white/5">
                  <td className="py-1 text-slate-300">{d.date.slice(8)}</td>
                  <td className="text-right">{d.mean_temp != null ? u.temp(d.mean_temp) : '--'}</td>
                  <td className="text-right text-orange-300">{d.high != null ? u.temp(d.high) : '--'}</td>
                  <td className="text-right text-[11px] text-slate-500">{hhmm(d.high_time)}</td>
                  <td className="text-right text-sky-300">{d.low != null ? u.temp(d.low) : '--'}</td>
                  <td className="text-right text-[11px] text-slate-500">{hhmm(d.low_time)}</td>
                  <td className="text-right text-slate-400">{d.hdd ?? '--'}</td>
                  <td className="text-right text-slate-400">{d.cdd ?? '--'}</td>
                  <td className="text-right text-blue-300">{d.rain != null ? u.rain(d.rain) : '--'}</td>
                  <td className="text-right text-emerald-300">{d.gust_max != null ? u.wind(d.gust_max) : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm min-w-[620px] tabular-nums">
            <caption className="text-slate-300 text-left mb-2 font-medium">Año {noaa.year}</caption>
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/10">
                <th className="text-left py-1">Mes</th><th className="text-right">Media</th>
                <th className="text-right">Máx</th><th className="text-right">Mín</th>
                <th className="text-right">Lluvia</th><th className="text-right">Días</th>
                <th className="text-right">GD cal</th><th className="text-right">GD ref</th>
              </tr>
            </thead>
            <tbody>
              {noaa.months!.map((m) => (
                <tr key={m.month} className="border-b border-white/5">
                  <td className="py-1 text-slate-300">{MES_LARGO[m.month - 1]}</td>
                  <td className="text-right">{m.mean_temp != null ? u.temp(m.mean_temp) : '--'}</td>
                  <td className="text-right text-orange-300">{m.high ? u.temp(m.high.value) : '--'}</td>
                  <td className="text-right text-sky-300">{m.low ? u.temp(m.low.value) : '--'}</td>
                  <td className="text-right text-blue-300">{m.rain_total != null ? u.rain(m.rain_total) : '--'}</td>
                  <td className="text-right">{m.rain_days ?? '--'}</td>
                  <td className="text-right text-slate-400">{m.hdd ?? '--'}</td>
                  <td className="text-right text-slate-400">{m.cdd ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {noaa && noaa.summary?.days ? (
          <p className="text-xs text-slate-500 mt-3">
            Resumen: media {noaa.summary.mean_temp != null ? `${u.temp(noaa.summary.mean_temp)}${u.tempU}` : '--'} ·
            máx {noaa.summary.high ? `${u.temp(noaa.summary.high.value)}${u.tempU} (${fmtDay(noaa.summary.high.date)})` : '--'} ·
            mín {noaa.summary.low ? `${u.temp(noaa.summary.low.value)}${u.tempU} (${fmtDay(noaa.summary.low.date)})` : '--'} ·
            lluvia {noaa.summary.rain_total != null ? `${u.rain(noaa.summary.rain_total)} ${u.rainU}` : '--'} en {noaa.summary.rain_days ?? 0} día(s)
          </p>
        ) : null}
      </div>
      <p className="text-[11px] text-slate-600 mt-2">Temperaturas en {u.tempU}. Grados-día con base 18.3 °C (estándar NOAA). Un "día con lluvia" es ≥ 0.2 mm.</p>
    </div>
  )
}
