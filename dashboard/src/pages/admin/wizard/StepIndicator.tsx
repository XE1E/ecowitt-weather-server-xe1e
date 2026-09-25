

export function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`w-3 h-3 rounded-full transition-colors ${
            i < current ? 'bg-sky-500' : i === current ? 'bg-sky-400' : 'bg-slate-600'
          }`}
        />
      ))}
    </div>
  )
}
