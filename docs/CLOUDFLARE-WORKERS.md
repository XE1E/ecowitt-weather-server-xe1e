# Cloudflare Workers — opciones para el proyecto

Notas sobre cómo Cloudflare Workers podría usarse en este proyecto, desde
usos incrementales (sumar al stack actual) hasta la pregunta grande: **¿se puede
tener TODO en Cloudflare, sin VPS?**

> **Qué son:** funciones serverless (JS/TS) que corren en el edge de Cloudflare.
> Free tier generoso: ~100,000 peticiones/día, **Cron Triggers**, y almacenamiento
> gratis (**KV**, **D1** = SQLite en el edge, **R2** = objetos). *Verificar límites
> vigentes en la consola de Cloudflare, cambian con el tiempo.*

---

## 1. Usos incrementales (suman al stack actual del VPS)

| Uso | Qué haría | Valor |
|-----|-----------|-------|
| **A. Monitor de uptime + alerta** | Cron Worker revisa `https://clima.xe1e.net/health` cada X min y avisa (Telegram/email) si el servidor se cae | 🔴 Alto (vigilancia externa e independiente del VPS) |
| **B. Snapshot público en caché** | Worker + KV guarda el último dato y lo sirve rapidísimo aunque el VPS esté caído | 🟠 Bueno |
| **C. Proxy/caché de la API** | Worker delante de `/api/*` para cachear y proteger el VPS | 🟢 Menor (el VPS va sobrado) |

Estos **no requieren cambiar nada** del stack actual; se añaden al lado.

---

## 2. ¿Se puede tener TODO en Cloudflare (sin VPS)?

**Sí, es viable.** Mapeo componente por componente:

| Componente actual (VPS) | Equivalente 100% Cloudflare |
|-------------------------|------------------------------|
| Receiver FastAPI (`/data/report`) | **Worker** con una ruta que recibe el push |
| InfluxDB (histórico) | **D1** (SQLite en el edge) |
| API REST (`/api/current`, `/history`, `/stats`) | **Worker** con rutas `/api/*` leyendo D1 |
| Dashboard React (nginx) | **Cloudflare Pages** (hosting estático) |
| Alertas + Telegram | **Worker** (en la ingesta o por Cron) |
| Tareas periódicas | **Cron Triggers** |
| Reverse proxy + HTTPS (Caddy) | Nativo de Cloudflare (ya lo hace) |

Resultado: **cero servidores, $0, cero mantenimiento**, sin sustos de reclamación
por inactividad ni de capacidad ARM.

### ⚠️ El gran matiz: la ingesta HTTP del Ecowitt
Es el único punto delicado y hay que validarlo con el hardware real:

- El WS2910 **solo habla HTTP (no HTTPS)** y postea al servidor "Customized"
  (protocolo Ecowitt, `POST` form-urlencoded).
- Cloudflare **sí** puede recibir en el puerto **80** y enrutar a un Worker
  (`clima.xe1e.net/data/report*`).
- **Pero** el edge suele forzar HTTPS ("Always Use HTTPS" → redirección 301),
  y el Ecowitt **no sigue redirecciones ni hace TLS**. Habría que **desactivar
  esa redirección para la ruta de ingesta** (Configuration/Page Rule) para que el
  push HTTP llegue al Worker sin redirigir.
- Esto **funciona en teoría**, pero conviene **probarlo con el WS2910** antes de
  confiar en ello (algunos reportan que el Ecowitt hacia Cloudflare en :80 va bien,
  otros tienen problemas).

### Detalles de almacenamiento (límites free)
- **D1** encaja perfecto: 1 estación cada 60s ≈ **1,440 filas/día**, muy por debajo
  de los límites de escritura de D1. Historial y consultas: sin problema.
- **KV** NO sirve para escribir cada lectura: su free tier limita ~1,000 escrituras/día
  y tendríamos ~1,440. KV solo para un "último snapshot" ocasional, no por-push.

### Pros y contras del "todo Cloudflare"
**A favor:**
- 💸 $0 y **sin servidores que mantener** (ni parches, ni reboots, ni backups de VM).
- 🌍 Rápido y global (edge), alta disponibilidad.
- 🛡️ Sin reclamación por inactividad, sin límites de capacidad ARM.

**En contra:**
- 🔁 Es **reescribir** el receiver (Python→Worker JS) y el almacén (InfluxDB→D1),
  y mover el dashboard a Pages.
- 🧪 La ingesta HTTP de Ecowitt hay que **validarla** (el matiz de arriba).
- 📉 Se pierden comodidades de InfluxDB (retención/downsampling automáticos), que
  a esta escala se resuelven fácil en D1.
- 🗑️ Renunciar al stack del VPS que **ya funciona**.

---

## 3. Recomendación

- **Ahora:** quedarnos con el VPS (ya está desplegado y funcionando) y **sumar el
  Worker A (uptime + alerta Telegram)** — alto valor, cero riesgo, y buen ejercicio
  para aprender Workers/Cron.
- **Futuro / experimento:** montar una **versión paralela "todo Cloudflare"**
  (Worker + D1 + Pages) como laboratorio, **sin apagar** el VPS. Cuando llegue el
  WS2910, se puede probar apuntando el push a la ruta del Worker en :80 y validar
  la ingesta. Si convence, se migra; si no, no se pierde nada.

> Idea práctica: el WS2910 tiene **un solo** servidor "Customized", así que para
> comparar VPS vs Cloudflare en paralelo, lo más simple es alternar el destino del
> push, o usar un pequeño reenvío. No se pueden alimentar ambos a la vez de forma
> nativa.
