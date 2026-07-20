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
