import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Selector de fecha con mini-calendario (mes/año), reutilizado en las tarjetas que
 * navegan por día (timelapse, histórico de análisis del cielo). Sustituye a la tira de
 * botones "un botón por día", que con meses de retención se vuelve inmanejable
 * (30+ accesos, sobre todo en móvil).
 */

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** "hoy" / "ayer" / "24 ago" */
export function fmtDia(iso: string): string {
  const hoy = new Date()
  const f = new Date(iso + 'T12:00:00')
  const dif = Math.round(
    (new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime() -
      new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime()) / 86400000,
  )
  if (dif === 0) return 'hoy'
  if (dif === 1) return 'ayer'
  return f.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

/** Semana de lunes a domingo, con `null` de relleno antes/después del mes. */
function gridMes(anio: number, mes: number): (Date | null)[] {
  const primero = new Date(anio, mes, 1)
  const inicioSemana = (primero.getDay() + 6) % 7 // lunes = 0
  const diasDelMes = new Date(anio, mes + 1, 0).getDate()
  const celdas: (Date | null)[] = []
  for (let i = 0; i < inicioSemana; i++) celdas.push(null)
  for (let d = 1; d <= diasDelMes; d++) celdas.push(new Date(anio, mes, d))
  while (celdas.length % 7 !== 0) celdas.push(null)
  return celdas
}

export interface DayCalendarProps {
  /** Fecha elegida (ISO `YYYY-MM-DD`) o `null` si aún no hay ninguna. */
  selected: string | null
  /** Fechas ISO con datos: sólo ésas se pueden elegir en la cuadrícula. */
  available: Set<string>
  onSelect: (iso: string) => void
  /** true → esa fecha lleva un puntito de aviso (p.ej. "sin vídeo todavía"). */
  dayBadge?: (iso: string) => boolean
  /** Texto del `title` (tooltip) de cada día disponible. */
  dayTitle?: (iso: string) => string | undefined
  /** Etiqueta del botón disparador. Por defecto usa {@link fmtDia}. */
  label?: (iso: string) => string
}

export function DayCalendar({ selected, available, onSelect, dayBadge, dayTitle, label }: DayCalendarProps) {
  const [abierto, setAbierto] = useState(false)
  const [cursor, setCursor] = useState<Date | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const cerrar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', cerrar)
    return () => document.removeEventListener('mousedown', cerrar)
  }, [abierto])

  const [limiteMin, limiteMax] = (() => {
    const fechas = Array.from(available).sort()
    if (!fechas.length) return [null, null] as const
    return [new Date(fechas[0] + 'T12:00:00'), new Date(fechas[fechas.length - 1] + 'T12:00:00')] as const
  })()

  const abrir = () => {
    const base = selected ? new Date(selected + 'T12:00:00') : new Date()
    setCursor(new Date(base.getFullYear(), base.getMonth(), 1))
    setAbierto((v) => !v)
  }

  const cambiarMes = (delta: number) => {
    setCursor((c) => {
      const base = c ?? new Date()
      return new Date(base.getFullYear(), base.getMonth() + delta, 1)
    })
  }

  /** true si el mes destino de moverse `delta` meses cae fuera del rango con datos. */
  const mesFueraDeLimite = (delta: number) => {
    if (!cursor) return false
    const objetivo = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1)
    if (limiteMin && (objetivo.getFullYear() < limiteMin.getFullYear() ||
      (objetivo.getFullYear() === limiteMin.getFullYear() && objetivo.getMonth() < limiteMin.getMonth()))) return true
    if (limiteMax && (objetivo.getFullYear() > limiteMax.getFullYear() ||
      (objetivo.getFullYear() === limiteMax.getFullYear() && objetivo.getMonth() > limiteMax.getMonth()))) return true
    return false
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={abrir}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium border bg-white/5 border-white/10 text-slate-200 hover:bg-white/10 transition"
      >
        <Calendar className="w-3.5 h-3.5 text-sky-400" />
        {selected ? (label ?? fmtDia)(selected) : 'Elegir día'}
      </button>

      {abierto && cursor && (
        <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur p-3 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => cambiarMes(-1)}
              disabled={mesFueraDeLimite(-1)}
              className="p-2 -m-1 rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="text-sm font-semibold text-slate-200 capitalize">
              {cursor.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
            </p>
            <button
              onClick={() => cambiarMes(1)}
              disabled={mesFueraDeLimite(1)}
              className="p-2 -m-1 rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => (
              <span key={i} className="text-center text-[10px] text-slate-500">{l}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {gridMes(cursor.getFullYear(), cursor.getMonth()).map((f, i) => {
              if (!f) return <span key={i} />
              const iso = toISO(f)
              const disponible = available.has(iso)
              const seleccionado = iso === selected
              return (
                <button
                  key={iso}
                  disabled={!disponible}
                  onClick={() => { onSelect(iso); setAbierto(false) }}
                  title={disponible ? dayTitle?.(iso) : undefined}
                  className={`relative aspect-square min-h-[2.25rem] rounded-lg text-xs flex items-center justify-center transition border ${
                    seleccionado
                      ? 'bg-sky-600/40 border-sky-500/60 text-slate-100 font-semibold'
                      : disponible
                        ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                        : 'border-transparent text-slate-700'
                  }`}
                >
                  {f.getDate()}
                  {disponible && dayBadge?.(iso) && (
                    <span className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-amber-400/80" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
