/**
 * Vista del exterior desde la cámara (Tapo C325WB) + análisis del cielo.
 *
 * Se abre tocando la celda de CONDICIÓN ACTUAL de la consola. Muestra la última foto
 * y, sobre ella, la descripción del cielo que genera el análisis con IA (Gemini) de
 * esa misma imagen: condición, cobertura de nubes y una frase de lo que se ve.
 *
 * NAVEGACIÓN: tocar la pantalla vuelve a la CONSOLA. La foto entera es una zona
 * `data-nav="consola"`, y el respaldo (`parentOf('camara')`) también es la consola,
 * así que el toque cae donde caiga vuelve a la pantalla de inicio.
 *
 * Contrato con el backend:
 *   GET /api/camera/status  -> { available, captured_at, age_seconds, stale, analysis }
 *   GET /api/camera/latest.jpg
 *
 * DEGRADA CON GRACIA: si no hay foto, o si la que hay está vieja, se dice; no se deja
 * el hueco en blanco ni se enseña una imagen de hace horas como si fuera de ahora. Si
 * hay foto pero todavía no hay análisis, se ve la foto sin la banda de texto.
 */
import { useEffect, useRef, useState } from 'react'
import { CONSOLE_CSS } from '../../components/station/console-css'
import { useNavZones, NavDebugOverlay } from './nav-zones'
import { KioskBar, KioskHead, type Boton } from './chrome'

interface Analysis {
  cloud_type?: string
  cloud_coverage_pct?: number
  sky_condition?: string
  visibility?: string
  precipitation_visible?: boolean
  description?: string
  forecast_hint?: string
  error?: string
}

interface Estado {
  available?: boolean
  captured_at?: string
  age_seconds?: number
  analysis?: Analysis
}

/**
 * A partir de aquí la foto se marca como vieja: 15 min son TRES capturas perdidas con
 * la cadencia de 5 min. Debe coincidir con `camera_stale_seconds` del servidor, que
 * es quien calcula `stale` en /api/camera/status; esto es sólo el respaldo por si la
 * respuesta no lo trae.
 */
const VIEJA_S = 15 * 60

/** Emoji e idioma de la condición, los mismos que la tarjeta del cielo de la web. */
const COND_EMOJI: Record<string, string> = {
  clear: '☀️', partly_cloudy: '⛅', mostly_cloudy: '🌥️', overcast: '☁️',
  foggy: '🌫️', rainy: '🌧️', stormy: '⛈️', night: '🌙',
}
const COND_ES: Record<string, string> = {
  clear: 'DESPEJADO', partly_cloudy: 'PARC. NUBLADO', mostly_cloudy: 'MAY. NUBLADO',
  overcast: 'CUBIERTO', foggy: 'NEBLINA', rainy: 'LLUVIA', stormy: 'TORMENTA', night: 'NOCHE',
}
const VIS_ES: Record<string, string> = {
  excellent: 'EXCELENTE', good: 'BUENA', moderate: 'MODERADA', poor: 'POBRE', very_poor: 'MUY POBRE',
}

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

  // El análisis sólo se pinta si vino sin error y trae al menos una descripción. Con
  // el fix del servidor, un fallo pasajero de Gemini ya no borra el último bueno.
  const an = st?.analysis
  const hayAnalisis = !!an && !an.error && !!(an.description || an.sky_condition)
  const emoji = COND_EMOJI[an?.sky_condition || ''] || '🌤️'
  const condicion = COND_ES[an?.sky_condition || ''] || an?.sky_condition?.toUpperCase()
  const visibilidad = VIS_ES[an?.visibility || '']

  useNavZones(rootRef, slug)

  const botones: Boton[] = [{ label: '‹ CONSOLA', to: 'consola', tipo: 'back' }]

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

      {/* Toda la zona de la foto es una sola zona táctil: tocarla vuelve a la consola.
          Es lo pedido --tocar la imagen regresa a inicio-- y no depende de la pila de
          navegación del firmware. */}
      <div
        data-nav="consola"
        style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 8, position: 'relative' }}
      >
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
            {/* Banda de análisis del cielo, pegada al pie de la foto. Fondo en degradado
                para que el texto se lea sobre cualquier cielo, claro u oscuro. */}
            {hayAnalisis && (
              <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8,
                padding: '14px 18px 12px', borderRadius: '0 0 8px 8px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.7) 55%, rgba(0,0,0,0) 100%)' }}>
                {/* Frase protagonista: lo que se ve, en grande. */}
                {an?.description && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 30, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
                    <div style={{ color: '#fff', fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
                      {an.description}
                    </div>
                  </div>
                )}
                {/* Renglón de apoyo: condición, cobertura y visibilidad, en cifras. */}
                <div style={{ marginTop: an?.description ? 8 : 0, display: 'flex',
                  flexWrap: 'wrap', gap: '4px 18px', fontSize: 17, fontWeight: 700, letterSpacing: 0.5 }}>
                  {condicion && <span style={{ color: '#eaeaea' }}>{condicion}</span>}
                  {an?.cloud_coverage_pct != null && (
                    <span style={{ color: '#8ab4ff' }}>{an.cloud_coverage_pct}% NUBES</span>
                  )}
                  {visibilidad && <span style={{ color: '#9a9a9a' }}>VIS. {visibilidad}</span>}
                  {an?.precipitation_visible && (
                    <span style={{ color: '#ffb020' }}>LLUVIA EN EL HORIZONTE</span>
                  )}
                </div>
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
