// Ciclones tropicales (NHC · NOAA) — tipos y utilidades compartidas entre la
// página /ciclones, el aviso de Inicio y la pestaña del cintillo.
import { useSharedFetch } from '../../hooks/useSharedFetch'

export type Nivel = 'alta' | 'media' | 'baja'

export interface CicloneLugar { km_costa: number; lugar: string; horas?: number; hora?: string | null; sobre_tierra?: boolean }

export interface CiclonPunto {
  horas: number; valido: string | null; lat: number; lon: number
  viento_kt: number | null; racha_kt: number | null
}

export interface Ciclon {
  id: string; nombre: string; clase: string; tipo: string; categoria: number | null
  cuenca: 'al' | 'ep' | 'cp'; oceano: string
  viento_kt: number | null; viento_kmh: number | null; presion_mb: number | null
  lat: number; lon: number
  movimiento: { rumbo_deg: number | null; rumbo: string | null; kmh: number | null }
  actualizado: string | null; aviso_num: string | null; aviso_url: string | null; graficas_url: string | null
  avisos_costeros: boolean; km_estacion: number
  pronostico: CiclonPunto[]
  ahora: CicloneLugar; acercamiento: CicloneLugar
  toca_tierra: { horas: number; lugar: string; hora?: string | null } | null
  nivel: Nivel
  imagenes: { cono: string | null; mensajes: string | null }
  avisos: CiclonAvisos
  probabilidades: CiclonProb[]
}

export interface CiclonAvisos {
  vigentes: { tipo: string; grado: 'aviso' | 'vigilancia'; tipo_en: string; zonas: { zona: string; zona_en: string; mexico: boolean }[] }[]
  notas: { texto: string; mexico: boolean | null }[]
  mexico: 'aviso' | 'vigilancia' | null
}

/** Probabilidad acumulada a 5 días de vientos ≥ 34/50/64 kt (63/93/119 km/h). */
export interface CiclonProb { lugar: string; mexico: boolean; p34: number; p50: number; p64: number }

export interface CiclonMapa {
  tormentas: { id: string; cono: [number, number][][]; avisos: { clave: string; tipo: string; coords: [number, number][] }[] }[]
}

export interface CiclonSat {
  cuadros: { hora: string; url: string }[]; grande?: string; satelite?: string | null; pagina?: string
}

export interface Temporada {
  anio: number; desde: string | null
  pacifico: { total: number; tormentas: number; huracanes: number; mayores: number }
  atlantico: { total: number; tormentas: number; huracanes: number; mayores: number }
  tormentas: {
    id: string; nombre: string; cuenca: string; primera: string; ultima: string
    max_kt?: number; max_tipo?: string; max_categoria?: number | null; min_mb?: number
    nivel_max?: Nivel; toco_tierra?: string
  }[]
}

/** Colores del NHC para vigilancias/avisos costeros. */
export const COLOR_AVISO: Record<string, string> = {
  HWR: '#ef4444', HWA: '#f472b6', TWR: '#3b82f6', TWA: '#facc15',
}

export interface CiclonesData {
  fuente: string; actualizado: string; tormentas: Ciclon[]; amenaza: Nivel | null; stale: boolean
}

/** Una sola consulta cada 10 min, compartida por cintillo, Inicio y la página. */
export function useCiclones(): CiclonesData | null {
  return useSharedFetch<CiclonesData>('/api/ciclones', 600000)
}

/** Color por intensidad (escala Saffir-Simpson y abajo). */
export function colorCiclon(c: Pick<Ciclon, 'clase' | 'categoria'>): string {
  if (c.categoria) return ['#facc15', '#fb923c', '#f87171', '#e11d48', '#c026d3'][c.categoria - 1]
  if (c.clase === 'TS' || c.clase === 'STS' || c.clase === 'SS') return '#34d399'
  if (c.clase === 'TD' || c.clase === 'STD' || c.clase === 'SD') return '#38bdf8'
  return '#94a3b8'
}

export function etiquetaCiclon(c: Pick<Ciclon, 'tipo' | 'categoria'>): string {
  return c.categoria ? `${c.tipo} cat. ${c.categoria}` : c.tipo
}

export function categoriaDeKt(kt: number | null): number | null {
  if (kt == null || kt < 64) return null
  return kt <= 82 ? 1 : kt <= 95 ? 2 : kt <= 112 ? 3 : kt <= 136 ? 4 : 5
}

export const NIVEL_TXT: Record<Nivel, string> = {
  alta: 'Amenaza para México', media: 'Vigilar: se acerca a México', baja: 'Lejos de México',
}

/** "vie 26 sep, 18:00" en hora local del visitante. */
export function fmtHora(iso?: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** Frase corta con lo que importa para México. */
export function fraseAmenaza(c: Ciclon): string {
  if (c.ahora.sobre_tierra) return `Está sobre territorio mexicano, cerca de ${c.ahora.lugar}.`
  if (c.toca_tierra) {
    const cuando = c.toca_tierra.hora ? ` hacia el ${fmtHora(c.toca_tierra.hora)}` : ''
    return `El pronóstico lo lleva a tocar tierra cerca de ${c.toca_tierra.lugar}${cuando}.`
  }
  const a = c.acercamiento
  if (c.nivel === 'baja') {
    // Lejos: dar el lugar "más cercano" a 4,000 km (p. ej. Tijuana para una
    // tormenta junto a Hawái) confunde más de lo que informa.
    return a.km_costa > 1500
      ? `Lejos de México: a más de ${(Math.floor(a.km_costa / 100) * 100).toLocaleString('es-MX')} km de su costa.`
      : `Lejos de México: el pronóstico no lo acerca a menos de ${a.km_costa.toLocaleString('es-MX')} km de la costa (${a.lugar}).`
  }
  if (a.horas && a.km_costa < c.ahora.km_costa) {
    const cuando = a.hora ? ` hacia el ${fmtHora(a.hora)}` : ''
    return `Se pronostica que pase a unos ${a.km_costa.toLocaleString('es-MX')} km de ${a.lugar}${cuando}.`
  }
  return `A unos ${c.ahora.km_costa.toLocaleString('es-MX')} km de ${c.ahora.lugar}; el pronóstico no lo acerca más.`
}

// Temporadas oficiales: Pacífico oriental 15 may–30 nov, Atlántico 1 jun–30 nov.
export function enTemporada(cuenca: 'ep' | 'al', d = new Date()): boolean {
  const m = d.getMonth() + 1, day = d.getDate()
  if (m === 12 || m < 5) return false
  if (m === 5) return cuenca === 'ep' && day >= 15
  return true
}

export const SMN_AVISO: Record<string, string> = {
  ep: 'https://smn.conagua.gob.mx/es/pronosticos/avisos/aviso-de-ciclon-tropical-en-el-oceano-pacifico',
  cp: 'https://smn.conagua.gob.mx/es/pronosticos/avisos/aviso-de-ciclon-tropical-en-el-oceano-pacifico',
  al: 'https://smn.conagua.gob.mx/es/pronosticos/avisos/aviso-de-ciclon-tropical-en-el-oceano-atlantico',
}
