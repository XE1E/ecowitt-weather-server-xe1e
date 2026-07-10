import { useEffect, useState } from 'react'
import { LOCATION } from '../../config'

/**
 * Imagen satelital diaria de NASA GIBS (Global Imagery Browse Services),
 * centrada en la estación. Usa la API pública de "snapshots" (sin API key):
 * una sola imagen JPEG del color real observado ese día por los satélites
 * polares (VIIRS / MODIS), con líneas de costa y fronteras superpuestas.
 */
const LAYERS = [
  { key: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', label: 'VIIRS · color real' },
  { key: 'MODIS_Terra_CorrectedReflectance_TrueColor', label: 'MODIS Terra · mañana' },
  { key: 'MODIS_Aqua_CorrectedReflectance_TrueColor', label: 'MODIS Aqua · tarde' },
]

function isoOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function NasaSatelliteCard() {
  const { latitude, longitude, name, label } = LOCATION
  const [layer, setLayer] = useState(LAYERS[0].key)
  const [date, setDate] = useState(isoOffset(-1)) // ayer (la imagen de hoy puede no estar lista)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const dLat = 6, dLon = 9
  // Se sirve desde nuestro backend (mismo origen) para evitar bloqueos/latencia
  // al pedir la imagen directo a NASA desde el navegador.
  const src = `/api/satellite?layer=${layer}&date=${date}&lat=${latitude}&lon=${longitude}`
  const worldview = `https://worldview.earthdata.nasa.gov/?v=${(longitude - dLon).toFixed(2)},${(latitude - dLat).toFixed(2)},${(longitude + dLon).toFixed(2)},${(latitude + dLat).toFixed(2)}&l=${layer},Coastlines_15m,Reference_Features_15m&t=${date}`

  useEffect(() => { setLoading(true); setError(false) }, [src])

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="card-title mb-0">Satélite (NASA GIBS)</p>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={layer} onChange={(e) => setLayer(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg text-sm px-2 py-1 text-slate-200">
            {LAYERS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <input type="date" value={date} max={isoOffset(0)} min="2012-05-01"
            onChange={(e) => setDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg text-sm px-2 py-1 text-slate-200" />
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black/30" style={{ aspectRatio: '3 / 2' }}>
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">Cargando imagen satelital…</div>
        )}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-sm gap-1 px-4 text-center">
            <span>No hay imagen para esa fecha/capa.</span>
            <span className="text-xs text-slate-500">Prueba con otro día (a veces la más reciente aún no se ha publicado).</span>
          </div>
        ) : (
          <img
            key={src}
            src={src}
            alt={`Imagen satelital de ${name} el ${date}`}
            className="w-full h-full object-cover"
            loading="lazy"
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true) }}
          />
        )}
        {/* Marca de la estación (centro del recorte) */}
        {!loading && !error && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="w-3 h-3 rounded-full bg-red-500 ring-2 ring-white shadow" />
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 mt-2">
        Color real observado por satélites polares (NASA GIBS), centrado en {label}. El punto rojo marca la estación.
        {' '}<a href={worldview} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Abrir en NASA Worldview ↗</a>
      </p>
    </div>
  )
}
