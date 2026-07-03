interface WindCompassProps {
  direction: number
}

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function getCardinal(degrees: number): string {
  const index = Math.round(degrees / 45) % 8
  return DIRECTIONS[index]
}

export function WindCompass({ direction }: WindCompassProps) {
  return (
    <div className="relative w-24 h-24">
      {/* Compass circle */}
      <div className="absolute inset-0 rounded-full border-2 border-slate-600">
        {/* Direction markers */}
        <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 text-xs text-slate-400">N</span>
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 text-xs text-slate-400">S</span>
        <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 text-xs text-slate-400">W</span>
        <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 text-xs text-slate-400">E</span>
      </div>

      {/* Arrow */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: `rotate(${direction}deg)` }}
      >
        <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[32px] border-b-green-400" />
      </div>

      {/* Center dot */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-slate-700 border-2 border-green-400" />
      </div>

      {/* Direction label */}
      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-sm font-medium text-slate-300">
        {direction}° {getCardinal(direction)}
      </div>
    </div>
  )
}
