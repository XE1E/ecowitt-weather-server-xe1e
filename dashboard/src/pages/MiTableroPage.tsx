import { useState, useEffect } from 'react'
import { RefreshCw, LayoutGrid, SlidersHorizontal, Check } from 'lucide-react'
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
import { EarthquakesCard } from '../components/station/EarthquakesCard'
import { RadarCard } from '../components/station/RadarCard'
import { AirQualityCard } from '../components/station/AirQualityCard'
import { ImecaMiniCard } from '../components/station/ImecaMiniCard'
import { PageInfo } from '../components/station/PageInfo'

const STORAGE_KEY = 'mi_tablero_cards'

export function MiTableroPage() {
  const { data, stats, history, forecast, compare, localForecast, loading } = useStationData()
  const [editing, setEditing] = useState(false)

  // Catálogo de tarjetas elegibles (la de condiciones actuales va fija aparte)
  const CARDS: { key: string; label: string; span: 1 | 2 | 3; render: () => JSX.Element }[] = [
    { key: 'ministats', label: 'Resumen rápido', span: 3, render: () => <MiniStats data={data!} stats={stats} forecast={forecast} compare={compare} /> },
    { key: 'wind', label: 'Viento', span: 1, render: () => <WindFlipCard data={data!} /> },
    { key: 'pressure', label: 'Presión', span: 1, render: () => <PressureCard data={data!} stats={stats} history={history} /> },
    { key: 'localforecast', label: 'Pronóstico local', span: 1, render: () => <LocalForecastCard lf={localForecast} /> },
    { key: 'forecast', label: 'Pronóstico', span: 1, render: () => <ForecastCard forecast={forecast} /> },
    { key: 'tempchart', label: 'Gráfica de temperatura', span: 2, render: () => <StationTempChart history={history} forecast={forecast} /> },
    { key: 'precip', label: 'Precipitación', span: 1, render: () => <PrecipitationCard data={data!} forecast={forecast} /> },
    { key: 'uvsolar', label: 'UV y radiación solar', span: 1, render: () => <UvSolarCard data={data!} /> },
    { key: 'sunmoon', label: 'Sol y luna', span: 1, render: () => <SunMoonCard astro={forecast?.astro ?? null} /> },
    { key: 'air', label: 'Calidad del aire', span: 1, render: () => <AirQualityCard /> },
    { key: 'imeca', label: 'IMECA', span: 1, render: () => <ImecaMiniCard /> },
    { key: 'quakes', label: 'Sismos', span: 1, render: () => <EarthquakesCard /> },
    { key: 'alerts', label: 'Alertas', span: 1, render: () => <AlertsPanel /> },
    { key: 'sky', label: 'Próximos eventos del cielo', span: 1, render: () => <SkyEventsCard /> },
    { key: 'interior', label: 'Interior', span: 1, render: () => <InteriorCard data={data!} /> },
    { key: 'extra', label: 'Sensores adicionales', span: 1, render: () => <ExtraSensorsCard data={data!} /> },
    { key: 'remote', label: 'Estación remota', span: 1, render: () => <RemoteStationCard /> },
    { key: 'radar', label: 'Radar', span: 3, render: () => <RadarCard /> },
  ]
  const ALL = CARDS.map((c) => c.key)
  // Por defecto se muestran unas cuantas; el usuario ajusta y se guarda.
  const DEFAULT = ['wind', 'pressure', 'forecast', 'tempchart', 'precip', 'uvsolar', 'sunmoon', 'air']

  const [visible, setVisible] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s) return JSON.parse(s)
    } catch { /* ignore */ }
    return DEFAULT
  })
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visible)) } catch { /* ignore */ }
  }, [visible])

  const toggle = (k: string) =>
    setVisible((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))

  if (loading && !data) {
    return <div className="h-64 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-400" /></div>
  }
  if (!data) return <p className="text-slate-400">Sin datos disponibles.</p>

  const shown = CARDS.filter((c) => visible.includes(c.key))
  const spanCls = (s: 1 | 2 | 3) => (s === 3 ? 'md:col-span-2 xl:col-span-3' : s === 2 ? 'xl:col-span-2' : '')

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><LayoutGrid className="w-6 h-6 text-sky-400" /> Mi tablero</h2>
          <p className="text-xs text-slate-400">Tu vista personalizada: elige qué tarjetas ver. Se guarda en este dispositivo.</p>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          className={`rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5 transition ${editing ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'}`}
        >
          <SlidersHorizontal className="w-4 h-4" /> {editing ? 'Listo' : 'Personalizar'}
        </button>
      </div>

      {editing && (
        <div className="card mb-4">
          <p className="card-title">Elige tus tarjetas</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {CARDS.map((c) => {
              const on = visible.includes(c.key)
              return (
                <button
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition border ${on ? 'bg-blue-600/20 border-blue-500/50 text-slate-100' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-blue-500' : 'border border-white/20'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </span>
                  {c.label}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setVisible(ALL)} className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10">Mostrar todas</button>
            <button onClick={() => setVisible(DEFAULT)} className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10">Restablecer</button>
          </div>
        </div>
      )}

      {/* Tarjeta fija: condiciones actuales */}
      <div className="mb-4">
        <CurrentConditions data={data} />
      </div>

      {shown.length === 0 ? (
        <div className="card text-slate-400 text-center py-8">
          No tienes tarjetas seleccionadas. Pulsa <span className="font-semibold text-slate-200">Personalizar</span> para elegir.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 grid-flow-dense">
          {shown.map((c) => (
            <div key={c.key} className={spanCls(c.span)}>{c.render()}</div>
          ))}
        </div>
      )}

      <PageInfo>
        <p>
          <span className="font-semibold">Mi tablero</span> es una vista a tu medida con las mismas tarjetas del Inicio.
          Pulsa <span className="font-semibold">Personalizar</span> para mostrar u ocultar cada una; la selección se
          guarda en <span className="font-semibold">este dispositivo/navegador</span> (no afecta a otros visitantes).
          La tarjeta de <span className="font-semibold">condiciones actuales</span> queda siempre fija arriba.
        </p>
      </PageInfo>
    </div>
  )
}
