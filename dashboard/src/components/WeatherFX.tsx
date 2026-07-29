import { useEffect, useRef } from 'react'
import { FxType } from '../weather'

interface WeatherFXProps {
  type: FxType
  intensity?: number // 0..1
}

interface Particle {
  x: number
  y: number
  len: number
  speed: number
  drift: number
  alpha: number
  // For stars
  twinkle?: number
  twinkleSpeed?: number
  // For clouds
  width?: number
  height?: number
}

/**
 * Full-viewport animated weather effects rendered on a canvas behind the UI.
 * Condition-driven: rain, snow, fog, storms, clear skies, and clouds.
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

    const isRain = type === 'rain' || type === 'storm'
    const isSnow = type === 'snow'
    const isFog = type === 'fog'
    const isClear = type === 'clear'
    const isCloudy = type === 'cloudy' || type === 'partly-cloudy'
    const isStorm = type === 'storm'

    // Detect day/night for clear effect
    const hour = new Date().getHours()
    const isNight = hour < 7 || hour >= 19

    // Rain/snow particles
    const precipCount = Math.round((isSnow ? 90 : isRain ? 220 : 0) * (0.4 + intensity))
    const precipParticles: Particle[] = Array.from({ length: precipCount }, () => makePrecipParticle())

    function makePrecipParticle(): Particle {
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
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        len: 8 + Math.random() * 14 * (0.5 + intensity),
        speed: 6 + Math.random() * 8 * (0.6 + intensity),
        drift: 1 + Math.random() * 1.5,
        alpha: 0.15 + Math.random() * 0.35,
      }
    }

    // Stars for clear night
    const starCount = isClear && isNight ? Math.round(80 * (0.5 + intensity)) : 0
    const stars: Particle[] = Array.from({ length: starCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h * 0.7,
      len: 0.8 + Math.random() * 1.5,
      speed: 0,
      drift: 0,
      alpha: 0.3 + Math.random() * 0.7,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.02 + Math.random() * 0.04,
    }))

    // Clouds for cloudy/partly-cloudy
    const cloudCount = isCloudy ? (type === 'partly-cloudy' ? 4 : 7) : 0
    const clouds: Particle[] = Array.from({ length: cloudCount }, () => ({
      x: Math.random() * w * 1.5 - w * 0.25,
      y: 50 + Math.random() * h * 0.4,
      len: 0,
      speed: 0.15 + Math.random() * 0.25,
      drift: 0,
      alpha: type === 'partly-cloudy' ? 0.08 + Math.random() * 0.06 : 0.12 + Math.random() * 0.1,
      width: 200 + Math.random() * 250,
      height: 80 + Math.random() * 60,
    }))

    // Lightning state
    let flash = 0
    let nextFlash = 60 + Math.random() * 180

    // Sun rays angle
    let sunAngle = 0

    let raf = 0
    let frame = 0

    const render = () => {
      frame++
      ctx.clearRect(0, 0, w, h)

      // --- Clear sky effect ---
      if (isClear) {
        if (isNight) {
          // Stars twinkling
          for (const s of stars) {
            s.twinkle! += s.twinkleSpeed!
            const twinkleAlpha = s.alpha * (0.5 + 0.5 * Math.sin(s.twinkle!))
            ctx.beginPath()
            ctx.fillStyle = `rgba(255,255,255,${twinkleAlpha})`
            ctx.arc(s.x, s.y, s.len, 0, Math.PI * 2)
            ctx.fill()
          }
        } else {
          // Sun rays effect
          sunAngle += 0.002
          const cx = w * 0.85
          const cy = h * 0.1
          const rayCount = 12
          for (let i = 0; i < rayCount; i++) {
            const angle = sunAngle + (i * Math.PI * 2) / rayCount
            const rayLen = 300 + Math.sin(frame / 60 + i) * 50
            const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(angle) * rayLen, cy + Math.sin(angle) * rayLen)
            g.addColorStop(0, `rgba(255,240,200,${0.08 * intensity})`)
            g.addColorStop(1, 'rgba(255,240,200,0)')
            ctx.beginPath()
            ctx.moveTo(cx, cy)
            ctx.lineTo(cx + Math.cos(angle - 0.05) * rayLen, cy + Math.sin(angle - 0.05) * rayLen)
            ctx.lineTo(cx + Math.cos(angle + 0.05) * rayLen, cy + Math.sin(angle + 0.05) * rayLen)
            ctx.closePath()
            ctx.fillStyle = g
            ctx.fill()
          }
          // Sun glow
          const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 150)
          glow.addColorStop(0, `rgba(255,240,180,${0.15 * intensity})`)
          glow.addColorStop(0.5, `rgba(255,220,150,${0.05 * intensity})`)
          glow.addColorStop(1, 'rgba(255,200,100,0)')
          ctx.fillStyle = glow
          ctx.fillRect(0, 0, w, h)
        }
      }

      // --- Clouds effect ---
      if (isCloudy) {
        for (const c of clouds) {
          // Draw cloud as overlapping ellipses
          ctx.fillStyle = `rgba(180,190,210,${c.alpha!})`
          const cw = c.width!
          const ch = c.height!

          // Main body
          ctx.beginPath()
          ctx.ellipse(c.x, c.y, cw * 0.5, ch * 0.5, 0, 0, Math.PI * 2)
          ctx.fill()
          // Left puff
          ctx.beginPath()
          ctx.ellipse(c.x - cw * 0.35, c.y + ch * 0.1, cw * 0.3, ch * 0.4, 0, 0, Math.PI * 2)
          ctx.fill()
          // Right puff
          ctx.beginPath()
          ctx.ellipse(c.x + cw * 0.35, c.y + ch * 0.05, cw * 0.35, ch * 0.45, 0, 0, Math.PI * 2)
          ctx.fill()
          // Top puff
          ctx.beginPath()
          ctx.ellipse(c.x + cw * 0.1, c.y - ch * 0.25, cw * 0.25, ch * 0.35, 0, 0, Math.PI * 2)
          ctx.fill()

          // Move cloud
          c.x += c.speed
          if (c.x - cw > w) {
            c.x = -cw
            c.y = 50 + Math.random() * h * 0.4
          }
        }
      }

      // --- Fog effect ---
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

      // --- Snow effect ---
      if (isSnow) {
        for (const p of precipParticles) {
          ctx.beginPath()
          ctx.fillStyle = `rgba(255,255,255,${p.alpha})`
          ctx.arc(p.x, p.y, p.len, 0, Math.PI * 2)
          ctx.fill()
          p.y += p.speed
          p.x += Math.sin(frame / 40 + p.y / 50) * 0.6 + p.drift
          if (p.y > h) {
            p.y = -5
            p.x = Math.random() * w
          }
        }
      }

      // --- Rain effect ---
      if (isRain) {
        ctx.lineCap = 'round'
        for (const p of precipParticles) {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(174,201,235,${p.alpha})`
          ctx.lineWidth = 1.1
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x + p.drift, p.y + p.len)
          ctx.stroke()
          p.y += p.speed
          p.x += p.drift
          if (p.y > h) {
            p.y = -p.len
            p.x = Math.random() * w
          }
        }
      }

      // --- Storm effect (lightning flashes) ---
      if (isStorm) {
        if (frame >= nextFlash) {
          flash = 1
          nextFlash = frame + 80 + Math.random() * 200
        }
        if (flash > 0) {
          // Multiple quick flashes
          const flashIntensity = flash > 0.7 ? 0.4 : flash > 0.4 ? 0.25 : 0.15
          ctx.fillStyle = `rgba(220,230,255,${flashIntensity})`
          ctx.fillRect(0, 0, w, h)
          flash -= 0.06
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
