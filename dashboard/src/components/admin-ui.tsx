import { useState, type ReactNode } from 'react'

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

// ── Controles comunes del Admin ─────────────────────────────────────────────
// Antes cada página tenía su copia (Toggle ×7, TextField ×4, NumField ×3) con
// diferencias mínimas; las que quedan son opciones aquí.

/** Interruptor. Con `label`, va dentro de una etiqueta clicable. */
export function Toggle({ enabled, onChange, label }: {
  enabled: boolean; onChange: (v: boolean) => void; label?: ReactNode
}) {
  const sw = (
    <div className="relative shrink-0">
      <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <div onClick={label === undefined ? () => onChange(!enabled) : undefined}
        className={`w-8 h-5 rounded-full cursor-pointer transition-colors ${enabled ? 'bg-sky-600' : 'bg-slate-600'}`} />
      <div className={`pointer-events-none absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3' : ''}`} />
    </div>
  )
  if (label === undefined) return sw
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
      {sw}
      <span>{label}</span>
    </label>
  )
}

/**
 * Campo de texto. `masked`: valor guardado que el servidor no devuelve (secretos):
 * se muestra como placeholder y vacío = conservarlo. `type="password"` agrega el
 * botón de mostrar/ocultar. `size`: 'sm' compacto, 'md' más holgado.
 */
export function TextField({ value, onChange, placeholder, type = 'text', masked, size = 'sm', className = 'flex-1 min-w-0' }: {
  value: string | null; onChange: (v: string) => void; placeholder: string; type?: string
  masked?: string | null; size?: 'sm' | 'md'; className?: string
}) {
  const [show, setShow] = useState(false)
  const isPw = type === 'password'
  const pad = size === 'md' ? 'px-3 py-1.5' : 'px-2 py-1'
  return (
    <div className={`relative ${className}`}>
      <input
        type={isPw && show ? 'text' : type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={!value && masked ? `(${masked})` : placeholder}
        className={`w-full rounded bg-slate-900/50 border border-white/10 ${pad} ${isPw ? 'pr-8' : ''} text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50`}
      />
      {isPw && (
        <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
          title={show ? 'Ocultar' : 'Mostrar'}
          className={`absolute ${size === 'md' ? 'right-2' : 'right-1.5'} top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs`}>
          {show ? '🙈' : '👁️'}
        </button>
      )}
    </div>
  )
}

/** Campo numérico. `off`: deshabilitado y atenuado. */
export function NumField({ value, onChange, min, max, step = 1, w = 'w-20', off = false }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; w?: string; off?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      disabled={off}
      className={`${w} rounded bg-slate-900/50 border border-white/10 px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-sky-500/50 disabled:opacity-40`}
    />
  )
}
