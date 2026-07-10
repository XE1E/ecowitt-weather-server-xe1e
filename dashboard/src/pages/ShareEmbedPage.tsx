import { useState } from 'react'
import { Code2 } from 'lucide-react'
import { LOCATION } from '../config'

const SIZES = [
  { k: 'compact', label: 'Compacto', w: 300, h: 200 },
  { k: 'normal', label: 'Normal', w: 360, h: 210 },
] as const

export function ShareEmbedPage() {
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [size, setSize] = useState<'compact' | 'normal'>('normal')
  const [copied, setCopied] = useState('')

  const origin = window.location.origin
  const dim = SIZES.find((s) => s.k === size)!
  const embedUrl = `${origin}/embed?units=${units}&theme=${theme}`
  const snippet = `<iframe src="${embedUrl}" width="${dim.w}" height="${dim.h}" style="border:0;border-radius:16px;max-width:100%" title="Clima ${LOCATION.name}" loading="lazy"></iframe>`
  const siteUrl = `${origin}/pro`

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(what); setTimeout(() => setCopied(''), 1800) },
      () => {}
    )
  }

  const pill = (active: boolean) =>
    `px-3 py-1 rounded-lg text-sm transition ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`
  const box = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs font-mono text-slate-200 break-all'

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold text-slate-100 mb-1 flex items-center gap-2"><Code2 className="w-6 h-6 text-sky-400" /> Widget para tu sitio</h2>
      <p className="text-sm text-slate-400 mb-4">
        Pon el clima en vivo de la estación en tu web o blog. Elige las opciones, copia el código y pégalo — se actualiza solo cada minuto.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Opciones + preview */}
        <div className="card">
          <p className="card-title">Vista previa</p>
          <div className="flex flex-wrap gap-4 mb-3">
            <div>
              <p className="text-xs text-slate-400 mb-1">Unidades</p>
              <div className="flex gap-1">
                <button className={pill(units === 'metric')} onClick={() => setUnits('metric')}>°C · km/h</button>
                <button className={pill(units === 'imperial')} onClick={() => setUnits('imperial')}>°F · mph</button>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">Tema</p>
              <div className="flex gap-1">
                <button className={pill(theme === 'dark')} onClick={() => setTheme('dark')}>🌙 Oscuro</button>
                <button className={pill(theme === 'light')} onClick={() => setTheme('light')}>☀️ Claro</button>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">Tamaño</p>
              <div className="flex gap-1">
                {SIZES.map((s) => (
                  <button key={s.k} className={pill(size === s.k)} onClick={() => setSize(s.k)}>{s.label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-center">
            <iframe
              key={`${units}-${theme}-${size}`}
              src={`/embed?units=${units}&theme=${theme}`}
              width={dim.w}
              height={dim.h}
              style={{ border: 0, borderRadius: 16, maxWidth: '100%' }}
              title="Vista previa del widget"
            />
          </div>
        </div>

        {/* Código */}
        <div className="card space-y-4">
          <div>
            <p className="card-title">Código para insertar</p>
            <p className="text-xs text-slate-400 mb-2">Copia y pega este código en tu página:</p>
            <div className={box}>{snippet}</div>
            <button
              onClick={() => copy(snippet, 'iframe')}
              className="mt-2 w-full rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-2 text-sm font-semibold"
            >
              {copied === 'iframe' ? '¡Copiado! ✓' : '📋 Copiar código'}
            </button>
          </div>

          <div className="border-t border-white/10 pt-3">
            <p className="card-title">Enlace directo</p>
            <div className={box}>{siteUrl}</div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => copy(siteUrl, 'link')}
                className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-sm"
              >
                {copied === 'link' ? 'Copiado ✓' : 'Copiar enlace'}
              </button>
              <a href={embedUrl} target="_blank" rel="noopener noreferrer"
                className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-sm text-blue-400">
                Abrir widget ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Cómo insertarlo */}
      <div className="card mt-4">
        <p className="card-title">Cómo ponerlo en tu web</p>
        <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside">
          <li>Ajusta <span className="font-semibold">unidades, tema y tamaño</span> arriba hasta que la vista previa te guste.</li>
          <li>Pulsa <span className="font-semibold">“Copiar código”</span>.</li>
          <li>Pega el código en el <span className="font-semibold">HTML</span> de tu página donde quieras que aparezca.</li>
        </ol>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-400">
          <div className="rounded-lg bg-white/5 px-3 py-2"><span className="font-semibold text-slate-200">WordPress:</span> añade un bloque <span className="font-mono">HTML personalizado</span> y pega el código.</div>
          <div className="rounded-lg bg-white/5 px-3 py-2"><span className="font-semibold text-slate-200">Blogger / Wix:</span> usa un elemento <span className="font-mono">HTML / Insertar código</span>.</div>
          <div className="rounded-lg bg-white/5 px-3 py-2"><span className="font-semibold text-slate-200">HTML puro:</span> pégalo dentro del <span className="font-mono">&lt;body&gt;</span>.</div>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          El widget es <span className="font-semibold">responsivo</span> (<span className="font-mono">max-width:100%</span>): se adapta al ancho disponible.
          Muestra temperatura, sensación, humedad, viento y presión; al hacer clic abre el sitio completo. No requiere permisos ni cuentas.
        </p>
      </div>
    </div>
  )
}
