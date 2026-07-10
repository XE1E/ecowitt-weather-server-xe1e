import { useState, useEffect } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { CalendarDays } from 'lucide-react'
import { useUnits } from '../units'
import { LOCATION } from '../config'
import { PageInfo } from '../components/station/PageInfo'

interface Rec { value: number; date: string }
interface Period {
  days: number
  date?: string
  mean_temp?: number | null
  high?: Rec | null
  low?: Rec | null
  rain_total?: number
  rain_max_day?: Rec | null
  rain_days?: number
  wind_avg?: number | null
  wind_max?: Rec | null
  gust_max?: Rec | null
  hum_avg?: number | null
  hum_max?: number | null
  hum_min?: number | null
  hdd?: number
  cdd?: number
  et_total?: number | null
}
interface RecordsBundle {
  all_time: Record<string, Rec | null> & { days: number }
  monthly: Record<string, { temp_max?: Rec; temp_min?: Rec; rain_max_day?: Rec; gust_max?: Rec }>
  this_month: Period
  this_year: Period
  yesterday: Period | null
}
interface NoaaDay {
  date: string; mean_temp?: number | null; high?: number | null; high_time?: string | null
  low?: number | null; low_time?: string | null; hdd?: number | null; cdd?: number | null
  rain?: number | null; wind_avg?: number | null; gust_max?: number | null; et?: number | null
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

interface OnThisDay {
  month_day: string
  count: number
  years: { date: string; temp_max?: number | null; temp_min?: number | null; rain_total?: number | null }[]
  warmest?: Rec | null
  coldest?: Rec | null
  wettest?: Rec | null
}

export function ClimatePage() {
  const u = useUnits()
  const [rec, setRec] = useState<RecordsBundle | null>(null)
  const [otd, setOtd] = useState<OnThisDay | null>(null)
  const [year, setYear] = useState(YEAR_NOW)
  const [month, setMonth] = useState<number | null>(null) // null = anual
  const [noaa, setNoaa] = useState<Noaa | null>(null)
  const [yearData, setYearData] = useState<Noaa | null>(null)
  const [loadingNoaa, setLoadingNoaa] = useState(false)

  useEffect(() => {
    fetch('/api/climate/records').then((r) => (r.ok ? r.json() : null)).then(setRec).catch(() => {})
    fetch('/api/climate/onthisday').then((r) => (r.ok ? r.json() : null)).then(setOtd).catch(() => {})
  }, [])

  // Datos anuales para el climograma (siempre año completo, independiente del selector)
  useEffect(() => {
    fetch(`/api/climate/noaa?year=${year}`).then((r) => (r.ok ? r.json() : null)).then(setYearData).catch(() => {})
  }, [year])

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

  const row = (label: string, value: string, color = 'text-slate-200') => (
    <><span className="text-slate-400">{label}</span><span className={`text-right ${color}`}>{value}</span></>
  )

  const periodCard = (title: string, p?: Period | null) => {
    if (!p || !p.days) return (
      <div className="card"><p className="text-base font-bold text-slate-100">{title}</p><p className="text-slate-500 text-sm mt-1">Sin datos aún</p></div>
    )
    return (
      <div className="card">
        <p className="text-base font-bold text-slate-100">
          {title}
          <span className="text-slate-500 font-normal text-xs ml-1">
            {p.date ? fmtDay(p.date) : `${p.days} d`}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm mt-2">
          {row('Temperatura media', p.mean_temp != null ? `${u.temp(p.mean_temp)}${u.tempU}` : '--')}
          {row('Temperatura máxima', p.high ? `${u.temp(p.high.value)}${u.tempU}` : '--', 'text-right text-orange-300')}
          {row('Temperatura mínima', p.low ? `${u.temp(p.low.value)}${u.tempU}` : '--', 'text-right text-sky-300')}
          <div className="col-span-2 border-t border-white/5 my-1" />
          {row('Humedad media', p.hum_avg != null ? `${p.hum_avg.toFixed(0)} %` : '--')}
          {row('Humedad máxima', p.hum_max != null ? `${p.hum_max.toFixed(0)} %` : '--', 'text-right text-cyan-300')}
          {row('Humedad mínima', p.hum_min != null ? `${p.hum_min.toFixed(0)} %` : '--', 'text-right text-cyan-300')}
          <div className="col-span-2 border-t border-white/5 my-1" />
          {row('Viento medio', p.wind_avg != null ? `${u.wind(p.wind_avg)} ${u.windU}` : '--')}
          {row('Viento máximo', p.wind_max ? `${u.wind(p.wind_max.value)} ${u.windU}` : '--', 'text-right text-emerald-300')}
          {row('Ráfaga máxima', p.gust_max ? `${u.wind(p.gust_max.value)} ${u.windU}` : '--', 'text-right text-emerald-300')}
          <div className="col-span-2 border-t border-white/5 my-1" />
          {row('Lluvia', p.rain_total != null ? `${u.rain(p.rain_total)} ${u.rainU}` : '--', 'text-right text-blue-300')}
          {row('Días con lluvia', p.rain_days != null ? String(p.rain_days) : '--')}
          {(p.hdd != null || p.cdd != null) && row('Grados-día (cal/ref)', `${p.hdd ?? '--'} / ${p.cdd ?? '--'}`, 'text-right text-slate-400')}
          {p.et_total != null && row('Evapotranspiración', `${p.et_total} mm`, 'text-right text-emerald-300')}
        </div>
      </div>
    )
  }

  // ── Climograma: barras de lluvia + líneas de temperatura por mes ──
  const climo = (yearData?.months ?? []).map((m) => ({
    mes: MES[m.month - 1],
    lluvia: m.rain_total != null ? Number(u.rain(m.rain_total)) : null,
    tmed: m.mean_temp != null ? Number(u.temp(m.mean_temp)) : null,
    tmax: m.high ? Number(u.temp(m.high.value)) : null,
    tmin: m.low ? Number(u.temp(m.low.value)) : null,
  }))
  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-100 mb-1 flex items-center gap-2"><CalendarDays className="w-6 h-6 text-sky-400" /> Climatología Local</h2>
      <p className="text-xs text-slate-400 mb-4">Resúmenes construidos desde el histórico diario de la estación Clima XE1E · {LOCATION.label}.</p>

      {!hasData && (
        <div className="card text-slate-400 mb-6">
          Aún no hay días registrados. La climatología se irá construyendo día a día conforme la estación acumule datos.
        </div>
      )}

      {hasData && (
        <>
          {/* Resúmenes rápidos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {periodCard('Ayer', rec!.yesterday)}
            {periodCard('Este mes', rec!.this_month)}
            {periodCard('Este año', rec!.this_year)}
          </div>

          {/* Climograma anual */}
          {climo.length > 0 && (
            <div className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="text-lg font-semibold text-slate-300">Climograma · {year}</h3>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                  className="bg-white/5 border border-white/10 rounded-lg text-sm px-2 py-1">
                  {[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="card">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={climo} margin={{ top: 5, right: 6, left: -6, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="mes" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <YAxis yAxisId="r" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44}
                        label={{ value: `Lluvia (${u.rainU})`, angle: -90, position: 'insideLeft', fill: '#60a5fa', fontSize: 11 }} />
                      <YAxis yAxisId="t" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
                      <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} {...tip}
                        formatter={(v: number, n: string) => [n === 'Lluvia' ? `${v} ${u.rainU}` : `${v} ${u.tempU}`, n]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                      <Bar yAxisId="r" dataKey="lluvia" name="Lluvia" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="t" type="monotone" dataKey="tmax" name="T. máxima" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />
                      <Line yAxisId="t" type="monotone" dataKey="tmed" name="T. media" stroke="#94a3b8" strokeWidth={2} dot={false} connectNulls />
                      <Line yAxisId="t" type="monotone" dataKey="tmin" name="T. mínima" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Barras: precipitación mensual. Líneas: temperatura media, máxima y mínima del mes.
                </p>
              </div>
            </div>
          )}

          {/* Récords por mes */}
          <h3 className="text-lg font-semibold text-slate-300 mb-2">Récords por mes</h3>
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

          {/* En este día */}
          {otd && otd.count > 0 && (
            <div className="card mb-6">
              <p className="text-base font-bold text-slate-100">En este día</p>
              <p className="text-xs text-slate-500 mb-2">Qué pasó un {otd.month_day.slice(3)}/{otd.month_day.slice(0, 2)} en años anteriores</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[360px]">
                  <thead>
                    <tr className="text-[11px] text-slate-500 text-left">
                      <th className="font-normal">Año</th>
                      <th className="text-right font-normal">Máx</th>
                      <th className="text-right font-normal">Mín</th>
                      <th className="text-right font-normal">Lluvia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otd.years.map((y) => (
                      <tr key={y.date} className="border-t border-white/5">
                        <td className="py-1 text-slate-300">{y.date.slice(0, 4)}</td>
                        <td className="text-right text-orange-300">{y.temp_max != null ? `${u.temp(y.temp_max)}${u.tempU}` : '--'}</td>
                        <td className="text-right text-sky-300">{y.temp_min != null ? `${u.temp(y.temp_min)}${u.tempU}` : '--'}</td>
                        <td className="text-right text-blue-300">{y.rain_total != null ? `${u.rain(y.rain_total)} ${u.rainU}` : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Reporte NOAA */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-lg font-semibold text-slate-300">Reporte climatológico (estilo NOAA)</h3>
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
                <th className="text-right" title="Evapotranspiración (mm)">ET</th>
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
                  <td className="text-right text-slate-400">{d.et != null ? d.et : '--'}</td>
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
            {noaa.summary.et_total != null ? ` · ET ${noaa.summary.et_total} mm` : ''}
            {(noaa.summary.hdd != null || noaa.summary.cdd != null) ? ` · grados-día ${noaa.summary.hdd ?? 0}/${noaa.summary.cdd ?? 0}` : ''}
          </p>
        ) : null}
      </div>
      <p className="text-[11px] text-slate-600 mt-2">Temperaturas en {u.tempU}. Grados-día con base 18.3 °C (estándar NOAA). Un "día con lluvia" es ≥ 0.2 mm.</p>

      <PageInfo>
        <p>
          La <span className="font-semibold">climatología</span> describe el comportamiento típico del clima en tu
          ubicación a partir del histórico diario de la estación: resúmenes de <span className="font-semibold">ayer, este mes y este año</span>,
          el <span className="font-semibold">climograma</span> (barras de lluvia y líneas de temperatura por mes —
          la gráfica clásica del clima), los <span className="font-semibold">récords por mes</span>, el
          {' '}<span className="font-semibold">reporte estilo NOAA</span> (tabla diaria/mensual/anual) y la efeméride
          {' '}<span className="font-semibold">“en este día”</span>. A diferencia del pronóstico, describe lo ya ocurrido y
          se enriquece con cada día que la estación acumula.
        </p>
      </PageInfo>
    </div>
  )
}
