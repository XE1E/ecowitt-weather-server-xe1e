import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { LOCATION } from '../../config'

interface Sub { pollutant: string; conc: number; index: number }
interface Fc { t: string; imeca: number; category: string }
interface Imeca {
  available: boolean
  imeca?: number; dominant?: string; category?: string; color?: string
  recommendation?: string; pollutants?: Sub[]; forecast?: Fc[]; time?: string; source?: string
}

// Escala IMECA sobre 0–300 (los tramos miden 50,50,50,50,100)
const SEG = [
  { c: '#22c55e', to: 50 }, { c: '#eab308', to: 100 }, { c: '#f97316', to: 150 },
  { c: '#ef4444', to: 200 }, { c: '#a21caf', to: 300 },
]
const MAXSCALE = 300
const grad = (() => {
  let from = 0
  const stops: string[] = []
  for (const s of SEG) {
    const a = (from / MAXSCALE) * 100, b = (s.to / MAXSCALE) * 100
    stops.push(`${s.c} ${a}%`, `${s.c} ${b}%`)
    from = s.to
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
})()

function hourLabel(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(11, 16) : d.toLocaleTimeString('es-MX', { hour: '2-digit' })
}

export function ImecaCard() {
  const [d, setD] = useState<Imeca | null>(null)
  useEffect(() => {
    fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {})
  }, [])

  if (!d || !d.available || d.imeca == null) return null
  const pos = Math.min(100, (d.imeca / MAXSCALE) * 100)
  const isBad = d.imeca > 100
  const fc = (d.forecast ?? []).map((f) => ({ ...f, label: hourLabel(f.t) }))

  return (
    <div className="mt-4 space-y-4">
      {/* Aviso de contingencia / mala calidad */}
      {isBad && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-3 border"
          style={{ backgroundColor: d.color + '22', borderColor: d.color }}>
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: d.color }} />
          <div className="text-sm">
            <p className="font-semibold" style={{ color: d.color }}>Calidad del aire: {d.category}</p>
            <p className="text-slate-300">{d.recommendation}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* IMECA principal + medidor */}
        <div className="card lg:col-span-2">
          <p className="card-title">IMECA <span className="text-xs text-slate-500 font-normal">(estimado)</span></p>
          <div className="flex items-end gap-4">
            <div>
              <span className="text-5xl font-bold" style={{ color: d.color }}>{d.imeca}</span>
              <p className="text-lg font-semibold -mt-1" style={{ color: d.color }}>{d.category}</p>
            </div>
            {d.dominant && (
              <p className="text-xs text-slate-400 mb-2">Contaminante principal:<br /><span className="text-slate-200 font-semibold">{d.dominant}</span></p>
            )}
          </div>

          {/* Medidor visual */}
          <div className="mt-4">
            <div className="relative h-3 rounded-full" style={{ background: grad }}>
              <div className="absolute -top-1.5 w-1 h-6 bg-white rounded shadow -translate-x-1/2"
                style={{ left: `${pos}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>0</span><span>50</span><span>100</span><span>150</span><span>200</span><span>300+</span>
            </div>
          </div>

          {/* Sub-índices por contaminante (escala IMECA) */}
          {d.pollutants && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
              {d.pollutants.map((p) => (
                <div key={p.pollutant} className="rounded-lg bg-white/5 py-2 text-center">
                  <p className="text-[11px] text-slate-400">{p.pollutant}</p>
                  <p className="text-lg font-bold">{p.index}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recomendaciones de salud */}
        <div className="card">
          <p className="card-title">Recomendaciones de salud</p>
          <p className="text-sm text-slate-300 leading-relaxed">{d.recommendation}</p>
          <div className="mt-3 space-y-1 text-[11px]">
            {[
              ['#22c55e', 'Buena', '0–50'], ['#eab308', 'Regular', '51–100'], ['#f97316', 'Mala', '101–150'],
              ['#ef4444', 'Muy mala', '151–200'], ['#a21caf', 'Extremadamente mala', '201+'],
            ].map(([c, n, r]) => (
              <div key={n} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
                <span className="text-slate-300">{n}</span>
                <span className="text-slate-500 ml-auto">{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pronóstico por horas */}
      {fc.length > 1 && (
        <div className="card">
          <p className="card-title">Pronóstico del IMECA (próximas horas)</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={fc} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="imecaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={16} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={36} domain={[0, (m: number) => Math.max(120, Math.ceil(m / 20) * 20)]} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--ink, #e2e8f0)', fontWeight: 600 }}
                  formatter={(v: number, _n, p) => [`${v} · ${(p?.payload as Fc)?.category ?? ''}`, 'IMECA']}
                />
                <ReferenceLine y={100} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'Mala', fill: '#f97316', fontSize: 10, position: 'insideTopRight' }} />
                <Area type="monotone" dataKey="imeca" stroke="#38bdf8" strokeWidth={2} fill="url(#imecaFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        IMECA <span className="font-semibold">estimado</span> con las tablas oficiales (NADF-009-AIRE-2017) a partir de
        concentraciones modeladas de {d.source ?? 'Open-Meteo'}. No es la lectura oficial medida por las estaciones del
        SIMAT/SEDEMA; úsalo como referencia.
      </p>
    </div>
  )
}
