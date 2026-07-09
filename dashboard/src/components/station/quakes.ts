export interface Quake {
  mag: number | null
  place: string | null
  time: number | null // epoch segundos UTC
  depth_km: number | null
  url: string | null
}

export function magColor(m: number): string {
  if (m < 4.5) return '#38bdf8'
  if (m < 5.5) return '#eab308'
  if (m < 6.5) return '#f97316'
  return '#ef4444'
}

export function timeAgo(sec: number): string {
  const diff = Date.now() / 1000 - sec
  if (diff < 3600) return `hace ${Math.max(1, Math.round(diff / 60))} min`
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`
  return `hace ${Math.round(diff / 86400)} d`
}
