import { useState, useEffect, useRef } from 'react'
import { WeatherData } from '../../types'
import { WindCard } from './WindCard'
import { WindRose, Rose } from './WindRose'

function RoseBack({ onBack }: { onBack: () => void }) {
  const [rose, setRose] = useState<Rose | null>(null)

  useEffect(() => {
    let cancel = false
    fetch('/api/wind/rose?start=-24h')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancel && setRose(j))
      .catch(() => {})
    return () => { cancel = true }
  }, [])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <p className="card-title mb-0">Rosa de vientos <span className="text-slate-500 font-normal normal-case">· 24 h</span></p>
        <button onClick={onBack} className="text-xs text-blue-400 hover:text-blue-300">← Atrás</button>
      </div>
      {!rose || rose.total === 0 ? (
        <p className="text-slate-400 text-sm py-10 text-center">Sin datos de viento aún.</p>
      ) : (
        <div className="flex flex-col items-center">
          <WindRose rose={rose} size={220} compact />
          <p className="text-[11px] text-slate-500 mt-1">
            Dominante <strong className="text-emerald-300">{rose.dominant ?? '--'}</strong> · {rose.total.toLocaleString('es-MX')} lecturas
          </p>
        </div>
      )}
    </div>
  )
}

const faceStyle = (t: string): React.CSSProperties => ({
  position: 'absolute', top: 0, left: 0, width: '100%',
  transition: 'transform 0.6s', transformStyle: 'preserve-3d',
  backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: t,
})

export function WindFlipCard({ data }: { data: WeatherData }) {
  const [flipped, setFlipped] = useState(false)
  const frontRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ f: 0, b: 0 })

  useEffect(() => {
    const measure = () => setDims({ f: frontRef.current?.offsetHeight || 0, b: backRef.current?.offsetHeight || 0 })
    measure()
    const ro = new ResizeObserver(measure)
    if (frontRef.current) ro.observe(frontRef.current)
    if (backRef.current) ro.observe(backRef.current)
    return () => ro.disconnect()
  }, [])

  const h = flipped ? dims.b : dims.f
  return (
    <div style={{ position: 'relative', perspective: '1400px', height: h || undefined, transition: 'height 0.5s ease' }}>
      <div ref={frontRef} style={faceStyle(flipped ? 'rotateY(180deg)' : 'rotateY(0deg)')}>
        <WindCard data={data} onFlip={() => setFlipped(true)} />
      </div>
      <div ref={backRef} style={faceStyle(flipped ? 'rotateY(360deg)' : 'rotateY(180deg)')}>
        <RoseBack onBack={() => setFlipped(false)} />
      </div>
    </div>
  )
}
