/** Datos que va juntando el asistente de configuración inicial (AdminWizard). */
export interface WizardData {
  station_label: string
  cwop_latitude: number
  cwop_longitude: number
  timezone_offset: number
  alerts_enabled: boolean
  telegram_enabled: boolean
  telegram_bot_token: string
  telegram_chat_id: string
  email_enabled: boolean
  email_smtp_host: string
  email_smtp_port: number
  email_smtp_user: string
  email_smtp_password: string
  email_from: string
  email_to: string
  email_starttls: boolean
  wu_enabled: boolean
  wu_station_id: string
  wu_station_key: string
  windy_enabled: boolean
  windy_station_id: string
  windy_station_password: string
}
