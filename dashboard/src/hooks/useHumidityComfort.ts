import { useRef } from 'react'
import { HUMIDITY_COMFORT_BANDS, type HumidityComfortBand, type HumidityComfortKind } from '../weather'

/**
 * Como un termostato: sin esta holgura, una lectura que ronda justo un corte (p.
 * ej. 60-61% de humedad, oscilando por ruido del sensor) haría que la carita
 * parpadeara entre dos categorías en cada actualización. Con 1 punto de margen,
 * hay que alejarse del corte esa cantidad para SUBIR de categoría, y alejarse
 * la misma cantidad por el otro lado para volver a bajar.
 */
const HYSTERESIS = 1

/**
 * Categoría de confort de humedad con histéresis, para EXTERIOR/JARDÍN e INTERIOR
 * de la consola (ver tablas en `HUMIDITY_COMFORT_BANDS`, `weather.ts`). El estado
 * (última categoría mostrada) vive en un `useRef` propio de cada llamada al hook,
 * así que EXTERIOR, INTERIOR y JARDÍN --tres llamadas en el mismo componente-- no
 * se pisan entre sí.
 */
export function useHumidityComfort(
  rh: number | null | undefined,
  kind: HumidityComfortKind
): HumidityComfortBand | null {
  const bands = HUMIDITY_COMFORT_BANDS[kind]
  const edges = bands.slice(0, -1).map((b) => b.max)
  const lastIndex = useRef<number | null>(null)

  if (rh == null) return null

  const raw = bands.findIndex((b) => rh < b.max)
  let idx = lastIndex.current
  if (idx == null) {
    idx = raw
  } else if (raw > idx) {
    while (idx < raw && rh >= edges[idx] + HYSTERESIS) idx++
  } else if (raw < idx) {
    while (idx > raw && rh <= edges[idx - 1] - HYSTERESIS) idx--
  }
  lastIndex.current = idx

  return bands[idx]
}
