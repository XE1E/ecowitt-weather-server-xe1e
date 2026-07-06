import { useEffect, useRef } from 'react'
import { FxType } from '../weather'

interface WeatherFXProps {
  type: FxType
  intensity?: number // 0..1
}

interface Particle {
  x: number
  y: number
  len: number   // rain streak length / snow radius
  speed: number
  drift: number
  alpha: number
}

/**
 * Full-viewport animated weather effects rendered on a canvas behind the UI.
 * Condition-driven: rain streaks, snow, drifting fog, and lightning flashes.
 */
export function WeatherFX({ type, intensity = 0.6 }: WeatherFXProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || type === 'none') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = (canvas.width = window.innerWidth)
    let h = (canvas.height = window.innerHeight)

    const onResize = () => {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', onResize)

    const isRain = type === 'rain' || type === 'lightning'
    const isSnow = type === 'snow'
    const isFog = type === 'fog'

    const count = Math.round((isSnow ? 90 : isRain ? 220 : 0) * (0.4 + intensity))
    const particles: Particle[] = Array.from({ length: count }, () => makeParticle())

    function makeParticle(): Particle {
      if (isSnow) {
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          len: 1.5 + Math.random() * 2.5,
          speed: 0.5 + Math.random() * 1.2,
          drift: (Math.random() - 0.5) * 0.8,
          alpha: 0.4 + Math.random() * 0.5,
        }
      }
      // rain
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        len: 8 + Math.random() * 14 * (0.5 + intensity),
        speed: 6 + Math.random() * 8 * (0.6 + intensity),
        drift: 1 + Math.random() * 1.5,
        alpha: 0.15 + Math.random() * 0.35,
      }
    }

    // Lightning state
    let flash = 0
    let nextFlash = 60 + Math.random() * 240

    let raf = 0
    let frame = 0
    const render = () => {
      frame++
      ctx.clearRect(0, 0, w, h)

      if (isFog) {
        const t = frame / 120
        for (let i = 0; i < 4; i++) {
          const cx = ((t * 40 * (i + 1)) % (w + 400)) - 200
          const cy = h * (0.2 + i * 0.2)
          const r = 260 + i * 60
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
          g.addColorStop(0, `rgba(200,210,225,${0.05 * intensity + 0.03})`)
          g.addColorStop(1, 'rgba(200,210,225,0)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, w, h)
        }
      }

      if (isSnow) {
        for (const p of particles) {
          ctx.beginPath()
          ctx.fillStyle = `rgba(255,255,255,${p.alpha})`
          ctx.arc(p.x, p.y, p.len, 0, Math.PI * 2)
          ctx.fill()
          p.y += p.speed
          p.x += Math.sin(frame / 40 + p.y / 50) * 0.6 + p.drift
          if (p.y > h) { p.y = -5; p.x = Math.random() * w }
        }
      }

      if (isRain) {
        ctx.lineCap = 'round'
        for (const p of particles) {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(174,201,235,${p.alpha})`
          ctx.lineWidth = 1.1
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x + p.drift, p.y + p.len)
          ctx.stroke()
          p.y += p.speed
          p.x += p.drift
          if (p.y > h) { p.y = -p.len; p.x = Math.random() * w }
        }
      }

      if (type === 'lightning') {
        if (frame >= nextFlash) {
          flash = 1
          nextFlash = frame + 120 + Math.random() * 300
        }
        if (flash > 0) {
          ctx.fillStyle = `rgba(220,230,255,${flash * 0.35})`
          ctx.fillRect(0, 0, w, h)
          flash -= 0.08
          if (flash < 0) flash = 0
        }
      }

      raf = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [type, intensity])

  if (type === 'none') return null

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-10"
      aria-hidden="true"
    />
  )
}
