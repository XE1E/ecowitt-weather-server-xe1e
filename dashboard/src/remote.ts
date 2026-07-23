// Utilidades compartidas de la estación remota (secundaria). El nombre debe
// coincidir con SECONDARY_STATIONS del backend (p. ej. "<passkey>:gw1100").
export const REMOTE_STATION = 'gw1100'
export const REMOTE_LABEL = 'Estación remota'

export interface RemoteHistRow {
  _time: string
  temperature_indoor?: number
  humidity_indoor?: number
  // Si la secundaria está "a la intemperie" (treat_indoor_as_outdoor), su lectura
  // llega como exterior. Se prefiere exterior y, si no hay, se cae a interior.
  temperature_outdoor?: number
  humidity_outdoor?: number
  pressure_relative?: number
}

// Punto de rocío (Magnus) a partir de temperatura (°C) y humedad relativa (%).
export function dewPointC(t?: number, rh?: number): number | null {
  if (t == null || rh == null || rh <= 0) return null
  const a = 17.625
  const b = 243.04
  const g = Math.log(rh / 100) + (a * t) / (b + t)
  return (b * g) / (a - g)
}

// Cambio de un campo respecto a ~`hours` horas antes (tendencia). Valor métrico.
export function trendOver(
  history: RemoteHistRow[], field: keyof RemoteHistRow, hours: number
): number | null {
  const withVal = history.filter((r) => r[field] != null)
  if (withVal.length < 2) return null
  const last = withVal[withVal.length - 1]
  const target = new Date(last._time).getTime() - hours * 3600 * 1000
  let best: RemoteHistRow | null = null
  let bestDiff = Infinity
  for (const r of withVal) {
    const diff = Math.abs(new Date(r._time).getTime() - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = r
    }
  }
  if (!best || best === last) return null
  return (last[field] as number) - (best[field] as number)
}

// Convierte un delta métrico a la unidad mostrada (para tendencias).
export function tempDeltaDisp(system: string, d: number): number {
  return system === 'imperial' ? d * 9 / 5 : d
}
export function pressDeltaDisp(system: string, d: number): number {
  return system === 'imperial' ? d * 0.0295299830714 : d
}
