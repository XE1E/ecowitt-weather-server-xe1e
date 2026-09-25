import { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AdminAuthProvider } from '../admin-auth'
import { AdminLayout } from '../pages/admin/AdminLayout'
import { lazyPage } from './lazyPage'

// Cada página del panel se descarga al entrar (el Suspense de las que van dentro
// del menú está en AdminLayout; el de aquí cubre el asistente, que va sin menú).
const AdminDashboard = lazyPage(() => import('../pages/admin/AdminDashboard'), 'AdminDashboard')
const AdminEstaciones = lazyPage(() => import('../pages/admin/AdminEstaciones'), 'AdminEstaciones')
const AdminEstacionConfig = lazyPage(() => import('../pages/admin/AdminEstacionConfig'), 'AdminEstacionConfig')
const AdminAlertas = lazyPage(() => import('../pages/admin/AdminAlertas'), 'AdminAlertas')
const AdminCalibracion = lazyPage(() => import('../pages/admin/AdminCalibracion'), 'AdminCalibracion')
const AdminPublicacion = lazyPage(() => import('../pages/admin/AdminPublicacion'), 'AdminPublicacion')
const AdminNotificaciones = lazyPage(() => import('../pages/admin/AdminNotificaciones'), 'AdminNotificaciones')
const AdminIntegraciones = lazyPage(() => import('../pages/admin/AdminIntegraciones'), 'AdminIntegraciones')
const AdminCamara = lazyPage(() => import('../pages/admin/AdminCamara'), 'AdminCamara')
const AdminSistema = lazyPage(() => import('../pages/admin/AdminSistema'), 'AdminSistema')
const AdminUpdates = lazyPage(() => import('../pages/admin/AdminUpdates'), 'AdminUpdates')
const AdminWizard = lazyPage(() => import('../pages/admin/AdminWizard'), 'AdminWizard')

export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-screen bg-slate-900" />}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="estaciones" element={<AdminEstaciones />} />
              <Route path="estaciones/:name" element={<AdminEstacionConfig />} />
              <Route path="alertas" element={<AdminAlertas />} />
              <Route path="calibracion" element={<AdminCalibracion />} />
              <Route path="publicacion" element={<AdminPublicacion />} />
              <Route path="notificaciones" element={<AdminNotificaciones />} />
              <Route path="integraciones" element={<AdminIntegraciones />} />
              <Route path="camara" element={<AdminCamara />} />
              <Route path="sistema" element={<AdminSistema />} />
              <Route path="updates" element={<AdminUpdates />} />
            </Route>
            <Route path="/admin/wizard" element={<AdminWizard />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AdminAuthProvider>
  )
}
