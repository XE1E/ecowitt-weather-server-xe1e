import { useEffect, useState } from 'react'
import { Sparkles, ImageOff } from 'lucide-react'

/**
 * La foto con mejor visibilidad reportada del día seleccionado (ver
 * `CameraStore.best_of_day` en el receiver). No es un juicio estético -- es la
 * métrica más honesta que ya se guarda para "se ve bien y se ve lejos".
 *
 * El metadato se conserva para siempre (vive en el análisis diario), pero la
 * foto en sí puede haberse podado ya -- las fotos se retienen 7 días por
 * defecto -- así que se degrada mostrando el dato sin la imagen.
 */

interface BestPhoto {
  ts: string
  condition: string
  cloud_type: string
  visibility: string
  coverage: number
  precip: boolean
}

const CONDITION_ES: Record<string, string> = {
  clear: 'Despejado', partly_cloudy: 'Parcialmente nublado', mostly_cloudy: 'Mayormente nublado',
  overcast: 'Cubierto', foggy: 'Neblina', rainy: 'Lluvia', stormy: 'Tormenta', night: 'Noche',
}
const VISIBILITY_ES: Record<string, string> = {
  excellent: 'Excelente', good: 'Buena', moderate: 'Moderada', poor: 'Pobre', very_poor: 'Muy pobre',
}

export interface BestPhotoCardProps {
  /** Fecha seleccionada (YYYY-MM-DD), compartida con Timelapse e Histórico. */
  selected: string | null
}

export function BestPhotoCard({ selected }: BestPhotoCardProps) {
  const [meta, setMeta] = useState<BestPhoto | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'empty'>('loading')
  const [fotoOk, setFotoOk] = useState(true)

  useEffect(() => {
    if (!selected) return
    let cancel = false
    setState('loading')
    setMeta(null)
    setFotoOk(true)
    fetch(`/api/camera/best/${selected}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancel) return
        setMeta(j)
        setState(j ? 'ok' : 'empty')
      })
      .catch(() => !cancel && setState('empty'))
    return () => { cancel = true }
  }, [selected])

  if (!selected || state === 'empty') return null
  if (state === 'loading') return <div className="card mt-4 h-64 rounded-xl bg-white/5 animate-pulse" />
  if (!meta) return null

  return (
    <div className="card mt-4">
      <p className="card-title mb-3 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-violet-400" />
        Mejor foto del día
      </p>

      {fotoOk ? (
        <img
          src={`/api/camera/best/${selected}.jpg`}
          alt="Mejor foto del día, según visibilidad"
          onError={() => setFotoOk(false)}
          className="w-full rounded-xl border border-white/10"
        />
      ) : (
        <div className="h-40 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center px-6">
          <ImageOff className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-sm text-slate-400">
            La foto ya no está disponible (las fotos se conservan 7 días; este dato, para siempre).
          </p>
        </div>
      )}

      <p className="text-sm text-slate-400 mt-2">
        {new Date(meta.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
        {' · '}{CONDITION_ES[meta.condition] ?? meta.condition}
        {', visibilidad '}{(VISIBILITY_ES[meta.visibility] ?? meta.visibility).toLowerCase()}
      </p>
    </div>
  )
}
