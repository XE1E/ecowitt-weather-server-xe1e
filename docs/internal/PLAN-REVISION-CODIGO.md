# Plan: revisión general del código (depurar, optimizar, mejorar)

> Estado: **en ejecución** — fases 0 y 1 ✅ hechas y desplegadas el 2026-09-24; sigue la 2. Sale de un diagnóstico de solo lectura en tres
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

## Fase 2 — Rendimiento

Backend:
- [ ] **Consultas a InfluxDB bloquean todo el servidor:** casi todos los métodos de
      `storage.py` son `async` pero llaman a Influx de forma síncrona (timeout 30 s).
      `/api/current` hace 7 por petición. Pasarlas a `asyncio.to_thread` (o al cliente
      async). Es lo que más protege a `/data/report`.
- [ ] Caché corta (30-60 s) de `/api/current` y límite al rango de `/api/history`.
- [ ] Caché en memoria de `settings.json` (se relee del disco 2 veces por push de la
      secundaria, 2+2N por `/api/stations`, 1+N por minuto en el watchdog).
- [ ] `_awekas_condition_code` corre en cada push aunque AWEKAS esté apagado;
      `publish_all` abre un cliente HTTP nuevo por push aunque no publique nada.

Dashboard:
- [ ] **Todo en un solo archivo de 1.87 MB**: cargar por sección (`React.lazy`); el
      widget `/embed` hoy descarga también el Admin y las gráficas.
- [ ] `/consola` monta a la vez la réplica y la imagen (sólo las esconde con CSS).
- [ ] Peticiones duplicadas en la misma página (alertas ×2, IMECA ×2, NOAA ×2, forecast ×2,
      camera/status en 5 componentes).
- [ ] Un `usePolling` común: pausa con la pestaña oculta, cancela respuestas viejas.
      Inicio hace ~11 consultas/min por pestaña, nunca se pausa.
- [ ] Relojes de 1 s que redibujan componentes enormes (ConsoleReplica completa).

## Fase 3 — Estructura

- [ ] **Partir `main.py` en routers** por área (ingesta, admin, estaciones, cámara,
      pronóstico, radar, dispositivos…), sin cambiar URLs. Antes: `state.py` (estado
      compartido: `storage`, `latest_by_station`, `alert_service`, cachés), `deps.py`
      (`require_admin` como `Depends`, ubicación de la estación), `tasks.py`. Respetar el
      orden de rutas que importa (`/camera/best/{date}.jpg`, `/radar/sacmex/archive`…).
- [ ] Dashboard: primitivas del Admin a `admin-ui.tsx` (Toggle ×7, TextField ×4,
      NumField ×3), tipos compartidos (Station/SensorDetail/Imeca/Metar… repetidos),
      helpers de fecha (días/meses en 12 lugares), dividir ConsoleReplica, AdminWizard,
      AdminPublicacion (8 tarjetas casi iguales → una data-driven).

## Fase 4 — Limpieza

- [ ] Código muerto verificado (funciones sin llamadas, atributos que nadie lee,
      `useIsMobile`, exports de `theme/constants`, `NAV_SOON`…).
- [ ] Duplicación backend: 26 `getattr(settings, "cwop_latitude", …)`, patrón de caché
      TTL repetido en ~13 servicios, xweather/netatmo copia uno del otro, brújula ×5,
      SMTP/Telegram del asistente reimplementados.
- [ ] Dependencias: `paho-mqtt` 1.6 → 2.x (cambia la API), eslint 8 (sin soporte),
      lucide-react muy viejo; Node 22 en CI vs 20 en Docker.
- [ ] Repo: capturas de `docs/` de hasta 7 MB (comprimir), Grafana monta una carpeta que
      no existe, carpetas que parecen abandonadas (decidir con el usuario).

## Cómo se trabaja

Cada fase en commits chicos; `pytest` + `ruff` + `tsc` + lint antes de cada push; deploy
y verificación en producción (las dos estaciones entran, passkey desconocido → 403).
Las fases 0 y 1 primero; las demás se pueden reordenar.
