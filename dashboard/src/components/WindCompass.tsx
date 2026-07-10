interface WindCompassProps {
  direction: number
}

const CARD16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
const dir16 = (d: number) => CARD16[Math.round(d / 22.5) % 16]

export function WindCompass({ direction }: WindCompassProps) {
  const d = ((direction % 360) + 360) % 360
  return (
    <div className="flex flex-col items-center shrink-0">
      <svg viewBox="0 0 120 120" className="w-28 h-28">
        {/* Aro */}
        <circle cx="60" cy="60" r="54" fill="rgba(148,163,184,0.05)" stroke="rgba(148,163,184,0.3)" strokeWidth="2" />
        {/* Marcas cada 30° (mayores en los cardinales) */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1="60" y1="9" x2="60" y2={i % 3 === 0 ? 19 : 14}
            stroke={i % 3 === 0 ? 'rgba(148,163,184,0.7)' : 'rgba(148,163,184,0.4)'}
            strokeWidth={i % 3 === 0 ? 2 : 1}
            transform={`rotate(${i * 30} 60 60)`}
          />
        ))}
        {/* Cardinales (español) */}
        <text x="60" y="30" textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="700">N</text>
        <text x="97" y="64" textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="700">E</text>
        <text x="60" y="100" textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="700">S</text>
        <text x="23" y="64" textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="700">O</text>
        {/* Aguja (punta de color = de dónde viene el viento; cola gris) */}
        <g transform={`rotate(${d} 60 60)`}>
          <polygon points="60,16 53,62 67,62" fill="#34d399" />
          <polygon points="60,104 53,62 67,62" fill="#475569" />
        </g>
        <circle cx="60" cy="60" r="6" fill="var(--surface, #0f1a2a)" stroke="#34d399" strokeWidth="2" />
      </svg>
      <p className="text-sm font-semibold text-slate-200 mt-1">
        {Math.round(d)}° <span className="text-slate-400">{dir16(d)}</span>
      </p>
    </div>
  )
}
