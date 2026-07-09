/**
 * Monitor de uptime externo para clima.xe1e.net
 *
 * Corre en Cloudflare (fuera del VPS), así que detecta caídas del propio
 * servidor —algo que el vigilante interno de la estación no puede—. Cada pocos
 * minutos (cron) hace ping a /health y, si cambia el estado, avisa por Telegram
 * (una vez al caer y otra al recuperarse). El estado se guarda en KV.
 *
 * Variables (wrangler.toml [vars]):   TARGET_URL
 * Secretos (wrangler secret put ...):  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * KV binding:                          UPTIME
 */

const TIMEOUT_MS = 15000;

async function fetchHealth(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: { "user-agent": "clima-xe1e-uptime/1.0" },
    });
    return res.status === 200;
  } catch (_e) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function notify(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
  } catch (_e) {
    /* no romper el monitor por un fallo de notificación */
  }
}

async function runCheck(env) {
  const url = env.TARGET_URL || "https://clima.xe1e.net/health";
  const ok = await fetchHealth(url);
  const now = ok ? "up" : "down";
  const prev = await env.UPTIME.get("state");

  if (prev === now) return { changed: false, now };

  await env.UPTIME.put("state", now);
  await env.UPTIME.put("since", new Date().toISOString());

  // No avisar en el primer arranque (prev === null): solo registrar el estado.
  if (prev !== null) {
    await notify(
      env,
      ok
        ? "✅ clima.xe1e.net volvió a responder (monitor externo)."
        : "🔴 clima.xe1e.net no responde. El servidor podría estar caído (monitor externo)."
    );
  }
  return { changed: true, now };
}

export default {
  // Disparo por cron
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },
  // Acceso manual: muestra el estado y permite forzar una comprobación con ?check
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.searchParams.has("check")) {
      const r = await runCheck(env);
      return Response.json(r);
    }
    const state = (await env.UPTIME.get("state")) || "desconocido";
    const since = (await env.UPTIME.get("since")) || "—";
    return Response.json({ target: env.TARGET_URL, state, since });
  },
};
