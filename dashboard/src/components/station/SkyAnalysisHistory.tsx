import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'

/**
 * Histórico de análisis del cielo.
 * Muestra una gráfica de cobertura de nubes del día seleccionado.
 *
 * Fecha CONTROLADA desde `CameraPage`, que la comparte con `TimelapseCard`: un solo
 * calendario mueve las dos tarjetas a la vez, en vez de cada una con el suyo.
 */

interface DayInfo {
  date: string
  count: number
}

interface AnalysisEntry {
  ts: string
  coverage: number
  condition: string
  cloud_type: string
  visibility: string
  development: string
  precip: boolean
}

interface DayData {
  date: string
  count: number
  stats: {
    coverage_avg: number
    coverage_min: number
    coverage_max: number
    conditions: Record<string, number>
  }
  entries: AnalysisEntry[]
}

const CONDITION_ES: Record<string, string> = {
  clear: 'Despejado',
  partly_cloudy: 'Parcialmente nublado',
  mostly_cloudy: 'Mayormente nublado',
  overcast: 'Cubierto',
  foggy: 'Neblina',
  rainy: 'Lluvia',
  stormy: 'Tormenta',
  night: 'Noche',
}

/**
 * Mismo color para "condición observada" que para su franja de cobertura
 * equivalente en la gráfica de barras (clear/partly/mostly/overcast), y colores
 * propios para las condiciones que no son de cobertura (niebla, lluvia, tormenta,
 * noche), para que no parezcan un punto más de la misma escala.
 */
const CONDITION_COLOR: Record<string, string> = {
  clear: 'bg-emerald-400',
  partly_cloudy: 'bg-sky-300',
  mostly_cloudy: 'bg-sky-400',
  overcast: 'bg-slate-400',
  foggy: 'bg-indigo-300',
  rainy: 'bg-blue-500',
  stormy: 'bg-violet-500',
  night: 'bg-slate-600',
}

const COBERTURA_LEYENDA = [
  { color: 'bg-emerald-400', label: '≤ 20%' },
  { color: 'bg-sky-300', label: '20–50%' },
  { color: 'bg-sky-400', label: '50–80%' },
  { color: 'bg-slate-400', label: '> 80%' },
]

function colorCobertura(pct: number): string {
  return pct > 80 ? 'bg-slate-400' : pct > 50 ? 'bg-sky-400' : pct > 20 ? 'bg-sky-300' : 'bg-emerald-400'
}

/** Minutos desde medianoche, en hora LOCAL del navegador. */
function minutosDelDia(ts: string): number {
  const t = new Date(ts)
  return t.getHours() * 60 + t.getMinutes()
}

export interface SkyAnalysisHistoryProps {
  selected: string | null
  onSelect: (iso: string) => void
  /** Reporta hacia arriba qué fechas tienen análisis, para el calendario compartido. */
  onDaysChange: (dates: string[]) => void
}

export function SkyAnalysisHistory({ selected, onSelect, onDaysChange }: SkyAnalysisHistoryProps) {
  const [days, setDays] = useState<DayInfo[]>([])
  const [dayData, setDayData] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [cargandoDia, setCargandoDia] = useState(false)

  // Cargar lista de días disponibles
  useEffect(() => {
    fetch('/api/camera/analysis/history')
      .then(r => r.ok ? r.json() : null)
      .then(data => setDays(data?.days ?? []))
      .catch(() => setDays([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    onDaysChange(days.map((d) => d.date))
  }, [days, onDaysChange])

  // Selección inicial (sólo si nadie ha elegido fecha todavía): el día con análisis
  // más reciente.
  useEffect(() => {
    if (selected || !days.length) return
    onSelect(days[0].date)
  }, [days, selected, onSelect])

  // Cargar datos del día seleccionado
  useEffect(() => {
    if (!selected) return
    setDayData(null)
    setCargandoDia(true)
    fetch(`/api/camera/analysis/history?date=${selected}`)
      .then(r => r.ok ? r.json() : null)
      .then(setDayData)
      .catch(() => setDayData(null))
      .finally(() => setCargandoDia(false))
  }, [selected])

  if (loading) return null
  if (!days.length) {
    return (
      <div className="card mt-4">
        <p className="card-title flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-violet-400" />
          Histórico de análisis
        </p>
        <p className="text-sm text-slate-400">
          Aún no hay suficientes análisis guardados. El historial se irá llenando
          conforme la cámara envíe fotos.
        </p>
      </div>
    )
  }

  return (
    <div className="card mt-4">
      <p className="card-title mb-3 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-violet-400" />
        Histórico de análisis
        {dayData && <span className="text-xs font-normal text-slate-500">· {dayData.count} análisis</span>}
      </p>

      {cargandoDia && <div className="h-40 rounded-xl bg-white/5 animate-pulse" />}

      {!cargandoDia && selected && !dayData && (
        // `selected` puede venir de un día que SÍ tiene timelapse pero no análisis
        // guardado (p.ej. la cámara estuvo caída ese día): no es "cargando".
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-sm text-slate-400">
          Sin análisis guardado para este día.
        </div>
      )}

      {!cargandoDia && dayData && (
        <>
          {/* Estadísticas del día */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-white/[0.03] rounded-lg p-2 text-center">
              <p className="text-xs text-slate-500">Promedio</p>
              <p className="text-lg font-bold text-slate-200">{dayData.stats.coverage_avg}%</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2 text-center">
              <p className="text-xs text-slate-500">Mínimo</p>
              <p className="text-lg font-bold text-emerald-400">{dayData.stats.coverage_min}%</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2 text-center">
              <p className="text-xs text-slate-500">Máximo</p>
              <p className="text-lg font-bold text-amber-400">{dayData.stats.coverage_max}%</p>
            </div>
          </div>

          {/* Gráfica de barras de cobertura */}
          <div className="mb-4">
            <p className="text-xs text-slate-500 mb-2">Cobertura de nubes durante el día</p>
            {/* Cada barra en su hora REAL (posición absoluta sobre un riel de 24h), no
                repartidas por igual entre sí: la cámara sólo captura de día (hoy
                06:00-00:00, configurable en Admin), así que el hueco nocturno se ve
                como hueco en vez de estirar las muestras reales para tapar el día
                entero -- que es lo que hacía la versión anterior con `flex-1`. */}
            <div className="h-24 relative bg-white/[0.02] rounded-lg px-2 pt-2 pb-0">
              {dayData.entries.map((entry, i) => {
                const leftPct = (minutosDelDia(entry.ts) / 1440) * 100
                const height = Math.max(2, entry.coverage)
                return (
                  <div
                    key={i}
                    className={`absolute bottom-0 w-[3px] -ml-px ${colorCobertura(entry.coverage)} rounded-t opacity-80 hover:opacity-100 transition-opacity`}
                    style={{ left: `${leftPct}%`, height: `${height}%` }}
                    title={`${new Date(entry.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}: ${entry.coverage}% - ${CONDITION_ES[entry.condition] || entry.condition}`}
                  />
                )
              })}
            </div>
            <div className="flex justify-between text-xs text-slate-600 mt-1">
              <span>00:00</span>
              <span>12:00</span>
              <span>24:00</span>
            </div>

            {/* Leyenda: qué % de cobertura representa cada color de barra. */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {COBERTURA_LEYENDA.map((l) => (
                <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>

          {/* Condiciones del día */}
          <div>
            <p className="text-xs text-slate-500 mb-2">Condiciones observadas</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(dayData.stats.conditions)
                .sort((a, b) => b[1] - a[1])
                .map(([cond, count]) => (
                  <span
                    key={cond}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-full bg-white/[0.05] text-slate-300"
                  >
                    <span className={`w-2 h-2 rounded-full ${CONDITION_COLOR[cond] || 'bg-slate-500'}`} />
                    {CONDITION_ES[cond] || cond}: {count}
                  </span>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
