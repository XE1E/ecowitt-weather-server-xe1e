import { WeatherData } from '../../types'
import { WeatherIcon } from '../WeatherIcon'

function uvLabel(uv: number): string {
  if (uv >= 11) return 'Extremo'
  if (uv >= 8) return 'Muy alto'
  if (uv >= 6) return 'Alto'
  if (uv >= 3) return 'Moderado'
  return 'Bajo'
}

// Color del número/etiqueta de UV según el nivel (verde→morado). Distingue el
// dato de UV del de radiación (ámbar fijo).
function uvColor(uv: number): string {
  if (uv >= 11) return 'text-fuchsia-400'
  if (uv >= 8) return 'text-red-400'
  if (uv >= 6) return 'text-orange-400'
  if (uv >= 3) return 'text-yellow-300'
  return 'text-emerald-400'
}

// Ícono meteocons uv-index-N (sol + badge con el número, coloreado por nivel).
function uvIconName(uv: number): string {
  if (uv >= 11) return 'uv-index-11-plus'
  return `uv-index-${Math.max(1, Math.round(uv))}`
}

export function UvSolarCard({ data }: { data: WeatherData }) {
  const uv = data.uv_index ?? 0
  return (
    <div className="card">
      <p className="card-title">UV y radiación solar</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">UV</p>
          <div className="flex items-center gap-3">
            <WeatherIcon name={uvIconName(uv)} size={40} className="shrink-0" />
            <div>
              <p className={`text-2xl font-bold ${uvColor(uv)}`}>{uv}</p>
              <p className={`text-xs ${uvColor(uv)}`}>{uvLabel(uv)}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Radiación</p>
          <div className="flex items-center gap-3">
            <WeatherIcon name="clear-day" size={40} className="shrink-0" />
            <div>
              <p className="text-2xl font-bold text-amber-300">{(data.solar_radiation ?? 0).toFixed(0)}</p>
              <p className="text-xs text-slate-400">W/m²</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
