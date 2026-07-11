# Cloudflare — Modelo de datos D1 + Worker de ingesta (a fondo)

> Complemento técnico de [`PROYECTO-CLOUDFLARE.md`](PROYECTO-CLOUDFLARE.md).
> Aquí se aterriza el **esquema de la base D1** y un **Worker de ingesta**
> concreto. Es material de estudio/diseño: código ilustrativo (no desplegado),
> pero escrito para que sea fiel a cómo quedaría.

## Índice
- [A. Modelo de datos en D1](#a-modelo-de-datos-en-d1)
  - [A.1 Principios de diseño](#a1-principios-de-diseño)
  - [A.2 Esquema (DDL)](#a2-esquema-ddl)
  - [A.3 Por qué así](#a3-por-qué-así)
  - [A.4 Consultas típicas](#a4-consultas-típicas)
  - [A.5 Resumen diario (Dayfile) y récords](#a5-resumen-diario-y-récords)
  - [A.6 Retención y archivado a R2](#a6-retención-y-archivado)
  - [A.7 Migraciones con wrangler](#a7-migraciones)
- [B. Worker de ingesta](#b-worker-de-ingesta)
  - [B.1 wrangler.toml](#b1-wranglertoml)
  - [B.2 Conversión y derivadas](#b2-conversión-y-derivadas)
  - [B.3 El Worker (TypeScript + Hono)](#b3-el-worker)
  - [B.4 Cron: rollup diario](#b4-cron-rollup-diario)
  - [B.5 Probar en local y desplegar](#b5-probar-y-desplegar)

---

## A. Modelo de datos en D1

D1 es **SQLite**. Dos decisiones de fondo:

- **Tiempo como `INTEGER` (epoch en segundos, UTC).** Ordena y filtra por rango
  rapidísimo y es la clave primaria natural de las lecturas.
- **Tabla "ancha" para los sensores principales + una columna `extra` JSON** para
  lo variable (canales WN31, baterías, campos poco comunes). Así la tabla caliente
  queda ligera y fácil de consultar, sin decenas de columnas casi siempre vacías.

### A.1 Principios de diseño
1. **`readings`**: crudo, una fila por lectura (~cada 60 s).
2. **`daily`**: un registro por día local (el "Dayfile"), del que salen récords,
   climatología, "en este día", etc. — igual que hoy en el VPS.
3. **Config** editable → mejor en **KV** (no en D1), por su lectura instantánea.
4. **Retención**: D1 guarda crudo reciente (p. ej. 90 días) + todos los `daily`;
   el crudo viejo se archiva a **R2** y se purga de D1.

### A.2 Esquema (DDL)

```sql
-- migrations/0001_init.sql

-- Lecturas crudas (una por minuto aprox.)
CREATE TABLE IF NOT EXISTS readings (
  ts            INTEGER PRIMARY KEY,   -- epoch UTC (segundos)
  temp          REAL,                  -- °C exterior
  hum           REAL,                  -- % exterior
  dewpoint      REAL,
  feels_like    REAL,
  humidex       REAL,
  pressure_rel  REAL,                  -- hPa (nivel del mar)
  pressure_abs  REAL,                  -- hPa (absoluta)
  wind_speed    REAL,                  -- km/h
  wind_gust     REAL,
  wind_dir      INTEGER,               -- grados
  rain_rate     REAL,                  -- mm/h
  rain_daily    REAL,                  -- mm acumulado del día (contador consola)
  uv            REAL,
  solar         REAL,                  -- W/m²
  temp_in       REAL,
  hum_in        REAL,
  extra         TEXT                   -- JSON: canales WN31, baterías, etc.
);

-- Resumen por día LOCAL (Dayfile) -> récords y climatología
CREATE TABLE IF NOT EXISTS daily (
  date          TEXT PRIMARY KEY,      -- 'YYYY-MM-DD' (hora local)
  temp_min REAL, temp_max REAL, temp_avg REAL,
  temp_min_ts INTEGER, temp_max_ts INTEGER,
  hum_min REAL, hum_max REAL, hum_avg REAL,
  wind_avg REAL, wind_max REAL, gust_max REAL,
  rain_total REAL,
  press_min REAL, press_max REAL, press_avg REAL,
  hdd REAL, cdd REAL, et REAL          -- grados-día y evapotranspiración
);

-- Índice para barridos por rango de tiempo (además del PK)
CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings (ts);
```

### A.3 Por qué así
- **`ts` PK** = orden e índice gratis; `WHERE ts BETWEEN ? AND ?` vuela.
- **`extra` JSON**: SQLite tiene funciones `json_extract()`; los canales WN31
  (`temp_ch1..8`, `hum_ch1..8`, `batt*`) y sensores futuros caben ahí sin migrar
  el esquema cada vez. Si algún canal se vuelve "de primera clase", se promueve a
  columna.
- **`daily` separada**: las consultas de récords/climatología **no** tocan la
  tabla grande; leen `daily` (365 filas/año). Rapidísimo y barato en lecturas D1.

### A.4 Consultas típicas

```sql
-- Última lectura (aunque el "último" real lo servimos desde KV, más rápido)
SELECT * FROM readings ORDER BY ts DESC LIMIT 1;

-- Últimas 24 h (para gráficas)
SELECT ts, temp, hum, pressure_rel, wind_speed
FROM readings
WHERE ts >= unixepoch('now','-24 hours')
ORDER BY ts;

-- Un canal WN31 desde el JSON extra
SELECT ts, json_extract(extra,'$.temp_ch1') AS t1
FROM readings WHERE ts >= unixepoch('now','-24 hours');
```

### A.5 Resumen diario y récords

El día es **local** (CDMX = UTC−6, sin horario de verano). En SQLite se agrupa así:

```sql
-- Rollup de un día: agrega readings -> upsert en daily
INSERT OR REPLACE INTO daily
  (date, temp_min, temp_max, temp_avg, hum_min, hum_max, hum_avg,
   wind_avg, wind_max, gust_max, rain_total, press_min, press_max, press_avg)
SELECT
  date(ts,'unixepoch','-6 hours')       AS date,
  min(temp), max(temp), avg(temp),
  min(hum),  max(hum),  avg(hum),
  avg(wind_speed), max(wind_speed), max(wind_gust),
  max(rain_daily),                       -- total del día = pico del contador
  min(pressure_rel), max(pressure_rel), avg(pressure_rel)
FROM readings
WHERE ts >= unixepoch(?, '-6 hours')     -- inicio del día local en epoch
  AND ts <  unixepoch(?, '-6 hours')
GROUP BY date;
```

> La **hora del extremo** (`temp_min_ts`, `temp_max_ts`) se calcula aparte con una
> subconsulta (p. ej. `SELECT ts FROM readings WHERE date(...)=? ORDER BY temp DESC LIMIT 1`),
> o con funciones de ventana. Los **grados-día y ET** (hdd/cdd/et) se calculan en
> el Worker (misma fórmula Hargreaves de hoy) y se guardan en `daily`.

```sql
-- Récords de siempre (desde daily; barato)
SELECT max(temp_max) AS temp_max_hist,
       min(temp_min) AS temp_min_hist,
       max(gust_max) AS gust_hist,
       max(rain_total) AS dia_mas_lluvioso
FROM daily;

-- "En este día" (mismo mes-día en años previos)
SELECT date, temp_max, temp_min, rain_total
FROM daily
WHERE strftime('%m-%d', date) = strftime('%m-%d','now','-6 hours')
  AND strftime('%Y', date)   <> strftime('%Y','now','-6 hours')
ORDER BY date DESC;
```

### A.6 Retención y archivado

Un Cron diario:
1. Calcula/actualiza el `daily` de ayer (y hoy parcial).
2. **Archiva** a R2 el crudo de hace > 90 días (NDJSON por día) y lo **borra** de
   `readings`.
3. Deja `daily` intacto (histórico completo, pesa poquísimo).

```sql
-- Purga de crudo viejo (tras archivar a R2)
DELETE FROM readings WHERE ts < unixepoch('now','-90 days');
```

### A.7 Migraciones

```bash
wrangler d1 create clima-xe1e            # crea la base, copia el database_id a wrangler.toml
wrangler d1 migrations create init       # crea migrations/0001_init.sql (pega el DDL de A.2)
wrangler d1 migrations apply clima-xe1e  # local
wrangler d1 migrations apply clima-xe1e --remote   # producción
```

---

## B. Worker de ingesta

Un solo Worker maneja **ingesta + API + cron**. Aquí el foco es la **ingesta**.

### B.1 wrangler.toml

```toml
name = "clima-xe1e"
main = "src/index.ts"
compatibility_date = "2024-11-01"

# Recibir el push del WS2910 por HTTP en el borde (ver nota de puertos/redirect)
[[routes]]
pattern = "estacion.xe1e.net/*"
zone_name = "xe1e.net"

[[d1_databases]]
binding = "DB"
database_name = "clima-xe1e"
database_id = "REEMPLAZAR"

[[kv_namespaces]]
binding = "KV"
id = "REEMPLAZAR"

[[r2_buckets]]
binding = "ARCHIVE"
bucket_name = "clima-xe1e-archive"

[triggers]
crons = ["*/10 * * * *", "20 6 * * *"]   # watchdog cada 10 min; rollup 06:20 UTC (00:20 CDMX)

# Secretos (NO aquí):  wrangler secret put TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / INGEST_KEY
```

> **Recordatorio de la ingesta (§7 del doc principal):** el WS2910 postea por
> **HTTP** a un **puerto compatible** (80/8080/…) y **no sigue redirects**; hay que
> **exentar `…/data/report*` de "Always Use HTTPS"** con una regla de Cloudflare.

### B.2 Conversión y derivadas

```typescript
// src/convert.ts — Ecowitt (imperial) -> métrico + derivadas (port del Python actual)
export const fToC = (f: number) => (f - 32) * 5 / 9;
export const inHgToHpa = (v: number) => v * 33.8639;
export const inToMm = (v: number) => v * 25.4;
export const mphToKmh = (v: number) => v * 1.60934;

export function dewPoint(tC: number, rh: number): number {
  const a = 17.27, b = 237.7;
  const alpha = (a * tC) / (b + tC) + Math.log(rh / 100);
  return (b * alpha) / (a - alpha);
}

export function feelsLike(tC: number, rh: number, windKmh: number): number {
  if (tC >= 27 && rh >= 40) {            // heat index (aprox.)
    return tC + 0.33 * (rh / 100 * 6.105 * Math.exp(17.27 * tC / (237.7 + tC))) - 0.7 * (windKmh / 3.6) - 4.0;
  }
  if (tC <= 10 && windKmh >= 4.8) {      // wind chill
    return 13.12 + 0.6215 * tC - 11.37 * windKmh ** 0.16 + 0.3965 * tC * windKmh ** 0.16;
  }
  return tC;
}
```

### B.3 El Worker

```typescript
// src/index.ts
import { Hono } from 'hono';
import { fToC, inHgToHpa, inToMm, mphToKmh, dewPoint, feelsLike } from './convert';

type Env = {
  DB: D1Database;
  KV: KVNamespace;
  ARCHIVE: R2Bucket;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  INGEST_KEY?: string;
};

const app = new Hono<{ Bindings: Env }>();

// --- Ingesta del WS2910 (protocolo Ecowitt, form-urlencoded) ---
// El path lleva una clave secreta para que nadie más inyecte datos.
app.post('/data/report/:key?', async (c) => {
  // Validación simple de origen
  if (c.env.INGEST_KEY && c.req.param('key') !== c.env.INGEST_KEY) {
    return c.text('forbidden', 403);
  }

  const form = await c.req.formData();
  const num = (k: string) => {
    const v = form.get(k);
    return v == null || v === '' ? null : Number(v);
  };

  // Campos crudos Ecowitt -> métrico
  const tempf = num('tempf'), hum = num('humidity');
  const temp = tempf != null ? +fToC(tempf).toFixed(1) : null;
  const wind = num('windspeedmph'); const gust = num('windgustmph');
  const rec = {
    ts: Math.floor(Date.now() / 1000),
    temp,
    hum,
    pressure_rel: num('baromrelin') != null ? +inHgToHpa(num('baromrelin')!).toFixed(1) : null,
    pressure_abs: num('baromabsin') != null ? +inHgToHpa(num('baromabsin')!).toFixed(1) : null,
    wind_speed: wind != null ? +mphToKmh(wind).toFixed(1) : null,
    wind_gust: gust != null ? +mphToKmh(gust).toFixed(1) : null,
    wind_dir: num('winddir'),
    rain_rate: num('rainratein') != null ? +inToMm(num('rainratein')!).toFixed(1) : null,
    rain_daily: num('dailyrainin') != null ? +inToMm(num('dailyrainin')!).toFixed(1) : null,
    uv: num('uv'),
    solar: num('solarradiation'),
    temp_in: num('tempinf') != null ? +fToC(num('tempinf')!).toFixed(1) : null,
    hum_in: num('humidityin'),
    dewpoint: null as number | null,
    feels_like: null as number | null,
    humidex: null as number | null,
  };

  // Derivadas
  if (temp != null && hum != null) {
    rec.dewpoint = +dewPoint(temp, hum).toFixed(1);
    rec.feels_like = +feelsLike(temp, hum, rec.wind_speed ?? 0).toFixed(1);
  }

  // Canales WN31 y baterías -> JSON extra
  const extra: Record<string, unknown> = {};
  for (let ch = 1; ch <= 8; ch++) {
    const t = num(`temp${ch}f`), h = num(`humidity${ch}`), b = form.get(`batt${ch}`);
    if (t != null) extra[`temp_ch${ch}`] = +fToC(t).toFixed(1);
    if (h != null) extra[`hum_ch${ch}`] = h;
    if (b != null) extra[`batt_ch${ch}`] = Number(b) === 0; // true = OK
  }

  // (Aquí irían también QC por rangos y filtro de picos, como en el receiver actual)

  // 1) Guardar en D1
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO readings
     (ts,temp,hum,dewpoint,feels_like,pressure_rel,pressure_abs,
      wind_speed,wind_gust,wind_dir,rain_rate,rain_daily,uv,solar,temp_in,hum_in,extra)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    rec.ts, rec.temp, rec.hum, rec.dewpoint, rec.feels_like, rec.pressure_rel, rec.pressure_abs,
    rec.wind_speed, rec.wind_gust, rec.wind_dir, rec.rain_rate, rec.rain_daily, rec.uv, rec.solar,
    rec.temp_in, rec.hum_in, JSON.stringify(extra),
  ).run();

  // 2) Último dato en KV (para /api/current instantáneo)
  await c.env.KV.put('latest', JSON.stringify({ ...rec, extra, received_at: new Date(rec.ts * 1000).toISOString() }));

  // 3) Alertas (ejemplo: temperatura alta) — sin bloquear la respuesta
  if (rec.temp != null && rec.temp >= 35 && c.env.TELEGRAM_BOT_TOKEN) {
    c.executionCtx.waitUntil(sendTelegram(c.env, `🌡️ Temp alta: ${rec.temp}°C`));
  }

  return c.text('OK'); // el Ecowitt solo espera 200
});

// --- API de lectura ---
app.get('/api/current', async (c) => {
  const latest = await c.env.KV.get('latest');
  return latest ? c.body(latest, 200, { 'content-type': 'application/json' }) : c.json({ error: 'sin datos' }, 404);
});

app.get('/api/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ts,temp,hum,pressure_rel,wind_speed,rain_daily
     FROM readings WHERE ts >= unixepoch('now','-24 hours') ORDER BY ts`
  ).all();
  return c.json({ data: results });
});

async function sendTelegram(env: Env, text: string) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
}

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(handleCron(event, env)),
};

// --- Cron: rollup diario + watchdog ---
async function handleCron(event: ScheduledController, env: Env) {
  if (event.cron === '20 6 * * *') {
    // Rollup del día local de ayer (ver A.5). Ejemplo simplificado:
    await env.DB.prepare(
      `INSERT OR REPLACE INTO daily (date,temp_min,temp_max,temp_avg,rain_total,press_min,press_max,press_avg,wind_avg,wind_max,gust_max,hum_min,hum_max,hum_avg)
       SELECT date(ts,'unixepoch','-6 hours') AS d,
              min(temp),max(temp),avg(temp),max(rain_daily),
              min(pressure_rel),max(pressure_rel),avg(pressure_rel),
              avg(wind_speed),max(wind_speed),max(wind_gust),
              min(hum),max(hum),avg(hum)
       FROM readings
       WHERE ts >= unixepoch('now','-2 days') GROUP BY d`
    ).run();
    // (luego: calcular hdd/cdd/et en JS y UPDATE; archivar crudo viejo a R2; purgar)
  } else {
    // watchdog: si el último dato es muy viejo, avisar
    const latest = await env.KV.get('latest', 'json') as any;
    if (latest?.received_at) {
      const ageMin = (Date.now() - Date.parse(latest.received_at)) / 60000;
      if (ageMin > 15) await sendTelegram(env, `🔌 Estación sin datos hace ${Math.round(ageMin)} min`);
    }
  }
}
```

### B.4 Cron: rollup diario
Va incluido arriba en `handleCron`. Dos triggers: `*/10 * * * *` (watchdog) y
`20 6 * * *` (rollup a las 00:20 CDMX). El mismo patrón sirve para **uploaders**
(WU/PWS/Windy/OWM) y **backup** de D1 a R2.

### B.5 Probar y desplegar

```bash
npm create hono@latest clima-xe1e      # plantilla Cloudflare Workers
cd clima-xe1e && npm i
# pega src/, wrangler.toml, migrations/
wrangler d1 migrations apply clima-xe1e            # local
npm run dev                                        # Miniflare: prueba local
# Simular el push del WS2910:
curl -X POST 'http://localhost:8787/data/report/MI_CLAVE' \
  -d 'tempf=71.6&humidity=55&baromrelin=29.92&windspeedmph=5&winddir=210&dailyrainin=0.1&uv=6&solarradiation=640'
curl http://localhost:8787/api/current

wrangler d1 migrations apply clima-xe1e --remote   # producción
wrangler deploy
wrangler tail                                      # logs en vivo
```

---

## Notas finales
- Falta portar **QC (rangos + picos)**, **calibración**, **humidex/base de nubes**,
  el resto de la **API** (`/stats`, `/climate/*`, `/almanac`, `/wind/rose`), los
  **uploaders** y el **panel** (protegido con Cloudflare Access). Todo es el mismo
  patrón: SQL en D1 + lógica TS en el Worker + Cron para lo periódico.
- **CWOP (APRS/TCP)** no encaja en un Worker; se deja fuera o con relay.
- Este archivo es el "andamio" para arrancar la **Fase 3–4** del plan por fases.
