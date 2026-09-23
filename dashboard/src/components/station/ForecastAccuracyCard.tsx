import { useEffect, useMemo, useState } from 'react'
import { Target } from 'lucide-react'
import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

/**
 * ¿Qué fuente ACIERTA más? No compara fuentes entre sí (eso no dice cuál tenía
 * razón): califica cada una contra lo observado -- el pluviómetro para lluvia y
 * la cámara para nubosidad. Todo el cálculo vive en el receiver
 * (`services/forecast_verification.py`, `GET /api/forecast/verification`); la
 * tarjeta sólo lo pinta.
 *
 * Métrica principal: "acierto en lluvia" (CSI) = aciertos / (aciertos + lluvias
 * no avisadas + falsas alarmas). Se usa en vez de la exactitud simple porque
 * ésta premia decir siempre "no llueve": si llueve el 9% del tiempo, "nunca
 * llueve" tendría 91%.
 */

type Horizon = 'now' | 'next3h'

interface Ranked {
  key: string
  label: string
  n: number
  hits: number
  misses: number
  false_alarms: number
  observed: number
  predicted: number
  pod: number | null
  far: number | null
  csi: number | null
  /** Referencia "a vencer" (avisar sólo por horario), no una fuente real. */
  reference?: boolean
}

interface HorizonReport {
  n: number
  observed_pct: number | null
  ranking: Ranked[]
  by_hour: { hour: number; n: number; observed_pct: number; predicted_pct: Record<string, number> }[]
  trend: { date: string; rained: boolean; csi: Record<string, number | null> }[]
}

interface Report {
  days: number
  rain_threshold_mm: number
  prob_threshold_pct: number
  log_started: string | null
  horizons: Record<Horizon, HorizonReport>
  sky: {
    n: number
    steps: Record<'0' | '1' | '2+', number>
    steps_pct: Record<'0' | '1' | '2+', number | null>
    coverage_bias_pct: number | null
    coverage_mae_pct: number | null
  }
}

// Color fijo POR FUENTE (nunca por su lugar en el ranking). Los cinco que entran
// en las gráficas se validaron juntos (daltonismo + contraste, tema claro y
// oscuro). Las fuentes que sólo aparecen en el ranking van en gris neutro: su
// nombre está al lado, el color no carga la identidad.
const COLOR: Record<string, string> = {
  observed: '#0284c7',
  openmeteo: '#d95926',
  camera: '#199e70',
  own: '#c98500',
  pressure: '#9333ea',
}
const NEUTRAL = '#64748b'
const colorOf = (k: string) => COLOR[k] ?? NEUTRAL

// Fuentes que se grafican por horizonte (máx. 3 + lo observado).
const CHARTED: Record<Horizon, string[]> = {
  now: ['openmeteo', 'camera'],
  next3h: ['own', 'pressure', 'openmeteo'],
}

const HORIZONS: { k: Horizon; label: string }[] = [
  { k: 'now', label: 'Ahora' },
  { k: 'next3h', label: 'Próximas 3 h' },
]
const DAYS = [7, 30]
// Horas con menos casos que esto no se grafican: de madrugada casi no hay fotos
// de día y un solo caso pinta un 0% o 100% que no significa nada.
const MIN_HOUR_N = 10

const tooltipStyle = {
  backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8, fontSize: 12,
}
const axisTick = { fill: '#94a3b8', fontSize: 10 }

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`)

function fmtDay(d: string) {
  const [, m, dd] = d.split('-')
  return `${Number(dd)}/${Number(m)}`
}

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
}

/** Frases que resumen el ranking: quién es lo más certero y en qué falla cada otro. */
function insights(h: HorizonReport, horizon: Horizon): string[] {
  const conCsi = h.ranking.filter((r) => r.csi != null && !r.reference)
  if (!conCsi.length) return []
  const ref = h.ranking.find((r) => r.reference && r.csi != null)
  const best = conCsi[0]
  const que = horizon === 'now' ? 'Para saber si llueve ahora' : 'Para anticipar lluvia en las próximas 3 h'
  const vencen = ref ? conCsi.filter((r) => (r.csi ?? 0) > (ref.csi ?? 0)) : conCsi
  const out: string[] = []
  if (ref && !vencen.length) {
    // Llamar "lo más certero" a algo que no le gana a la hora del día engaña.
    out.push(`${que}, ninguna fuente supera todavía a avisar sólo por horario (${pct(ref.csi)}): ` +
      `no aportan más que la hora del día. La mejor, ${best.label}, acierta ${pct(best.csi)}.`)
  } else {
    out.push(`${que}, lo más certero es ${best.label}: acierta ${pct(best.csi)} de los casos de lluvia.`)
    if (ref) {
      out.push(`Avisar sólo por horario acierta ${pct(ref.csi)}; ` +
        (vencen.length === conCsi.length ? 'todas las fuentes lo superan.'
          : `sólo ${vencen.map((r) => r.label).join(' y ')} lo ${vencen.length === 1 ? 'supera' : 'superan'}.`))
    }
  }
  for (const r of conCsi.slice(1)) {
    if (r.far != null && r.far >= 50) {
      out.push(`${r.label} avisa ${pct(r.pod)} de las lluvias, pero ${pct(r.far)} de sus avisos fueron falsas alarmas.`)
    } else if (r.pod != null && r.pod < 50) {
      out.push(`A ${r.label} se le escapa ${pct(100 - r.pod)} de las lluvias.`)
    }
  }
  // La hora en que cada fuente graficada más exagera la lluvia frente a lo observado.
  for (const k of CHARTED[horizon]) {
    let peor: { hour: number; pred: number; obs: number } | null = null
    for (const b of h.by_hour) {
      const p = b.predicted_pct[k]
      if (p == null || b.n < MIN_HOUR_N) continue
      if (!peor || p - b.observed_pct > peor.pred - peor.obs) peor = { hour: b.hour, pred: p, obs: b.observed_pct }
    }
    const label = h.ranking.find((r) => r.key === k)?.label
    if (peor && label && peor.pred - peor.obs >= 25) {
      out.push(`A las ${peor.hour} h ${label} dice lluvia el ${pct(peor.pred)} del tiempo; llovió sólo el ${pct(peor.obs)}.`)
    }
  }
  return out
}

function Legend({ items }: { items: { key: string; label: string; bar?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {items.map((it) => (
        <span key={it.key} className="flex items-center gap-1.5 text-xs text-slate-400">
          {it.bar
            ? <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorOf(it.key) }} />
            : <span className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colorOf(it.key) }} />}
          {it.label}
        </span>
      ))}
    </div>
  )
}

export function ForecastAccuracyCard() {
  const [days, setDays] = useState(30)
  const [horizon, setHorizon] = useState<Horizon>('now')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    setLoading(true)
    fetch(`/api/forecast/verification?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d) setReport(d) })
      .catch(() => {})
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [days])

  const h = report?.horizons[horizon]
  const labels = useMemo(() => {
    const m: Record<string, string> = { observed: 'Llovió (pluviómetro)' }
    for (const r of h?.ranking ?? []) m[r.key] = r.label
    return m
  }, [h])
  const charted = CHARTED[horizon].filter((k) => h?.ranking.some((r) => r.key === k))

  if (!report && loading) return null
  if (!report || !h) return null

  const btn = (active: boolean) =>
    `px-2 py-1 rounded-lg text-xs transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`
  const frases = insights(h, horizon)
  const maxN = Math.max(...h.ranking.map((r) => r.n), 1)
  // Las 24 horas siempre: una hora sin casos suficientes queda como hueco en vez
  // de que la línea la cruce como si hubiera datos.
  const hourData = Array.from({ length: 24 }, (_, hour) => {
    const b = h.by_hour.find((x) => x.hour === hour && x.n >= MIN_HOUR_N)
    return b ? { hour, observed: b.observed_pct, ...b.predicted_pct } : { hour }
  })
  const trendData = h.trend.map((t) => ({ date: t.date, ...t.csi }))
  const sky = report.sky

  return (
    <div className={`card mt-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <p className="card-title mb-3 flex items-center gap-2">
        <Target className="w-5 h-5 text-violet-400" />
        Precisión del pronóstico
      </p>

      {/* Un solo renglón de filtros: todo lo de abajo responde a ellos. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1">
          {HORIZONS.map((o) => (
            <button key={o.k} className={btn(horizon === o.k)} onClick={() => setHorizon(o.k)}>{o.label}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {DAYS.map((d) => (
            <button key={d} className={btn(days === d)} onClick={() => setDays(d)}>{d} días</button>
          ))}
        </div>
      </div>

      {/* ---- 1. Ranking: quién acierta ---- */}
      <p className="text-sm font-semibold text-slate-200 mb-1">¿Quién acierta la lluvia?</p>
      {frases.length > 0 && (
        <div className="text-sm text-slate-300 leading-relaxed mb-3 space-y-1">
          {frases.map((f) => <p key={f}>{f}</p>)}
        </div>
      )}

      <div className="space-y-3">
        {h.ranking.map((r) => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`flex items-center gap-1.5 text-sm min-w-0 ${r.reference ? 'text-slate-400' : 'text-slate-200'}`}>
                <span className={`w-2.5 h-2.5 shrink-0 ${r.reference ? 'rounded-sm border border-slate-500' : 'rounded-full'}`}
                  style={r.reference ? undefined : { backgroundColor: colorOf(r.key) }} />
                <span className="truncate">{r.label}</span>
                {r.reference && <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">referencia</span>}
              </span>
              <span className="text-sm font-semibold text-slate-100">
                {r.csi == null ? <span className="text-xs font-normal text-slate-500">sin lluvias suficientes</span> : pct(r.csi)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.05] mt-1 overflow-hidden">
              <div className={`h-full rounded-full ${r.reference ? 'opacity-50' : ''}`}
                style={{ width: `${r.csi ?? 0}%`, backgroundColor: colorOf(r.key) }} />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Avisó {r.hits} de {r.observed} lluvias ({pct(r.pod)}) · {r.false_alarms} {r.false_alarms === 1 ? 'falsa alarma' : 'falsas alarmas'} ({pct(r.far)} de sus avisos)
              {' · '}{r.n.toLocaleString('es-MX')} casos{r.n < maxN * 0.5 ? ' (acumulando)' : ''}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-3">
        Llovió en el {pct(h.observed_pct)} de los {h.n.toLocaleString('es-MX')} momentos revisados
        ({horizon === 'now' ? '±30 min alrededor de cada foto de día' : 'ventanas de 3 h cada media hora'};
        {' '}cuenta como lluvia desde {report.rain_threshold_mm} mm).
        {horizon === 'next3h' && (
          <> La presión se reconstruye del historial; los demás se registran
            {report.log_started ? ` desde el ${fmtDate(report.log_started)}` : ' a partir de hoy'} y
            necesitan varias tardes de lluvia para calificarse. Los modelos &laquo;avisan&raquo; cuando dan
            {' '}{report.prob_threshold_pct}% o más.</>
        )}
      </p>

      {/* ---- 2. Por hora del día ---- */}
      {h.by_hour.some((b) => b.n >= MIN_HOUR_N) && charted.length > 0 && (
        <>
          <p className="text-sm font-semibold text-slate-200 mt-5 mb-0.5">Por hora del día</p>
          <p className="text-xs text-slate-500 mb-2">% del tiempo en que llovió vs. en que cada fuente dijo lluvia.</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#94a3b8" strokeOpacity={0.12} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" type="number" domain={[-0.5, 23.5]} ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
                  tick={axisTick} tickLine={false} tickFormatter={(v: number) => `${v}h`} axisLine={{ stroke: '#94a3b8', strokeOpacity: 0.15 }} />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                  labelFormatter={(l) => `${l}:00 h`}
                  formatter={(v: number, k: string) => [pct(v), labels[k] ?? k]} />
                <Bar dataKey="observed" fill={COLOR.observed} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
                {charted.map((k) => (
                  <Line key={k} dataKey={k} stroke={colorOf(k)} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ key: 'observed', label: labels.observed, bar: true }, ...charted.map((k) => ({ key: k, label: labels[k] }))]} />
        </>
      )}

      {/* ---- 3. Tendencia ---- */}
      {trendData.length > 1 && charted.length > 0 && (
        <>
          <p className="text-sm font-semibold text-slate-200 mt-5 mb-0.5">¿Va mejorando?</p>
          <p className="text-xs text-slate-500 mb-2">Acierto en lluvia de los 7 días anteriores a cada fecha (hueco = sin lluvias suficientes).</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#94a3b8" strokeOpacity={0.12} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} tickFormatter={fmtDay} minTickGap={24}
                  axisLine={{ stroke: '#94a3b8', strokeOpacity: 0.15 }} />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }}
                  labelFormatter={(l) => fmtDate(String(l))}
                  formatter={(v: number, k: string) => [pct(v), labels[k] ?? k]} />
                {charted.map((k) => (
                  <Line key={k} dataKey={k} stroke={colorOf(k)} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={charted.map((k) => ({ key: k, label: labels[k] }))} />
        </>
      )}

      {/* ---- 4. Nubosidad ---- */}
      {sky.n > 0 && (
        <>
          <p className="text-sm font-semibold text-slate-200 mt-5 mb-1">Nubosidad: Open-Meteo vs. lo que vio la cámara</p>
          {sky.coverage_bias_pct != null && (
            <p className="text-sm text-slate-300 leading-relaxed mb-2">
              Open-Meteo pronostica en promedio{' '}
              <span className="font-semibold">
                {sky.coverage_bias_pct > 0 ? '+' : ''}{Math.round(sky.coverage_bias_pct)} puntos
              </span>{' '}
              {sky.coverage_bias_pct >= 0 ? 'más' : 'menos'} nubes de las que se ven (error típico ±{Math.round(sky.coverage_mae_pct ?? 0)} puntos).
            </p>
          )}
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-white/[0.03]">
            {(['0', '1', '2+'] as const).map((k) => (sky.steps_pct[k] ?? 0) > 0 && (
              <div key={k} className={SKY_STEP[k].color} style={{ width: `${sky.steps_pct[k]}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {(['0', '1', '2+'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={`w-2.5 h-2.5 rounded-sm ${SKY_STEP[k].color}`} />
                {SKY_STEP[k].label}: {pct(sky.steps_pct[k])}
              </span>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {sky.n.toLocaleString('es-MX')} fotos de día en las que ni la cámara ni el modelo decían lluvia
            (la lluvia se califica arriba, contra el pluviómetro).
          </p>
        </>
      )}
    </div>
  )
}

// Escala ordenada (misma categoría -> se aleja más): de verde a gris, igual que la
// barra que tenía esta tarjeta antes.
const SKY_STEP: Record<'0' | '1' | '2+', { label: string; color: string }> = {
  '0': { label: 'Coincide', color: 'bg-emerald-500' },
  '1': { label: 'A un paso', color: 'bg-emerald-300' },
  '2+': { label: 'Muy distinto', color: 'bg-slate-400' },
}
