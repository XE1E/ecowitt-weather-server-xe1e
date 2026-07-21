import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { WeatherData, DailyStats, HistoryData } from '../../types'
import { useUnits } from '../../units'

const hourFmt = (t: number) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit' })
const stampFmt = (t: number) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

interface Props {
  data: WeatherData
  stats: DailyStats['stats'] | null
  history: HistoryData[]
}

export function PressureCard({ data, stats, history }: Props) {
  const u = useUnits()
  const p = data.pressure_relative
  const s = stats?.pressure_relative

  // Serie de presión suavizada: submuestreo a ~60 puntos para una línea clara
  const pts = history
    .filter((h) => h.pressure_relative !== undefined)
    .map((h) => ({ t: h._time, v: h.pressure_relative as number }))
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
  const raw = pts.map((p) => p.v)
  const step = Math.max(1, Math.floor(pts.length / 60))
  const series = pts.filter((_, i) => i % step === 0).map((pt) => ({ t: new Date(pt.t).getTime(), p: u.pressN(pt.v) }))

  // Tendencia: sobre valores MÉTRICOS crudos (hPa), comparar con ~3h atrás
  let trend = 'Estable'
  let trendColor = 'text-slate-300'
  if (raw.length > 6) {
    const d = raw[raw.length - 1] - raw[Math.max(0, raw.length - 7)]
    if (d > 0.6) { trend = 'Subiendo'; trendColor = 'text-emerald-300' }
    else if (d < -0.6) { trend = 'Bajando'; trendColor = 'text-red-300' }
  }

  const box = (label: string, value: string, color = 'text-slate-100') => (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  )

  return (
    <div className="card">
      <p className="card-title">Presión</p>
      <div className="flex items-end gap-2">
        <span className="text-4xl font-bold text-violet-300">{u.press(p)}</span>
        <span className="text-slate-400 mb-1">{u.pressU}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        {box('Mín', s?.min != null ? u.press(s.min) : '--', 'text-sky-300')}
        {box('Máx', s?.max != null ? u.press(s.max) : '--', 'text-orange-300')}
        {box('Tendencia', trend, trendColor)}
      </div>

      {series.length > 1 && (
        <div className="mt-3 rounded-lg bg-white/5 px-2 pt-2 pb-1">
          <p className="text-xs text-slate-400 mb-1 px-1">Últimas 24 h</p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 8, left: 2, bottom: 0 }}>
                <defs>
                  <linearGradient id="pFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                {/* Rejilla discreta: gris muy tenue, punteada, sin robar foco a la línea */}
                <CartesianGrid stroke="#94a3b8" strokeOpacity={0.12} strokeDasharray="3 3" vertical horizontal />
                <XAxis
                  dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                  tickFormatter={hourFmt} tick={{ fill: '#94a3b8', fontSize: 10 }}
                  minTickGap={34} tickLine={false} axisLine={{ stroke: '#94a3b8', strokeOpacity: 0.15 }}
                />
                <YAxis
                  width={34} orientation="right" domain={['dataMin - 1', 'dataMax + 1']}
                  tickCount={4} tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(u.system === 'imperial' ? 2 : 0)}
                  tickLine={false} axisLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--surface, #1e293b)', border: '1px solid var(--line, #334155)', borderRadius: 8 }}
                  cursor={{ stroke: '#a78bfa', strokeOpacity: 0.4, strokeDasharray: '3 3' }}
                  labelFormatter={(l) => stampFmt(Number(l))}
                  formatter={(v: number) => [`${v.toFixed(u.system === 'imperial' ? 2 : 1)} ${u.pressU}`, 'Presión']}
                />
                <Area type="monotone" dataKey="p" stroke="#a78bfa" strokeWidth={2} fill="url(#pFill)" dot={false} activeDot={{ r: 3, fill: '#a78bfa', strokeWidth: 0 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
