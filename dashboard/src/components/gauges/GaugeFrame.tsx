import type { ReactNode } from 'react'

// Marco circular con el mismo bisel metálico que AnalogGauge/CompassGauge,
// para instrumentos que no son un dial de aguja (p. ej. la rosa de vientos).
// Misma carátula crema que los demás medidores (antes usaba var(--surface)/
// var(--ink), el tema normal de la app) -- el título va flotando ARRIBA en
// vez de apilado en el flujo, así el contenido (los círculos concéntricos de
// la rosa) queda centrado de verdad en el círculo, no desplazado hacia abajo
// por el alto del título.
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
        <div className="relative rounded-full w-full h-full flex items-center justify-center"
          style={{
            background: 'radial-gradient(at 35% 28%, #fbf8ee 0%, #f0ead6 55%, #d5cdb2 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15), inset 0 0 0 3px rgba(0,0,0,0.35)',
          }}>
          <p className="absolute top-[5%] text-[11px] font-bold tracking-wide"
            style={{ color: '#5a5545' }}>{title.toUpperCase()}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
