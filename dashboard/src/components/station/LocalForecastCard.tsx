import { LocalForecast } from '../../station-data'
import { useUnits } from '../../units'

interface Props {
  lf: LocalForecast | null
}

const LEVEL_LABEL: Record<string, string> = {
  high: 'Presión alta',
  normal: 'Presión normal',
  low: 'Presión baja',
}

const TREND_COLOR: Record<string, string> = {
  falling_fast: 'text-red-400',
  falling: 'text-amber-300',
  steady: 'text-slate-300',
  rising: 'text-emerald-300',
  rising_fast: 'text-emerald-400',
}

export function LocalForecastCard({ lf }: Props) {
  const u = useUnits()
  if (!lf || !lf.available) return null

  const trend = lf.trend
  const color = trend ? TREND_COLOR[trend.code] ?? 'text-slate-300' : 'text-slate-300'

  return (
    <div className="card">
      <p className="card-title">Pronóstico local</p>
      <p className="text-xs text-slate-500 -mt-1 mb-2">Por tendencia del barómetro · datos de la estación</p>

      <p className="text-slate-100 leading-snug">{lf.forecast}</p>

      <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
        <div>
          <p className="text-xs text-slate-400">Barómetro</p>
          <p className="font-semibold">{lf.pressure != null ? u.press(lf.pressure) : '--'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Tendencia</p>
          <p className={`font-semibold ${color}`}>
            {trend?.arrow} {trend?.label ?? '--'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Cambio 3 h</p>
          <p className="font-semibold">
            {lf.delta_3h != null ? `${lf.delta_3h > 0 ? '+' : ''}${lf.delta_3h} hPa` : '--'}
          </p>
        </div>
      </div>
      {lf.level && <p className="text-xs text-slate-500 mt-2">{LEVEL_LABEL[lf.level] ?? ''}</p>}
    </div>
  )
}
