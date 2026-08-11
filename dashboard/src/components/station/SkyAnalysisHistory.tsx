import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Histórico de análisis del cielo.
 * Muestra una gráfica de cobertura de nubes del día seleccionado.
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
  partly_cloudy: 'Parc. nublado',
  mostly_cloudy: 'May. nublado',
  overcast: 'Cubierto',
  foggy: 'Neblina',
  rainy: 'Lluvia',
  stormy: 'Tormenta',
  night: 'Noche',
}

export function SkyAnalysisHistory() {
  const [days, setDays] = useState<DayInfo[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayData, setDayData] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(true)

  // Cargar lista de días disponibles
  useEffect(() => {
    fetch('/api/camera/analysis/history')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.days?.length) {
          setDays(data.days)
          setSelectedDate(data.days[0].date)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Cargar datos del día seleccionado
  useEffect(() => {
    if (!selectedDate) return
    setDayData(null)
    fetch(`/api/camera/analysis/history?date=${selectedDate}`)
      .then(r => r.ok ? r.json() : null)
      .then(setDayData)
      .catch(() => {})
  }, [selectedDate])

  const navDay = useCallback((delta: number) => {
    if (!selectedDate || !days.length) return
    const idx = days.findIndex(d => d.date === selectedDate)
    const newIdx = Math.max(0, Math.min(days.length - 1, idx - delta))
    setSelectedDate(days[newIdx].date)
  }, [selectedDate, days])

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

  const currentIdx = days.findIndex(d => d.date === selectedDate)
  const canPrev = currentIdx < days.length - 1
  const canNext = currentIdx > 0

  return (
    <div className="card mt-4">
      <p className="card-title flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-violet-400" />
        Histórico de análisis
      </p>

      {/* Selector de fecha */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navDay(1)}
          disabled={!canPrev}
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <span className="font-medium">{selectedDate}</span>
          {dayData && (
            <span className="text-xs text-slate-500">({dayData.count} análisis)</span>
          )}
        </div>
        <button
          onClick={() => navDay(-1)}
          disabled={!canNext}
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {dayData && (
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
            <div className="h-24 flex items-end gap-px bg-white/[0.02] rounded-lg p-2">
              {dayData.entries.map((entry, i) => {
                const height = Math.max(2, entry.coverage)
                const color = entry.coverage > 80 ? 'bg-slate-400' :
                              entry.coverage > 50 ? 'bg-sky-400' :
                              entry.coverage > 20 ? 'bg-sky-300' : 'bg-emerald-400'
                return (
                  <div
                    key={i}
                    className={`flex-1 ${color} rounded-t opacity-80 hover:opacity-100 transition-opacity`}
                    style={{ height: `${height}%` }}
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
                    className="px-2 py-1 text-xs rounded-full bg-white/[0.05] text-slate-300"
                  >
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
