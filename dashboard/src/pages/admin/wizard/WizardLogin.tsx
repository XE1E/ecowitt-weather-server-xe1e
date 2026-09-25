import { useState } from 'react'
import { useAdminAuth } from '../../../admin-auth'

export function WizardLogin({ onLogin }: { onLogin: () => void }) {
  const { login } = useAdminAuth()
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const ok = await login(user, pass)
    setLoading(false)
    if (ok) {
      onLogin()
    } else {
      setError('Credenciales inválidas')
    }
  }

  return (
    <div className="text-center">
      <div className="text-4xl mb-4">🔐</div>
      <h2 className="text-xl font-bold mb-2">Inicia sesión</h2>
      <p className="text-slate-400 text-sm mb-6">
        Ingresa tus credenciales de administrador para continuar
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <div>
          <label className="block text-sm text-slate-300 mb-1">Usuario</label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
            placeholder="admin"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-300 mb-1">Contraseña</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="w-full rounded-lg bg-slate-900/50 border border-white/10 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
          />
        </div>
        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !user || !pass}
          className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white font-medium py-2.5 rounded-lg"
        >
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
