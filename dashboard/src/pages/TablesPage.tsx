import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStationData } from '../station-data'
import { StationSummaryTable } from '../components/station/StationSummaryTable'
import { WeatherData, DailyStats } from '../types'

type StationType = 'principal' | 'remota'

export function TablesPage() {
  const { data, stats, loading } = useStationData()
  const [selected, setSelected] = useState<StationType>('principal')
  const [remoteData, setRemoteData] = useState<WeatherData | null>(null)
  const [remoteStats, setRemoteStats] = useState<DailyStats['stats'] | null>(null)
  const [remoteLoading, setRemoteLoading] = useState(false)

  useEffect(() => {
    if (selected === 'remota') {
      setRemoteLoading(true)
      Promise.all([
        fetch('/api/current?station=gw1100').then(r => r.ok ? r.json() : null),
        fetch('/api/stats/daily?station=gw1100').then(r => r.ok ? r.json() : null),
      ])
        .then(([current, statsRes]) => {
          setRemoteData(current)
          setRemoteStats(statsRes?.stats ?? null)
        })
        .finally(() => setRemoteLoading(false))
    }
  }, [selected])

  const isLoading = selected === 'principal' ? (loading && !data) : remoteLoading
  const currentData = selected === 'principal' ? data : remoteData
  const currentStats = selected === 'principal' ? stats : remoteStats

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Tablas de Datos</h1>
          <p className="text-slate-400 text-sm">Resumen tabular de variables meteorologicas</p>
        </div>

        {/* Station Selector */}
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <button
            onClick={() => setSelected('principal')}
            className={`px-4 py-2 text-sm font-medium transition ${
              selected === 'principal'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
            }`}
          >
            Principal (WS2910)
          </button>
          <button
            onClick={() => setSelected('remota')}
            className={`px-4 py-2 text-sm font-medium transition ${
              selected === 'remota'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
            }`}
          >
            Remota
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="h-64 flex items-center justify-center">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
        </div>
      ) : currentData ? (
        <StationSummaryTable
          data={currentData}
          stats={currentStats}
          label={selected === 'principal' ? 'Estacion Principal — WS2910' : 'Estacion Remota'}
          indoorPrimary={selected === 'remota' && currentData.temperature_outdoor == null}
        />
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-8 text-center text-slate-400">
          {selected === 'remota'
            ? 'No hay datos disponibles de la estacion remota.'
            : 'Sin datos disponibles.'
          }
        </div>
      )}
    </div>
  )
}
