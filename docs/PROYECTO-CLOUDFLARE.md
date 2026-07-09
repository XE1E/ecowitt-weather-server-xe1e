# Proyecto "Todo con Cloudflare" — estudio, análisis y plan

> Documento de estudio para migrar la estación a una arquitectura **100 %
> serverless en Cloudflare**, sin VPS ni ningún externo. Pensado para leerse con
> calma: visión, servicios, arquitectura, el reto de los datos, la ingesta del
> Ecowitt, límites/costos, stack, plan por fases, riesgos y recursos.
>
> Es un **laboratorio paralelo**: el stack actual (VPS: FastAPI + InfluxDB +
> React) sigue funcionando; esto se construye al lado y solo se "cambia el
> switch" cuando esté validado.
>
> Documento vivo — se irá afinando. Última revisión: 2026-07-09.

---

## Índice
1. [Visión y objetivo](#1-visión-y-objetivo)
2. [Por qué Cloudflare (beneficios y trade-offs)](#2-por-qué-cloudflare)
3. [Panorama de servicios Cloudflare](#3-panorama-de-servicios-cloudflare)
4. [Arquitectura objetivo](#4-arquitectura-objetivo)
5. [Mapeo pieza por pieza](#5-mapeo-pieza-por-pieza)
6. [El reto de los datos (series temporales)](#6-el-reto-de-los-datos)
7. [La ingesta del WS2910](#7-la-ingesta-del-ws2910)
8. [Límites y costos (free tier)](#8-límites-y-costos)
9. [Stack técnico recomendado](#9-stack-técnico-recomendado)
10. [Plan por fases](#10-plan-por-fases)
11. [Seguridad](#11-seguridad)
12. [Observabilidad y depuración](#12-observabilidad-y-depuración)
13. [Riesgos, límites y mitigaciones](#13-riesgos-límites-y-mitigaciones)
14. [Preguntas abiertas a validar](#14-preguntas-abiertas-a-validar)
15. [Recursos oficiales](#15-recursos-oficiales)
16. [Glosario](#16-glosario)

---

## 1. Visión y objetivo

Tener **toda la estación corriendo en la red de Cloudflare**: ingesta del sensor,
base de datos, API, procesamiento, alertas, tareas programadas y el sitio web —
**sin servidor propio (VPS) ni dependencias externas**.

Meta concreta:
- **Cero servidores que mantener** (nada de SSH, Docker, parches, reinicios).
- **Cero (o casi) costo** dentro de la capa gratuita.
- **Sin sustos** de reclamación por inactividad ni de capacidad de shapes ARM.
- **Escala y disponibilidad global** de fábrica (edge).

No-objetivos (por ahora): reemplazar Home Assistant, ni la telemetría avanzada.

---

## 2. Por qué Cloudflare

**A favor**
- Modelo *serverless* real: no hay proceso que vigilar; se ejecuta por evento.
- Free tier generoso y suficiente para **una estación** (ver §8).
- HTTPS, CDN, DNS y protección ya incluidos (el dominio ya está en Cloudflare).
- Todo se despliega con `wrangler` + Git (infra como código).

**En contra / a considerar**
- **Sin proceso persistente**: todo es *event-driven* (peticiones + cron). No hay
  un "servidor corriendo" con estado en memoria. El estado va a KV/D1/DO.
- **No es InfluxDB**: hay que resolver el almacenamiento de series temporales con
  D1/Analytics Engine/R2 (ver §6).
- **Límites de CPU por invocación** y de I/O a D1 (ver §8).
- **Vendor lock-in**: quedas atado a las APIs de Cloudflare (Workers, D1, etc.).
- Algunas piezas "premium" (**Durable Objects**, **Queues**) requieren el plan
  **Workers Paid ($5/mes)**; el núcleo del proyecto se puede hacer sin ellas.

---

## 3. Panorama de servicios Cloudflare

| Servicio | Qué es | Uso en la estación |
|----------|--------|--------------------|
| **Workers** | Funciones JS/TS en el edge, por evento | El "cerebro": ingesta `/data/report`, API `/api/*`, procesamiento |
| **Pages** | Hosting de sitios estáticos + funciones | El dashboard React (reemplaza nginx) |
| **D1** | SQLite serverless (SQL) | Base de datos: lecturas, resúmenes diarios, récords |
| **KV** | Clave-valor, lecturas ultrarrápidas, consistencia eventual | Último dato, config editable, estado de alertas |
| **R2** | Almacenamiento de objetos (tipo S3), sin egreso | Backups, archivado de crudo a largo plazo, blobs |
| **Durable Objects** | Objeto con estado + coordinación (1 instancia global) | *Opcional*: watchdog con estado, WebSockets en vivo, contadores exactos. **Requiere plan pago** |
| **Cron Triggers** | Ejecutar un Worker en horario (cron) | Resumen diario (Dayfile), watchdog, uploaders, limpieza |
| **Queues** | Colas de mensajes | *Opcional*: desacoplar ingesta de procesamiento. **Requiere plan pago** |
| **Analytics Engine** | Almacén de series/eventos de alta cardinalidad, consulta SQL | *Alternativa* para series temporales de alta frecuencia (gráficas) |
| **Workers AI / Vectorize** | IA en el edge | *Futuro*: resúmenes en lenguaje natural, detección de anomalías |
| **Email Routing / Email Workers** | Enviar/recibir correo | Alertas por email (además de Telegram) |
| **Zero Trust / Access** | Autenticación delante de rutas | Proteger el panel admin sin implementar login |
| **Turnstile** | CAPTCHA sin fricción | Proteger formularios públicos si los hubiera |
| **Cache / Rules** | CDN y reglas de tráfico | Cachear la API pública; exentar del redirect la ruta de ingesta |

---

## 4. Arquitectura objetivo

```
   WS2910  ──HTTP POST /data/report/──►  Cloudflare edge (sin redirect en esa ruta)
                                              │
                                     ┌────────▼─────────┐
                                     │  Worker ingesta   │  parsea Ecowitt →
                                     │  (calibra, QC,    │  escribe en D1 + KV(último)
                                     │   deriva, alerta) │  → Telegram / uploaders
                                     └────────┬──────────┘
                                              │
   Navegador ──►  Pages (dashboard React)  ──►  Worker API /api/*  ──►  D1 / KV / R2
                                              ▲
                                   Cron Triggers ──► Worker tareas:
                                     - Dayfile (resumen diario)
                                     - watchdog (estación caída)
                                     - backups a R2
                                     - uploaders a redes públicas
```

Todo dentro de Cloudflare. El único actor externo es el **WS2910** enviando por
HTTP, y las **APIs externas** que consultamos (Open-Meteo, USGS, WAQI…) que se
llaman desde el Worker.

---

## 5. Mapeo pieza por pieza

| Componente actual (VPS) | Equivalente Cloudflare | Dificultad | Notas |
|-------------------------|------------------------|------------|-------|
| Dashboard React (nginx) | **Pages** | 🟢 Fácil | Casi tal cual; `wrangler pages deploy dist` |
| API `/api/*` (FastAPI) | **Worker** (Hono) | 🟠 Media | Reescribir endpoints en TS |
| Ingesta `/data/report` | **Worker** ruta HTTP | 🟠 Media | + el tema del redirect (§7) |
| InfluxDB (histórico) | **D1** (+ R2 archivado) | 🔴 Alta | Rediseñar el modelo de datos (§6) |
| Procesamiento (QC/calib/derivadas) | **Worker** (lib TS) | 🟠 Media | Portar la lógica de Python a TS |
| Dayfile / récords / NOAA | **Worker + Cron** + D1 | 🟠 Media | SQL en vez de Flux |
| Alertas + Telegram | **Worker** (ingesta o cron) | 🟢 Fácil | `fetch` a Telegram |
| Uploaders (WU/PWS/Windy/OWM/CWOP) | **Worker + Cron** | 🟠 Media | CWOP usa TCP/APRS → complejo en Worker |
| Config editable (panel) | **KV** + Worker | 🟢 Fácil | JSON en KV |
| Panel admin (login) | **Cloudflare Access** | 🟢 Fácil | Delegar auth a Cloudflare |
| Backups | **R2** + Cron | 🟢 Fácil | Export D1 → R2 |
| HTTPS / proxy (Caddy) | **Nativo** | 🟢 | Ya lo hace |
| MQTT / Home Assistant | ⚠️ **Fuera de Cloudflare** | — | HA seguiría leyendo la API por REST; MQTT no encaja en el edge |

> **Punto flojo:** **CWOP** (APRS) necesita una conexión **TCP** saliente, que los
> Workers no hacen igual que un servidor. Y **MQTT** tampoco encaja. Si esas dos
> son importantes, quizá convenga un pequeño relay o mantenerlas fuera.

---

## 6. El reto de los datos

InfluxDB es una base **de series temporales**; Cloudflare no tiene un equivalente
directo. Tres opciones, combinables:

### Opción A — D1 (SQLite)  ✅ recomendada como base
- Tabla `readings(ts, field, value)` o `readings(ts, temp, hum, wind, …)` (columnas).
- Tabla `daily(date, temp_min, temp_max, …)` para el Dayfile (igual que hoy).
- **Pros:** SQL familiar, transaccional, perfecto para récords/climatología.
- **Contras:** no está optimizada para millones de puntos ni *downsampling*
  automático; hay que hacer *housekeeping* (borrar/mover crudo viejo).
- **Volumen real:** 1 lectura/min = **1,440 filas/día ≈ 525k/año**. Muy manejable
  en D1 si archivamos el crudo > N meses a R2 y conservamos los `daily`.

### Opción B — Analytics Engine (series de alta frecuencia)
- Diseñado para escribir muchísimos *data points* y consultarlos con SQL (API).
- **Pros:** ideal para gráficas de alta resolución sin llenar D1; muestreo integrado.
- **Contras:** modelo distinto (blobs/doubles + índices), retención limitada,
  menos "relacional".
- **Uso:** las **gráficas** en vivo/históricas; D1 para récords y agregados.

### Opción C — R2 (archivo frío)
- Guardar el crudo por día/mes en **NDJSON o Parquet** para retención larga y
  backups. Se consulta puntualmente (descarga), no en caliente.

### Recomendación
**Híbrido:** **D1** como base (últimos ~90 días de crudo + todos los `daily`
resúmenes + récords) y **R2** para archivar el crudo antiguo. Evaluar **Analytics
Engine** si queremos gráficas de muy alta resolución. Un Cron de "compactación"
diaria genera el `daily`, mueve crudo viejo a R2 y purga D1.

---

## 7. La ingesta del WS2910

El punto más delicado (limitación del hardware, no de Cloudflare):

- El WS2910 postea **solo por HTTP (sin TLS)**, form-urlencoded, a un
  **host + puerto + ruta**, y **no sigue redirecciones**.
- Cloudflare **sí** recibe HTTP en el **borde** y puede enrutar a un Worker.
- **Pero** por defecto *"Always Use HTTPS"* responde **301 http→https**, y el
  Ecowitt ni hace HTTPS ni sigue el redirect → el POST se perdería.

**Requisitos para que funcione directo a un Worker:**
1. **Puerto compatible** con el proxy de Cloudflare: HTTP en **80, 8080, 8880,
   2052, 2082, 2086, 2095** (el WS2910 permite fijar el puerto).
2. **Exentar del redirect** la ruta de ingesta: una **Configuration Rule /
   Redirect Rule** que desactive "Always Use HTTPS" para `…/data/report*`, para
   que el POST HTTP llegue al Worker sin redirigir.
3. El Worker se ata a esa ruta (`estacion.tudominio/data/report*`) y parsea el
   cuerpo form-urlencoded.

**A tener presente:** el tramo estación→edge va en **HTTP plano** (sin cifrar).
Para datos de clima (públicos) es bajo riesgo, pero conviene saberlo.

**Validación obligatoria con el hardware real (≥ 17 jul):** confirmar que el
WS2910 postea correctamente a Cloudflare en :80 sin redirect. Hay reportes de
ambos lados; hasta no probarlo, es el mayor supuesto del proyecto.

> **Plan B si la ingesta directa falla:** mantener un mini-receptor (el actual, o
> un contenedor mínimo) SOLO para recibir el push y reenviarlo al Worker por
> HTTPS. Rompe el "cero servidores", pero es un fallback.

---

## 8. Límites y costos

Cifras aproximadas del **free tier** (⚠️ cambian; verificar en la consola):

| Servicio | Free tier (aprox.) | Uso estimado de la estación | ¿Sobra? |
|----------|--------------------|-----------------------------|---------|
| Workers | ~100,000 req/día | 1,440 ingesta + visitas API (cientos–miles) | ✅ de sobra |
| Workers CPU | límite de ms por invocación | procesamiento por lectura: trivial | ✅ |
| D1 | ~5 GB; millones de filas leídas/día; ~100k escritas/día | 1,440 escrituras/día | ✅ |
| KV | ~100k lecturas/día; ~1k escrituras/día; 1 GB | último dato + config | ✅ |
| R2 | 10 GB gratis; ops con capa free | backups/archivo | ✅ |
| Pages | peticiones ilimitadas; 500 builds/mes | el dashboard | ✅ |
| Cron Triggers | incluido | unas pocas tareas | ✅ |
| **Durable Objects** | **requiere Workers Paid ($5/mes)** | opcional | ⚠️ evitar en v1 |
| **Queues** | **requiere Workers Paid** | opcional | ⚠️ evitar en v1 |

**Conclusión:** el núcleo (Workers + Pages + D1 + KV + R2 + Cron) cabe en **$0**.
Solo si queremos WebSockets en vivo (Durable Objects) o colas, saltaría al plan
de **$5/mes** — nada grave, pero se puede evitar con *polling* como hoy.

---

## 9. Stack técnico recomendado

- **Lenguaje:** TypeScript (todo el proyecto Workers/Pages).
- **Router/API:** **Hono** — micro-framework ideal para Workers (rápido, tipado,
  middleware). Reemplaza a FastAPI.
- **Acceso a D1:** **Drizzle ORM** (tipado, migraciones) o SQL directo con el
  binding de D1.
- **Validación:** **Zod** (equivalente a Pydantic).
- **CLI/infra:** **wrangler** (deploy, secrets, tail de logs, migraciones D1).
- **Dashboard:** el mismo React/Vite actual, desplegado en **Pages** (poco cambio).
- **Tests:** **Vitest** + `@cloudflare/vitest-pool-workers` (correr Workers en test).
- **CI/CD:** GitHub Actions → `wrangler deploy` (opcional, luego).
- **Estructura sugerida:** monorepo `cloudflare/` con `worker/` (API+ingesta),
  `pages/` (o reutilizar `dashboard/`), y `migrations/` (D1).

---

## 10. Plan por fases

Migración **incremental**, sin apagar el VPS hasta el final. Cada fase entrega
algo usable.

**Fase 0 — Preparación**
- Cuenta Cloudflare lista (dominio ya está), instalar `wrangler`, `wrangler login`.
- Crear proyecto `cloudflare/` en el repo.
- *Éxito:* `wrangler deploy` de un Worker "hola mundo" en un subdominio.

**Fase 1 — Dashboard en Pages** 🟢
- Desplegar el React actual en Cloudflare Pages (apuntando a la API del VPS aún).
- *Éxito:* el dashboard carga desde Pages; el VPS solo sirve la API.

**Fase 2 — API de solo lectura en Worker**
- Worker con `/api/*` que lee de una **D1 espejo** (poblada en paralelo) o que
  *proxya* al VPS mientras tanto.
- *Éxito:* el dashboard de Pages consume la API del Worker.

**Fase 3 — Ingesta en Worker (en paralelo)**
- Un Worker recibe el push del WS2910 y escribe en D1 — **a la vez** que el VPS
  (doble escritura), para comparar sin riesgo.
- *Éxito:* D1 se llena igual que InfluxDB; validado el tema del redirect (§7).

**Fase 4 — Procesamiento en el edge**
- Portar QC, calibración, derivadas y el Dayfile (Cron) a TS/Worker.
- *Éxito:* récords, climatología y derivadas salen de D1 y cuadran con el VPS.

**Fase 5 — Alertas, uploaders y backups**
- Telegram + watchdog + uploaders + backup D1→R2 como Cron Workers.
- *Éxito:* llegan alertas y backups sin el VPS.

**Fase 6 — Apagar el VPS** 🎉
- Repuntar el WS2910 solo a Cloudflare, verificar unos días, y dar de baja el VPS.
- *Éxito:* todo en Cloudflare, $0, cero servidores.

---

## 11. Seguridad

- **Panel admin:** en vez de implementar login, poner **Cloudflare Access**
  delante de `/admin*` (email OTP / Google / etc.). Auth gestionada por Cloudflare.
- **Secretos** (tokens de Telegram, WAQI, redes): `wrangler secret put …`
  (cifrados, nunca en el repo).
- **Ingesta:** validar un "token" o path secreto en la URL de `/data/report` para
  que no cualquiera inyecte datos falsos.
- **Rate limiting / WAF:** reglas de Cloudflare para proteger la API pública.
- **Turnstile:** si algún día hay formularios públicos.

---

## 12. Observabilidad y depuración

- **`wrangler tail`**: logs en vivo del Worker (equivale a `docker logs`).
- **Workers Logs / Logpush**: envío de logs a R2/externos para histórico.
- **Dashboard de Analytics** de Workers/Pages: peticiones, errores, CPU.
- **D1**: consola web para correr SQL y ver el tamaño de la base.
- **Alertas de salud**: un Cron que se auto-verifica (o el Worker de uptime actual
  vigilando el nuevo endpoint).

---

## 13. Riesgos, límites y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Ingesta HTTP del WS2910 a Cloudflare no funciona | 🔴 Bloquea el proyecto | Validar temprano (Fase 3); Plan B: mini-relay |
| D1 se queda corta o lenta con el tiempo | 🟠 | Archivar crudo a R2; conservar solo `daily` + N días |
| Límite de CPU por request en procesamiento | 🟢 | El procesamiento por lectura es trivial; mover trabajo pesado a Cron |
| CWOP (APRS/TCP) y MQTT no encajan | 🟠 | Dejar fuera o con relay; no son críticos |
| Vendor lock-in | 🟠 | Mantener la lógica portable (TS puro), el repo versionado |
| Cambios de límites/precios del free tier | 🟢 | Uso muy por debajo; margen amplio |
| Depuración distinta (sin servidor) | 🟢 | `wrangler tail`, tests locales con Miniflare |

---

## 14. Preguntas abiertas a validar

1. **¿El WS2910 postea bien a Cloudflare en :80 sin redirect?** (lo más importante).
2. ¿D1 o Analytics Engine para las gráficas de alta resolución?
3. ¿Vale la pena Durable Objects (WebSockets en vivo) o seguimos con *polling*?
4. ¿CWOP y MQTT se dejan fuera, con relay, o se sacrifican?
5. ¿Retención: cuánto crudo en D1 vs archivado en R2?
6. ¿CI/CD con GitHub Actions desde el principio o deploy manual?

---

## 15. Recursos oficiales

- Workers: https://developers.cloudflare.com/workers/
- Pages: https://developers.cloudflare.com/pages/
- D1: https://developers.cloudflare.com/d1/
- KV: https://developers.cloudflare.com/kv/
- R2: https://developers.cloudflare.com/r2/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Analytics Engine: https://developers.cloudflare.com/analytics/analytics-engine/
- Access (Zero Trust): https://developers.cloudflare.com/cloudflare-one/
- wrangler: https://developers.cloudflare.com/workers/wrangler/
- Hono: https://hono.dev/  ·  Drizzle (D1): https://orm.drizzle.team/docs/get-started-d1

---

## 16. Glosario

- **Serverless / edge:** el código corre en los cientos de datacenters de
  Cloudflare, por evento, sin un servidor que administres.
- **Worker:** función JS/TS que responde a peticiones o a cron.
- **Binding:** "cable" que conecta un Worker con un recurso (D1, KV, R2, secreto).
- **D1:** base SQLite serverless de Cloudflare.
- **KV:** almacén clave-valor, lecturas muy rápidas, consistencia eventual.
- **R2:** almacenamiento de objetos tipo S3, sin costo de egreso.
- **Durable Object:** instancia única global con estado, para coordinación y
  WebSockets (plan pago).
- **Cron Trigger:** horario que dispara un Worker.
- **Pages:** hosting de sitios estáticos + funciones.
- **wrangler:** la CLI para desarrollar y desplegar en Cloudflare.
- **Hono:** micro-framework web para Workers (como FastAPI, pero en TS).
