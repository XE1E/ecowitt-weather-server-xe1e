import { RefreshCw } from 'lucide-react'
import { useStationData } from '../station-data'
import { MiniStats } from '../components/station/MiniStats'
import { CurrentConditions } from '../components/station/CurrentConditions'
import { WindFlipCard } from '../components/station/WindFlipCard'
import { PressureCard } from '../components/station/PressureCard'
import { LocalForecastCard } from '../components/station/LocalForecastCard'
import { ForecastCard } from '../components/station/ForecastCard'
import { ForecastCompareCard } from '../components/station/ForecastCompareCard'
import { StationTempChart } from '../components/station/StationTempChart'
import { PrecipitationCard } from '../components/station/PrecipitationCard'
import { UvSolarCard } from '../components/station/UvSolarCard'
import { SunMoonCard } from '../components/station/SunMoonCard'
import { SkyEventsCard } from '../components/station/SkyEventsCard'
import { ExtraSensorsCard } from '../components/station/ExtraSensorsCard'
import { InteriorCard } from '../components/station/InteriorCard'
import { RemoteStationCard } from '../components/station/RemoteStationCard'
import { AlertsPanel } from '../components/station/AlertsPanel'
import { RadarCard } from '../components/station/RadarCard'
import { AirQualityCard } from '../components/station/AirQualityCard'
import { ImecaMiniCard } from '../components/station/ImecaMiniCard'
import { MetarCard } from '../components/station/MetarCard'
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

      {/* Dos columnas principales */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Columna izquierda */}
        <div className="space-y-4">
          <CurrentConditions data={data} history={history} />
          <PrecipitationCard data={data} forecast={forecast} />
          <ForecastCard forecast={forecast} />
          <ForecastCompareCard forecast={forecast} />
          <LocalForecastCard lf={localForecast} />
        </div>
        {/* Columna derecha */}
        <div className="space-y-4">
          <WindFlipCard data={data} />
          <AlertsPanel />
          <EarthquakesCard />
          <AirQualityCard />
          <ImecaMiniCard />
          <SunMoonCard astro={forecast?.astro ?? null} />
          <MetarCard />
        </div>
      </div>

      {/* Fila de sensores y extras */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <UvSolarCard data={data} />
        <InteriorCard data={data} />
        <ExtraSensorsCard data={data} history={history} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <RemoteStationCard />
        <PressureCard data={data} stats={stats} history={history} />
      </div>

      {/* Próximos eventos y gráficas */}
      <div className="space-y-4">
        <SkyEventsCard />
        <StationTempChart history={history} forecast={forecast} />
        <RadarCard />
      </div>
    </>
  )
}
