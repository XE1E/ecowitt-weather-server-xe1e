import type { WizardData } from './types'

export function AlertsStep({
  data,
  onChange,
  onNext,
  onBack,
  onTestTelegram,
  testingTelegram,
  testTelegramResult,
  onTestEmail,
  testingEmail,
  testEmailResult,
}: {
  data: WizardData
  onChange: (d: Partial<WizardData>) => void
  onNext: () => void
  onBack: () => void
  onTestTelegram: () => void
  testingTelegram: boolean
  testTelegramResult: { ok: boolean; message: string } | null
  onTestEmail: () => void
  testingEmail: boolean
  testEmailResult: { ok: boolean; message: string } | null
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2 text-center">Configura las alertas</h2>
      <p className="text-slate-400 text-sm text-center mb-6">
        Recibe notificaciones cuando algo importante ocurra
      </p>

      <div className="space-y-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data.alerts_enabled}
            onChange={e => onChange({ alerts_enabled: e.target.checked })}
            className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
          />
          <div>
            <p className="font-medium">Habilitar alertas</p>
            <p className="text-sm text-slate-400">Temperatura, viento, lluvia, presión, etc.</p>
          </div>
        </label>

        <div className="border-t border-white/10 pt-4">
          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={data.telegram_enabled}
              onChange={e => onChange({ telegram_enabled: e.target.checked })}
              className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
            />
            <div>
              <p className="font-medium">Notificaciones por Telegram</p>
              <p className="text-sm text-slate-400">Recibe alertas en tu móvil</p>
            </div>
          </label>

          {data.telegram_enabled && (
            <div className="space-y-4 pl-8 animate-in slide-in-from-top-2">
              <div className="bg-slate-800/30 rounded-lg p-3 text-sm text-slate-400">
                <p className="font-medium text-slate-300 mb-2">¿Cómo obtener los datos?</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Abre Telegram y busca @BotFather</li>
                  <li>Envía /newbot y sigue las instrucciones</li>
                  <li>Copia el token que te da</li>
                  <li>Para el Chat ID, busca @userinfobot y envía cualquier mensaje</li>
                </ol>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Bot Token</label>
                <input
                  type="password"
                  value={data.telegram_bot_token}
                  onChange={e => onChange({ telegram_bot_token: e.target.value })}
                  placeholder="123456789:ABCdefGHI..."
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Chat ID</label>
                <input
                  type="text"
                  value={data.telegram_chat_id}
                  onChange={e => onChange({ telegram_chat_id: e.target.value })}
                  placeholder="123456789"
                  className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                />
              </div>
              {data.telegram_bot_token && data.telegram_chat_id && (
                <div>
                  <button
                    onClick={onTestTelegram}
                    disabled={testingTelegram}
                    className="text-sky-400 hover:text-sky-300 text-sm disabled:text-slate-500"
                  >
                    {testingTelegram ? 'Enviando...' : '🧪 Enviar mensaje de prueba'}
                  </button>
                  {testTelegramResult && (
                    <p className={`text-sm mt-1 ${testTelegramResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testTelegramResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Email section */}
        <div className="border-t border-white/10 pt-4">
          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={data.email_enabled}
              onChange={e => onChange({ email_enabled: e.target.checked })}
              className="w-5 h-5 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500/50"
            />
            <div>
              <p className="font-medium">Notificaciones por correo</p>
              <p className="text-sm text-slate-400">Recibe alertas en tu email</p>
            </div>
          </label>

          {data.email_enabled && (
            <div className="space-y-4 pl-8 animate-in slide-in-from-top-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm text-slate-300 mb-1">Servidor SMTP</label>
                  <input
                    type="text"
                    value={data.email_smtp_host}
                    onChange={e => onChange({ email_smtp_host: e.target.value })}
                    placeholder="smtp.gmail.com"
                    className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Puerto</label>
                  <input
                    type="number"
                    value={data.email_smtp_port}
                    onChange={e => onChange({ email_smtp_port: parseInt(e.target.value) || 587 })}
                    className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white focus:outline-none focus:border-sky-500/50"
                  />
                </div>
                <div className="flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={data.email_starttls}
                      onChange={e => onChange({ email_starttls: e.target.checked })}
                      className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-sky-500"
                    />
                    <span className="text-sm text-slate-300">STARTTLS</span>
                  </label>
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Usuario</label>
                  <input
                    type="text"
                    value={data.email_smtp_user}
                    onChange={e => onChange({ email_smtp_user: e.target.value })}
                    placeholder="usuario@gmail.com"
                    className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Contraseña</label>
                  <input
                    type="password"
                    value={data.email_smtp_password}
                    onChange={e => onChange({ email_smtp_password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Remitente</label>
                  <input
                    type="email"
                    value={data.email_from}
                    onChange={e => onChange({ email_from: e.target.value })}
                    placeholder="alertas@tudominio.com"
                    className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Destinatario(s)</label>
                  <input
                    type="text"
                    value={data.email_to}
                    onChange={e => onChange({ email_to: e.target.value })}
                    placeholder="tu@email.com"
                    className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                  />
                </div>
              </div>
              {data.email_smtp_host && data.email_to && (
                <div>
                  <button
                    onClick={onTestEmail}
                    disabled={testingEmail}
                    className="text-sky-400 hover:text-sky-300 text-sm disabled:text-slate-500"
                  >
                    {testingEmail ? 'Enviando...' : '🧪 Enviar correo de prueba'}
                  </button>
                  {testEmailResult && (
                    <p className={`text-sm mt-1 ${testEmailResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testEmailResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2">
          ← Atrás
        </button>
        <button
          onClick={onNext}
          className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-6 py-2 rounded-lg"
        >
          Continuar
        </button>
      </div>
    </div>
  )
}
