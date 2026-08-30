import { useEffect, useState } from 'react'
import { Stars } from 'lucide-react'

/**
 * ¿Vale la pena salir a ver el cielo esta noche? Cruza dos datos que ya existen
 * por su cuenta, sin pedirle nada nuevo a la IA de la cámara (que sería tener
 * que validar un esquema nuevo -- "detecta estrellas" -- contra fotos reales
 * antes de confiar en él):
 *
 *   - Cobertura de nubes de la cámara AHORA MISMO (sólo aporta esto de noche:
 *     ni la luna ni el almanaque dicen si está nublado en este momento).
 *   - % de iluminación lunar, de `/api/almanac` -- la luna llena "apaga" las
 *     estrellas tenues aunque el cielo esté perfectamente despejado.
 *
 * Se oculta de día, sin análisis reciente (>20 min, el mismo umbral de "foto
 * vieja" que ya usa el resto de la cámara) o sin dato de luna.
 */

interface CamaraNoche {
  sky_condition?: string
  cloud_coverage_pct?: number
  analyzed_at?: string
}

const STALE_MS = 20 * 60 * 1000

function veredicto(coverage: number, illumination: number): { texto: string; bueno: boolean } {
  if (coverage > 50) {
    return { texto: `Cielo nublado ahora mismo (${coverage}%): no es buena noche para observar, sin importar la luna.`, bueno: false }
  }
  if (illumination > 70) {
    return {
      texto: `Cielo despejado (${coverage}% nubes), pero luna muy brillante (${illumination}%): buena noche para ver la Luna o planetas, no tanto para objetos tenues.`,
      bueno: false,
    }
  }
  if (illumination > 25) {
    return { texto: `Cielo despejado (${coverage}% nubes) con luna moderada (${illumination}%): condiciones aceptables para observar.`, bueno: true }
  }
  return { texto: `Cielo despejado (${coverage}% nubes) y poca luna (${illumination}%): buena noche para observar estrellas.`, bueno: true }
}

export function StargazingCard() {
  const [camara, setCamara] = useState<CamaraNoche | null>(null)
  const [illumination, setIllumination] = useState<number | null>(null)

  useEffect(() => {
    let cancel = false
    const load = () => {
      fetch('/api/camera/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => !cancel && setCamara(j?.analysis && !j.analysis.error ? j.analysis : null))
        .catch(() => !cancel && setCamara(null))
      fetch('/api/almanac')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => !cancel && setIllumination(typeof j?.moon?.illumination === 'number' ? j.moon.illumination : null))
        .catch(() => !cancel && setIllumination(null))
    }
    load()
    const i = setInterval(load, 5 * 60 * 1000)
    return () => { cancel = true; clearInterval(i) }
  }, [])

  if (!camara || camara.sky_condition !== 'night' || camara.cloud_coverage_pct == null || illumination == null) return null
  if (!camara.analyzed_at || Date.now() - new Date(camara.analyzed_at).getTime() > STALE_MS) return null

  const v = veredicto(camara.cloud_coverage_pct, illumination)

  return (
    <div className={`card border ${v.bueno ? 'border-emerald-500/20' : 'border-white/10'}`}>
      <p className="card-title mb-2 flex items-center gap-2">
        <Stars className="w-5 h-5 text-violet-400" />
        ¿Buena noche para observar?
      </p>
      <p className="text-base text-slate-100 leading-relaxed">{v.texto}</p>
      <p className="text-xs text-slate-500 mt-2">
        Según la cámara del exterior de la estación y la iluminación lunar actual.
      </p>
    </div>
  )
}
