import { useState } from 'react'
import { LOCATION } from '../config'

export function ShareEmbedPage() {
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [copied, setCopied] = useState('')

  const origin = window.location.origin
  const embedUrl = `${origin}/embed?units=${units}&theme=${theme}`
  const snippet = `<iframe src="${embedUrl}" width="360" height="210" style="border:0;border-radius:16px;max-width:100%" title="Clima ${LOCATION.name}" loading="lazy"></iframe>`
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
      <h2 className="text-lg font-semibold text-slate-300 mb-1">Compartir / insertar</h2>
      <p className="text-sm text-slate-400 mb-4">
        Comparte el enlace de la estación o incrusta un widget con las condiciones actuales en otra web o blog.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Opciones + preview */}
        <div className="card">
          <p className="card-title">Vista previa</p>
          <div className="flex flex-wrap gap-4 mb-3 text-sm">
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
          </div>
          <iframe
            key={`${units}-${theme}`}
            src={`/embed?units=${units}&theme=${theme}`}
            width={360}
            height={210}
            style={{ border: 0, borderRadius: 16, maxWidth: '100%' }}
            title="Vista previa del widget"
          />
        </div>

        {/* Snippets */}
        <div className="card space-y-4">
          <div>
            <p className="card-title">Insertar (iframe)</p>
            <p className="text-xs text-slate-400 mb-2">Pega este código en tu web o blog:</p>
            <div className={box}>{snippet}</div>
            <button
              onClick={() => copy(snippet, 'iframe')}
              className="mt-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-sm font-semibold"
            >
              {copied === 'iframe' ? 'Copiado ✓' : 'Copiar código'}
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
              <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-sm text-blue-400"
              >
                Abrir widget ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-4">
        El widget muestra temperatura, sensación, humedad, viento y presión, y se actualiza cada minuto.
        Al hacer clic, abre el sitio completo.
      </p>
    </div>
  )
}
