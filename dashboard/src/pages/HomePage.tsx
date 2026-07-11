import { RefreshCw } from 'lucide-react'
import { useStationData } from '../station-data'
import { MiniStats } from '../components/station/MiniStats'
import { CurrentConditions } from '../components/station/CurrentConditions'
import { WindFlipCard } from '../components/station/WindFlipCard'
import { PressureCard } from '../components/station/PressureCard'
import { LocalForecastCard } from '../components/station/LocalForecastCard'
import { ForecastCard } from '../components/station/ForecastCard'
import { StationTempChart } from '../components/station/StationTempChart'
import { PrecipitationCard } from '../components/station/PrecipitationCard'
import { UvSolarCard } from '../components/station/UvSolarCard'
import { SunMoonCard } from '../components/station/SunMoonCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { ExtraSensorsCard } from '../components/station/ExtraSensorsCard'
import { AlertsPanel } from '../components/station/AlertsPanel'
import { RadarCard } from '../components/station/RadarCard'
import { AirQualityCard } from '../components/station/AirQualityCard'
import { ImecaMiniCard } from '../components/station/ImecaMiniCard'
import { EarthquakesCard } from '../components/station/EarthquakesCard'

export function HomePage() {
  const { data, stats, history, forecast, compare, localForecast, loading } = useStationData()

  if (loading && !data) {
    return (
      <div className="h-64 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    )
  }
  if (!data) return <p className="text-slate-400">Sin datos disponibles.</p>

  return (
    <>
      <div className="mb-4">
        <MiniStats data={data} stats={stats} forecast={forecast} compare={compare} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <CurrentConditions data={data} />
          <WindFlipCard data={data} />
          <PressureCard data={data} stats={stats} history={history} />
          <LocalForecastCard lf={localForecast} />
        </div>
        <div className="space-y-4">
          <ForecastCard forecast={forecast} />
          <StationTempChart history={history} forecast={forecast} />
          <PrecipitationCard data={data} forecast={forecast} />
          <UvSolarCard data={data} />
          <ExtraSensorsCard data={data} />
        </div>
        <div className="space-y-4">
          <SunMoonCard astro={forecast?.astro ?? null} />
          <AirQualityCard />
          <ImecaMiniCard />
          <EarthquakesCard />
          <AlertsPanel />
          <SkyEventsCard />
        </div>
      </div>

      <div className="mt-4">
        <RadarCard />
      </div>
    </>
  )
}
