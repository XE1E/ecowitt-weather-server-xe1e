import { useState, useEffect } from 'react'
import {
  LineChart, Line, Bar, ComposedChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useUnits } from '../../units'

interface Row {
  _time: string
  temperature_outdoor?: number
  dew_point?: number
  feels_like?: number
  humidity_outdoor?: number
  wind_speed?: number
  wind_gust?: number
  wind_direction?: number
  pressure_relative?: number
  pressure_absolute?: number
  rain_rate?: number
  rain_hourly?: number
  rain_daily?: number
  uv_index?: number
  solar_radiation?: number
}

const CARDINAL = ['N', 'E', 'S', 'O', 'N']
const CARD16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const dir16 = (deg?: number) => (deg == null ? '' : CARD16[Math.round(deg / 22.5) % 16])

function fmtLongDate(date: string): string {
  const s = new Date(date + 'T12:00:00').toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function shiftDay(date: string, delta: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}
function shortDay(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

export function HistoryDayDetail({ date, onBack }: { date: string; onBack: () => void }) {
  const u = useUnits()
  const [cur, setCur] = useState(date)
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    // Día local CDMX (UTC-6): de 06:00Z a 06:00Z del día siguiente
    const start = `${cur}T06:00:00Z`
    const stop = `${shiftDay(cur, 1)}T06:00:00Z`
    let cancel = false
    setRows(null)
    fetch(`/api/history?start=${start}&stop=${stop}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => { if (!cancel) setRows(j.data ?? []) })
      .catch(() => !cancel && setRows([]))
    return () => { cancel = true }
  }, [cur])

  const fmtTick = (t: number) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  const data = (rows ?? []).map((r) => ({
    t: new Date(r._time).getTime(),
    temp: r.temperature_outdoor != null ? +u.temp(r.temperature_outdoor) : null,
    dew: r.dew_point != null ? +u.temp(r.dew_point) : null,
    feels: r.feels_like != null ? +u.temp(r.feels_like) : null,
    hum: r.humidity_outdoor ?? null,
    vmed: r.wind_speed != null ? +u.wind(r.wind_speed) : null,
    vmax: r.wind_gust != null ? +u.wind(r.wind_gust) : null,
    dir: r.wind_direction ?? null,
    press: r.pressure_relative != null ? +u.press(r.pressure_relative) : null,
    rain: r.rain_rate != null ? +u.rain(r.rain_rate) : 0,
    uv: r.uv_index ?? null,
    solar: r.solar_radiation ?? null,
  }))

  // Resumen del día desde los datos horarios
  const vals = (f: (r: Row) => number | undefined) =>
    (rows ?? []).map(f).filter((v): v is number => v != null)
  const temps = vals((r) => r.temperature_outdoor)
  const has = (rows?.length ?? 0) > 0
  const max = temps.length ? Math.max(...temps) : null
  const min = temps.length ? Math.min(...temps) : null
  const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null
  const rainTotal = Math.max(0, ...vals((r) => r.rain_daily))
  const gustMax = vals((r) => r.wind_gust)
  const windAvg = vals((r) => r.wind_speed)
  const humAvg = vals((r) => r.humidity_outdoor)
  const pressAvg = vals((r) => r.pressure_relative)
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

  const nf = (v: number) => Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })
  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
  }
  const cursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }

  const card = (label: string, value: string, cls = 'text-slate-100', ring = '') => (
    <div className={`card py-4 ${ring}`}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
    </div>
  )
  const LineCard = ({ title, unit, series }: { title: string; unit: string; series: { key: string; name: string; color: string; dash?: string }[] }) => (
    <div className="card">
      <p className="card-title">{title}</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={40} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
            <Tooltip cursor={cursor} {...tip} labelFormatter={(l) => fmtTick(Number(l))} formatter={(v: number, n: string) => [`${nf(v)} ${unit}`, n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            {series.map((se) => (
              <Line key={se.key} type="monotone" dataKey={se.key} name={se.name} stroke={se.color} strokeWidth={2} strokeDasharray={se.dash} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Cabecera del detalle */}
      <div>
        <button onClick={onBack} className="text-sm text-blue-400 hover:text-blue-300">← Volver al resumen</button>
        <div className="flex items-end justify-between gap-2 flex-wrap mt-1">
          <div>
            <h2 className="text-xl font-bold">{fmtLongDate(cur)}</h2>
            <p className="text-xs text-slate-400">Datos meteorológicos diarios</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCur(shiftDay(cur, -1))} className="px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">← {shortDay(shiftDay(cur, -1))}</button>
            <button onClick={() => setCur(shiftDay(cur, 1))} className="px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">{shortDay(shiftDay(cur, 1))} →</button>
          </div>
        </div>
      </div>

      {rows === null ? (
        <div className="h-40 flex items-center justify-center text-slate-400">Cargando…</div>
      ) : !has ? (
        <div className="card text-slate-400">Sin datos registrados para este día.</div>
      ) : (
        <>
          {/* 8 tarjetas de resumen del día */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {card('Máximo', max != null ? `${u.temp(max)} ${u.tempU}` : '--', 'text-orange-300', 'ring-1 ring-orange-500/30')}
            {card('Mínimo', min != null ? `${u.temp(min)} ${u.tempU}` : '--', 'text-cyan-300', 'ring-1 ring-cyan-500/30')}
            {card('Promedio', avg != null ? `${u.temp(avg)} ${u.tempU}` : '--')}
            {card('Precipitaciones', `${u.rain(rainTotal)} ${u.rainU}`, 'text-violet-300', 'ring-1 ring-violet-500/30')}
            {card('Viento máximo', gustMax.length ? `${u.wind(Math.max(...gustMax))} ${u.windU}` : '--', 'text-emerald-300')}
            {card('Viento medio', windAvg.length ? `${u.wind(mean(windAvg)!)} ${u.windU}` : '--', 'text-emerald-300')}
            {card('Humedad', humAvg.length ? `${Math.round(mean(humAvg)!)}%` : '--', 'text-sky-300')}
            {card('Presión', pressAvg.length ? `${u.press(mean(pressAvg)!)} ${u.pressU}` : '--', 'text-violet-300')}
          </div>

          {/* Gráficas por hora del día (mismos 5 grupos que el mes) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LineCard title="Temperatura" unit={u.tempU} series={[
              { key: 'temp', name: 'Temperatura', color: '#f97316' },
              { key: 'feels', name: 'Sensación', color: '#a78bfa' },
            ]} />

            {/* Viento: medio/máx (líneas) + dirección (puntos, eje derecho) */}
            <div className="card">
              <p className="card-title">Viento</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={40} />
                    <YAxis yAxisId="v" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
                    <YAxis yAxisId="dir" orientation="right" domain={[0, 360]} ticks={[0, 90, 180, 270, 360]}
                      tickFormatter={(t: number) => CARDINAL[t / 90]} tick={{ fill: '#84cc16', fontSize: 10 }} width={28} />
                    <Tooltip cursor={cursor} {...tip} labelFormatter={(l) => fmtTick(Number(l))} formatter={(v: number, n: string) => [n === 'Dirección' ? `${Math.round(v)}° (${dir16(v)})` : `${nf(v)} ${u.windU}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Line yAxisId="v" type="monotone" dataKey="vmed" name="Viento medio" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="v" type="monotone" dataKey="vmax" name="Viento máximo" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />
                    <Scatter yAxisId="dir" dataKey="dir" name="Dirección" fill="#84cc16" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Humedad y punto de rocío (doble eje) */}
            <div className="card">
              <p className="card-title">Humedad y punto de rocío</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={40} />
                    <YAxis yAxisId="h" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
                    <YAxis yAxisId="d" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
                    <Tooltip cursor={cursor} {...tip} labelFormatter={(l) => fmtTick(Number(l))} formatter={(v: number, n: string) => [n === 'Humedad' ? `${nf(v)} %` : `${nf(v)} ${u.tempU}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Line yAxisId="h" type="monotone" dataKey="hum" name="Humedad" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="d" type="monotone" dataKey="dew" name="Punto de rocío" stroke="#22d3ee" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Radiación UV y solar (doble eje) */}
            <div className="card">
              <p className="card-title">Radiación UV y solar</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={40} />
                    <YAxis yAxisId="s" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
                    <YAxis yAxisId="u" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={30} />
                    <Tooltip cursor={cursor} {...tip} labelFormatter={(l) => fmtTick(Number(l))} formatter={(v: number, n: string) => [n === 'Radiación solar' ? `${nf(v)} W/m²` : `${nf(v)}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Line yAxisId="s" type="monotone" dataKey="solar" name="Radiación solar" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="u" type="monotone" dataKey="uv" name="Índice UV" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Precipitación y presión (doble eje) */}
            <div className="card lg:col-span-2">
              <p className="card-title">Precipitación y presión</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={40} />
                    <YAxis yAxisId="r" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
                    <YAxis yAxisId="p" orientation="right" domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} {...tip} labelFormatter={(l) => fmtTick(Number(l))} formatter={(v: number, n: string) => [n === 'Presión' ? `${nf(v)} ${u.pressU}` : `${nf(v)} ${u.rateU}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Bar yAxisId="r" dataKey="rain" name="Tasa de lluvia" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="p" type="monotone" dataKey="press" name="Presión" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Mediciones por hora (una fila por hora) */}
          {(() => {
            // Downsample: una lectura por hora (la primera de cada hora)
            const byHour = new Map<string, Row>()
            for (const r of rows!) {
              const key = r._time.slice(0, 13) // YYYY-MM-DDTHH
              if (!byHour.has(key)) byHour.set(key, r)
            }
            const slice = Array.from(byHour.values())
            const hhmm = (t: string) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
            return (
              <div className="card">
                <p className="card-title">Mediciones por hora</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[820px] tabular-nums">
                    <thead>
                      <tr className="text-slate-400 text-xs border-b border-white/10">
                        <th className="text-left py-1.5">Hora</th>
                        <th className="text-right">Temp.</th>
                        <th className="text-right">Sensación</th>
                        <th className="text-right">P. rocío</th>
                        <th className="text-right">Humedad</th>
                        <th className="text-right">Viento</th>
                        <th className="text-right">Presión</th>
                        <th className="text-right">Lluvia</th>
                        <th className="text-right">UV</th>
                        <th className="text-right">Solar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slice.map((r) => (
                        <tr key={r._time} className="border-b border-white/5">
                          <td className="py-1.5 font-semibold text-slate-300">{hhmm(r._time)}</td>
                          <td className="text-right">{r.temperature_outdoor != null ? `${u.temp(r.temperature_outdoor)} ${u.tempU}` : '--'}</td>
                          <td className="text-right">{r.feels_like != null ? `${u.temp(r.feels_like)} ${u.tempU}` : '--'}</td>
                          <td className="text-right">{r.dew_point != null ? `${u.temp(r.dew_point)} ${u.tempU}` : '--'}</td>
                          <td className="text-right text-cyan-300">{r.humidity_outdoor != null ? `${Math.round(r.humidity_outdoor)}%` : '--'}</td>
                          <td className="text-right">
                            <span className="text-emerald-300">{r.wind_speed != null ? `${u.wind(r.wind_speed)} ${u.windU}` : '--'}</span>
                            <span className="block text-[10px] text-slate-500">
                              {r.wind_gust != null ? `ráf. ${u.wind(r.wind_gust)}` : ''}{r.wind_direction != null ? ` · ${dir16(r.wind_direction)}` : ''}
                            </span>
                          </td>
                          <td className="text-right text-violet-300">{r.pressure_relative != null ? `${u.press(r.pressure_relative)} ${u.pressU}` : '--'}</td>
                          <td className="text-right text-blue-300">{r.rain_rate != null ? `${u.rain(r.rain_rate)} ${u.rateU}` : '--'}</td>
                          <td className="text-right text-yellow-300">{r.uv_index ?? '--'}</td>
                          <td className="text-right">{r.solar_radiation != null ? `${Math.round(r.solar_radiation)} W/m²` : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </>
      )}
      <p className="text-xs text-slate-500">Datos por hora de la estación (InfluxDB). Pasa el cursor sobre las gráficas para ver los valores.</p>
    </div>
  )
}
