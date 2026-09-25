/**
 * Corre `fn` ya y luego cada `ms`, pero NO mientras la pestaña esté oculta; al
 * volver a ella, si ya se pasó el intervalo, corre de inmediato. Devuelve la función
 * de limpieza para el `useEffect`.
 *
 * Antes las consultas periódicas seguían con la pestaña en segundo plano (la
 * portada: ~11 por minuto por pestaña, aunque nadie la viera). El navegador del
 * kiosco nunca oculta la pestaña, así que ahí nada cambia.
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  let last = Date.now()
  const run = () => { last = Date.now(); fn() }
  fn()
  const id = setInterval(() => { if (!document.hidden) run() }, ms)
  const onVis = () => { if (!document.hidden && Date.now() - last >= ms) run() }
  document.addEventListener('visibilitychange', onVis)
  return () => {
    clearInterval(id)
    document.removeEventListener('visibilitychange', onVis)
  }
}
