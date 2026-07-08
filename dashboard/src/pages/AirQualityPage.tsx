import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { LOCATION } from '../config'

interface AQ {
  aqi: number | null
  dominant?: string
  station?: string
  time?: string
  pollutants?: Record<string, number | null>
  error?: string
}

function category(aqi: number): { label: string; color: string; advice: string } {
  if (aqi <= 50) return { label: 'Buena', color: '#22c55e', advice: 'Calidad del aire satisfactoria; riesgo bajo o nulo.' }
  if (aqi <= 100) return { label: 'Moderada', color: '#eab308', advice: 'Aceptable; personas muy sensibles con precaución.' }
  if (aqi <= 150) return { label: 'Dañina a grupos sensibles', color: '#f97316', advice: 'Grupos sensibles deben reducir el esfuerzo al aire libre.' }
  if (aqi <= 200) return { label: 'Dañina', color: '#ef4444', advice: 'Todos pueden verse afectados; limita la actividad exterior.' }
  if (aqi <= 300) return { label: 'Muy dañina', color: '#a855f7', advice: 'Alerta de salud; evita la actividad al aire libre.' }
  return { label: 'Peligrosa', color: '#9f1239', advice: 'Emergencia sanitaria; permanece en interiores.' }
}

const POLS = [
  { k: 'pm25', label: 'PM2.5' },
  { k: 'pm10', label: 'PM10' },
  { k: 'o3', label: 'O₃' },
  { k: 'no2', label: 'NO₂' },
  { k: 'so2', label: 'SO₂' },
  { k: 'co', label: 'CO' },
]

export function AirQualityPage() {
  const [aq, setAq] = useState<AQ | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () =>
      fetch(`/api/airquality?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { setAq(d); setLoading(false) })
        .catch(() => setLoading(false))
    load()
    const i = setInterval(load, 10 * 60000)
    return () => clearInterval(i)
  }, [])

  if (loading) {
    return <div className="h-40 flex items-center justify-center"><RefreshCw className="w-7 h-7 animate-spin text-blue-400" /></div>
  }

  if (aq?.error === 'no_token') {
    return (
      <div>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Calidad del aire</h2>
        <div className="card text-sm text-slate-300">
          <p>Falta configurar el token de WAQI. Consíguelo gratis en
            {' '}<a href="https://aqicn.org/data-platform/token/" className="text-blue-400">aqicn.org/data-platform/token</a>
            {' '}y ponlo en el <span className="font-mono">.env</span> del servidor como
            {' '}<span className="font-mono">WAQI_TOKEN=...</span></p>
        </div>
      </div>
    )
  }

  if (!aq || aq.aqi == null) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Calidad del aire</h2>
        <div className="card text-slate-400">Sin datos de calidad del aire por ahora.</div>
      </div>
    )
  }

  const cat = category(aq.aqi)
  const pol = aq.pollutants ?? {}

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-300 mb-3">Calidad del aire</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AQI principal */}
        <div className="card flex flex-col items-center justify-center text-center">
          <div
            className="w-32 h-32 rounded-full flex flex-col items-center justify-center"
            style={{ backgroundColor: cat.color + '22', border: `3px solid ${cat.color}` }}
          >
            <span className="text-5xl font-bold" style={{ color: cat.color }}>{aq.aqi}</span>
            <span className="text-xs text-slate-400">AQI (US)</span>
          </div>
          <p className="mt-3 text-lg font-semibold" style={{ color: cat.color }}>{cat.label}</p>
          {aq.dominant && <p className="text-xs text-slate-400 mt-1">Contaminante principal: {aq.dominant.toUpperCase()}</p>}
        </div>

        {/* Contaminantes */}
        <div className="card lg:col-span-2">
          <p className="card-title">Contaminantes (sub-índice AQI)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {POLS.map((p) => {
              const v = pol[p.k]
              return (
                <div key={p.k} className="rounded-lg bg-white/5 p-3 text-center">
                  <p className="text-xs text-slate-400">{p.label}</p>
                  <p className="text-2xl font-bold">{v != null ? Math.round(v) : '--'}</p>
                </div>
              )
            })}
          </div>
          <p className="text-sm text-slate-400 mt-3">{cat.advice}</p>
        </div>
      </div>

      <div className="card mt-4 text-sm text-slate-300 leading-relaxed">
        <p>
          Índice de calidad del aire (<span className="font-semibold">AQI, escala US EPA</span>) vía
          {' '}<span className="font-semibold">WAQI/aqicn</span>, que usa las estaciones oficiales de
          monitoreo de CDMX{aq.station ? ` (estación: ${aq.station})` : ''}. Los valores por contaminante
          son sub-índices AQI. Nota: el AQI (US) puede diferir del índice oficial mexicano (IMECA / Aire y
          Salud) aunque provengan de las mismas estaciones. Dato externo, no medido por esta estación.
          {aq.time ? ` Actualizado: ${aq.time}.` : ''}
        </p>
      </div>
    </div>
  )
}
