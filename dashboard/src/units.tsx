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
  rainN: (mm: number) => number
  rateN: (mmh: number) => number
  /**
   * Convierte una DIFERENCIA de temperatura: grados-día, deltas, amplitudes.
   * Multiplica por 9/5 SIN sumar 32. Usar `temp()`/`tempN()` para esto es el error
   * clásico: un delta de 5 °C son 9 °F, no 41.
   */
  dTempN: (dc: number) => number
  /** Altura (base de nubes, elevación): m -> ft. */
  alt: (m?: number) => string
  altU: string
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
    rainN: (mm) => (imp ? mm / 25.4 : mm),
    rateN: (mmh) => (imp ? mmh / 25.4 : mmh),
    dTempN: (dc) => (imp ? dc * 9 / 5 : dc),
    alt: (m) =>
      na(m) ? '--' : Math.round(imp ? (m as number) / 0.3048 : (m as number)).toLocaleString('es-MX'),
    altU: imp ? 'ft' : 'm',
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
