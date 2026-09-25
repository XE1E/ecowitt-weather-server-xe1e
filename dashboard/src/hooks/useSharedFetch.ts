import { useEffect, useSyncExternalStore } from 'react'

/**
 * JSON de una URL, compartido entre todos los componentes que la piden y
 * refrescado cada `intervalMs` (0 = una sola vez).
 *
 * Por qué existe: varias tarjetas de la misma página pedían lo mismo por su cuenta
 * (p. ej. /api/alerts dos veces por minuto en Inicio, IMECA dos veces), y ninguna
 * consulta periódica se pausaba con la pestaña en segundo plano. Aquí:
 *   - una sola petición por URL, la use quien la use;
 *   - si varios la piden con distinto intervalo, manda el más corto;
 *   - con la pestaña oculta no se consulta; al volver, se refresca lo vencido.
 * Si una consulta falla se conserva el último dato bueno.
 */
type Entry = {
  data: unknown
  ts: number              // última respuesta buena (0 = nunca)
  intervals: Map<symbol, number>
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  inflight: boolean
}

const store = new Map<string, Entry>()
const ONCE_MAX_AGE_MS = 5 * 60 * 1000

function entry(url: string): Entry {
  let e = store.get(url)
  if (!e) {
    e = { data: null, ts: 0, intervals: new Map(), listeners: new Set(), timer: null, inflight: false }
    store.set(url, e)
  }
  return e
}

function refresh(url: string, e: Entry) {
  if (e.inflight) return
  e.inflight = true
  fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j !== null) {
        e.data = j
        e.ts = Date.now()
        e.listeners.forEach((l) => l())
      }
    })
    .catch(() => { /* se queda el último dato bueno */ })
    .finally(() => { e.inflight = false })
}

function period(e: Entry): number {
  const vals = [...e.intervals.values()].filter((v) => v > 0)
  return vals.length ? Math.min(...vals) : 0
}

function schedule(url: string, e: Entry) {
  if (e.timer) clearInterval(e.timer)
  e.timer = null
  const ms = period(e)
  if (ms > 0 && e.intervals.size > 0 && !document.hidden) {
    e.timer = setInterval(() => refresh(url, e), ms)
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    for (const [url, e] of store) {
      if (e.intervals.size === 0) continue
      schedule(url, e)
      const ms = period(e)
      if (!document.hidden && ms > 0 && Date.now() - e.ts >= ms) refresh(url, e)
    }
  })
}

export function useSharedFetch<T>(url: string | null, intervalMs = 0): T | null {
  const e = url ? entry(url) : null
  const data = useSyncExternalStore(
    (cb) => {
      if (!e) return () => {}
      e.listeners.add(cb)
      return () => { e.listeners.delete(cb) }
    },
    () => (e ? (e.data as T | null) : null),
  )

  useEffect(() => {
    if (!url || !e) return
    const id = Symbol(url)
    e.intervals.set(id, intervalMs)
    const ms = period(e)
    // Primera vez, o dato más viejo que el intervalo (o que 5 min, si nadie pide
    // refresco periódico): pedirlo ya.
    if (e.ts === 0 || Date.now() - e.ts >= (ms > 0 ? ms : ONCE_MAX_AGE_MS)) refresh(url, e)
    schedule(url, e)
    return () => {
      e.intervals.delete(id)
      schedule(url, e)
    }
  }, [url, intervalMs, e])

  return data
}
