import { useState, useEffect } from 'react'

interface Alert {
  key: string
  message: string
}

// Nombre corto por categoría de la clave (namespaceada: "gw1100:temp_high" en
// una secundaria). Mismo criterio que `_category_for` del backend
// (services/alerts.py) pero en palabras legibles para el cintillo público.
function categoryLabel(key: string): string {
  const k = key.includes(':') ? key.split(':')[1] : key
  if (k === 'pressure_drop' || k === 'pressure_rise') return 'Presión'
  if (k === 'temp_drop' || k === 'temp_rise') return 'Temperatura'
  if (k.startsWith('temp_') || k.startsWith('dew_') || k.startsWith('feels_')) return 'Temperatura'
  if (k === 'uv_high' || k === 'solar_high') return 'Sol'
  if (k === 'wind_high' || k === 'gust_high') return 'Viento'
  if (k.startsWith('rain_')) return 'Lluvia'
  if (k.startsWith('pressure_')) return 'Presión'
  if (k.startsWith('humidity_')) return 'Humedad'
  if (k.startsWith('station_offline')) return 'Estación'
  if (k.startsWith('battery_')) return 'Batería'
  if (k.startsWith('sensor_')) return 'Sensor'
  if (k.startsWith('camera_')) return 'Cámara'
  if (k === 'aqi_high' || k === 'imeca_high') return 'Aire'
  if (k.startsWith('sky_')) return 'Visual'
  if (k.startsWith('earthquake_')) return 'Sismo'
  return 'Alerta'
}

/**
 * Cintillo compacto bajo el nav, visible SOLO cuando hay alertas activas (no
 * ocupa espacio si no hay nada que avisar). Inspirado en el patrón de sitios
 * de clima que muestran "N alertas activas: X, Y" arriba de todo — a
 * diferencia de `AlertsPanel` (la tarjeta con el detalle completo, más abajo
 * en la columna derecha), este es el aviso de un vistazo.
 */
export function AlertBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    const load = () =>
      fetch('/api/alerts')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j) setAlerts(j.active ?? []) })
        .catch(() => {})
    load()
    const i = setInterval(load, 60000)
    return () => clearInterval(i)
  }, [])

  if (alerts.length === 0) return null

  // Categorías únicas, en el orden en que aparecieron (sin repetir "Temperatura"
  // dos veces si hay dos alertas de esa familia).
  const labels = Array.from(new Set(alerts.map((a) => categoryLabel(a.key))))

  return (
    <a
      href="#alertas"
      className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/15 transition"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
      </span>
      <span className="font-medium truncate">
        {alerts.length} {alerts.length === 1 ? 'alerta activa' : 'alertas activas'}: {labels.join(', ')}
      </span>
      <span className="ml-auto shrink-0 text-amber-300/80 whitespace-nowrap">Ver alertas →</span>
    </a>
  )
}
