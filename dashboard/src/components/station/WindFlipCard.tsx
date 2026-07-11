import { useState, useEffect, useRef } from 'react'
import { WeatherData } from '../../types'
import { WindCard } from './WindCard'
import { useUnits } from '../../units'

interface Sector { dir: number; label: string; count: number; pct: number; avg_speed: number; max_speed: number }
interface Rose { sectors: Sector[]; calm_pct: number; total: number; dominant: string | null }

function speedColor(kmh: number): string {
  if (kmh < 5) return '#93c5fd'
  if (kmh < 15) return '#38bdf8'
  if (kmh < 25) return '#22c55e'
  if (kmh < 40) return '#f59e0b'
  return '#ef4444'
}
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function RoseBack({ onBack }: { onBack: () => void }) {
  const u = useUnits()
  const [rose, setRose] = useState<Rose | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancel = false
    fetch('/api/wind/rose?start=-24h')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancel && setRose(j))
      .catch(() => {})
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !rose) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = 210
    canvas.width = size * dpr; canvas.height = size * dpr
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const cx = size / 2, cy = size / 2, R = size / 2 - 22
    const grid = cssVar('--line', 'rgba(148,163,184,0.25)')
    const ink = cssVar('--muted', '#94a3b8')
    const maxPct = Math.max(1, ...rose.sectors.map((s) => s.pct))
    ctx.strokeStyle = grid; ctx.lineWidth = 1
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); ctx.stroke() }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke()
    rose.sectors.forEach((s) => {
      if (s.pct <= 0) return
      const len = (R * s.pct) / maxPct
      const half = (22.5 * Math.PI) / 180 / 2
      const a = ((s.dir - 90) * Math.PI) / 180
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, len, a - half, a + half); ctx.closePath()
      ctx.fillStyle = speedColor(s.avg_speed); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1
      ctx.strokeStyle = grid; ctx.stroke()
    })
    ctx.fillStyle = ink; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('N', cx, cy - R - 11); ctx.fillText('S', cx, cy + R + 11)
    ctx.fillText('E', cx + R + 11, cy); ctx.fillText('O', cx - R - 11, cy)
  }, [rose])

  const chip = (c: string, t: string) => (
    <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{t}</span>
  )

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
          <div className="relative">
            <canvas ref={canvasRef} aria-label="Rosa de vientos" />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] text-slate-400 leading-none">Calma</span>
              <span className="text-base font-bold text-slate-200 leading-none">{rose.calm_pct}%</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-400">
            {chip('#93c5fd', '<5')}{chip('#38bdf8', '5–15')}{chip('#22c55e', '15–25')}{chip('#f59e0b', '25–40')}{chip('#ef4444', '>40')}
            <span className="text-slate-500">{u.windU}</span>
          </div>
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
