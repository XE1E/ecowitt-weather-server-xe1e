import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../admin-auth'
import type { StationSummary as Station } from '../../api-types'
import type { WizardData } from './wizard/types'
import { STEPS } from './wizard/steps'
import { StepIndicator } from './wizard/StepIndicator'
import { WelcomeStep } from './wizard/WelcomeStep'
import { StationStep } from './wizard/StationStep'
import { AlertsStep } from './wizard/AlertsStep'
import { PublishStep } from './wizard/PublishStep'
import { DoneStep } from './wizard/DoneStep'
import { WizardLogin } from './wizard/WizardLogin'

// Asistente de configuración inicial. Cada paso vive en ./wizard/ (antes todo iba
// en este archivo, ~900 líneas).
export function AdminWizard() {
  const navigate = useNavigate()
  const { isAuthenticated, fetchWithAuth } = useAdminAuth()
  const [step, setStep] = useState(0)
  const [stations, setStations] = useState<Station[]>([])
  const [needsLogin, setNeedsLogin] = useState(!isAuthenticated)
  const [data, setData] = useState<WizardData>({
    station_label: '',
    cwop_latitude: 19.380359,
    cwop_longitude: -99.174564,
    timezone_offset: -6,
    alerts_enabled: true,
    telegram_enabled: false,
    telegram_bot_token: '',
    telegram_chat_id: '',
    email_enabled: false,
    email_smtp_host: '',
    email_smtp_port: 587,
    email_smtp_user: '',
    email_smtp_password: '',
    email_from: '',
    email_to: '',
    email_starttls: true,
    wu_enabled: false,
    wu_station_id: '',
    wu_station_key: '',
    windy_enabled: false,
    windy_station_id: '',
    windy_station_password: '',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testingEmail, setTestingEmail] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/stations').then(r => r.json()).then(j => setStations(j.stations || []))
  }, [])

  const updateData = (partial: Partial<WizardData>) => {
    setData(d => ({ ...d, ...partial }))
    setTestResult(null)
  }

  const testTelegram = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetchWithAuth('/api/admin/wizard/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_token: data.telegram_bot_token,
          chat_id: data.telegram_chat_id,
        }),
      })
      const j = await r.json()
      setTestResult({ ok: r.ok, message: j.message || (r.ok ? 'Mensaje enviado' : 'Error') })
    } catch {
      setTestResult({ ok: false, message: 'Error de conexión' })
    }
    setTesting(false)
  }

  const testEmail = async () => {
    setTestingEmail(true)
    setTestEmailResult(null)
    try {
      const r = await fetchWithAuth('/api/admin/wizard/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtp_host: data.email_smtp_host,
          smtp_port: data.email_smtp_port,
          smtp_user: data.email_smtp_user,
          smtp_password: data.email_smtp_password,
          from_address: data.email_from,
          to_addresses: data.email_to,
          starttls: data.email_starttls,
        }),
      })
      const j = await r.json()
      setTestEmailResult({ ok: r.ok, message: j.message || (r.ok ? 'Correo enviado' : 'Error') })
    } catch {
      setTestEmailResult({ ok: false, message: 'Error de conexión' })
    }
    setTestingEmail(false)
  }

  const finish = async () => {
    setSaving(true)
    try {
      const settings: Record<string, unknown> = {
        alerts_enabled: data.alerts_enabled,
        telegram_enabled: data.telegram_enabled,
        cwop_latitude: data.cwop_latitude,
        cwop_longitude: data.cwop_longitude,
        timezone_offset: data.timezone_offset,
      }
      if (data.telegram_enabled && data.telegram_bot_token) {
        settings.telegram_bot_token = data.telegram_bot_token
        settings.telegram_chat_id = data.telegram_chat_id
      }
      if (data.wu_enabled) {
        settings.wu_enabled = true
        settings.wu_station_id = data.wu_station_id
        if (data.wu_station_key) settings.wu_station_key = data.wu_station_key
      }
      if (data.windy_enabled) {
        settings.windy_enabled = true
        settings.windy_station_id = data.windy_station_id
        if (data.windy_station_password) settings.windy_station_password = data.windy_station_password
      }
      if (data.email_enabled) {
        settings.email_enabled = true
        // Claves de EDITABLE_KEYS (settings_store.py): las que no están ahí, el
        // backend las descarta sin avisar -- así se perdía el SMTP del asistente.
        settings.smtp_host = data.email_smtp_host
        settings.smtp_port = data.email_smtp_port
        settings.smtp_user = data.email_smtp_user
        if (data.email_smtp_password) settings.smtp_password = data.email_smtp_password
        settings.email_from = data.email_from
        settings.email_to = data.email_to
        settings.smtp_tls = data.email_starttls
      }

      await fetchWithAuth('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (data.station_label) {
        await fetchWithAuth('/api/stations/_principal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: { label: data.station_label } }),
        })
      }

      await fetchWithAuth('/api/admin/setup-complete', { method: 'POST' })

      navigate('/admin')
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {needsLogin ? (
          <div className="bg-slate-800/80 backdrop-blur rounded-2xl border border-white/10 p-8 shadow-xl">
            <WizardLogin onLogin={() => setNeedsLogin(false)} />
          </div>
        ) : (
          <>
            <StepIndicator current={step} total={STEPS.length} />
            <div className="bg-slate-800/80 backdrop-blur rounded-2xl border border-white/10 p-8 shadow-xl">
              {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
              {step === 1 && (
                <StationStep
                  stations={stations}
                  data={data}
                  onChange={updateData}
                  onNext={() => setStep(2)}
                  onBack={() => setStep(0)}
                />
              )}
              {step === 2 && (
                <AlertsStep
                  data={data}
                  onChange={updateData}
                  onNext={() => setStep(3)}
                  onBack={() => setStep(1)}
                  onTestTelegram={testTelegram}
                  testingTelegram={testing}
                  testTelegramResult={testResult}
                  onTestEmail={testEmail}
                  testingEmail={testingEmail}
                  testEmailResult={testEmailResult}
                />
              )}
              {step === 3 && (
                <PublishStep
                  data={data}
                  onChange={updateData}
                  onNext={() => setStep(4)}
                  onBack={() => setStep(2)}
                />
              )}
              {step === 4 && (
                <DoneStep
                  data={data}
                  saving={saving}
                  onFinish={finish}
                  onBack={() => setStep(3)}
                />
              )}
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  fetchWithAuth('/api/admin/setup-complete', { method: 'POST' })
                  navigate('/admin')
                }}
                className="text-slate-500 hover:text-slate-400 text-sm"
              >
                Omitir configuración inicial →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
