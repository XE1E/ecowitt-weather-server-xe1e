/**
 * Tipos de respuestas de la API que usan varios componentes.
 *
 * Antes cada componente definía su propia versión (IMECA en 5 archivos, METAR en 3,
 * la estación del Admin en 4…), cada una con los campos que le tocaba leer. Aquí va
 * la forma completa que devuelve el backend; cada componente usa lo que necesita.
 * Los tipos que sólo usa un archivo se quedan en ese archivo.
 */

/** GET /api/alerts → `active[]` */
export interface Alert {
  key: string
  message: string
}

/** GET /api/airquality/imeca (receiver/app/services/imeca.py) */
export interface ImecaPollutant { pollutant: string; conc: number; index: number }
export interface ImecaForecastPoint { t: string; imeca: number; category: string }
export interface Imeca {
  available: boolean
  imeca?: number
  dominant?: string
  category?: string
  color?: string
  recommendation?: string
  pollutants?: ImecaPollutant[]
  forecast?: ImecaForecastPoint[]
  time?: string
  source?: string
}

/** GET /api/airquality (WAQI) */
export interface AirQuality {
  aqi: number | null
  dominant?: string
  station?: string
  time?: string
  pollutants?: Record<string, number | null>
  error?: string
}

/** GET /api/metar (receiver/app/services/metar.py) */
export interface MetarCloud { cover: string; base: number | null }
export interface Metar {
  station?: string
  name?: string
  raw?: string
  observed?: string | null
  temp_c?: number | null
  dewpoint_c?: number | null
  wind_dir?: number | null
  wind_speed_kt?: number | null
  wind_gust_kt?: number | null
  visibility?: number | string | null
  altimeter_hpa?: number | null
  slp_hpa?: number | null
  flight_category?: string | null
  clouds?: MetarCloud[]
  wx?: string | null
}

/** Lo que usan las tarjetas de METAR del análisis de la cámara (/api/camera/status → analysis). */
export interface CameraSkyBrief { sky_condition?: string; cloud_coverage_pct?: number }

/** Sensor detectado de una estación (GET /api/stations → sensors_detail[]). */
export interface SensorDetail {
  id: string
  type: string
  category: string
  channel?: number
  label: string
  temperature?: number
  humidity?: number
  pressure?: number
  wind_speed?: number
  rain_daily?: number
  uv_index?: number
  battery_ok: boolean
  active: boolean
}

/** Estación en GET /api/stations y GET /api/stations/{name}. `name: null` = la principal. */
export interface StationSummary {
  name: string | null
  label: string
  last_received: string | null
  status: 'online' | 'offline' | 'unknown'
  sensors: string[]
  sensors_detail: SensorDetail[]
  model: string | null
  passkey_hint?: string | null
}

/** Opción de estación para las pestañas del Admin (sólo secundarias). */
export interface StationOpt { name: string; label: string }
