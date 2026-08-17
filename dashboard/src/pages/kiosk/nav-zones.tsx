/**
 * Zonas táctiles del kiosco, MEDIDAS del DOM ya renderizado.
 *
 * El display es una imagen fija: lo único que el firmware sabe hacer es decir dónde
 * tocaste. Alguien tiene que traducir ese (x, y) a una página, y ese alguien es este
 * archivo: cada elemento navegable lleva `data-nav="slug"`, aquí se recoge su
 * rectángulo real y se publica en `data-kiosk-nav` del contenedor raíz. El renderer
 * lo lee justo antes de capturar y lo devuelve en la cabecera `X-Kiosk-Nav`, en la
 * misma respuesta que el JPEG.
 *
 * Medirlo en vez de escribirlo a mano no es comodidad, es lo que evita que el
 * sistema se pudra: las coordenadas escritas a mano se desincronizan del layout al
 * primer retoque, en silencio y sin que ningún test lo note --el botón sigue
 * dibujado, sólo que tocarlo ya no hace nada--. Así, si una celda se mueve, su zona
 * se mueve con ella.
 *
 * El firmware NO necesita saber qué páginas existen: sólo comparar el toque contra
 * la lista que acaba de recibir.
 */
import { useEffect, useState, type CSSProperties, type RefObject } from 'react'
import { parentOf, ttlOf, holdOf } from '../../kiosk-nav'

/**
 * Tope de zonas por página. La cabecera HTTP tiene que caber holgada: 20 zonas con
 * slugs de una veintena de caracteres son ~700 bytes, lejos de cualquier límite.
 *
 * 20 y no 16: la consola tiene 17 celdas navegables y con 16 se quedaba una fuera
 * --en silencio, y precisamente la más grande, porque se recorta por área--.
 */
const MAX_ZONAS = 20

export interface Zona { x: number; y: number; w: number; h: number; to: string }

/** Lee del DOM los rectángulos de todo lo que lleve `data-nav`. */
export function medirZonas(root: HTMLElement): Zona[] {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-nav]'))
  const zonas = els.map((el) => {
    const r = el.getBoundingClientRect()
    return {
      // Enteros: el firmware compara con el toque en píxeles y medio píxel no
      // significa nada ahí. `getBoundingClientRect` ya es relativo al viewport,
      // que es exactamente el recorte que captura el renderer (0,0,1024,600).
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      to: el.getAttribute('data-nav') || '',
    }
  }).filter((z) => z.to && z.w > 0 && z.h > 0)

  // De MENOR a MAYOR área: el firmware se queda con la primera que contenga el
  // toque, así que si un botón cae dentro de un bloque navegable más grande, gana
  // el botón. Sin este orden, el contenedor se comería a sus hijos.
  zonas.sort((a, b) => a.w * a.h - b.w * b.h)
  return zonas.slice(0, MAX_ZONAS)
}

/**
 * Formato plano a propósito, no JSON: al otro lado hay un ESP32 parseándolo con
 * `strtok`, y meter un parser de JSON en el firmware para esto sería desproporcionado.
 *
 *   v=1;back=consola;ttl=1800;z=0,536,120,64,consola;z=120,536,150,64,det-rain-24h
 *
 * `hold=1` (sólo cuando lo pide la página, ver `holdOf`) le dice al firmware que NO
 * aplique aquí su vuelta automática a la consola por inactividad: es una vista viva
 * --la cámara-- que se queda hasta que la toquen. Va antes de las zonas; un firmware
 * que no lo conozca lo ignora, como ya hace con `v=` y `ttl=`.
 */
export function serializarNav(zonas: Zona[], back: string, ttl: number, hold = false): string {
  const z = zonas.map((s) => `z=${s.x},${s.y},${s.w},${s.h},${s.to}`).join(';')
  return `v=1;back=${back};ttl=${ttl}${hold ? ';hold=1' : ''}${z ? ';' + z : ''}`
}

/**
 * Publica el mapa en el contenedor raíz. Corre en CADA render, sin dependencias: es
 * barato (una docena de `getBoundingClientRect`) y así no hay forma de que las zonas
 * se queden con las medidas de un layout anterior --que es justo el fallo que este
 * módulo existe para impedir--. Que los datos lleguen tarde y muevan algo no importa:
 * el renderer captura después del `data-kiosk-ready`, cuando ya no se mueve nada.
 *
 * Recibe la REF y no el elemento: en el primer render el elemento todavía no existe,
 * y si se pasara suelto el mapa no se publicaría hasta que algo provocara otro
 * render. Con la ref, el primer efecto ya lo encuentra montado.
 *
 * `useEffect` y no `useLayoutEffect`: sólo escribe un atributo, no hay nada que
 * pintar antes.
 */
export function useNavZones(ref: RefObject<HTMLElement | null>, slug: string, enabled = true) {
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) return
    root.setAttribute('data-kiosk-nav', serializarNav(medirZonas(root), parentOf(slug), ttlOf(slug), holdOf(slug)))
    root.setAttribute('data-kiosk-ttl', String(ttlOf(slug)))
  })
}

/**
 * `?debug=nav` dibuja las zonas encima de la página.
 *
 * Es la única forma barata de comprobar que la zona cae donde se VE el botón: en el
 * display no hay puntero ni hover, y un rectángulo desplazado 20 px no se nota hasta
 * que alguien toca y no pasa nada.
 */
export function NavDebugOverlay({ nodo }: { nodo: RefObject<HTMLElement | null> }) {
  // Estado propio y no lectura directa: el overlay se pinta en el mismo render que
  // las zonas que quiere dibujar, cuando todavía no están montadas. Un efecto tras
  // el montaje las mide y provoca el render en el que ya se pueden dibujar.
  const [zonas, setZonas] = useState<Zona[]>([])
  const activo = new URLSearchParams(window.location.search).get('debug') === 'nav'
  useEffect(() => {
    if (!activo || !nodo.current) return
    const t = setTimeout(() => nodo.current && setZonas(medirZonas(nodo.current)), 400)
    return () => clearTimeout(t)
  }, [activo, nodo])
  if (!activo) return null
  const base: CSSProperties = { position: 'fixed', pointerEvents: 'none', zIndex: 9999 }
  return (
    <>
      {zonas.map((z, i) => (
        <div key={i} style={{ ...base, left: z.x, top: z.y, width: z.w, height: z.h,
          border: '2px dashed #ff00ff', background: 'rgba(255,0,255,0.06)' }}>
          <span style={{ position: 'absolute', left: 2, top: 2, fontSize: 11, fontWeight: 700,
            color: '#000', background: '#ff00ff', padding: '0 3px', fontFamily: 'monospace' }}>
            {z.to}
          </span>
        </div>
      ))}
    </>
  )
}
