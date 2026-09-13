import { useEffect, useState } from 'react'
import { MapPin, ChevronDown } from 'lucide-react'
import { useUnits } from '../../units'
import type { WeatherData } from '../../types'
import type { LocalForecast } from '../../station-data'

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
  precip_mm: number | null
  trust_factor: number | null
}

interface NearbyResponse {
  stations: NearbyStation[]
  fetched_at: string | null
  age_minutes: number | null
  stale: boolean
  zone_trend_mb: number | null
  zone_trend: { code: string; label: string; arrow: string } | null
  zone_trend_reference: 'metar' | 'median' | null
}

const SOURCE_LABEL: Record<string, string> = {
  PWS: 'PWS',
  METAR_NOAA: 'METAR',
  MADIS_MESONET2: 'Mesonet',
  NETATMO: 'Netatmo',
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

const COLLAPSED_COUNT = 5

// Las 5 (colapsado) "más significativas": el METAR siempre entra si hay uno
// en el radio -- es la referencia de calibración de la tarjeta (ver el
// aviso de presión más abajo) -- y el resto son las más cercanas. Sin
// METAR, son simplemente las 5 más cercanas.
function pickSignificant(sortedByDistance: NearbyStation[], count: number): NearbyStation[] {
  const metar = sortedByDistance.find((s) => s.source === 'METAR_NOAA')
  const rest = sortedByDistance.filter((s) => s !== metar)
  const picked = metar ? [metar, ...rest.slice(0, count - 1)] : rest.slice(0, count)
  return [...picked].sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
}

// Rumbo en inglés (mismas 8 letras que ya manda el backend en `bearing` --
// Xweather solo da compass point, no grados, así que esta es la resolución
// máxima posible; NO es el `cardinal()` en español de weather.ts, que usa
// otro alfabeto -- SO/O/NO en vez de SW/W/NW -- y compararía mal).
const COMPASS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function compassEN(deg: number): string {
  return COMPASS_EN[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

// Mismo rumbo, o uno de los dos adyacentes (+/-45°) -- da algo de margen al
// bucket de 8 puntos, que ya es la resolución más fina disponible.
function isRoughlyFrom(stationBearing: string, windFrom: string): boolean {
  const ia = COMPASS_EN.indexOf(stationBearing)
  const ib = COMPASS_EN.indexOf(windFrom)
  if (ia < 0 || ib < 0) return false
  const diff = Math.min((ia - ib + 8) % 8, (ib - ia + 8) % 8)
  return diff <= 1
}

// Señal (no pronóstico): con viento en calma no hay nada que "traiga" la
// lluvia, y por debajo de esto el rumbo instantáneo es demasiado ruidoso.
const MIN_WIND_KPH_FOR_SIGNAL = 5

export function NearbyStationsCard({ data, lf }: { data: WeatherData; lf?: LocalForecast | null }) {
  const u = useUnits()
  const [resp, setResp] = useState<NearbyResponse | null>(null)
  const [expanded, setExpanded] = useState(false)

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

  // Fase 2: tendencia de presión de la zona en las últimas 3 h (mismo criterio
  // METAR-primero-si-hay que la comparación de arriba), calculada del lado del
  // servidor con un historial corto por estación vecina -- ver xweather.py.
  // Se muestra junto a la tendencia propia (misma ventana, `/api/forecast/local`)
  // solo como contexto visual: aún no hay umbral definido para alertar por
  // divergencia (ver "Decisiones abiertas" en PLAN-ESTACIONES-VECINAS.md).
  const zoneTrend = resp?.zone_trend && resp.zone_trend.code !== 'unknown' ? resp.zone_trend : null
  const zoneTrendSuffix = zoneTrend && resp?.zone_trend_mb != null
    ? ` (${resp.zone_trend_mb > 0 ? '+' : ''}${resp.zone_trend_mb.toFixed(1)} hPa/3h${resp?.zone_trend_reference === 'metar' ? ', METAR' : ''})`
    : ''

  const sortedByDistance = [...stations].sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
  const visibleStations = expanded ? sortedByDistance : pickSignificant(sortedByDistance, COLLAPSED_COUNT)
  const canExpand = stations.length > COLLAPSED_COUNT

  // Señal puntual de lluvia acercándose (no interpolación ni pronóstico):
  // alguna vecina en la dirección de donde SOPLA el viento ahora mismo
  // reporta precipitación, y aquí todavía no llueve. Se busca en TODAS las
  // estaciones (no solo las 5 visibles) -- la que avisa puede no ser de las
  // "significativas" por distancia. Ver conversación: el viento superficial
  // no siempre coincide con el movimiento real de la célula, así que esto
  // es una pista, no una certeza -- se redacta como tal.
  const windFrom = data.wind_direction != null ? compassEN(data.wind_direction) : null
  const incomingRain = (windFrom && (data.wind_speed ?? 0) >= MIN_WIND_KPH_FOR_SIGNAL && !((data.rain_rate ?? 0) > 0))
    ? stations.find((s) => s.bearing && s.precip_mm != null && s.precip_mm > 0 && isRoughlyFrom(s.bearing, windFrom))
    : undefined

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

      {incomingRain && (
        <p className="text-xs text-sky-400 mt-2">
          {SOURCE_LABEL[incomingRain.source] ?? incomingRain.source} reporta lluvia al {incomingRain.bearing}
          {incomingRain.distance_km != null && ` (${incomingRain.distance_km.toFixed(1)} km)`}
          {' '}y el viento viene de esa dirección -- podría estar acercándose (no es un pronóstico).
        </p>
      )}

      {zoneTrend && (
        <p className="mt-2 text-xs text-slate-400">
          Tendencia de la zona: {zoneTrend.arrow} {zoneTrend.label}{zoneTrendSuffix}
          {lf?.available && lf.trend && ` · tu estación: ${lf.trend.arrow} ${lf.trend.label}`}
        </p>
      )}

      <div className="mt-3 space-y-2 text-sm">
        {visibleStations.map((s) => (
          <div key={s.id} className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400 truncate">
              {SOURCE_LABEL[s.source] ?? s.source}
              {s.distance_km != null && ` · ${s.distance_km.toFixed(1)} km`}
              {s.bearing && ` ${s.bearing}`}
            </span>
            <span className="font-semibold text-right tabular-nums shrink-0">
              {s.temp_c != null ? `${u.temp(s.temp_c)}${u.tempU}` : '--'}
              {s.pressure_mb != null && ` · ${u.press(s.pressure_mb)} ${u.pressU}`}
              {s.precip_mm != null && s.precip_mm > 0 && <span className="text-sky-400"> · lluvia</span>}
            </span>
          </div>
        ))}
      </div>

      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 flex w-full items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
        >
          <span>
            {stations.length} estaciones cercanas · {minutesAgo(resp?.fetched_at ?? null)}
            {' · vía '}{[...new Set(stations.map((s) => (s.source === 'NETATMO' ? 'Netatmo' : 'Xweather')))].join(' + ')}
          </span>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">
          {stations.length} estaciones cercanas · {minutesAgo(resp?.fetched_at ?? null)}
          {' · vía '}{[...new Set(stations.map((s) => (s.source === 'NETATMO' ? 'Netatmo' : 'Xweather')))].join(' + ')}
        </p>
      )}
    </div>
  )
}
