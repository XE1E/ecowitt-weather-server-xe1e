// Service worker de la Estación XE1E — habilita instalación (PWA) y uso offline.
// Estrategia:
//   - HTML / navegaciones: RED PRIMERO (siempre la última versión tras un deploy),
//     con respaldo a caché si no hay conexión.
//   - Recursos con hash (JS/CSS/íconos): caché al instante + refresco en segundo
//     plano (stale-while-revalidate).
//   - API y orígenes externos: siempre a la red.
const CACHE = 'clima-xe1e-v2';
const SHELL = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/data')) return;

  const isHTML =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  // HTML: red primero -> siempre ves el último deploy; caché solo como respaldo offline
  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Recursos: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
