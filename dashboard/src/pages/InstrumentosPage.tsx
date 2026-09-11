import { useEffect, useState } from 'react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { AnalogGauge, CompassGauge, GaugeFrame, ClockGauge, type GaugeZone } from '../components/gauges'
import { WindRose, type Rose } from '../components/station/WindRose'
import { PageInfo } from '../components/station/PageInfo'
import { getTrend } from '../components/TrendArrow'
import { historicValue } from '../weather'
import { LOCATION } from '../config'

// Anclas de zonas en MÉTRICO; se convierten a la unidad activa con las
// mismas funciones que usa el resto del sitio (u.tempN, u.windN, ...) para
// que un mismo umbral (p. ej. "35°C = calor") caiga en el mismo punto real
// de la escala sin importar el sistema de unidades.
function zonesIn(anchors: [number, number, string][], conv: (v: number) => number): GaugeZone[] {
  return anchors.map(([from, to, color]) => ({ from: conv(from), to: conv(to), color }))
}

// Mismo tamaño que el título normal en la carátula (AnalogGauge:
// `size * 0.046`, con size=200 acá) -- para que "Exterior"/"Interior",
// "Hoy"/"Semana"/... y demás etiquetas de selector se vean a juego.
const TOGGLE_FONT_SIZE = 200 * 0.046

// Selector exterior/interior debajo de un medidor -- como en la captura de
// referencia (radio buttons «снаружи»/«внутри»). `name` debe ser único por
// instancia para que los dos grupos de radios no se interfieran.
function ExtIntToggle({ name, value, onChange }: { name: string; value: 'out' | 'in'; onChange: (v: 'out' | 'in') => void }) {
  return (
    <div className="flex items-center gap-3 mt-1 text-slate-400" style={{ fontSize: TOGGLE_FONT_SIZE }}>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="radio" name={name} className="accent-sky-500" checked={value === 'out'} onChange={() => onChange('out')} />
        Exterior
      </label>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="radio" name={name} className="accent-sky-500" checked={value === 'in'} onChange={() => onChange('in')} />
        Interior
      </label>
    </div>
  )
}

// Selector de 4 vías para Punto de rocío -- como en la captura de referencia
// (точка росы / por ощущению / с учетом ветра / индекс влажности; el
// original repite "por ощущению" dos veces, así que aquí solo se implementan
// las 4 variantes distintas). Mismo patrón visual que ExtIntToggle pero en
// grid 2x2: 4 etiquetas en una fila se saldrían del ancho del medidor (200px).
type DewSource = 'dew' | 'feels' | 'wind' | 'humidex'
const DEW_SOURCE_OPTIONS: { value: DewSource; label: string }[] = [
  { value: 'dew', label: 'Punto de rocío' },
  { value: 'feels', label: 'Sensación' },
  { value: 'wind', label: 'Con viento' },
  { value: 'humidex', label: 'Índice humedad' },
]
function DewPointToggle({ value, onChange }: { value: DewSource; onChange: (v: DewSource) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-slate-400" style={{ fontSize: TOGGLE_FONT_SIZE }}>
      {DEW_SOURCE_OPTIONS.map((opt) => (
        <label key={opt.value} className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input type="radio" name="dew-source" className="accent-sky-500"
            checked={value === opt.value} onChange={() => onChange(opt.value)} />
          {opt.label}
        </label>
      ))}
    </div>
  )
}

// Selector de periodo para Lluvia -- mismo patrón 2x2 que DewPointToggle.
type RainPeriod = 'day' | 'week' | 'month' | 'year'
const RAIN_PERIOD_OPTIONS: { value: RainPeriod; label: string }[] = [
  { value: 'day', label: 'Hoy' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
]
function RainPeriodToggle({ value, onChange }: { value: RainPeriod; onChange: (v: RainPeriod) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-slate-400" style={{ fontSize: TOGGLE_FONT_SIZE }}>
      {RAIN_PERIOD_OPTIONS.map((opt) => (
        <label key={opt.value} className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input type="radio" name="rain-period" className="accent-sky-500"
            checked={value === opt.value} onChange={() => onChange(opt.value)} />
          {opt.label}
        </label>
      ))}
    </div>
  )
}

// Selector Temperatura/Humedad para el sensor extra (Jardín) -- a diferencia
// de ExtIntToggle, acá cambia el TIPO de escala completo (zonas, unidad,
// rango), no solo qué dato alimenta la misma escala.
type GardenMode = 'temp' | 'hum'
function GardenToggle({ value, onChange }: { value: GardenMode; onChange: (v: GardenMode) => void }) {
  return (
    <div className="flex items-center gap-3 mt-1 text-slate-400" style={{ fontSize: TOGGLE_FONT_SIZE }}>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="radio" name="garden-mode" className="accent-sky-500" checked={value === 'temp'} onChange={() => onChange('temp')} />
        Temperatura
      </label>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="radio" name="garden-mode" className="accent-sky-500" checked={value === 'hum'} onChange={() => onChange('hum')} />
        Humedad
      </label>
    </div>
  )
}

export function InstrumentosPage() {
  const { data, stats, history } = useStationData()
  const u = useUnits()
  const imp = u.system === 'imperial'
  const [rose, setRose] = useState<Rose | null>(null)
  const [tempSource, setTempSource] = useState<'out' | 'in'>('out')
  const [humSource, setHumSource] = useState<'out' | 'in'>('out')
  const [dewSource, setDewSource] = useState<DewSource>('dew')
  const [rainPeriod, setRainPeriod] = useState<RainPeriod>('day')
  const [gardenMode, setGardenMode] = useState<GardenMode>('temp')
  const [imeca, setImeca] = useState<{ available: boolean; imeca?: number; category?: string } | null>(null)

  const tempStats = stats?.[tempSource === 'out' ? 'temperature_outdoor' : 'temperature_indoor']
  const humStats = stats?.[humSource === 'out' ? 'humidity_outdoor' : 'humidity_indoor']
  const pressStats = stats?.pressure_relative

  // Mismo cálculo de tendencia que CurrentConditions.tsx (flecha verde/roja):
  // umbrales en MÉTRICO, sobre el dato crudo, antes de convertir a la unidad
  // activa -- si no, el umbral (p. ej. "0.5°C") cambiaría de significado real
  // al pasar a Fahrenheit.
  const tempKey = tempSource === 'out' ? 'temperature_outdoor' : 'temperature_indoor'
  const humKey = humSource === 'out' ? 'humidity_outdoor' : 'humidity_indoor'
  const tempTrend = getTrend(data?.[tempKey], historicValue(history, (h) => h[tempKey], 1), 0.5)
  const humTrend = getTrend(data?.[humKey], historicValue(history, (h) => h[humKey], 1), 3)
  const pressTrend = getTrend(data?.pressure_relative, historicValue(history, (h) => h.pressure_relative, 3), 1)

  const dewRaw = data ? (
    dewSource === 'dew' ? data.dew_point
      : dewSource === 'feels' ? data.feels_like
      : dewSource === 'wind' ? data.wind_chill
      : data.humidex
  ) : undefined

  useEffect(() => {
    fetch('/api/wind/rose?start=-7d').then((r) => (r.ok ? r.json() : null)).then(setRose).catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null)).then(setImeca).catch(() => {})
  }, [])

  // Lluvia: mismo dato (rain_daily/weekly/monthly/yearly), pero cada periodo
  // necesita su propia escala -- un año acumula muchas veces más que un día.
  // Los pasos en imperial son valores "redondos" propios, no una conversión
  // exacta del métrico (mismo criterio que ya usaba "Tasa de lluvia").
  const RAIN_SCALE: Record<RainPeriod, {
    max: number
    metric: { major: number; mid: number; minor: number }
    imperial: { major: number; mid: number; minor: number }
  }> = {
    day: { max: 50, metric: { major: 10, mid: 5, minor: 1 }, imperial: { major: 0.5, mid: 0.25, minor: 0.05 } },
    week: { max: 150, metric: { major: 25, mid: 12.5, minor: 5 }, imperial: { major: 1, mid: 0.5, minor: 0.1 } },
    month: { max: 300, metric: { major: 50, mid: 25, minor: 10 }, imperial: { major: 2, mid: 1, minor: 0.2 } },
    year: { max: 1200, metric: { major: 200, mid: 100, minor: 20 }, imperial: { major: 8, mid: 4, minor: 1 } },
  }
  const rainRaw = data ? (
    rainPeriod === 'day' ? data.rain_daily
      : rainPeriod === 'week' ? data.rain_weekly
      : rainPeriod === 'month' ? data.rain_monthly
      : data.rain_yearly
  ) : undefined
  const rainScale = RAIN_SCALE[rainPeriod]
  const rainStep = imp ? rainScale.imperial : rainScale.metric

  // Base de nubes no tiene conversor en units.tsx (solo `alt()`, que da un
  // string formateado) -- se necesita el NÚMERO para posicionar la aguja.
  const altN = (m: number) => (imp ? m / 0.3048 : m)

  // `rose.dominant` es el rótulo del sector (p. ej. "NNE"), no un bearing en
  // grados -- se resuelve buscando el sector cuya `label` coincida y usando
  // su `dir` (0-360, mismo convenio que el resto de los gauges).
  const dominantBearing = rose?.dominant != null
    ? rose.sectors.find((s) => s.label === rose.dominant)?.dir ?? null
    : null

  const g = 200 // tamaño de cada medidor

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Instrumentos</h1>
        <p className="text-slate-400 text-sm">
          Panel de medidores analógicos -- mismo dato que el resto del sitio, presentado como instrumentos físicos.
        </p>
      </div>

      <div className="card">
        <div className="grid gap-x-2 gap-y-6 justify-items-center grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="flex flex-col items-center">
            <AnalogGauge title={`Temperatura\n${tempSource === 'out' ? 'Exterior' : 'Interior'}`} size={g}
              value={data
                ? u.tempN((tempSource === 'out' ? data.temperature_outdoor : data.temperature_indoor) ?? NaN)
                : null}
              min={u.tempN(-20)} max={u.tempN(50)} majorStep={imp ? 20 : 10} midStep={imp ? 10 : 5} minorStep={imp ? 2 : 1}
              unit={u.tempU} decimals={1}
              zones={zonesIn([[-20, 10, '#38bdf8'], [10, 25, '#22c55e'], [25, 35, '#eab308'], [35, 50, '#ef4444']], u.tempN)}
              minMarkerValue={tempStats?.min != null ? u.tempN(tempStats.min) : null}
              maxMarkerValue={tempStats?.max != null ? u.tempN(tempStats.max) : null}
              trend={tempTrend} />
            <ExtIntToggle name="temp-source" value={tempSource} onChange={setTempSource} />
          </div>

          <div className="flex flex-col items-center">
            <AnalogGauge title={`Humedad\n${humSource === 'out' ? 'Exterior' : 'Interior'}`} size={g}
              value={(humSource === 'out' ? data?.humidity_outdoor : data?.humidity_indoor) ?? null}
              min={0} max={100} majorStep={20} midStep={10} minorStep={2}
              unit="%" decimals={0}
              zones={[{ from: 0, to: 30, color: '#d4a373' }, { from: 30, to: 60, color: '#22c55e' },
                { from: 60, to: 85, color: '#38bdf8' }, { from: 85, to: 100, color: '#2563eb' }]}
              minMarkerValue={humStats?.min ?? null}
              maxMarkerValue={humStats?.max ?? null}
              trend={humTrend} />
            <ExtIntToggle name="hum-source" value={humSource} onChange={setHumSource} />
          </div>

          <AnalogGauge title="Presión" size={g} lcdWide
            value={data ? u.pressN(data.pressure_relative) : null}
            min={u.pressN(950)} max={u.pressN(1050)} majorStep={imp ? 0.5 : 20} midStep={imp ? 0.25 : 10} minorStep={imp ? 0.05 : 2}
            unit={u.pressU} decimals={imp ? 2 : 1}
            zones={zonesIn([[950, 1000, '#f472b6'], [1000, 1020, '#94a3b8'], [1020, 1050, '#22c55e']], u.pressN)}
            minMarkerValue={pressStats?.min != null ? u.pressN(pressStats.min) : null}
            maxMarkerValue={pressStats?.max != null ? u.pressN(pressStats.max) : null}
            trend={pressTrend} />

          <div className="flex flex-col items-center">
            <AnalogGauge title={DEW_SOURCE_OPTIONS.find((o) => o.value === dewSource)!.label} size={g}
              value={dewRaw != null ? u.tempN(dewRaw) : null}
              min={u.tempN(-10)} max={u.tempN(30)} majorStep={10} midStep={5} minorStep={1}
              unit={u.tempU} decimals={1}
              zones={zonesIn([[-10, 5, '#38bdf8'], [5, 18, '#22c55e'], [18, 30, '#f59e0b']], u.tempN)} />
            <DewPointToggle value={dewSource} onChange={setDewSource} />
          </div>

          <AnalogGauge title="Viento" size={g}
            value={data ? u.windN(data.wind_speed) : null}
            markerValue={data?.wind_gust_max_daily != null ? u.windN(data.wind_gust_max_daily) : null}
            avgMarkerValue={data?.wind_speed_avg10m != null ? u.windN(data.wind_speed_avg10m) : null}
            min={0} max={u.windN(100)} majorStep={imp ? 10 : 20} midStep={imp ? 5 : 10} minorStep={imp ? 1 : 2}
            unit={u.windU} decimals={1}
            zones={zonesIn([[0, 20, '#22c55e'], [20, 40, '#eab308'], [40, 60, '#f97316'], [60, 100, '#ef4444']], u.windN)} />

          <GaugeFrame size={g}>
            {rose ? <WindRose rose={rose} size={g * 0.78} compact dial /> : <p className="text-xs" style={{ color: '#6b6656' }}>Sin datos</p>}
          </GaugeFrame>

          <CompassGauge size={g} value={data?.wind_direction ?? null} avgBearing={data?.wind_direction_avg10m ?? null}
            dominantBearing={dominantBearing} />

          <div className="flex flex-col items-center">
            <AnalogGauge title={`Lluvia\n${RAIN_PERIOD_OPTIONS.find((o) => o.value === rainPeriod)!.label}`} size={g}
              value={rainRaw != null ? u.rainN(rainRaw) : null}
              min={0} max={u.rainN(rainScale.max)}
              majorStep={rainStep.major} midStep={rainStep.mid} minorStep={rainStep.minor}
              unit={u.rainU} decimals={imp ? 2 : 1}
              zones={zonesIn([
                [0, rainScale.max * 0.2, '#7dd3fc'],
                [rainScale.max * 0.2, rainScale.max * 0.5, '#38bdf8'],
                [rainScale.max * 0.5, rainScale.max, '#2563eb'],
              ], u.rainN)} />
            <RainPeriodToggle value={rainPeriod} onChange={setRainPeriod} />
          </div>

          <AnalogGauge title="Tasa de lluvia" size={g}
            value={data ? u.rateN(data.rain_rate) : null}
            min={0} max={u.rateN(20)} majorStep={imp ? 0.2 : 4} midStep={imp ? 0.1 : 2} minorStep={imp ? 0.025 : 0.5}
            unit={u.rateU} decimals={imp ? 2 : 1}
            zones={zonesIn([[0, 2, '#86efac'], [2, 10, '#38bdf8'], [10, 20, '#2563eb']], u.rateN)} />

          <AnalogGauge title="Base de nubes" size={g}
            value={data?.cloud_base != null ? altN(data.cloud_base) : null}
            min={0} max={imp ? 10000 : 3000} majorStep={imp ? 2000 : 500} midStep={imp ? 1000 : 250} minorStep={imp ? 200 : 50}
            unit={u.altU} decimals={0}
            zones={[{ from: 0, to: imp ? 1500 : 500, color: '#94a3b8' }, { from: imp ? 1500 : 500, to: imp ? 5000 : 1500, color: '#38bdf8' },
              { from: imp ? 5000 : 1500, to: imp ? 10000 : 3000, color: '#2563eb' }]} />

          <AnalogGauge title="Radiación solar" size={g}
            value={data?.solar_radiation ?? null}
            min={0} max={1200} majorStep={200} midStep={100} minorStep={20}
            unit="W/m²" decimals={0}
            zones={[{ from: 0, to: 200, color: '#94a3b8' }, { from: 200, to: 500, color: '#22c55e' },
              { from: 500, to: 800, color: '#eab308' }, { from: 800, to: 1200, color: '#f97316' }]} />

          <AnalogGauge title="UV" size={g}
            value={data?.uv_index ?? null}
            min={0} max={12} majorStep={2} midStep={1} minorStep={0.25}
            unit="índice" decimals={1}
            zones={[{ from: 0, to: 3, color: '#22c55e' }, { from: 3, to: 6, color: '#eab308' },
              { from: 6, to: 8, color: '#f97316' }, { from: 8, to: 11, color: '#ef4444' }, { from: 11, to: 12, color: '#a78bfa' }]} />

          <AnalogGauge title={'Calidad del aire\nIMECA'} size={g}
            value={imeca?.available ? imeca.imeca ?? null : null}
            min={0} max={300} majorStep={50} midStep={25} minorStep={10}
            unit="IMECA" decimals={0}
            zones={[{ from: 0, to: 50, color: '#22c55e' }, { from: 50, to: 100, color: '#eab308' },
              { from: 100, to: 150, color: '#f97316' }, { from: 150, to: 200, color: '#ef4444' },
              { from: 200, to: 300, color: '#a21caf' }]} />

          <div className="flex flex-col items-center">
            <AnalogGauge title="Jardín" size={g}
              value={data ? (
                gardenMode === 'temp' ? u.tempN(data.temperature_ch1 ?? NaN) : (data.humidity_ch1 ?? NaN)
              ) : null}
              min={gardenMode === 'temp' ? u.tempN(-20) : 0}
              max={gardenMode === 'temp' ? u.tempN(50) : 100}
              majorStep={gardenMode === 'temp' ? (imp ? 20 : 10) : 20}
              midStep={gardenMode === 'temp' ? (imp ? 10 : 5) : 10}
              minorStep={gardenMode === 'temp' ? (imp ? 2 : 1) : 2}
              unit={gardenMode === 'temp' ? u.tempU : '%'}
              decimals={gardenMode === 'temp' ? 1 : 0}
              zones={gardenMode === 'temp'
                ? zonesIn([[-20, 10, '#38bdf8'], [10, 25, '#22c55e'], [25, 35, '#eab308'], [35, 50, '#ef4444']], u.tempN)
                : [{ from: 0, to: 30, color: '#d4a373' }, { from: 30, to: 60, color: '#22c55e' },
                    { from: 60, to: 85, color: '#38bdf8' }, { from: 85, to: 100, color: '#2563eb' }]} />
            <GardenToggle value={gardenMode} onChange={setGardenMode} />
          </div>

          <ClockGauge size={g} />
        </div>
      </div>

      <PageInfo>
        <p>
          Los <span className="font-semibold">medidores analógicos</span> muestran el mismo dato que las demás
          páginas del sitio, presentado como instrumentos físicos (bisel metálico, aguja, pantalla digital) --
          inspirados en el aspecto clásico de la instrumentación meteorológica, con SVG propio de este proyecto.
        </p>
      </PageInfo>
    </div>
  )
}
