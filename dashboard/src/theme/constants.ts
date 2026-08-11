/**
 * Constantes de diseño centralizadas
 * Referencia: docs/CONVENCIONES.md
 */

// Colores por variable meteorológica
export const WEATHER_COLORS = {
  temperature: '#f97316',      // orange-500
  pressure: '#8b5cf6',         // violet-500
  precipitation: '#38bdf8',    // sky-400
  humidity: '#3b82f6',         // blue-500
  wind: '#22c55e',             // green-500
  dewPoint: '#10b981',         // emerald-500
  uv: '#a78bfa',               // violet-400
  solar: '#f59e0b',            // amber-500
} as const

// Colores auxiliares para gráficas
export const CHART_COLORS = {
  tempMax: '#f97316',          // orange-500
  tempMin: '#38bdf8',          // sky-400 (convención: azul = frío)
  tempAvg: '#94a3b8',          // slate-400
  windDirection: '#22c55e',    // green-500 (mismo que viento)
  rainRate: '#38bdf8',         // sky-400 (mismo que precipitación)
} as const

// Colores de tendencia
export const TREND_COLORS = {
  up: '#22c55e',               // green-500
  down: '#ef4444',             // red-500
  stable: '#94a3b8',           // slate-400
} as const

// Clases Tailwind de tendencia
export const TREND_CLASSES = {
  up: 'text-green-500',
  down: 'text-red-500',
  stable: 'text-slate-400',
} as const

// Umbrales de tendencia
export const TREND_THRESHOLDS = {
  temperature: 0.5,            // °C en 1 hora
  humidity: 3,                 // % en 1 hora
  pressure: 1,                 // hPa en 3 horas
} as const

// Estilos de tooltip para Recharts
export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--surface, #0f1a2a)',
    border: '1px solid var(--line, #334155)',
    borderRadius: 8,
  },
  cursor: { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' },
  cursorBar: { fill: 'rgba(148,163,184,0.12)' }, // para gráficas con barras
} as const

// Estilos de grid para Recharts
export const GRID_STYLE = {
  strokeDasharray: '3 3',
  stroke: 'rgba(148,163,184,0.2)',
} as const
