import { useEffect, useState } from 'react'
import { useStationData } from '../station-data'
import { useUnits } from '../units'
import { AnalogGauge, CompassGauge, GaugeFrame, type GaugeZone } from '../components/gauges'
import { WindRose, type Rose } from '../components/station/WindRose'
import { PageInfo } from '../components/station/PageInfo'

// Anclas de zonas en MÉTRICO; se convierten a la unidad activa con las
// mismas funciones que usa el resto del sitio (u.tempN, u.windN, ...) para
// que un mismo umbral (p. ej. "35°C = calor") caiga en el mismo punto real
// de la escala sin importar el sistema de unidades.
function zonesIn(anchors: [number, number, string][], conv: (v: number) => number): GaugeZone[] {
  return anchors.map(([from, to, color]) => ({ from: conv(from), to: conv(to), color }))
}

export function InstrumentosPage() {
  const { data } = useStationData()
  const u = useUnits()
  const imp = u.system === 'imperial'
  const [rose, setRose] = useState<Rose | null>(null)

  useEffect(() => {
    fetch('/api/wind/rose?start=-7d').then((r) => (r.ok ? r.json() : null)).then(setRose).catch(() => {})
  }, [])

  // Base de nubes no tiene conversor en units.tsx (solo `alt()`, que da un
  // string formateado) -- se necesita el NÚMERO para posicionar la aguja.
  const altN = (m: number) => (imp ? m / 0.3048 : m)

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
        <div className="grid gap-x-2 gap-y-6 justify-items-center" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${g}px, 1fr))` }}>
          <AnalogGauge title="Temperatura" size={g}
            value={data ? u.tempN(data.temperature_outdoor) : null}
            min={u.tempN(-20)} max={u.tempN(50)} majorStep={imp ? 20 : 10} midStep={imp ? 10 : 5} minorStep={imp ? 2 : 1}
            unit={u.tempU} decimals={1}
            zones={zonesIn([[-20, 10, '#38bdf8'], [10, 25, '#22c55e'], [25, 35, '#eab308'], [35, 50, '#ef4444']], u.tempN)} />

          <AnalogGauge title="Punto de rocío" size={g}
            value={data ? u.tempN(data.dew_point ?? NaN) : null}
            min={u.tempN(-10)} max={u.tempN(30)} majorStep={10} midStep={5} minorStep={1}
            unit={u.tempU} decimals={1}
            zones={zonesIn([[-10, 5, '#38bdf8'], [5, 18, '#22c55e'], [18, 30, '#f59e0b']], u.tempN)} />

          <AnalogGauge title="Humedad" size={g}
            value={data?.humidity_outdoor ?? null}
            min={0} max={100} majorStep={20} midStep={10} minorStep={2}
            unit="%" decimals={0}
            zones={[{ from: 0, to: 30, color: '#d4a373' }, { from: 30, to: 60, color: '#22c55e' },
              { from: 60, to: 85, color: '#38bdf8' }, { from: 85, to: 100, color: '#2563eb' }]} />

          <AnalogGauge title="Viento" size={g}
            value={data ? u.windN(data.wind_speed) : null}
            min={0} max={u.windN(100)} majorStep={imp ? 10 : 20} midStep={imp ? 5 : 10} minorStep={imp ? 1 : 2}
            unit={u.windU} decimals={1}
            zones={zonesIn([[0, 20, '#22c55e'], [20, 40, '#eab308'], [40, 60, '#f97316'], [60, 100, '#ef4444']], u.windN)} />

          <CompassGauge size={g} value={data?.wind_direction ?? null} />

          <GaugeFrame title="Rosa de vientos" size={g}>
            {rose ? <WindRose rose={rose} size={g * 0.78} compact /> : <p className="text-xs text-slate-500 mt-16">Sin datos</p>}
          </GaugeFrame>

          <AnalogGauge title="Presión" size={g}
            value={data ? u.pressN(data.pressure_relative) : null}
            min={u.pressN(950)} max={u.pressN(1050)} majorStep={imp ? 0.5 : 20} midStep={imp ? 0.25 : 10} minorStep={imp ? 0.05 : 2}
            unit={u.pressU} decimals={imp ? 2 : 1}
            zones={zonesIn([[950, 1000, '#f472b6'], [1000, 1020, '#94a3b8'], [1020, 1050, '#22c55e']], u.pressN)} />

          <AnalogGauge title="Lluvia (hoy)" size={g}
            value={data ? u.rainN(data.rain_daily) : null}
            min={0} max={u.rainN(50)} majorStep={imp ? 0.5 : 10} midStep={imp ? 0.25 : 5} minorStep={imp ? 0.05 : 1}
            unit={u.rainU} decimals={imp ? 2 : 1}
            zones={zonesIn([[0, 10, '#7dd3fc'], [10, 25, '#38bdf8'], [25, 50, '#2563eb']], u.rainN)} />

          <AnalogGauge title="Tasa de lluvia" size={g}
            value={data ? u.rateN(data.rain_rate) : null}
            min={0} max={u.rateN(20)} majorStep={imp ? 0.2 : 4} midStep={imp ? 0.1 : 2} minorStep={imp ? 0.025 : 0.5}
            unit={u.rateU} decimals={imp ? 2 : 1}
            zones={zonesIn([[0, 2, '#86efac'], [2, 10, '#38bdf8'], [10, 20, '#2563eb']], u.rateN)} />

          <AnalogGauge title="UV" size={g}
            value={data?.uv_index ?? null}
            min={0} max={12} majorStep={2} midStep={1} minorStep={0.25}
            unit="índice" decimals={1}
            zones={[{ from: 0, to: 3, color: '#22c55e' }, { from: 3, to: 6, color: '#eab308' },
              { from: 6, to: 8, color: '#f97316' }, { from: 8, to: 11, color: '#ef4444' }, { from: 11, to: 12, color: '#a78bfa' }]} />

          <AnalogGauge title="Radiación solar" size={g}
            value={data?.solar_radiation ?? null}
            min={0} max={1200} majorStep={200} midStep={100} minorStep={20}
            unit="W/m²" decimals={0}
            zones={[{ from: 0, to: 200, color: '#94a3b8' }, { from: 200, to: 500, color: '#22c55e' },
              { from: 500, to: 800, color: '#eab308' }, { from: 800, to: 1200, color: '#f97316' }]} />

          <AnalogGauge title="Base de nubes" size={g}
            value={data?.cloud_base != null ? altN(data.cloud_base) : null}
            min={0} max={imp ? 10000 : 3000} majorStep={imp ? 2000 : 500} midStep={imp ? 1000 : 250} minorStep={imp ? 200 : 50}
            unit={u.altU} decimals={0}
            zones={[{ from: 0, to: imp ? 1500 : 500, color: '#94a3b8' }, { from: imp ? 1500 : 500, to: imp ? 5000 : 1500, color: '#38bdf8' },
              { from: imp ? 5000 : 1500, to: imp ? 10000 : 3000, color: '#2563eb' }]} />
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
