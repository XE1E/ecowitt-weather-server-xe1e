/**
 * Menú del kiosco: la puerta a las páginas que no cuelgan de una celda.
 *
 * Se abre tocando el RELOJ de la consola. Esa celda es la única que no muestra una
 * magnitud --no tiene detalle histórico al que llevar-- así que era la candidata
 * natural a hacer de menú sin quitarle sitio a ningún dato.
 *
 * Aquí viven las cinco páginas clásicas, que se conservan tal cual. El árbol nuevo
 * las hace redundantes en parte, pero la 2 es el BME280 del propio display y no tiene
 * equivalente en ningún otro sitio.
 */
import { useRef, useState, useEffect } from 'react'
import { CONSOLE_CSS } from '../../components/station/console-css'
import { CLASICAS } from '../../kiosk-nav'
import { useNavZones, NavDebugOverlay } from './nav-zones'
import { KioskBar, KioskHead, type Boton } from './chrome'

/** Las cinco clásicas. La cámara se añade sólo si está activa en el kiosco (toggle
 *  del admin, kiosk_camera_enabled). */
const CLASICAS_ENTRADAS = CLASICAS.map((c) => ({ to: c.page as string, label: c.label as string, desc: c.desc as string }))
const CAMARA_ENTRADA = { to: 'camara', label: 'CÁMARA', desc: 'Vista del exterior' }

export function MenuPage({ slug }: { slug: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  useNavZones(rootRef, slug)

  // ¿Se lista la cámara? Lo dice /api/kiosk/config. Se espera al fetch antes de
  // marcarse listo para que el renderer no capture el menú con la cámara si está
  // apagada. Por defecto sí (caso común); si el fetch falla, también se lista.
  const [camaraKiosco, setCamaraKiosco] = useState(true)
  const [cargado, setCargado] = useState(false)
  useEffect(() => {
    fetch('/api/kiosk/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j.camera_enabled === 'boolean') setCamaraKiosco(j.camera_enabled) })
      .catch(() => {})
      .finally(() => setCargado(true))
  }, [])
  const entradas = camaraKiosco ? [...CLASICAS_ENTRADAS, CAMARA_ENTRADA] : CLASICAS_ENTRADAS

  // "info" es un slug RESERVADO que no existe en este servidor: lo reconoce el
  // firmware y pinta su propia pantalla de diagnóstico con lo que sólo él sabe --IP,
  // SSID, señal, versión--. Está aquí porque el gesto para llegar a ella (mantener
  // pulsado 2.5 s) no lo adivina nadie, y sin la IP no se puede entrar al portal de
  // configuración salvo mirando el router.
  const botones: Boton[] = [
    { label: '‹ CONSOLA', to: 'consola', tipo: 'back' },
    { label: 'INFO DEL DISPLAY', to: 'info' },
  ]

  return (
    <div
      ref={rootRef}
      className="cns"
      // Espera sólo a saber si la cámara va en el menú (fetch diminuto); el resto es
      // estático. Su TTL sigue siendo de una hora.
      data-kiosk-ready={cargado ? 'true' : 'false'}
      style={{
        width: 1024, height: 600, background: '#000', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        ['--acc' as string]: '#eaeaea',
      }}
    >
      <style>{CONSOLE_CSS}</style>
      <NavDebugOverlay nodo={rootRef} />

      <KioskHead titulo="MÁS PANTALLAS" />

      {/* Rejilla de 3×2 con botones enormes: son seis destinos y hay 1024×450 px
          libres, así que cada uno se lleva un tercio de ancho y media altura. Al ser
          zonas táctiles, cuanto más grandes, menos toques fallidos. */}
      <div style={{
        flex: 1, minHeight: 0, display: 'grid', gap: 10, padding: 14,
        gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)',
      }}>
        {entradas.map((e) => (
          <div
            key={e.to}
            data-nav={e.to}
            style={{
              border: '2px solid #3a3a3a', borderRadius: 12, background: '#0a0a0a',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 8, padding: 10, textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 3, color: '#eaeaea' }}>
              {e.label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#8a8a8a', lineHeight: 1.2 }}>
              {e.desc}
            </div>
          </div>
        ))}
      </div>

      <KioskBar botones={botones} />
    </div>
  )
}
