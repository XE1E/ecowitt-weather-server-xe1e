import { createContext, useContext, useState, ReactNode } from 'react'

interface AdminAuthContextType {
  token: string | null
  isAuthenticated: boolean
  login: (user: string, password: string) => Promise<boolean>
  logout: () => void
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null)

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem('admin_token')
  )

  const isAuthenticated = !!token

  const login = async (user: string, password: string): Promise<boolean> => {
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      })
      if (!r.ok) return false
      const j = await r.json()
      sessionStorage.setItem('admin_token', j.token)
      setToken(j.token)
      return true
    } catch {
      return false
    }
  }

  const logout = () => {
    sessionStorage.removeItem('admin_token')
    setToken(null)
  }

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const r = await fetch(url, { ...options, headers })
    if (r.status === 401) logout()
    return r
  }

  return (
    <AdminAuthContext.Provider value={{ token, isAuthenticated, login, logout, fetchWithAuth }}>
      {children}
    </AdminAuthContext.Provider>
  )
}
