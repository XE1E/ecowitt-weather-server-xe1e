# Plan: revisión general del código (depurar, optimizar, mejorar)

> Estado: **en ejecución** — fases 0, 1 y 2 ✅ hechas y desplegadas el 2026-09-24; fases 0–4 ✅ (2026-09-24). Quedan pendientes
> menores y opcionales al final de la fase 4. Sale de un diagnóstico de solo lectura en tres
> frentes (backend, dashboard, pruebas/infra). Se ejecuta por fases, con deploy y
> verificación en cada una. Producción en vivo: WS2910 + GW1100 empujando cada ~16-60 s.

Métricas de partida: backend ~16,900 líneas (`main.py` 3,891 y 103 rutas); dashboard
~26,800 (`ConsoleReplica.tsx` 2,605); ~380 pruebas de backend, **ninguna** de endpoints
ni del dashboard; `tsc` limpio, 0 `any`, lint del dashboard 0 errores / 15 avisos.

## Fase 0 — Red de seguridad — ✅ HECHA 2026-09-24 (commit a3a9a65)

- [x] **CI honesto:** hoy `pytest … || echo "No tests found yet"` y `mypy … || true`
      ocultan fallos: una prueba rota nunca pone el CI en rojo. Quitar el `|| echo`,
      fijar versiones de pytest/pytest-asyncio, agregar `npm run lint` y `npm ci`.
- [x] **Pruebas de humo de endpoints** con `TestClient` (Influx y red simulados): ingesta
      `/data/report` (principal, secundaria, passkey desconocido → 403), `/api/current`,
      `/api/stations`, login admin + un GET/POST de settings, alta/baja de estación.
      Son la condición para poder partir `main.py` sin miedo.
- [x] `conftest.py` (rutas /data a temporal). El `make_settings` de test_alerts y test_mqtt no
      era un duplicado real: arman ajustes distintos, se dejan.

## Fase 1 — Bugs y seguridad — ✅ HECHA 2026-09-24 (commits 7e5a13f, 0cd9a1a, de8f832)

Backend:
- [x] **Límite de intentos del login saltable** (verificado): `security.client_ip` confía
      en `X-Real-IP`, que nginx NO fija en `/api` → el cliente la inventa. Hecho: nginx la
      pisa en el 80; Caddy entra por el 81 interno (único donde se cree la suya) y la toma
      de CF-Connecting-IP sólo desde IPs de Cloudflare. Comprobado en producción por los
      dos caminos. De paso: Caddy monta la carpeta `caddy/` (con el archivo suelto,
      `git pull` dejaba al contenedor con el Caddyfile viejo).
- [x] **Estado de estación con 6 h de desfase** (verificado): `received_at` va en UTC sin
      zona (`main.py:616`) y `_station_status` compara con la hora local (TZ del
      contenedor = America/Mexico_City) → una caída se ve "en línea" ~6 h.
- [x] **Tareas que sólo miran su interruptor al arrancar:** `station_watchdog` (si las
      alertas se prenden desde el panel no hay avisos de estación caída/cámara/respaldo
      hasta reiniciar), `stats_refresh_task`, `timelapse_task`. Patrón correcto: el de
      `email_digest_task` (revisa en cada vuelta).
- [x] **Sismos:** sólo se evalúan si alguien abre `/api/earthquakes`; `active` nunca
      se limpia (salen como activos para siempre) y el recorte del set de notificados
      puede re-avisar.
- [x] **`settings.json` sin escritura atómica:** un corte a media escritura + JSON
      corrupto → se reescribe desde `{}` y se pierden estaciones, registro y secretos.
      (Netatmo lo reescribe seguido al rotar su token.)
- [x] CWOP: `readline()` del banner sin timeout (tarea colgada para siempre).
- [x] METAR: si falla, puede devolver la caché de OTRO aeropuerto; TAF con caché sin tope.
- [x] Cachés públicas sin tope: `satellite` (lat/lon/fecha del cliente, JPEG ~200 KB
      cada uno → se puede llenar la memoria desde fuera), `RateLimiter`, sesiones admin.
- [x] `POST /api/kiosk/local` sin autenticación: rangos físicos + límite por IP + token
      OPCIONAL (`KIOSK_LOCAL_TOKEN`); exigirlo requiere actualizar el firmware del display
      (otro repo), pendiente.
- [x] `get_station('_principal')` todavía usa `watchdog_minutes` retirado (15) mientras
      `list_stations` usa el global → pueden diferir. `station_altitude_m` no se expone en
      `public_settings` → Calibración muestra vacía la altitud de la principal.
- [x] `detail=str(e)` en 9 endpoints públicos (filtra errores internos).

Dashboard:
- [x] **Mapa de código fuente público** (`sourcemap: true`, 5.8 MB): quitar en producción.
- [x] `/basica`: un fallo de una sola consulta tapa todo el tablero aunque ya haya datos.
- [x] Respuestas viejas que pisan a las nuevas al cambiar rápido de pestaña/periodo
      (AdminAlertas, MultiVariableChart, ClimatePage, RemoteStationPage…).

## Fase 2 — Rendimiento — ✅ HECHA 2026-09-24 (commits 6075e51, 7e1f92d y el de /api/history)

Backend:
- [x] **Consultas a InfluxDB fuera del event loop:** todo pasa por `storage._q`
      (asyncio.to_thread); las independientes van en paralelo. Prueba que falla con el
      código anterior (tests/test_storage.py).
- [x] `/api/current`: extras en paralelo + caché de 30 s por estación → **0.31 s a 0.002 s**.
      `/api/history`: tope de 31 días, y `fields` + `every` opcionales para promedios por
      ventana → 30 días de la remota **13.9 s / 25.8 MB a 0.17 s / 324 KB**.
- [x] Condición de AWEKAS sólo si AWEKAS está activo; `publish_all` sin cliente HTTP si no
      hay redes HTTP activas.
- [~] Caché de `settings.json` en memoria: **descartada** — ~9 KB que el sistema ya tiene en
      caché de disco (<1 ms); no justifica el riesgo de servir ajustes viejos.

Dashboard:
- [x] Carga por vista y por página (`src/entries/*`, `lazyPage` con recarga única tras un
      deploy); librerías en archivos propios. JS: widget 1834→345 KB, admin →180, kiosco
      →576, consola →631, inicio ~725 antes de mostrarse (+304 de PostHog después).
- [x] PostHog se carga aparte, tras mostrar la página y sólo en vistas públicas.
- [x] `/consola` monta sólo la versión visible.
- [x] `useSharedFetch` (una consulta por URL: alertas, IMECA) y el pronóstico de la consola
      desde el proveedor.
- [x] `pollWhileVisible`: 27 consultas periódicas se pausan con la pestaña oculta
      (comprobado: 0 peticiones en 3 min oculta; al volver, refresca).
- [x] Relojes de 1 s que redibujaban componentes enormes: resuelto en la fase 3.

## Fase 3 — Estructura — ✅ HECHA 2026-09-24

- [x] **Partir `main.py` en routers — HECHO (2026-09-24).** `app/state.py` (objetos compartidos),
      `app/deps.py` (require_admin), `app/logs.py` (búfer de logs) y 9 routers: `admin`,
      `camera`, `data`, `devices`, `external`, `forecast`, `kiosk`, `radar`, `stations`.
      main.py 3,960 → 698 líneas (app, arranque, tareas de fondo, /health e ingesta).
      Mismas 107 rutas, comparadas antes/después en cada paso, y endpoints probados en
      producción tras cada deploy.
- [ ] ~~**Partir `main.py` en routers**~~ (plan original:) por área (ingesta, admin, estaciones, cámara,
      pronóstico, radar, dispositivos…), sin cambiar URLs. Antes: `state.py` (estado
      compartido: `storage`, `latest_by_station`, `alert_service`, cachés), `deps.py`
      (`require_admin` como `Depends`, ubicación de la estación), `tasks.py`. Respetar el
      orden de rutas que importa (`/camera/best/{date}.jpg`, `/radar/sacmex/archive`…).
- [x] Primitivas del Admin en `admin-ui.tsx` (Toggle, TextField, NumField) — 2026-09-24.
- [x] Relojes: el del encabezado en su propio componente; consola y kiosco avanzan por
      minuto (antes redibujaban todo cada segundo) — 2026-09-24.
- [x] Tipos de la API compartidos en `src/api-types.ts` (Alert, Imeca, AirQuality, Metar,
      SensorDetail, StationSummary…; antes en 18 archivos) — 2026-09-24.
- [x] Publicación: 6 redes iguales → lista `NETWORKS` + `NetworkCard` — 2026-09-24.
- [x] Asistente: un archivo por paso (`pages/admin/wizard/`, 910 → 236 líneas) — 2026-09-24.
- [x] ConsoleReplica: piezas a `console/parts.tsx` (2,600 → ~1,770). Las celdas NO se
      dividieron (comparten mucho estado; el riesgo para el display no lo vale).
      Cada movimiento se comparó palabra por palabra con el original.

## Fase 4 — Limpieza — ✅ HECHA en lo principal (2026-09-24)

- [x] Código muerto verificado con búsquedas antes de borrar (backend -90 líneas; dashboard:
      `allSlugs`, `NAV_SOON`). Se conservan `theme/constants.ts` e `iconUv`: los cita
      `docs/CONVENCIONES.md` como referencia de diseño.
- [x] Ubicación de la estación: 24 copias de `getattr(settings, "cwop_latitude", …)` menos;
      calidad del aire sin lat/lon usaba el Zócalo, ahora la estación.
- [x] Brújula: `services/compass.py` (4 copias del redondeo; alfabetos EN8/ES8/EN16 a propósito).
- [x] Asistente: pruebas de Telegram/correo con el mismo envío que las alertas (antes smtplib
      directo en el event loop, sin SSL 465).
- [x] Dependencias: paho-mqtt 2.1 (API VERSION2, probada contra un broker real), lucide-react
      1.48, ESLint 10 con config flat (mismas reglas), Node 22 en el Dockerfile del dashboard;
      fuera python-dateutil (no se importaba).
- [x] Repo: capturas de docs 33 → 6.7 MB (1440 px + paleta de 256 colores, mismos nombres),
      scripts de captura a 1x, `grafana/provisioning/` existe, `*.tsbuildinfo` ignorado.
      Nota: el historial de git conserva las capturas viejas (no se reescribió la historia).

Queda (menor, opcional):
- [ ] Patrón de caché TTL repetido en ~13 servicios y helpers copiados entre xweather/netatmo:
      un helper común; poco beneficio frente al riesgo de tocar 13 integraciones externas.
- [ ] Dashboard: helpers de fecha repetidos (días/meses en ~12 lugares) y `#f97316` escrito a
      mano en 19 archivos en vez de `theme/constants`.
- [ ] Reglas nuevas de react-hooks v7 (React Compiler): revisarlas aparte.

## Cómo se trabaja

Cada fase en commits chicos; `pytest` + `ruff` + `tsc` + lint antes de cada push; deploy
y verificación en producción (las dos estaciones entran, passkey desconocido → 403).
Las fases 0 y 1 primero; las demás se pueden reordenar.
