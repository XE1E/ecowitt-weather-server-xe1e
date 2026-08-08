import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { WeatherData, DailyStats, HistoryData } from '../../types'
import { useUnits } from '../../units'
import { historicValue } from '../../weather'
import { WeatherIcon } from '../WeatherIcon'
import { ICON, iconTendenciaPresion } from '../../theme/icons'

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
  const step = Math.max(1, Math.floor(pts.length / 60))
  const series = pts.filter((_, i) => i % step === 0).map((pt) => ({ t: new Date(pt.t).getTime(), p: u.pressN(pt.v) }))

  // Tendencia: sobre valores MÉTRICOS crudos (hPa), comparando con hace 3 h y con
  // el umbral de ±1 hPa de docs/CONVENCIONES.md.
  //
  // Antes esto restaba 7 POSICIONES del arreglo creyendo que eran ~3 h, pero
  // /api/history devuelve un punto por minuto: comparaba con 6 minutos atrás, y
  // como la presión no se mueve 1 hPa en 6 min, la tarjeta decía "Estable"
  // siempre. Ahora se busca por tiempo, igual que el resto de las tendencias.
  // "Sube" / "Baja" y no "Subiendo" / "Bajando": la caja de Tendencia es un tercio de la
  // tarjeta y no da para más. Medido, el contenido de "Subiendo" con su chevron pide 126 px
  // y la caja deja 90 en escritorio y 79 en móvil, así que la palabra se salía de la
  // tarjeta. Bajar el cuerpo o quitar el chevron no ahorraban lo suficiente --26 y 38 px--
  // y además el chevron es lo que dice la dirección de un vistazo. Con cuatro letras entra
  // con holgura en cualquier ancho. "Estable" se queda: es la única que no lleva chevron,
  // así que dispone de toda la caja.
  let trend = 'Estable'
  let trendColor = 'text-slate-300'
  const prev = historicValue(history, (h) => h.pressure_relative, 3)
  if (p != null && prev != null) {
    const d = p - prev
    if (d > 1) { trend = 'Sube'; trendColor = 'text-green-500' }
    else if (d < -1) { trend = 'Baja'; trendColor = 'text-red-500' }
  }

  const box = (label: string, value: string, color = 'text-slate-100', icono?: string | null) => (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      {/* `min-w-0` + `truncate` como cinturón: si algún día un valor vuelve a no caber
          --una presión imperial larga, otra palabra de tendencia-- se corta DENTRO de su
          caja con puntos suspensivos en vez de salirse de la tarjeta, que es el defecto que
          tenía "Subiendo". Sin el `min-w-0` el hijo de un flex no se deja encoger y el
          `truncate` no haría nada. */}
      <p className={`text-lg font-bold ${color} flex items-center gap-1 min-w-0`}>
        {/* Chevron solo si hay tendencia: estable no lleva icono (ver theme/icons.ts) */}
        {icono && <WeatherIcon name={icono} size={ICON.compact} alt="" className="shrink-0 -my-1" />}
        <span className="truncate">{value}</span>
      </p>
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
        {box('Tendencia', trend, trendColor, iconTendenciaPresion(p != null && prev != null ? p - prev : null))}
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
                  contentStyle={{ backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 }}
                  cursor={{ stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }}
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
