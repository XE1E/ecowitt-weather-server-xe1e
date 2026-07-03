export interface WeatherData {
  // Temperature
  temperature_outdoor: number
  temperature_indoor: number
  feels_like?: number
  dew_point?: number
  heat_index?: number
  wind_chill?: number

  // Humidity
  humidity_outdoor: number
  humidity_indoor: number

  // WN31 Extra sensors (up to 8 channels)
  temperature_ch1?: number
  temperature_ch2?: number
  temperature_ch3?: number
  temperature_ch4?: number
  temperature_ch5?: number
  temperature_ch6?: number
  temperature_ch7?: number
  temperature_ch8?: number
  humidity_ch1?: number
  humidity_ch2?: number
  humidity_ch3?: number
  humidity_ch4?: number
  humidity_ch5?: number
  humidity_ch6?: number
  humidity_ch7?: number
  humidity_ch8?: number

  // Pressure
  pressure_relative: number
  pressure_absolute: number

  // Wind
  wind_speed: number
  wind_gust: number
  wind_direction: number
  wind_gust_max_daily?: number

  // Rain
  rain_rate: number
  rain_daily: number
  rain_weekly: number
  rain_monthly: number
  rain_yearly: number
  rain_event?: number

  // Solar
  solar_radiation: number
  uv_index: number

  // Metadata
  station_type?: string
  model?: string
  received_at?: string
}

export interface HistoryData {
  _time: string
  temperature_outdoor?: number
  humidity_outdoor?: number
  wind_speed?: number
  rain_daily?: number
}

export interface DailyStats {
  period: string
  stats: {
    [key: string]: {
      min: number | null
      max: number | null
      avg: number | null
    }
  }
  generated_at: string
}
