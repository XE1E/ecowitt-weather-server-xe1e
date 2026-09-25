import { lazy, type ComponentType } from 'react'

/**
 * `React.lazy` para una página exportada con nombre (`export function XPage`).
 *
 * Si el archivo de la página ya no existe --pasa cuando alguien tiene el sitio
 * abierto durante un deploy: el HTML viejo apunta a archivos con hash que el deploy
 * borró-- se recarga la página UNA vez para traer la versión nueva, en lugar de
 * dejar la pantalla en blanco. La marca en sessionStorage evita un bucle si el
 * error fuera otro.
 */
export function lazyPage<T extends Record<string, unknown>>(
  load: () => Promise<T>,
  name: keyof T,
) {
  return lazy(async () => {
    try {
      const mod = await load()
      try { sessionStorage.removeItem('chunk-reload') } catch { /* sin storage */ }
      return { default: mod[name] as ComponentType }
    } catch (err) {
      let yaRecargo = false
      try { yaRecargo = sessionStorage.getItem('chunk-reload') === '1' } catch { /* sin storage */ }
      if (!yaRecargo) {
        try { sessionStorage.setItem('chunk-reload', '1') } catch { /* sin storage */ }
        window.location.reload()
      }
      throw err
    }
  })
}
