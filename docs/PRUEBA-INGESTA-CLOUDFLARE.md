# Ingesta HTTP en Cloudflare — análisis y prueba de concepto

> **Este es el punto que decide la viabilidad del proyecto "Todo con Cloudflare".**
> Aquí se analiza a fondo el problema y —lo importante— **cómo simularlo y
> validarlo AHORA, sin esperar al hardware**.
>
> Complementa [`PROYECTO-CLOUDFLARE.md`](PROYECTO-CLOUDFLARE.md).

---

## 1. El problema, en una frase

El WS2910 envía sus datos con un cliente HTTP **muy simple**: hace un `POST`
**por HTTP (sin TLS)**, `application/x-www-form-urlencoded`, a un **host + puerto
+ ruta**, y **no sigue redirecciones**. Cloudflare, por defecto, **fuerza HTTPS**
(responde `301` http→https). Como el WS2910 ni hace HTTPS ni sigue el `301`, el
dato **se perdería**. Todo depende de poder recibir ese POST en el borde **sin
redirección** y en un **puerto que Cloudflare acepte**.

---

## 2. ¿Qué se puede simular y qué no?

La buena noticia: **el 90 % del riesgo está en el lado de Cloudflare** (el
redirect y el puerto), y **eso sí se simula al 100 %** sin el hardware. Lo que no
se puede reproducir del todo son *quirks* del firmware, pero pesan poco.

| Parte | ¿Simulable sin hardware? | Cómo |
|-------|--------------------------|------|
| ¿Cloudflare redirige (301) el POST HTTP? | ✅ **Sí** | `curl`/probe HTTP plano sin seguir redirects |
| ¿El puerto (80/8080) llega al Worker? | ✅ **Sí** | probe al puerto exacto |
| ¿La regla de "no forzar HTTPS" funciona? | ✅ **Sí** | probar antes/después de la regla |
| ¿El Worker parsea bien el cuerpo Ecowitt? | ✅ **Sí** | enviar el mismo `form-urlencoded` |
| Quirks del firmware (keep-alive, chunked, timeouts) | ⚠️ **Parcial** | solo el WS2910 real lo confirma (≥ 17 jul) |

**Clave:** un cliente HTTP configurado como el WS2910 (HTTP plano, **sin** seguir
redirects, puerto fijo) es una réplica fiel para lo que importa. Si ese cliente
recibe `200`, el WS2910 casi con seguridad también.

> ⚠️ **Miniflare/local no sirve para esta prueba.** `wrangler dev` corre el Worker
> en `localhost` **sin** la capa de redirect/puertos de Cloudflare, que es
> justamente lo que hay que validar. La prueba **debe** ir contra Cloudflare real
> (un subdominio de prueba).

---

## 3. Prueba rápida (2 minutos, sin montar nada)

Revela **hoy** el comportamiento por defecto de tu dominio en Cloudflare. Desde
cualquier máquina:

```bash
# -v verboso, SIN -L (no seguir redirects, igual que el WS2910), http:// explícito
curl -v --max-time 15 -X POST 'http://clima.xe1e.net/data/report/' \
  -d 'tempf=71.6&humidity=55&baromrelin=29.92&winddir=210'
```

Interpretación:
- **`HTTP/1.1 301` / `Location: https://…`** → Cloudflare está forzando HTTPS.
  Es el problema esperado; se arregla con la regla del paso 4. **El WS2910 fallaría
  así.**
- **`HTTP/1.1 200`** (o lo que responda el origen) → no hay redirect en esa ruta;
  buena señal.
- **Timeout / conexión rechazada** → el puerto 80 no está llegando (revisar proxy).

> Nota: hoy `clima.xe1e.net` apunta al VPS por Cloudflare; esta prueba mide el
> **comportamiento del borde** (redirect/puerto), que es lo que nos interesa para
> el Worker.

### ✅ Resultado real ya medido (2026-07-09)
Ejecutando `python3 scripts/ws2910_probe.py http://clima.xe1e.net/health`, el
borde respondió:
```
<- HTTP 301 Moved Permanently
   Location: https://clima.xe1e.net/health
   Server: cloudflare
RESULTADO: [FALLA] redireccion 301 -> https://clima.xe1e.net/health
```
**Conclusión:** confirmado que hoy Cloudflare **fuerza HTTPS con un 301** en
todo el dominio. Un WS2910 fallaría al postar por HTTP. Por tanto, para la
ingesta directa a un Worker **habrá que crear la regla que exente esa ruta del
redirect** (paso 4) y volver a probar hasta obtener `200`. Es exactamente el
supuesto crítico del proyecto — y ya sabemos que hay que resolverlo, no es una
sorpresa futura.

---

## 4. Prueba de concepto completa (con un Worker de prueba)

Objetivo: demostrar de punta a punta que un POST HTTP plano llega a un Worker.

**Paso 1 — Worker mínimo de prueba** (`test-ingest/src/index.ts`):

```typescript
export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'POST') {
      const body = await req.text();
      console.log('INGESTA OK:', body.slice(0, 300));  // se ve con `wrangler tail`
      return new Response('OK', { status: 200 });
    }
    return new Response('ready', { status: 200 });
  },
};
```

`wrangler.toml`:
```toml
name = "test-ingest"
main = "src/index.ts"
compatibility_date = "2024-11-01"
[[routes]]
pattern = "estacion-test.xe1e.net/*"
zone_name = "xe1e.net"
```

```bash
wrangler deploy
wrangler tail          # logs en vivo, en otra terminal
```
(Crear el registro DNS `estacion-test` como **proxied** (nube naranja) en Cloudflare.)

**Paso 2 — Reproducir el problema (con "Always Use HTTPS" activo):**
```bash
curl -v --max-time 15 -X POST 'http://estacion-test.xe1e.net/data/report/' -d 'tempf=71.6'
# Esperado: 301 -> https  (el Worker NO se ejecuta; no aparece en wrangler tail)
```

**Paso 3 — Aplicar la regla y confirmar el arreglo:**
En Cloudflare → **Rules → Configuration Rules** (o Page Rules): para
`estacion-test.xe1e.net/data/report*` → **Automatic HTTPS Rewrites: Off** y, sobre
todo, evitar el redirect (desactivar "Always Use HTTPS" para esa ruta / no aplicar
el redirect). Luego:
```bash
curl -v --max-time 15 -X POST 'http://estacion-test.xe1e.net/data/report/' -d 'tempf=71.6&humidity=55'
# Éxito: HTTP/1.1 200 OK  y en `wrangler tail` aparece  INGESTA OK: tempf=71.6&humidity=55
```

**Paso 4 — Probar el puerto explícito y el "modo WS2910":**
```bash
curl -v -X POST 'http://estacion-test.xe1e.net:80/data/report/' -d 'tempf=71.6'
# (opcional) probar :8080 si piensas configurar ese puerto en la consola
```

### Criterios de éxito / fallo
- ✅ **Viable:** el `curl` sin `-L` recibe **200** y el Worker registra el cuerpo.
- ❌ **No viable (aún):** siempre **301**, o **conexión rechazada** en el puerto.
  → Ajustar la regla/puerto; si nada funciona, ir al **Plan B** (relay, §6).

---

## 5. Probe fiel al WS2910 (script)

`curl` sin `-L` ya imita lo esencial. Para una réplica aún más fiel (cliente
crudo que **no** sigue redirects, **no** hace TLS, cuerpo idéntico al Ecowitt),
usa el script incluido:

```bash
python3 scripts/ws2910_probe.py http://estacion-test.xe1e.net/data/report/
```
Envía los mismos campos que un WS2910 real (`tempf`, `humidity`, `baromrelin`,
`windspeedmph`, `winddir`, `dailyrainin`, `solarradiation`, `uv`, …) con
`http.client` (sin redirecciones, HTTP plano) y muestra **status + headers +
cuerpo** de la respuesta. Sirve contra el Worker de prueba, el VPS actual o
`localhost`.

Si `ws2910_probe.py` recibe **200**, es la mejor evidencia pre-hardware de que la
ingesta directa a Cloudflare funcionará.

---

## 6. Plan B si la ingesta directa no funciona

Si Cloudflare no dejara recibir el POST HTTP sin redirect (o el firmware diera
problemas), no se cae el proyecto; solo deja de ser "cero servidores puro":

- **Relay mínimo:** un componente muy pequeño (una función en cualquier host, o el
  propio receiver actual reducido) que **recibe el push HTTP** del WS2910 y lo
  **reenvía por HTTPS** al Worker de Cloudflare. Es ligero y estable.
- **Alternativa de red:** algunos usan el **puerto 8080** en la consola hacia
  Cloudflare con buenos resultados; por eso el paso 4 lo prueba.
- **Ecowitt.net → reenvío:** menos deseable (dependes del fabricante), pero existe.

El relay conserva el 95 % del beneficio (todo el proceso/almacenamiento/web en
Cloudflare) y es un "por si acaso".

---

## 7. Confianza y riesgo residual

- Si el **paso 3–5** dan **200** contra Cloudflare real → **confianza alta** (el
  edge acepta el POST HTTP sin redirect; el WS2910 es un cliente HTTP estándar).
- **Riesgo residual (bajo):** *quirks* del firmware del WS2910 (cómo maneja la
  respuesta, keep-alive, timeouts). Solo se confirma con el **hardware real
  (≥ 17 jul)**, pero es el 10 % restante, no el corazón del riesgo.

**Recomendación:** hacer el **paso 3** (prueba rápida) cuanto antes para ver el
redirect por defecto, y montar el **Worker de prueba (paso 1–5)** cuando entres a
Cloudflare. Con eso decidimos la viabilidad **antes** de invertir en migrar la
base y la lógica.
