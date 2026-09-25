import type { StationSummary as Station } from '../../../api-types'
import type { WizardData } from './types'

export function StationStep({
  stations,
  data,
  onChange,
  onNext,
  onBack,
}: {
  stations: Station[]
  data: WizardData
  onChange: (d: Partial<WizardData>) => void
  onNext: () => void
  onBack: () => void
}) {
  const principal = stations.find(s => s.name === null)
  const sensors = principal?.sensors_detail || []

  return (
    <div>
      <h2 className="text-xl font-bold mb-2 text-center">Verifica tu estación</h2>
      <p className="text-slate-400 text-sm text-center mb-6">
        Confirma que la estación está correctamente detectada
      </p>

      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🏠</span>
          <div>
            <p className="font-medium">Estación Principal</p>
            <p className="text-sm text-slate-400">{principal?.model || 'Ecowitt'}</p>
          </div>
          <span className={`ml-auto text-xs px-2 py-1 rounded ${
            principal?.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'
          }`}>
            {principal?.status === 'online' ? '🟢 Online' : '⚪ Esperando datos'}
          </span>
        </div>

        <div className="space-y-2 mb-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Sensores detectados</p>
          {sensors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {sensors.map(s => (
                <span key={s.id} className="text-xs bg-slate-700/50 px-2 py-1 rounded">
                  {s.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm italic">Esperando primera lectura...</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-slate-300 mb-1">
            Nombre de la estación (opcional)
          </label>
          <input
            type="text"
            value={data.station_label}
            onChange={e => onChange({ station_label: e.target.value })}
            placeholder="Ej: Casa, Oficina, Terraza"
            className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
          />
        </div>

        <div className="border-t border-white/10 pt-4 mt-4">
          <p className="text-sm text-slate-300 mb-3">Ubicación y zona horaria</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Latitud</label>
              <input
                type="number"
                step="0.000001"
                value={data.cwop_latitude}
                onChange={e => onChange({ cwop_latitude: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Longitud</label>
              <input
                type="number"
                step="0.000001"
                value={data.cwop_longitude}
                onChange={e => onChange({ cwop_longitude: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Zona horaria (UTC offset)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="-12"
                  max="14"
                  value={data.timezone_offset}
                  onChange={e => onChange({ timezone_offset: parseInt(e.target.value) || 0 })}
                  className="w-20 rounded-lg bg-slate-900/50 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500/50"
                />
                <span className="text-xs text-slate-500">
                  {data.timezone_offset >= 0 ? `UTC+${data.timezone_offset}` : `UTC${data.timezone_offset}`}
                </span>
                <span className="text-xs text-slate-600 ml-auto">Ej: -6 México Central</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Coordenadas para calcular amanecer/atardecer y fases lunares
          </p>
        </div>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2">
          ← Atrás
        </button>
        <button
          onClick={onNext}
          className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-6 py-2 rounded-lg"
        >
          Continuar
        </button>
      </div>
    </div>
  )
}
