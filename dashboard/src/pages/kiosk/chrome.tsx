/**
 * Piezas de marco que comparten todas las pantallas nuevas del kiosco: cabecera,
 * cifras destacadas y barra de botones.
 *
 * Están aquí y no repetidas en cada página porque son justamente lo que tiene que
 * ser IDÉNTICO en todas: la barra de botones ocupa siempre los mismos 64 px del pie
 * --los mismos que la barra de pestañas de las páginas clásicas-- así que el dedo
 * encuentra lo mismo esté donde esté. Si cada pantalla la maquetara por su cuenta,
 * acabarían desalineadas y el display no perdona: no hay hover ni puntero, sólo
 * aciertas o no.
 */
import type { ReactNode } from 'react'

/** Un botón de la barra del pie. */
export interface Boton {
  label: string
  /** Slug de destino. El botón activo no lo usa: no es zona táctil. */
  to: string
  activo?: boolean
  tipo?: 'back'
}

/**
 * Barra inferior.
 *
 * El botón ACTIVO se pinta pero no lleva `data-nav`: ya estás en esa pantalla y
 * tocarlo sólo gastaría un render. Al no ser zona, el toque cae en "fuera de zona" y
 * el firmware lo trata como atrás, que es un comportamiento razonable ahí.
 */
export function KioskBar({ botones }: { botones: Boton[] }) {
  return (
    <div className="kbar">
      {botones.map((b) => (
        <div
          key={b.label}
          className={`kbtn${b.activo ? ' on' : ''}${b.tipo === 'back' ? ' back' : ''}`}
          {...(b.activo ? {} : { 'data-nav': b.to })}
        >
          {b.label}
        </div>
      ))}
    </div>
  )
}

/**
 * Cabecera: qué estoy viendo y de cuándo.
 *
 * Lleva la hora a la derecha por la misma razón que la consola lleva su reloj: la
 * imagen del display puede tener varios minutos --se sirve de caché y se refresca
 * cada pocos minutos-- y sin una hora a la vista no hay forma de saber si lo que se
 * está mirando es de ahora o de hace un rato.
 */
export function KioskHead({ titulo, sub, extra }: {
  titulo: string; sub?: string; extra?: ReactNode
}) {
  const ahora = new Date()
  const hh = String(ahora.getHours()).padStart(2, '0')
  const mm = String(ahora.getMinutes()).padStart(2, '0')
  return (
    <div className="khead">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
        <span className="ktit">{titulo}</span>
        {sub && <span className="ksub">· {sub}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        {extra}
        <span style={{ fontSize: 20, fontWeight: 700, color: '#8a8a8a' }}>{hh}:{mm}</span>
      </div>
    </div>
  )
}

/**
 * Una cifra destacada: rótulo pequeño arriba, valor grande abajo.
 *
 * El valor va en DSEG (lo arrastra la clase de glow) y la unidad NO: siete segmentos
 * no saben dibujar letras, así que "mm" o "km/h" saldrían ilegibles. Es el mismo
 * reparto que ya usan las celdas de la consola.
 *
 * Y si el propio VALOR trae letras --"4 de 7" días con lluvia, "ESE" de rumbo
 * dominante-- se sale de DSEG y se pinta en la condensada, conservando el color.
 * Comprobado en captura: "4 de 7" en siete segmentos se lee "4 dE 7", con la e a
 * media altura. Es el mismo gotcha que ya está documentado para las clases de glow en
 * `docs/GUIA.md`, sólo que aquí no se puede resolver eligiendo la clase a mano porque
 * el valor lo decide cada variable en tiempo de ejecución.
 */
const SOLO_CIFRAS = /^[\d\s.,:+\-/°%]*$/

/**
 * ¿Se puede escribir esto con siete segmentos? Lo usan todas las pantallas que
 * mezclan cifras puras con valores que traen letras ("4 de 7", "ESE").
 */
export const esCifra = (v: string) => SOLO_CIFRAS.test(v)

export function Kpi({ rotulo, valor, unidad, glow, color }: {
  rotulo: string; valor: string; unidad?: string; glow: string; color: string
}) {
  const cifra = SOLO_CIFRAS.test(valor)
  return (
    <div className="kpi">
      <div className="k">{rotulo}</div>
      <div
        className={cifra ? `v ${glow}` : 'v'}
        style={cifra ? undefined : { color, fontSize: 34, letterSpacing: 1 }}
      >
        {valor}
        {unidad && <span className="u" style={{ fontSize: 18, marginLeft: 4 }}>{unidad}</span>}
      </div>
    </div>
  )
}
