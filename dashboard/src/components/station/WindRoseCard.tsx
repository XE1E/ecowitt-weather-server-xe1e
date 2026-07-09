import { useEffect, useRef, useState } from 'react'
import { useUnits } from '../../units'

interface Sector { dir: number; label: string; count: number; pct: number; avg_speed: number; max_speed: number }
interface Rose { sectors: Sector[]; calm_pct: number; total: number; dominant: string | null }

const PERIODS = [
  { k: '7d', label: '7 días', start: '-7d' },
  { k: '30d', label: '30 días', start: '-30d' },
  { k: 'year', label: 'Año', start: '-365d' },
]

// Color por velocidad media (km/h) del sector
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

export function WindRoseCard() {
  const u = useUnits()
  const [period, setPeriod] = useState('30d')
  const [rose, setRose] = useState<Rose | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const start = PERIODS.find((p) => p.k === period)!.start
    let cancel = false
    fetch(`/api/wind/rose?start=${start}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancel && setRose(j))
      .catch(() => {})
    return () => { cancel = true }
  }, [period])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !rose) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const size = 260
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = size + 'px'
    canvas.style.height = size + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    const cx = size / 2
    const cy = size / 2
    const R = size / 2 - 26
    const grid = cssVar('--line', '#dde5ed')
    const ink = cssVar('--muted', '#5a6b7b')
    const maxPct = Math.max(1, ...rose.sectors.map((s) => s.pct))

    // círculos de referencia
    ctx.strokeStyle = grid
    ctx.fillStyle = ink
    ctx.lineWidth = 1
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath()
      ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2)
      ctx.stroke()
    }
    // ejes N-S-E-O
    ctx.beginPath()
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy)
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R)
    ctx.stroke()

    // pétalos (una cuña por sector, largo ∝ frecuencia, color ∝ velocidad media)
    rose.sectors.forEach((s) => {
      if (s.pct <= 0) return
      const len = (R * s.pct) / maxPct
      const half = (22.5 * Math.PI) / 180 / 2
      const a = ((s.dir - 90) * Math.PI) / 180 // 0° = arriba (N)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, len, a - half, a + half)
      ctx.closePath()
      ctx.fillStyle = speedColor(s.avg_speed)
      ctx.globalAlpha = 0.85
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = grid
      ctx.stroke()
    })

    // etiquetas N E S O
    ctx.fillStyle = ink
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', cx, cy - R - 12)
    ctx.fillText('S', cx, cy + R + 12)
    ctx.fillText('E', cx + R + 12, cy)
    ctx.fillText('O', cx - R - 12, cy)
  }, [rose])

  const btn = (active: boolean) =>
    `px-2 py-1 rounded-lg text-xs transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <p className="card-title">Rosa de vientos</p>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p.k} className={btn(period === p.k)} onClick={() => setPeriod(p.k)}>{p.label}</button>
          ))}
        </div>
      </div>

      {!rose || rose.total === 0 ? (
        <p className="text-slate-400 text-sm py-8 text-center">Sin datos de viento en el periodo.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <canvas ref={canvasRef} aria-label="Rosa de vientos" />
          <div className="text-sm space-y-1 min-w-0">
            <p>Dirección dominante: <strong className="text-emerald-300">{rose.dominant ?? '--'}</strong></p>
            <p className="text-slate-400">Calma: {rose.calm_pct}% · {rose.total.toLocaleString('es-MX')} lecturas</p>
            <div className="flex flex-wrap gap-2 mt-2 text-xs text-slate-400">
              <span><i className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#93c5fd' }} />&lt;5</span>
              <span><i className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#38bdf8' }} />5–15</span>
              <span><i className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#22c55e' }} />15–25</span>
              <span><i className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#f59e0b' }} />25–40</span>
              <span><i className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#ef4444' }} />&gt;40</span>
              <span className="text-slate-500">{u.windU}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">El largo de cada pétalo es la frecuencia; el color, la velocidad media.</p>
          </div>
        </div>
      )}
    </div>
  )
}
