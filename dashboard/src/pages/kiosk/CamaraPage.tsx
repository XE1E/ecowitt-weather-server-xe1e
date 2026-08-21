/**
 * Vista del exterior desde la cámara (Tapo C325WB) + análisis del cielo.
 *
 * Se abre tocando la celda de SOL Y LUNA de la consola. Muestra la última foto
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

interface Analysis {
  cloud_type?: string
  cloud_coverage_pct?: number
  sky_condition?: string
  visibility?: string
  precipitation_visible?: boolean
  description?: string
  forecast_hint?: string
  analyzed_at?: string
  error?: string
}

/**
 * A partir de aquí el análisis se considera desligado de la foto actual y NO se pinta.
 * El análisis se rehace cada `camera_analysis_interval_min` (15 por defecto), así que
 * uno sano tiene <20 min. Si envejece más es porque lleva rato fallando (cuota de
 * Gemini agotada, timeouts): mostrar "cielo despejado" de hace una hora sobre una foto
 * nublada de ahora es justo la mentira que hay que evitar. Mejor foto sin análisis.
 */
const ANALISIS_VIEJO_S = 40 * 60

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
  clear: 'DESPEJADO', partly_cloudy: 'PARCIALMENTE NUBLADO', mostly_cloudy: 'MAYORMENTE NUBLADO',
  overcast: 'CUBIERTO', foggy: 'NEBLINA', rainy: 'LLUVIA', stormy: 'TORMENTA', night: 'NOCHE',
}
const VIS_ES: Record<string, string> = {
  excellent: 'EXCELENTE', good: 'BUENA', moderate: 'MODERADA', poor: 'POBRE', very_poor: 'MUY POBRE',
}
const CLOUD_TYPE_ES: Record<string, string> = {
  cirrus: 'CIRROS', cumulus: 'CÚMULOS', stratus: 'ESTRATOS', cumulonimbus: 'CUMULONIMBOS',
  altocumulus: 'ALTOCÚMULOS', stratocumulus: 'ESTRATOCÚMULOS', nimbostratus: 'NIMBOESTRATOS',
  mixed: 'NUBES MIXTAS',
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

  // El análisis sólo se pinta si vino sin error y trae al menos una descripción. Con
  // el fix del servidor, un fallo pasajero de Gemini ya no borra el último bueno.
  const an = st?.analysis
  const anEdadS = an?.analyzed_at ? (Date.now() - new Date(an.analyzed_at).getTime()) / 1000 : 0
  const hayAnalisis = !!an && !an.error && !!(an.description || an.sky_condition)
    && anEdadS < ANALISIS_VIEJO_S
  const emoji = COND_EMOJI[an?.sky_condition || ''] || '🌤️'
  const condicion = COND_ES[an?.sky_condition || ''] || an?.sky_condition?.toUpperCase()
  const visibilidad = VIS_ES[an?.visibility || '']
  // El tipo de nube sólo cuando aporta: con cielo despejado o desconocido no está en
  // el mapa, así que no se pinta y no duplica el "DESPEJADO" de la condición.
  const nubes = CLOUD_TYPE_ES[an?.cloud_type || '']

  useNavZones(rootRef, slug)

  return (
    <div
      ref={rootRef}
      className="cns"
      // Lista cuando se sabe que NO hay foto (se pinta el aviso) o cuando la que hay
      // ya está descargada y pintada.
      data-kiosk-ready={pedido && (!hayFoto || imagenLista) ? 'true' : 'false'}
      style={{
        width: 1024, height: 600, background: '#000', overflow: 'hidden',
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        ['--acc' as string]: '#eaeaea',
      }}
    >
      <style>{CONSOLE_CSS}</style>
      <NavDebugOverlay nodo={rootRef} />

      {/* Zona táctil que cubre TODA la pantalla: tocar donde sea vuelve a la consola.
          Va en un HIJO absoluto, no en la raíz: el medidor de zonas usa
          querySelectorAll, que NO incluye al propio nodo raíz, así que una `data-nav`
          puesta ahí no se mediría y la página se quedaría sin zonas --y el firmware
          caería a su barra de pestañas de abajo, mandando el toque a otras páginas--. */}
      <div data-nav="consola" style={{ position: 'absolute', inset: 0 }} />

      {hayFoto ? (
        <>
          {/* La foto a pantalla completa: sin cabecera ni barra propias --van
              sobrepuestas-- para que la imagen ocupe todo lo que la proporción permite. */}
          <img
            src="/api/camera/latest.jpg"
            alt="Exterior de la estación"
            onLoad={() => setImagenLista(true)}
            onError={() => setFalloImagen(true)}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />

          {/* Cabecera SOBREPUESTA, alineada a la DERECHA: la cámara quema su propia
              marca de fecha/hora en la esquina ARRIBA-IZQUIERDA, así que el rótulo va al
              otro lado para no encimarse. Y no lleva hora --la repetiría--: la antigüedad
              la dice esa marca más el aviso FOTO ANTIGUA. Mismo cuerpo y estilo que la
              descripción del clima (25 px, peso 700) para que se lean como una familia. */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 22px 22px',
            textAlign: 'right',
            // Sólido hasta pasado el renglón de texto (10 de padding + 25 de letra + margen) y
            // SÓLO DESPUÉS de eso empieza a desvanecer. Antes el degradado arrancaba a
            // desvanecerse desde el primer píxel, así que contra un cielo claro el propio
            // texto quedaba en la parte ya casi transparente. Ver la nota igual en la banda
            // de análisis, que tenía el mismo problema al revés.
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.78) 0, rgba(0,0,0,0.78) 42px, rgba(0,0,0,0) 100%)' }}>
            <span style={{ color: '#fff', fontSize: 25, fontWeight: 700 }}>Estación Clima XE1E</span>
          </div>

          {/* Aviso sobre la propia foto: si es de hace horas hay que verlo al mirarla.
              A la DERECHA, bajo el rótulo, para no pisar la marca de la cámara. */}
          {vieja && (
            <div style={{ position: 'absolute', top: 48, right: 22, background: 'rgba(255,65,40,0.92)',
              color: '#000', fontSize: 17, fontWeight: 800, letterSpacing: 2, padding: '4px 10px',
              borderRadius: 6 }}>
              FOTO ANTIGUA
            </div>
          )}

          {/* Banda de análisis del cielo, pegada al pie. Degradado para leerse sobre
              cualquier cielo, claro u oscuro.
              SÓLIDO hasta 26px del borde de arriba, y sólo ese margen se desvanece: antes
              el degradado repartía la opacidad en porcentaje de todo el alto de la banda
              (0.9 abajo, transparente arriba), y la frase protagonista --lo primero que se
              lee-- cae justo arriba, en la parte casi transparente. Contra un cielo claro
              quedaba casi sin fondo. Con el corte en píxeles el sólido cubre el texto
              entero sin importar cuántos renglones tenga (descripción + apoyo + pronóstico
              cambian de alto según el análisis), y sólo el margen vacío de arriba --antes
              del primer carácter-- es el que se funde con la foto. */}
          {hayAnalisis && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0,
              padding: '20px 22px 14px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0, rgba(0,0,0,0.92) calc(100% - 26px), rgba(0,0,0,0) 100%)' }}>
              {/* Frase protagonista: lo que se ve, en grande. */}
              {an?.description && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                  <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
                  <div style={{ color: '#fff', fontSize: 25, fontWeight: 700, lineHeight: 1.2 }}>
                    {an.description}
                  </div>
                </div>
              )}
              {/* Renglón de apoyo: condición, cobertura y visibilidad. Centrado y que se
                  ajuste solo (envuelve si no cabe). Se lee de lejos, que es desde donde se
                  mira la pantalla. */}
              <div style={{ marginTop: an?.description ? 10 : 0, display: 'flex',
                flexWrap: 'wrap', justifyContent: 'center', gap: '4px 22px',
                fontSize: 21, fontWeight: 800, letterSpacing: 0.6 }}>
                {condicion && <span style={{ color: '#f0f0f0' }}>{condicion}</span>}
                {nubes && <span style={{ color: '#d0d0d0' }}>{nubes}</span>}
                {an?.cloud_coverage_pct != null && (
                  <span style={{ color: '#8ab4ff' }}>{an.cloud_coverage_pct}% NUBES</span>
                )}
                {visibilidad && <span style={{ color: '#b0b0b0' }}>VISIBILIDAD {visibilidad}</span>}
                {an?.precipitation_visible && (
                  <span style={{ color: '#ffb020' }}>LLUVIA EN EL HORIZONTE</span>
                )}
              </div>
              {/* Pronóstico a corto plazo del análisis --lo que se espera en 1-2 h--,
                  para completar la narrativa: qué se ve ARRIBA y qué viene AQUÍ. En azul
                  cielo para distinguirlo de la descripción.
                  SÓLO si la foto es RECIENTE: un pronóstico sacado de una imagen vieja es
                  lo más engañoso que puede haber --puede decir "sin riesgo de lluvia"
                  mientras ya llueve, porque lo dedujo de un cielo despejado de hace rato--.
                  La descripción sí se queda (es lo que se veía entonces, y el aviso FOTO
                  ANTIGUA lo enmarca), pero la predicción a futuro no. */}
              {an?.forecast_hint && !vieja && (
                <div style={{ marginTop: 9, display: 'flex', alignItems: 'flex-start', gap: 9,
                  color: '#9ec5ff', fontSize: 20, fontWeight: 600, lineHeight: 1.25 }}>
                  <span style={{ flexShrink: 0, fontSize: 18 }}>↗</span>
                  <span>{an.forecast_hint}</span>
                </div>
              )}
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
  )
}
