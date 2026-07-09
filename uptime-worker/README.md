# Monitor de uptime externo (Cloudflare Worker)

Vigila `clima.xe1e.net` **desde fuera del VPS**. Si el servidor se cae por
completo, el vigilante interno de la estación no puede avisar (está caído con
él); este Worker corre en la red de Cloudflare y sí lo detecta.

Cada 5 minutos hace `GET /health`. Cuando el estado cambia, manda un aviso por
**Telegram** (uno al caer, otro al recuperarse). Guarda el estado en **KV** para
no repetir avisos.

## Requisitos
- Cuenta de Cloudflare (la misma del dominio).
- Node.js y `wrangler` (`npm i -g wrangler`), o usar `npx wrangler`.
- El bot de Telegram ya creado (token + chat id). Ver `docs/MEJORAS.md`.

## Despliegue (una vez)

```bash
cd uptime-worker
wrangler login

# 1) Crear el namespace KV y copiar el id que imprime
wrangler kv namespace create UPTIME
#   -> pega el id en wrangler.toml (kv_namespaces.id)

# 2) Cargar los secretos de Telegram
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID

# 3) Publicar
wrangler deploy
```

Listo: el cron queda activo cada 5 min.

## Comprobar

- Estado actual:  abre la URL del Worker (te la da `wrangler deploy`).
- Forzar una comprobación ahora:  `https://<tu-worker>.workers.dev/?check`

## Ajustes
- **Frecuencia:** edita `crons` en `wrangler.toml` (p. ej. `*/2 * * * *`).
- **Destino:** cambia `TARGET_URL` (por defecto `/health`).

> Alternativa sin código: servicios como UptimeRobot también sirven, pero este
> Worker reutiliza tu Telegram y no depende de terceros.
