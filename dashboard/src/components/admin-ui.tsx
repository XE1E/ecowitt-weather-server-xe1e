// Helpers de UI compartidos por las páginas de administración.

/** Etiqueta legible (es-MX) para el estado de una estación. */
export function statusLabel(status: string): string {
  if (status === 'online') return 'En línea'
  if (status === 'offline') return 'Sin conexión'
  return 'No conectada'
}

/** Emoji de punto para el estado (verde/rojo/gris). */
export function statusDot(status: string): string {
  if (status === 'online') return '🟢'
  if (status === 'offline') return '🔴'
  return '⚪'
}

/**
 * Ícono de batería coloreado (verde = OK, rojo = baja) y con nivel de relleno,
 * más visible que el emoji 🔋/🪫 (que no admite color).
 */
export function BatteryIcon({ ok, size = 20 }: { ok: boolean; size?: number }) {
  return (
    <span
      title={ok ? 'Batería OK' : 'Batería baja'}
      aria-label={ok ? 'Batería OK' : 'Batería baja'}
      className={ok ? 'text-emerald-400' : 'text-red-400'}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="inline-block align-middle">
        <rect x="2" y="7" width="18" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="20.5" y="10.5" width="2.2" height="3" rx="1" fill="currentColor" />
        <rect x="4" y="9" width={ok ? 14 : 3.5} height="6" rx="1" fill="currentColor" />
      </svg>
    </span>
  )
}

/**
 * Pestañas de estación para las páginas de categoría del Admin (Alertas,
 * Calibración): cada pestaña con lo propio de esa estación (`null` = la
 * principal). `onGeneral` agrega primero una pestaña «General» para lo que
 * aplica a todo el sistema (en Alertas: interruptor maestro, batería, sismos…).
 * Sin secundarias no se muestra nada: no hay nada que elegir.
 */
export function StationTabs({ principalLabel, secondaries, selected, onSelect, general = false, onGeneral }: {
  principalLabel: string
  secondaries: { name: string; label: string }[]
  selected: string | null
  onSelect: (name: string | null) => void
  general?: boolean
  onGeneral?: () => void
}) {
  if (secondaries.length === 0) return null
  const tabs: { key: string; icon: string; label: string; active: boolean; go: () => void }[] = []
  if (onGeneral) tabs.push({ key: '_general', icon: '⚙️', label: 'General', active: general, go: onGeneral })
  tabs.push({ key: '_principal', icon: '🏠', label: principalLabel, active: !general && selected === null, go: () => onSelect(null) })
  for (const s of secondaries) {
    tabs.push({ key: s.name, icon: '📡', label: s.label, active: !general && selected === s.name, go: () => onSelect(s.name) })
  }
  return (
    <div role="tablist" aria-label="Estación" className="flex gap-1 border-b border-white/10 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.active}
          onClick={() => { if (!t.active) t.go() }}
          className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
            t.active ? 'border-sky-500 text-sky-400 font-medium' : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  )
}
