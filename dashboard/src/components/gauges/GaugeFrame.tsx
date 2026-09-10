import type { ReactNode } from 'react'

// Marco circular con el mismo bisel metálico que AnalogGauge/CompassGauge,
// para instrumentos que no son un dial de aguja (p. ej. la rosa de vientos).
// El interior usa los colores de tema normales de la app (var(--surface)/
// var(--ink)), no la carátula crema: re-temar un componente ya existente
// (WindRose) solo para esta página sería trabajo extra sin beneficio real,
// y perdería la adaptación clara/oscuro que ya tiene.
export function GaugeFrame({ title, size = 200, children }: { title: string; size?: number; children: ReactNode }) {
  const pad = size * 0.11
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div
        className="rounded-full flex overflow-hidden"
        style={{
          width: size, height: size, padding: pad,
          background: 'conic-gradient(from 135deg, #f6f6f6, #9d9d9d, #5c5c5c, #e2e2e2, #f6f6f6)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.25)',
        }}
      >
        <div className="rounded-full w-full h-full flex flex-col items-center justify-center bg-[var(--surface)]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15), inset 0 0 0 3px rgba(0,0,0,0.35)' }}>
          <p className="text-[10px] font-semibold tracking-wide text-slate-400 mt-2">{title.toUpperCase()}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
