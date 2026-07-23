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

      {/* Mitades destacadas arriba (ambas altas, poco hueco entre ellas) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
        <CurrentConditions data={data} />
        <StationTempChart history={history} forecast={forecast} />
      </div>

      {/*
        Resto en columnas independientes (apilado tipo masonry): cada columna
        fluye por su cuenta, sin forzar misma altura por fila -> sin espacio
        vacío. Las tarjetas que devuelven null simplemente no ocupan lugar.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <ForecastCard forecast={forecast} />
          <WindFlipCard data={data} />
          <PressureCard data={data} stats={stats} history={history} />
          <LocalForecastCard lf={localForecast} />
        </div>
        <div className="space-y-4">
          <PrecipitationCard data={data} forecast={forecast} />
          <UvSolarCard data={data} />
          <InteriorCard data={data} />
          <ExtraSensorsCard data={data} />
          <RemoteStationCard />
        </div>
        <div className="space-y-4">
          <SunMoonCard astro={forecast?.astro ?? null} />
          <AirQualityCard />
          <ImecaMiniCard />
          <MetarCard />
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
