import { createContext, useContext, useState, ReactNode } from 'react'

export type UnitSystem = 'metric' | 'imperial'

// Los datos se guardan en métrico; aquí se convierten para mostrar.
const round = (n: number, d: number) => n.toFixed(d)

export interface Units {
  system: UnitSystem
  toggle: () => void
  // Formateadores: reciben el valor MÉTRICO y devuelven string ya convertido
  temp: (c?: number, d?: number) => string
  tempU: string
  wind: (kmh?: number, d?: number) => string
  windU: string
  press: (hpa?: number, d?: number) => string
  pressU: string
  rain: (mm?: number, d?: number) => string
  rainU: string
  rate: (mmh?: number, d?: number) => string
  rateU: string
  // Conversores numéricos (para gráficas)
  tempN: (c: number) => number
  windN: (kmh: number) => number
  pressN: (hpa: number) => number
}

const UnitsContext = createContext<Units | null>(null)

function build(system: UnitSystem, toggle: () => void): Units {
  const imp = system === 'imperial'
  const na = (v: number | undefined) => v === undefined || v === null || Number.isNaN(v)
  return {
    system,
    toggle,
    temp: (c, d = 1) => (na(c) ? '--' : round(imp ? (c as number) * 9 / 5 + 32 : (c as number), d)),
    tempU: imp ? '°F' : '°C',
    wind: (kmh, d = 1) => (na(kmh) ? '--' : round(imp ? (kmh as number) / 1.60934 : (kmh as number), d)),
    windU: imp ? 'mph' : 'km/h',
    press: (hpa, d = 1) => (na(hpa) ? '--' : round(imp ? (hpa as number) * 0.0295299830714 : (hpa as number), imp ? 2 : d)),
    pressU: imp ? 'inHg' : 'mb',
    rain: (mm, d = 1) => (na(mm) ? '--' : round(imp ? (mm as number) / 25.4 : (mm as number), imp ? 2 : d)),
    rainU: imp ? 'in' : 'mm',
    rate: (mmh, d = 1) => (na(mmh) ? '--' : round(imp ? (mmh as number) / 25.4 : (mmh as number), imp ? 2 : d)),
    rateU: imp ? 'in/h' : 'mm/h',
    tempN: (c) => (imp ? c * 9 / 5 + 32 : c),
    windN: (kmh) => (imp ? kmh / 1.60934 : kmh),
    pressN: (hpa) => (imp ? hpa * 0.0295299830714 : hpa),
  }
}

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState<UnitSystem>(
    () => (localStorage.getItem('units') === 'imperial' ? 'imperial' : 'metric')
  )
  const toggle = () =>
    setSystem((prev) => {
      const next = prev === 'metric' ? 'imperial' : 'metric'
      localStorage.setItem('units', next)
      return next
    })

  return <UnitsContext.Provider value={build(system, toggle)}>{children}</UnitsContext.Provider>
}

export function useUnits(): Units {
  const ctx = useContext(UnitsContext)
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider')
  return ctx
}
