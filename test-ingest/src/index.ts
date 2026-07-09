/**
 * Worker de PRUEBA para validar la ingesta HTTP del WS2910 hacia Cloudflare.
 *
 * No guarda nada permanente: registra lo recibido (visible con `wrangler tail`)
 * y responde 200 en texto plano (lo que el WS2910 espera). Un GET muestra el
 * estado y el último POST recibido, para verificar desde el navegador.
 *
 * El objetivo es UNO: comprobar que un POST HTTP plano (sin TLS, sin seguir
 * redirects) LLEGA a este Worker con 200 — y no un 301 http->https.
 */

// Estado en memoria (best-effort dentro del mismo isolate; suficiente para probar)
let last: { at: string; path: string; ct: string | null; body: string } | null = null;

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'POST') {
      const ct = req.headers.get('content-type');
      const body = await req.text();
      last = { at: new Date().toISOString(), path: url.pathname, ct, body: body.slice(0, 1000) };
      // Aparece en `wrangler tail`
      console.log('INGESTA OK', url.pathname, '| CT:', ct, '| body:', body.slice(0, 500));
      return new Response('OK\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    // GET -> estado (útil para ver desde el navegador si el Worker se ejecutó)
    const info = {
      worker: 'estacion-test-ingest',
      hint: 'Haz un POST a /data/report/ (HTTP) para simular el push del WS2910.',
      // Si ves esto, la petición LLEGÓ al Worker (no te redirigieron):
      protocolo_visto_por_el_worker: url.protocol, // 'http:' o 'https:'
      ruta: url.pathname,
      ultimo_post_recibido: last,
    };
    return new Response(JSON.stringify(info, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
