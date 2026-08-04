import { LocalForecast } from '../../station-data'
import { useUnits } from '../../units'
import { WeatherIcon } from '../WeatherIcon'
import { ICON, iconTendenciaPresion } from '../../theme/icons'

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
  // Chevron de tendencia (rojo sube / azul baja); nada si está estable.
  const icoTend = iconTendenciaPresion(lf.delta_3h ?? null)

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        {icoTend && <WeatherIcon name={icoTend} size={ICON.card} alt="" className="shrink-0" />}
        <p className="card-title mb-0">Pronóstico local</p>
      </div>
      <p className="text-xs text-slate-500 -mt-1 mb-2">Por tendencia del barómetro · datos de la estación</p>

      <p className="text-slate-100 leading-snug">{lf.forecast}</p>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Barómetro</p>
          <p className="text-lg font-bold">{lf.pressure != null ? u.press(lf.pressure) : '--'}</p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Tendencia</p>
          <p className={`text-lg font-bold ${color}`}>{trend?.arrow} {trend?.label ?? '--'}</p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-slate-400">Cambio 3 h</p>
          <p className="text-lg font-bold">{lf.delta_3h != null ? `${lf.delta_3h > 0 ? '+' : ''}${lf.delta_3h} hPa` : '--'}</p>
        </div>
      </div>
      {lf.level && <p className="text-xs text-slate-500 mt-2">{LEVEL_LABEL[lf.level] ?? ''}</p>}
    </div>
  )
}
