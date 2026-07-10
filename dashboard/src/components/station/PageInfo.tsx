import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

/** Tarjeta didáctica "Acerca de esta página" (se coloca al final de cada página). */
export function PageInfo({ children }: { children: ReactNode }) {
  return (
    <div className="card mt-6 text-sm text-slate-300 leading-relaxed">
      <p className="card-title flex items-center gap-2"><Info className="w-4 h-4" /> Acerca de esta página</p>
      {children}
    </div>
  )
}
