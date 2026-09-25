import type { WizardData } from './types'

export function PublishStep({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: WizardData
  onChange: (d: Partial<WizardData>) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2 text-center">Comparte tus datos</h2>
      <p className="text-slate-400 text-sm text-center mb-6">
        Publica tu estación en redes meteorológicas públicas (opcional)
      </p>

      <div className="space-y-4">
        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.wu_enabled}
              onChange={e => onChange({ wu_enabled: e.target.checked })}
              className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
            />
            <div>
              <p className="font-medium">Weather Underground</p>
              <p className="text-sm text-slate-400">wunderground.com</p>
            </div>
          </label>
          {data.wu_enabled && (
            <div className="mt-4 space-y-3 pl-8">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Station ID</label>
                <input
                  type="text"
                  value={data.wu_station_id}
                  onChange={e => onChange({ wu_station_id: e.target.value })}
                  placeholder="KMYSTATION1"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Station Key</label>
                <input
                  type="password"
                  value={data.wu_station_key}
                  onChange={e => onChange({ wu_station_key: e.target.value })}
                  placeholder="Tu clave de estación"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.windy_enabled}
              onChange={e => onChange({ windy_enabled: e.target.checked })}
              className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
            />
            <div>
              <p className="font-medium">Windy</p>
              <p className="text-sm text-slate-400">windy.com</p>
            </div>
          </label>
          {data.windy_enabled && (
            <div className="mt-4 pl-8 space-y-2">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Station ID</label>
                <input
                  type="text"
                  value={data.windy_station_id}
                  onChange={e => onChange({ windy_station_id: e.target.value })}
                  placeholder="Station ID (en 'Mis estaciones' de windy.com)"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Station password</label>
                <input
                  type="password"
                  value={data.windy_station_password}
                  onChange={e => onChange({ windy_station_password: e.target.value })}
                  placeholder="Station password (no la API key)"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-sm">
          Puedes configurar más redes después en Publicación
        </p>
      </div>

      <div className="flex justify-between mt-8">
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
