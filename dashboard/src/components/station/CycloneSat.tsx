import { useEffect, useMemo, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { CiclonSat, fmtHora } from './cyclones'

/**
 * Satélite GOES centrado en la tormenta (NOAA STAR). Muestra el cuadro más
 * reciente; "Animar" recorre las últimas ~6 h (12 cuadros de 500 px, ~2.5 MB):
 * sólo se descargan si se pide, para no gastar datos en el celular.
 * El GIF que publica NOAA pesa ~19 MB, por eso no se usa.
 */
export function CycloneSat({ id, nombre }: { id: string; nombre: string }) {
  const [sat, setSat] = useState<CiclonSat | null>(null)
  const [i, setI] = useState(-1)          // -1 = último cuadro
  const [anim, setAnim] = useState(false)
  const [listos, setListos] = useState(0) // cuadros ya precargados

  useEffect(() => {
    let cancel = false
    fetch(`/api/ciclones/sat/${id.toUpperCase()}`).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancel) setSat(j) }).catch(() => {})
    return () => { cancel = true }
  }, [id])

  const cuadros = useMemo(() => sat?.cuadros ?? [], [sat])

  // Precarga al pedir la animación; arranca cuando ya están todos.
  useEffect(() => {
    if (!anim || listos) return
    let n = 0
    cuadros.forEach((c) => {
      const im = new Image()
      im.onload = im.onerror = () => { n += 1; if (n === cuadros.length) setListos(n) }
      im.src = c.url
    })
  }, [anim, listos, cuadros])

  useEffect(() => {
    if (!anim || !listos) return
    const t = setInterval(() => setI((k) => (k + 1) % cuadros.length), 450)
    return () => clearInterval(t)
  }, [anim, listos, cuadros.length])

  if (!cuadros.length) return null
  const actual = cuadros[i < 0 ? cuadros.length - 1 : i]
  const cargando = anim && !listos

  return (
    <figure>
      <div className="relative">
        <img src={actual.url} alt={`Satélite de ${nombre}`} loading="lazy"
          className="w-full aspect-square object-cover rounded-lg border border-white/10 bg-black" />
        <div className="on-dark absolute top-2 left-2 bg-black/55 rounded px-2 py-0.5 text-[11px] text-white tabular-nums">
          {fmtHora(actual.hora)}{sat?.satelite ? ` · ${sat.satelite}` : ''}
        </div>
        <button onClick={() => { setAnim((a) => !a); if (anim) setI(-1) }}
          className="on-dark absolute top-2 right-2 flex items-center gap-1.5 bg-black/60 hover:bg-black/75 rounded-lg px-2.5 py-1 text-xs text-white">
          {anim ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {cargando ? 'Cargando…' : anim ? 'Pausa' : 'Animar últimas 6 h'}
        </button>
      </div>
      <figcaption className="text-[11px] text-slate-500 mt-1">
        Satélite GOES en color real de día e infrarrojo de noche (NOAA STAR), centrado en la tormenta.{' '}
        {sat?.pagina && <a href={sat.pagina} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">Más productos ↗</a>}
      </figcaption>
    </figure>
  )
}
