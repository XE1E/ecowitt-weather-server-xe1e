/** Placeholder de carga para una tarjeta, evita huecos vacíos mientras llegan datos. */
export function CardSkeleton({ title, lines = 3 }: { title?: string; lines?: number }) {
  return (
    <div className="card animate-pulse">
      {title && <p className="card-title">{title}</p>}
      <div className="space-y-2 mt-1">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-4 rounded bg-white/10" style={{ width: `${75 - i * 12}%` }} />
        ))}
      </div>
    </div>
  )
}
