import { useState } from 'react'
import { useUnits } from '../../units'

export interface RoseSector {
  dir: number
  label: string
  count: number
  pct: number
  avg_speed: number
  max_speed: number
  bands: number[]   // % del total por banda (suman ≈ pct)
}
export interface Rose {
  sectors: RoseSector[]
  band_edges: number[]   // bordes inferiores km/h (la última banda es abierta)
  calm_pct: number
  total: number
  dominant: string | null
}

const BAND_VARS = ['--wind-b1', '--wind-b2', '--wind-b3', '--wind-b4', '--wind-b5']

// Punto en el lienzo para un rumbo (0=N, horario) y radio r.
function pt(cx: number, cy: number, r: number, bearingDeg: number) {
  const t = (bearingDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) }
}

// Path de sector anular (r0→r1, rumbos a0→a1 con a1>a0, arco < 180°).
function annular(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const o0 = pt(cx, cy, r1, a0)
  const o1 = pt(cx, cy, r1, a1)
  const i1 = pt(cx, cy, r0, a1)
  const i0 = pt(cx, cy, r0, a0)
  return `M ${o0.x} ${o0.y} A ${r1} ${r1} 0 0 1 ${o1.x} ${o1.y} `
    + `L ${i1.x} ${i1.y} A ${r0} ${r0} 0 0 0 ${i0.x} ${i0.y} Z`
}

interface Props {
  rose: Rose
  size?: number
  compact?: boolean
}

export function WindRose({ rose, size = 280, compact = false }: Props) {
  const u = useUnits()
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)

  const cx = size / 2
  const cy = size / 2
  const pad = compact ? 16 : 20
  const R = size / 2 - pad
  const innerR = R * 0.16                    // círculo de calma
  const rawMax = Math.max(...rose.sectors.map((s) => s.pct), 0)
  const niceMax = Math.max(5, Math.ceil(rawMax / 5) * 5)
  const rOf = (p: number) => innerR + (R - innerR) * (Math.min(p, niceMax) / niceMax)

  const HALF = 11.25
  const GAP = 1.2         // hueco angular entre pétalos (grados)
  const RGAP = 1.4        // hueco radial entre bandas (px)

  const rings = [0.25, 0.5, 0.75, 1]
  const compass = [
    { b: 0, t: 'N' }, { b: 45, t: 'NE' }, { b: 90, t: 'E' }, { b: 135, t: 'SE' },
    { b: 180, t: 'S' }, { b: 225, t: 'SO' }, { b: 270, t: 'O' }, { b: 315, t: 'NO' },
  ]

  // Etiquetas de banda para la leyenda (bordes km/h → unidad mostrada).
  const edges = rose.band_edges
  const bandLabel = (k: number) => {
    const lo = Math.round(u.windN(edges[k]))
    if (k === edges.length - 1) return `${lo}+`
    const hi = Math.round(u.windN(edges[k + 1]))
    return `${lo}–${hi}`
  }

  return (
    <div className="relative inline-block" onMouseLeave={() => setHover(null)}>
      <svg width={size} height={size} role="img" aria-label="Rosa de vientos">
        {/* Aros de referencia + cruz de orientación */}
        {rings.map((f) => (
          <circle key={f} cx={cx} cy={cy} r={rOf(f * niceMax)} fill="none"
            stroke="var(--line)" strokeWidth={1} />
        ))}
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="var(--line)" strokeWidth={1} />
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="var(--line)" strokeWidth={1} />

        {/* Etiquetas de porcentaje (aros 50% y 100%) */}
        {!compact && [0.5, 1].map((f) => (
          <text key={f} x={cx + 4} y={cy - rOf(f * niceMax)} fill="var(--muted)"
            fontSize={9} dominantBaseline="middle">{Math.round(f * niceMax)}%</text>
        ))}

        {/* Pétalos apilados por banda de velocidad */}
        {rose.sectors.map((s, i) => {
          if (s.pct <= 0) return null
          const a0 = s.dir - HALF + GAP
          const a1 = s.dir + HALF - GAP
          let cum = 0
          return s.bands.map((bp, k) => {
            if (bp <= 0) { cum += bp; return null }
            const r0 = rOf(cum) + (k === 0 ? 0 : RGAP)
            const r1 = rOf(cum + bp)
            cum += bp
            if (r1 <= r0) return null
            return (
              <path key={`${i}-${k}`} d={annular(cx, cy, r0, r1, a0, a1)}
                fill={`var(${BAND_VARS[k]})`}
                opacity={hover && hover.i !== i ? 0.35 : 1}
                style={{ transition: 'opacity .12s' }} />
            )
          })
        })}

        {/* Capa de hover: una cuña transparente por sector */}
        {rose.sectors.map((s, i) => (
          <path key={`hit-${i}`}
            d={annular(cx, cy, innerR, R, s.dir - HALF, s.dir + HALF)}
            fill="transparent"
            stroke={hover?.i === i ? 'var(--muted)' : 'none'} strokeWidth={1}
            onMouseMove={(e) => {
              const box = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect()
              setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top })
            }} />
        ))}

        {/* Círculo de calma */}
        <circle cx={cx} cy={cy} r={innerR} fill="var(--surface)" stroke="var(--line)" strokeWidth={1} />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--muted)" fontSize={9}>Calma</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="var(--ink)" fontSize={12} fontWeight={700}>
          {rose.calm_pct}%
        </text>

        {/* Brújula */}
        {compass.map(({ b, t }) => {
          const p = pt(cx, cy, R + (compact ? 10 : 12), b)
          const cardinal = t.length === 1
          return (
            <text key={t} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
              fill={cardinal ? 'var(--ink)' : 'var(--muted)'}
              fontSize={cardinal ? 11 : 9} fontWeight={cardinal ? 700 : 400}>{t}</text>
          )
        })}
      </svg>

      {/* Tooltip por sector */}
      {hover && rose.sectors[hover.i] && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(hover.x + 12, size - 120), top: Math.max(hover.y - 12, 0) }}>
          <p className="font-semibold mb-1">
            {rose.sectors[hover.i].label} · {rose.sectors[hover.i].pct}%
          </p>
          <p className="text-slate-400">
            Media {u.wind(rose.sectors[hover.i].avg_speed)} · máx {u.wind(rose.sectors[hover.i].max_speed)} {u.windU}
          </p>
          <div className="mt-1 space-y-0.5">
            {rose.sectors[hover.i].bands.map((bp, k) => bp > 0 && (
              <div key={k} className="flex items-center gap-1.5">
                <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: `var(${BAND_VARS[k]})` }} />
                <span className="text-slate-400">{bandLabel(k)}</span>
                <span className="ml-auto tabular-nums">{bp.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leyenda de bandas (siempre; también en compacto) */}
      {(
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-400 ${compact ? 'justify-center' : ''}`}>
          {edges.map((_, k) => (
            <span key={k} className="flex items-center gap-1">
              <i className="inline-block w-3 h-3 rounded-sm" style={{ background: `var(${BAND_VARS[k]})` }} />
              {bandLabel(k)}
            </span>
          ))}
          <span className="text-slate-500">{u.windU}</span>
        </div>
      )}
    </div>
  )
}
