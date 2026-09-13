import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useUnits } from '../../units'
import type { WeatherData } from '../../types'

const REFRESH = 600000 // 10 min (igual que la caché del servidor)

interface NearbyStation {
  id: string
  source: string
  distance_km: number | null
  bearing: string | null
  observed_at: string | null
  temp_c: number | null
  humidity: number | null
  pressure_mb: number | null
  wind_speed_kph: number | null
  wind_dir_deg: number | null
  trust_factor: number | null
}

interface NearbyResponse {
  stations: NearbyStation[]
  fetched_at: string | null
  age_minutes: number | null
  stale: boolean
}

const SOURCE_LABEL: Record<string, string> = {
  PWS: 'PWS',
  METAR_NOAA: 'METAR',
  MADIS_MESONET2: 'Mesonet',
}

function minutesAgo(iso: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  return `hace ${Math.round(min / 60)} h`
}

export function NearbyStationsCard({ data }: { data: WeatherData }) {
  const u = useUnits()
  const [resp, setResp] = useState<NearbyResponse | null>(null)

  useEffect(() => {
    let cancel = false
    const load = () => {
      fetch('/api/nearby-stations')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancel && j) setResp(j) })
        .catch(() => { /* silencioso: tarjeta opcional */ })
    }
    load()
    const i = setInterval(load, REFRESH)
    return () => { cancel = true; clearInterval(i) }
  }, [])

  const stations = resp?.stations ?? []
  if (stations.length === 0) return null // sin configurar o sin estaciones cerca: no ocupa espacio

  // Referencia de presión para comparar: preferir el METAR más cercano si hay
  // uno en el radio -- es la más confiable (calibración profesional de
  // aeropuerto). Las PWS vecinas son sensores baratos sin calibrar: se vio en
  // vivo que su mediana puede quedar 8-13 hPa por debajo del METAR/estación
  // propia aunque ambos estén bien (ver PLAN-ESTACIONES-VECINAS.md,
  // "Residual esperado") -- comparar contra esa mediana daría falsas alarmas
  // de "revisa tu calibración". Solo si no hay METAR cerca se cae a la
  // mediana de lo que haya, con menos confianza.
  const metar = stations.find((s) => s.source === 'METAR_NOAA' && s.pressure_mb != null)
  const zonePressures = stations.map((s) => s.pressure_mb).filter((v): v is number => v != null).sort((a, b) => a - b)
  const zoneMedian = zonePressures.length ? zonePressures[Math.floor(zonePressures.length / 2)] : null
  const referencePressure = metar?.pressure_mb ?? zoneMedian
  const referenceLabel = metar ? 'el METAR más cercano' : 'la mediana de la zona'
  const ownPressure = data.pressure_relative
  const pressureDeltaMb = referencePressure != null && ownPressure != null ? ownPressure - referencePressure : null

  return (
    <div className="card">
      <div className="flex items-center gap-2">
        <MapPin className="w-6 h-6 text-emerald-400 shrink-0" />
        <p className="card-title mb-0">En tu zona</p>
        {resp?.stale && <span className="text-[10px] text-amber-400 ml-auto">datos previos</span>}
      </div>

      {pressureDeltaMb != null && Math.abs(pressureDeltaMb) >= (metar ? 3 : 10) && (
        <p className="text-xs text-amber-400 mt-2">
          Tu presión difiere {Math.abs(pressureDeltaMb).toFixed(1)} hPa de {referenceLabel}
          -- revisa la calibración si se sostiene.
        </p>
      )}

      <div className="mt-3 space-y-2 text-sm">
        {stations.slice(0, 5).map((s) => (
          <div key={s.id} className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400 truncate">
              {SOURCE_LABEL[s.source] ?? s.source}
              {s.distance_km != null && ` · ${s.distance_km.toFixed(1)} km`}
              {s.bearing && ` ${s.bearing}`}
            </span>
            <span className="font-semibold text-right tabular-nums shrink-0">
              {s.temp_c != null ? `${u.temp(s.temp_c)}${u.tempU}` : '--'}
              {s.pressure_mb != null && ` · ${u.press(s.pressure_mb)} ${u.pressU}`}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        {stations.length} estaciones cercanas · {minutesAgo(resp?.fetched_at ?? null)} · vía Xweather
      </p>
    </div>
  )
}
