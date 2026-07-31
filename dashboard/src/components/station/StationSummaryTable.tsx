import { useMemo } from 'react'
import { WeatherData, DailyStats } from '../../types'

interface Props {
  data: WeatherData
  stats: DailyStats['stats'] | null
  label?: string
  /** Si es true, muestra interior como sensor principal (para estaciones sin exterior) */
  indoorPrimary?: boolean
}

type TrendDir = 'up' | 'down' | 'stable'

function getTrend(current: number | undefined | null, avg: number | undefined | null): TrendDir {
  if (current == null || avg == null) return 'stable'
  const diff = current - avg
  const threshold = Math.abs(avg) * 0.02 // 2% threshold
  if (diff > threshold) return 'up'
  if (diff < -threshold) return 'down'
  return 'stable'
}

function TrendIcon({ dir }: { dir: TrendDir }) {
  if (dir === 'up') return <span className="text-green-500 text-2xl font-bold">↑</span>
  if (dir === 'down') return <span className="text-red-500 text-2xl font-bold">↓</span>
  return <span className="text-slate-400 text-2xl font-bold">→</span>
}

function WindArrow({ deg }: { deg: number }) {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 inline-block" style={{ transform: `rotate(${deg + 180}deg)` }}>
      <path d="M12 2L6 12h4v10h4V12h4L12 2z" fill="currentColor" className="text-sky-400" />
    </svg>
  )
}

function cardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatTimestamp(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

interface RowData {
  label: string
  unit: string
  current: number | string | undefined | null
  min?: number | null
  minTime?: string
  max?: number | null
  maxTime?: string
  avg?: number | null
  trend?: TrendDir
  extra?: React.ReactNode
}

export function StationSummaryTable({ data, stats, label, indoorPrimary = false }: Props) {
  const s = stats

  // Para remota (indoorPrimary): T/H exterior es del WN32, interior del GW1100
  // Para principal: T/H exterior es del WS69, interior de la consola

  const rows: RowData[] = useMemo(() => {
    const list: RowData[] = []

    if (indoorPrimary) {
      // REMOTA: WN32 exterior (cuando esté), GW1100 interior, presión
      list.push(
        {
          label: 'Temperatura',
          unit: '°C',
          current: data.temperature_outdoor,
          min: s?.temperature_outdoor?.min,
          minTime: s?.temperature_outdoor?.min_time,
          max: s?.temperature_outdoor?.max,
          maxTime: s?.temperature_outdoor?.max_time,
          avg: s?.temperature_outdoor?.avg,
          trend: getTrend(data.temperature_outdoor, s?.temperature_outdoor?.avg),
        },
        {
          label: 'Humedad',
          unit: '%',
          current: data.humidity_outdoor,
          min: s?.humidity_outdoor?.min,
          minTime: s?.humidity_outdoor?.min_time,
          max: s?.humidity_outdoor?.max,
          maxTime: s?.humidity_outdoor?.max_time,
          avg: s?.humidity_outdoor?.avg,
          trend: getTrend(data.humidity_outdoor, s?.humidity_outdoor?.avg),
        },
        {
          label: 'Punto de rocío',
          unit: '°C',
          current: data.dew_point,
          min: s?.dew_point?.min,
          minTime: s?.dew_point?.min_time,
          max: s?.dew_point?.max,
          maxTime: s?.dew_point?.max_time,
          avg: s?.dew_point?.avg,
          trend: getTrend(data.dew_point, s?.dew_point?.avg),
        },
        {
          label: 'Presión atmosférica',
          unit: 'hPa',
          current: data.pressure_relative,
          min: s?.pressure_relative?.min,
          minTime: s?.pressure_relative?.min_time,
          max: s?.pressure_relative?.max,
          maxTime: s?.pressure_relative?.max_time,
          avg: s?.pressure_relative?.avg,
          trend: getTrend(data.pressure_relative, s?.pressure_relative?.avg),
        },
        {
          label: 'Temperatura Interior',
          unit: '°C',
          current: data.temperature_indoor,
          min: s?.temperature_indoor?.min,
          minTime: s?.temperature_indoor?.min_time,
          max: s?.temperature_indoor?.max,
          maxTime: s?.temperature_indoor?.max_time,
          avg: s?.temperature_indoor?.avg,
          trend: getTrend(data.temperature_indoor, s?.temperature_indoor?.avg),
        },
        {
          label: 'Humedad Interior',
          unit: '%',
          current: data.humidity_indoor,
          min: s?.humidity_indoor?.min,
          minTime: s?.humidity_indoor?.min_time,
          max: s?.humidity_indoor?.max,
          maxTime: s?.humidity_indoor?.max_time,
          avg: s?.humidity_indoor?.avg,
          trend: getTrend(data.humidity_indoor, s?.humidity_indoor?.avg),
        }
      )
    } else {
      // PRINCIPAL: Exterior, interior, WN31 Jardín, viento, lluvia, sol, UV
      list.push(
        {
          label: 'Temperatura',
          unit: '°C',
          current: data.temperature_outdoor,
          min: s?.temperature_outdoor?.min,
          minTime: s?.temperature_outdoor?.min_time,
          max: s?.temperature_outdoor?.max,
          maxTime: s?.temperature_outdoor?.max_time,
          avg: s?.temperature_outdoor?.avg,
          trend: getTrend(data.temperature_outdoor, s?.temperature_outdoor?.avg),
        },
        {
          label: 'Humedad',
          unit: '%',
          current: data.humidity_outdoor,
          min: s?.humidity_outdoor?.min,
          minTime: s?.humidity_outdoor?.min_time,
          max: s?.humidity_outdoor?.max,
          maxTime: s?.humidity_outdoor?.max_time,
          avg: s?.humidity_outdoor?.avg,
          trend: getTrend(data.humidity_outdoor, s?.humidity_outdoor?.avg),
        },
        {
          label: 'Punto de rocío',
          unit: '°C',
          current: data.dew_point,
          min: s?.dew_point?.min,
          minTime: s?.dew_point?.min_time,
          max: s?.dew_point?.max,
          maxTime: s?.dew_point?.max_time,
          avg: s?.dew_point?.avg,
          trend: getTrend(data.dew_point, s?.dew_point?.avg),
        },
        {
          label: 'Sensación térmica',
          unit: '°C',
          current: data.feels_like,
        },
        {
          label: 'Presión atmosférica',
          unit: 'hPa',
          current: data.pressure_relative,
          min: s?.pressure_relative?.min,
          minTime: s?.pressure_relative?.min_time,
          max: s?.pressure_relative?.max,
          maxTime: s?.pressure_relative?.max_time,
          avg: s?.pressure_relative?.avg,
          trend: getTrend(data.pressure_relative, s?.pressure_relative?.avg),
        },
        {
          label: 'Velocidad del viento',
          unit: 'km/h',
          current: data.wind_speed,
          min: s?.wind_speed?.min,
          minTime: s?.wind_speed?.min_time,
          max: s?.wind_speed?.max,
          maxTime: s?.wind_speed?.max_time,
          avg: s?.wind_speed?.avg,
          extra: data.wind_direction !== undefined ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-300">
              <WindArrow deg={data.wind_direction} />
              <span>{cardinal(data.wind_direction)}</span>
              <span className="text-slate-500">{data.wind_direction}°</span>
            </div>
          ) : null,
        },
        {
          label: 'Ráfagas de viento',
          unit: 'km/h',
          current: data.wind_gust,
          min: s?.wind_gust?.min,
          minTime: s?.wind_gust?.min_time,
          max: s?.wind_gust?.max,
          maxTime: s?.wind_gust?.max_time,
          avg: s?.wind_gust?.avg,
        },
        {
          label: 'Tasa de lluvia',
          unit: 'mm/h',
          current: data.rain_rate,
          min: s?.rain_rate?.min,
          minTime: s?.rain_rate?.min_time,
          max: s?.rain_rate?.max,
          maxTime: s?.rain_rate?.max_time,
          avg: s?.rain_rate?.avg,
        },
        {
          label: 'Precipitación',
          unit: 'mm',
          current: data.rain_daily,
          extra: (
            <div className="text-xs text-slate-400 space-y-0.5">
              <div>{data.rain_hourly?.toFixed(1) ?? '—'} mm / 1h</div>
              <div>{data.rain_daily?.toFixed(1) ?? '—'} mm / hoy</div>
              <div>{data.rain_monthly?.toFixed(1) ?? '—'} mm / mes</div>
            </div>
          ),
        },
        {
          label: 'Radiación solar',
          unit: 'W/m²',
          current: data.solar_radiation,
          min: s?.solar_radiation?.min,
          minTime: s?.solar_radiation?.min_time,
          max: s?.solar_radiation?.max,
          maxTime: s?.solar_radiation?.max_time,
          avg: s?.solar_radiation?.avg,
        },
        {
          label: 'Índice UV',
          unit: '',
          current: data.uv_index,
          min: s?.uv_index?.min,
          minTime: s?.uv_index?.min_time,
          max: s?.uv_index?.max,
          maxTime: s?.uv_index?.max_time,
          avg: s?.uv_index?.avg,
        },
        {
          label: 'Temperatura Interior',
          unit: '°C',
          current: data.temperature_indoor,
          min: s?.temperature_indoor?.min,
          minTime: s?.temperature_indoor?.min_time,
          max: s?.temperature_indoor?.max,
          maxTime: s?.temperature_indoor?.max_time,
          avg: s?.temperature_indoor?.avg,
          trend: getTrend(data.temperature_indoor, s?.temperature_indoor?.avg),
        },
        {
          label: 'Humedad Interior',
          unit: '%',
          current: data.humidity_indoor,
          min: s?.humidity_indoor?.min,
          minTime: s?.humidity_indoor?.min_time,
          max: s?.humidity_indoor?.max,
          maxTime: s?.humidity_indoor?.max_time,
          avg: s?.humidity_indoor?.avg,
          trend: getTrend(data.humidity_indoor, s?.humidity_indoor?.avg),
        },
        {
          label: 'Temperatura WN31 Jardín',
          unit: '°C',
          current: data.temperature_ch1,
          min: s?.temperature_ch1?.min,
          minTime: s?.temperature_ch1?.min_time,
          max: s?.temperature_ch1?.max,
          maxTime: s?.temperature_ch1?.max_time,
          avg: s?.temperature_ch1?.avg,
          trend: getTrend(data.temperature_ch1, s?.temperature_ch1?.avg),
        },
        {
          label: 'Humedad WN31 Jardín',
          unit: '%',
          current: data.humidity_ch1,
          min: s?.humidity_ch1?.min,
          minTime: s?.humidity_ch1?.min_time,
          max: s?.humidity_ch1?.max,
          maxTime: s?.humidity_ch1?.max_time,
          avg: s?.humidity_ch1?.avg,
          trend: getTrend(data.humidity_ch1, s?.humidity_ch1?.avg),
        }
      )
    }

    return list
  }, [data, s, indoorPrimary])

  const fmt = (v: number | string | undefined | null, decimals = 1): string => {
    if (v == null) return '—'
    if (typeof v === 'string') return v
    return v.toFixed(decimals)
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-700/50 px-4 py-2 border-b border-white/10">
        <div className="flex items-center justify-between">
          <span className="font-medium">{label || 'Resumen de la Estación'}</span>
          <span className="text-sm text-slate-400">
            Dato desde: {formatTimestamp(data.received_at)}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="text-left px-4 py-2 font-medium">Variable</th>
              <th className="text-center px-4 py-2 font-medium">Actual</th>
              <th className="text-center px-4 py-2 font-medium">Mínima Hoy</th>
              <th className="text-center px-4 py-2 font-medium">Máxima Hoy</th>
              <th className="text-center px-4 py-2 font-medium">Media / Tendencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.label} className={`border-b border-white/5 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                <td className="px-4 py-2.5 text-slate-300 font-medium">
                  {row.label}
                  {row.unit && <span className="text-slate-500 text-xs ml-1">({row.unit})</span>}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className="text-white font-semibold text-base">{fmt(row.current)}</span>
                  {row.extra && <div className="mt-1">{row.extra}</div>}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {row.min !== undefined ? (
                    <>
                      <span className="text-slate-200">{fmt(row.min)}</span>
                      <div className="text-xs text-sky-400">{formatTime(row.minTime)}</div>
                    </>
                  ) : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {row.max !== undefined ? (
                    <>
                      <span className="text-slate-200">{fmt(row.max)}</span>
                      <div className="text-xs text-red-400">{formatTime(row.maxTime)}</div>
                    </>
                  ) : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {row.avg !== undefined ? (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-slate-300">{fmt(row.avg)}</span>
                      {row.trend && <TrendIcon dir={row.trend} />}
                    </div>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
