import { RefreshCw } from 'lucide-react'
import { useStationData } from '../station-data'
import { MiniStats } from '../components/station/MiniStats'
import { CurrentConditions } from '../components/station/CurrentConditions'
import { WindCard } from '../components/station/WindCard'
import { PressureCard } from '../components/station/PressureCard'
import { ForecastCard } from '../components/station/ForecastCard'
import { StationTempChart } from '../components/station/StationTempChart'
import { PrecipitationCard } from '../components/station/PrecipitationCard'
import { UvSolarCard } from '../components/station/UvSolarCard'
import { SunMoonCard } from '../components/station/SunMoonCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { ExtraSensorsCard } from '../components/station/ExtraSensorsCard'
import { AlertsPanel } from '../components/station/AlertsPanel'
import { RadarCard } from '../components/station/RadarCard'
import { MetarCard } from '../components/station/MetarCard'

export function HomePage() {
  const { data, stats, history, forecast, compare, loading } = useStationData()

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
          <WindCard data={data} />
          <PressureCard data={data} stats={stats} history={history} />
        </div>
        <div className="space-y-4">
          <ForecastCard forecast={forecast} />
          <StationTempChart history={history} forecast={forecast} />
          <PrecipitationCard data={data} forecast={forecast} />
          <UvSolarCard data={data} />
        </div>
        <div className="space-y-4">
          <SunMoonCard astro={forecast?.astro ?? null} />
          <AlertsPanel />
          <SkyEventsCard />
          <ExtraSensorsCard data={data} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <RadarCard />
        <MetarCard />
      </div>
    </>
  )
}
