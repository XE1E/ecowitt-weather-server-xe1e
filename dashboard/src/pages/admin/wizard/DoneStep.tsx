import type { WizardData } from './types'

export function DoneStep({
  data,
  saving,
  onFinish,
  onBack,
}: {
  data: WizardData
  saving: boolean
  onFinish: () => void
  onBack: () => void
}) {
  const tzLabel = data.timezone_offset >= 0 ? `UTC+${data.timezone_offset}` : `UTC${data.timezone_offset}`
  const features = [
    `Ubicación: ${data.cwop_latitude.toFixed(4)}, ${data.cwop_longitude.toFixed(4)}`,
    `Zona horaria: ${tzLabel}`,
    data.alerts_enabled && 'Alertas habilitadas',
    data.telegram_enabled && 'Notificaciones Telegram',
    data.email_enabled && 'Notificaciones por correo',
    data.wu_enabled && 'Weather Underground',
    data.windy_enabled && 'Windy',
  ].filter(Boolean)

  return (
    <div className="text-center">
      <div className="text-6xl mb-6">🎉</div>
      <h2 className="text-2xl font-bold mb-4">¡Todo listo!</h2>
      <p className="text-slate-400 mb-6 max-w-md mx-auto">
        Tu estación está configurada y lista para funcionar.
      </p>

      <div className="bg-slate-800/50 rounded-xl border border-white/10 p-4 mb-6 text-left max-w-sm mx-auto">
        <p className="text-sm text-slate-400 mb-3">Configuración:</p>
        <ul className="space-y-2">
          <li className="flex items-center gap-2 text-sm">
            <span className="text-emerald-400">✓</span>
            <span>Estación: {data.station_label || 'Principal'}</span>
          </li>
          {features.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="text-emerald-400">✓</span>
              <span>{f}</span>
            </li>
          ))}
          {features.length === 0 && (
            <li className="text-slate-500 text-sm italic">
              Sin características adicionales (puedes agregarlas después)
            </li>
          )}
        </ul>
      </div>

      <div className="flex justify-center gap-4">
        <button
          onClick={onBack}
          disabled={saving}
          className="text-slate-400 hover:text-white px-4 py-2 disabled:opacity-50"
        >
          ← Atrás
        </button>
        <button
          onClick={onFinish}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-medium px-8 py-3 rounded-lg transition-colors"
        >
          {saving ? 'Guardando...' : 'Finalizar y entrar al panel'}
        </button>
      </div>
    </div>
  )
}
