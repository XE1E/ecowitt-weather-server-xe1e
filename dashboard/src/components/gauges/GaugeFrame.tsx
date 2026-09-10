import type { ReactNode } from 'react'

// Marco circular con el mismo bisel metálico que AnalogGauge/CompassGauge,
// para instrumentos que no son un dial de aguja (p. ej. la rosa de vientos).
// El bisel es el MISMO gradiente lineal (mismos stops/ángulo) que el
// `linearGradient` SVG de esos dos -- antes era un conic-gradient CSS
// distinto, que se veía como un metal distinto al del resto del panel.
// Misma carátula crema que los demás medidores (antes usaba var(--surface)/
// var(--ink), el tema normal de la app). El título es opcional y va
// flotando ARRIBA en vez de apilado en el flujo (para cuando lo hay), así
// el contenido queda centrado de verdad en el círculo, no desplazado hacia
// abajo por el alto del título.
export function GaugeFrame({ title, size = 200, children }: { title?: string; size?: number; children: ReactNode }) {
  const pad = size * 0.11
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div
        className="rounded-full flex overflow-hidden"
        style={{
          width: size, height: size, padding: pad,
          background: 'linear-gradient(135deg, #ffffff 0%, #c9c9c9 20%, #8a8a8a 40%, #4a4a4a 50%, #8a8a8a 62%, #d8d8d8 82%, #f2f2f2 100%)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.25)',
        }}
      >
        <div className="relative rounded-full w-full h-full flex items-center justify-center"
          style={{
            background: 'radial-gradient(at 35% 28%, #fbf8ee 0%, #f0ead6 55%, #d5cdb2 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15), inset 0 0 0 3px rgba(0,0,0,0.35)',
          }}>
          {title && (
            <p className="absolute top-[5%] text-[11px] font-bold tracking-wide"
              style={{ color: '#5a5545' }}>{title.toUpperCase()}</p>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
