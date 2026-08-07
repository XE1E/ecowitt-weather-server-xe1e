/**
 * Vista del exterior desde la cámara (Tapo C325WB).
 *
 * La cámara está comprada pero **todavía no instalada**: esta página existe ya para
 * que el día que empiecen a llegar fotos no haya que tocar nada del display. Ver
 * `docs/internal/PLAN-CAMARA-EXTERIOR.md`, que además da por hecho que meterla en el
 * kiosco obligaría a reflashear el firmware --con el mapa de zonas ya no--.
 *
 * Contrato con el backend, pendiente de implementar del lado del servidor:
 *   GET /api/camera/status  -> { available, captured_at, age_seconds }
 *   GET /api/camera/latest.jpg
 *
 * DEGRADA CON GRACIA, que es lo acordado en ese plan: si no hay foto, o si la que hay
 * está vieja, se dice; no se deja el hueco en blanco ni se enseña una imagen de hace
 * horas como si fuera de ahora. En una pantalla de pared, una foto sin fecha es una
 * mentira en potencia: nada distingue el jardín de hoy del de anteayer.
 */
import { useEffect, useRef, useState } from 'react'
import { CONSOLE_CSS } from '../../components/station/console-css'
import { useNavZones, NavDebugOverlay } from './nav-zones'
import { KioskBar, KioskHead, type Boton } from './chrome'

interface Estado {
  available?: boolean
  captured_at?: string
  age_seconds?: number
}

/**
 * A partir de aquí la foto se marca como vieja: 15 min son TRES capturas perdidas con
 * la cadencia de 5 min. Debe coincidir con `camera_stale_seconds` del servidor, que
 * es quien calcula `stale` en /api/camera/status; esto es sólo el respaldo por si la
 * respuesta no lo trae.
 */
const VIEJA_S = 15 * 60

export function CamaraPage({ slug }: { slug: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [st, setSt] = useState<Estado | null>(null)
  const [pedido, setPedido] = useState(false)
  const [falloImagen, setFalloImagen] = useState(false)
  // Saber que hay foto NO basta para capturar: la etiqueta <img> la descarga
  // después, y el renderer llegaba a tiempo de fotografiar el hueco todavía en
  // negro. Hay que esperar a que la imagen esté PINTADA.
  const [imagenLista, setImagenLista] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch('/api/camera/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && setSt(j))
      .catch(() => {})
      .finally(() => vivo && setPedido(true))
    return () => { vivo = false }
  }, [])

  const hayFoto = !!st?.available && !falloImagen
  const vieja = (st?.age_seconds ?? 0) > VIEJA_S
  // 24 h: el resto de la consola va así (su reloj marca 17:36) y un "05:36 p. m."
  // en la cabecera cantaba al lado.
  const cuando = st?.captured_at
    ? new Date(st.captured_at).toLocaleTimeString('es-MX',
        { hour: '2-digit', minute: '2-digit', hour12: false })
    : null

  useNavZones(rootRef, slug)

  const botones: Boton[] = [{ label: '‹ ATRÁS', to: 'menu', tipo: 'back' }]

  return (
    <div
      ref={rootRef}
      className="cns"
      // Lista cuando se sabe que NO hay foto (se pinta el aviso) o cuando la que hay
      // ya está descargada y pintada.
      data-kiosk-ready={pedido && (!hayFoto || imagenLista) ? 'true' : 'false'}
      style={{
        width: 1024, height: 600, background: '#000', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        ['--acc' as string]: '#eaeaea',
      }}
    >
      <style>{CONSOLE_CSS}</style>
      <NavDebugOverlay nodo={rootRef} />

      <KioskHead
        titulo="EXTERIOR"
        sub={hayFoto && cuando ? `${vieja ? 'ÚLTIMA A LAS ' : ''}${cuando}` : undefined}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 8, position: 'relative' }}>
        {hayFoto ? (
          <>
            <img
              src="/api/camera/latest.jpg"
              alt="Exterior de la estación"
              onLoad={() => setImagenLista(true)}
              onError={() => setFalloImagen(true)}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
            />
            {/* Aviso sobre la propia foto, no debajo: si la imagen es de hace horas hay
                que verlo al mirarla, no al buscar el pie. */}
            {vieja && (
              <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(255,65,40,0.9)',
                color: '#000', fontSize: 17, fontWeight: 800, letterSpacing: 2, padding: '4px 10px',
                borderRadius: 6 }}>
                FOTO ANTIGUA
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', color: '#8a8a8a' }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3 }}>SIN IMAGEN</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 10, color: '#5a5a5a' }}>
              {st == null ? 'LA CÁMARA AÚN NO ESTÁ CONFIGURADA' : 'NO HA LLEGADO NINGUNA CAPTURA'}
            </div>
          </div>
        )}
      </div>

      <KioskBar botones={botones} />
    </div>
  )
}
