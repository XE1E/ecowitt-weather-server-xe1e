import { useState, useEffect } from 'react'
import { useUnits } from '../../units'

interface Rec { value: number; date: string }
type RecordsTop = Record<string, Rec[]>

const REC_TABS: { key: string; label: string; cats: string[] }[] = [
  { key: 'temp', label: 'Temperatura', cats: ['temp_max', 'temp_min', 'warm_day', 'cold_day', 'range_day'] },
  { key: 'precip', label: 'Precipitaciones', cats: ['rain_day'] },
  { key: 'wind', label: 'Viento', cats: ['gust_max', 'wind_max'] },
  { key: 'press', label: 'Presión', cats: ['press_max', 'press_min'] },
  { key: 'hum', label: 'Humedad', cats: ['hum_max', 'hum_min'] },
  { key: 'solaruv', label: 'Solar y UV', cats: ['solar_max', 'uv_max'] },
]

function fmtDay(date?: string): string {
  if (!date) return ''
  const d = new Date(date + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function HistoricalRecords({ title = 'Récords históricos' }: { title?: string }) {
  const u = useUnits()
  const [recTop, setRecTop] = useState<RecordsTop | null>(null)
  const [days, setDays] = useState(0)
  const [tab, setTab] = useState('temp')

  useEffect(() => {
    fetch('/api/climate/records')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { setRecTop(j?.all_time_top ?? null); setDays(j?.all_time?.days ?? 0) })
      .catch(() => {})
  }, [])

  const recFmt: Record<string, (v: number) => string> = {
    temp: (v) => `${u.temp(v)} ${u.tempU}`,
    rain: (v) => `${u.rain(v)} ${u.rainU}`,
    wind: (v) => `${u.wind(v)} ${u.windU}`,
    press: (v) => `${u.press(v)} ${u.pressU}`,
    pct: (v) => `${v.toFixed(0)} %`,
    uv: (v) => v.toFixed(0),
    solar: (v) => `${v.toFixed(0)} W/m²`,
  }
  const CATS: Record<string, { label: string; color: string; kind: string }> = {
    temp_max: { label: 'Temperatura máxima', color: 'text-orange-300', kind: 'temp' },
    temp_min: { label: 'Temperatura mínima', color: 'text-sky-300', kind: 'temp' },
    warm_day: { label: 'Día más cálido (prom.)', color: 'text-orange-300', kind: 'temp' },
    cold_day: { label: 'Día más frío (prom.)', color: 'text-sky-300', kind: 'temp' },
    range_day: { label: 'Mayor rango diario', color: 'text-amber-300', kind: 'temp' },
    rain_day: { label: 'Día más lluvioso', color: 'text-blue-300', kind: 'rain' },
    gust_max: { label: 'Ráfaga máxima', color: 'text-emerald-300', kind: 'wind' },
    wind_max: { label: 'Viento medio máx.', color: 'text-emerald-300', kind: 'wind' },
    press_max: { label: 'Presión máxima', color: 'text-violet-300', kind: 'press' },
    press_min: { label: 'Presión mínima', color: 'text-violet-300', kind: 'press' },
    hum_max: { label: 'Humedad máxima', color: 'text-cyan-300', kind: 'pct' },
    hum_min: { label: 'Humedad mínima', color: 'text-cyan-300', kind: 'pct' },
    uv_max: { label: 'Índice UV máx.', color: 'text-fuchsia-300', kind: 'uv' },
    solar_max: { label: 'Radiación solar máx.', color: 'text-amber-300', kind: 'solar' },
  }

  if (!recTop) return null
  const btn = (active: boolean) =>
    `px-3 py-1 rounded-lg text-sm transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`
  const activeTab = REC_TABS.find((t) => t.key === tab)!
  const rows = activeTab.cats.map((k) => ({ key: k, ...CATS[k] })).filter((c) => (recTop[c.key]?.length ?? 0) > 0)

  return (
    <div>
      <h3 className="text-lg font-semibold text-slate-300 mb-3">
        {title} <span className="text-xs text-slate-500 font-normal">({days} días registrados)</span>
      </h3>
      <div className="card">
        <div className="flex flex-wrap gap-1 mb-3">
          {REC_TABS.map((t) => (
            <button key={t.key} className={btn(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Sin récords en esta categoría todavía.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {rows.map((c) => (
              <RecordRow key={c.key} label={c.label} color={c.color} list={recTop[c.key]} fmt={recFmt[c.kind]} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RecordRow({ label, color, list, fmt }: { label: string; color: string; list: Rec[]; fmt: (v: number) => string }) {
  const [open, setOpen] = useState(false)
  const top = list[0]
  const rest = list.slice(1)
  return (
    <div className="rounded-lg bg-white/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-300">
          {label}
          {rest.length > 0 && (
            <button onClick={() => setOpen((o) => !o)} className="text-xs text-blue-400 hover:text-blue-300 ml-2 align-middle">
              {open ? 'ocultar' : 'Top 5'}
            </button>
          )}
        </span>
        <span className="text-right whitespace-nowrap">
          <span className={`text-lg font-bold ${color}`}>{fmt(top.value)}</span>
          <span className="text-xs text-slate-500 ml-2">{fmtDay(top.date)}</span>
        </span>
      </div>
      {open && rest.length > 0 && (
        <ol className="mt-2 pt-2 border-t border-white/10 space-y-1 text-xs" start={2}>
          {rest.map((r, i) => (
            <li key={i} className="flex justify-between text-slate-400">
              <span className="text-slate-500">{i + 2}.</span>
              <span className="whitespace-nowrap"><span className="text-slate-300">{fmt(r.value)}</span><span className="text-slate-500 ml-2">{fmtDay(r.date)}</span></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
