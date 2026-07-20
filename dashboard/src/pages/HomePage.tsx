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

      {/*
        Rejilla modular de 6 columnas (md+): 1/3 = 2col, 1/2 = 3col, full = 6col.
        Cada tarjeta va en una .cell (llena su celda -> misma altura por fila; las
        que devuelven null se ocultan sin dejar hueco). Empaque denso.
        Las dos "mitades" (condiciones + gráfica) van arriba; el resto en tercios.
      */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 md:grid-flow-row-dense">
        {/* Mitades (alto natural, ambas destacadas) */}
        <div className="cell md:col-span-3"><CurrentConditions data={data} /></div>
        <div className="cell md:col-span-3"><StationTempChart history={history} forecast={forecast} /></div>

        {/* Tercios */}
        <div className="cell md:col-span-2"><ForecastCard forecast={forecast} /></div>
        <div className="cell md:col-span-2"><PrecipitationCard data={data} forecast={forecast} /></div>
        <div className="cell md:col-span-2"><SunMoonCard astro={forecast?.astro ?? null} /></div>
        <div className="cell md:col-span-2"><WindFlipCard data={data} /></div>
        <div className="cell md:col-span-2"><PressureCard data={data} stats={stats} history={history} /></div>
        <div className="cell md:col-span-2"><UvSolarCard data={data} /></div>
        <div className="cell md:col-span-2"><AirQualityCard /></div>
        <div className="cell md:col-span-2"><ImecaMiniCard /></div>
        <div className="cell md:col-span-2"><InteriorCard data={data} /></div>
        <div className="cell md:col-span-2"><ExtraSensorsCard data={data} /></div>
        <div className="cell md:col-span-2"><RemoteStationCard /></div>
        <div className="cell md:col-span-2"><LocalForecastCard lf={localForecast} /></div>
        <div className="cell md:col-span-2"><EarthquakesCard /></div>
        <div className="cell md:col-span-2"><AlertsPanel /></div>
        <div className="cell md:col-span-2"><SkyEventsCard /></div>

        {/* Ancho completo */}
        <div className="cell md:col-span-6"><RadarCard /></div>
      </div>
    </>
  )
}
