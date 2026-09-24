# Plan: rediseño del panel Admin — por categorías, con la estación adentro

> Estado: **✅ TERMINADO 2026-09-24** (etapas 1-4, cada una desplegada y verificada) (deploy y verificación en
> cada una). Sustituye la propuesta del 2026-07-24 ("una página por estación con todas
> sus tarjetas"), que se descartó: ver §1.

## 1. Por qué por categorías y no por estación

Inventario del 2026-09-24 (12 páginas + backend):

- **Casi todo es del sistema, no de una estación.** Publicación (credenciales una por
  red), MQTT/Home Assistant, cámara, notificaciones, respaldos, sismos y calidad del
  aire sólo existen para la principal o son globales (`main.py`: la publicación y MQTT
  corren sólo si `station is None`). El GW1100 sólo tiene ajustes propios en tres
  cosas: **umbrales de alertas, calibración y la ficha** (nombre, altitud, "sin datos").
- Una página por estación dejaría la del GW1100 casi vacía y las páginas de categoría
  seguirían existiendo para lo global: dos lugares para lo mismo.
- La **Etapa 1 del plan viejo ya estaba hecha** (commit `f27f5b6`): `station_passkeys`
  retirado, no-op de `create_station` arreglado, alta por MAC, baja, `passkey_hint`.

## 2. Diseño objetivo

**Patrón único en las páginas de categoría:** arriba lo GLOBAL (aplica a todo); abajo
**pestañas por estación** (Principal · GW1100) con lo propio de cada una. La pestaña va
en la URL (`/admin/alertas?estacion=gw1100`) para enlazarla directo. Sin secundarias,
no hay pestañas.

- **Alertas.** Global: interruptor maestro, estado de Telegram/correo, batería, sensor
  perdido/atorado, persistencia, calidad del aire, sismos, cámara, respaldos, redes
  públicas, ventanas de tendencia. Por estación: umbrales + reglas desactivadas + el
  aviso de **"sin datos" (minutos) — sólo aquí**.
- **Calibración.** Por estación: habilitada, offsets por sensor, presión y la
  **altitud — sólo aquí** (de ella depende la presión a nivel del mar).
- **Estación (ficha).** Nombre, registro (MAC), nombres de sensores y un **resumen con
  accesos directos** en vez de casillas: "Alertas: umbrales propios → editar",
  "Calibración: presión +0.8 hPa → editar". Así se conserva "todo lo de la estación a
  la vista" sin duplicar ningún ajuste.
- **Sistema.** Ubicación única (lat/lon/zona horaria) que usan CWOP y AWEKAS (hoy
  AWEKAS tiene coordenadas propias: confirmar al migrar que no difieran a propósito).

**Menú agrupado** (hoy 10 entradas sueltas):
Estado (Dashboard, Estaciones) · Datos (Calibración, Alertas) · Salidas (Publicación,
Notificaciones, Integraciones) · Cámara · Sistema (Sistema, Actualizaciones).

## 3. Etapas

### Etapa 1 — limpieza sin mover nada de lugar
- [x] **Asistente (bugs reales):** manda el SMTP con claves que no existen
      (`email_smtp_host`… en vez de `smtp_host`…, las descarta `/api/admin/settings`
      en silencio) y el nombre a `PUT /api/admin/stations/_principal`, que no existe
      (es `PUT /api/stations/_principal` con `{config:{label}}`).
- [x] **Quitar casillas que no hacen nada** de "Servicios para esta estación":
      `publish_enabled` y `mqtt_enabled` por estación (nadie los lee); en la principal,
      `alerts_enabled` y `watchdog_enabled` (se ignoran, manda el global).
- [x] **Quitar `treat_indoor_as_outdoor`** (fue una prueba; apagado en las dos
      estaciones al 2026-09-24): toggle de la ficha, lectura en Calibración, rama en
      `main.py` al ingerir, default en `settings_store.py`, y la clave guardada.
- [x] **Borrar `pages/AdminPage.tsx`** (panel viejo, sin ruta ni import).
- [x] **Un solo camino de alta:** la tarjeta Registro de la ficha usa
      `POST /api/admin/registry/secondary` (no crea config, reglas distintas) y el
      modal usa `POST /api/admin/stations`. Dejar uno. **Hecho 2026-09-24:** el alta es
      sólo `POST /api/admin/stations`; `registry/secondary` quedó para CAMBIAR la MAC de
      una secundaria existente (404 si no existe; rechaza la MAC de la principal o de
      otra estación). Las claves retiradas se filtran al leer/guardar
      (`settings_store.RETIRED_STATION_KEYS`).

### Etapa 2 — un solo lugar por ajuste — HECHA 2026-09-24
- [x] "Sin datos": la principal usa sólo `alert_station_offline_minutes` (Alertas);
      `stations._principal.watchdog_minutes` ya no cuenta (se ignora al leer y se quita
      al guardar: `settings_store.RETIRED_PRINCIPAL_KEYS`, junto con `watchdog_enabled`,
      `alerts_enabled` y `altitude_m`). Las secundarias: alertas on/off, watchdog y
      minutos en Alertas (vista de la estación). Fuera de Sistema y de la ficha.
- [x] Coordenadas: sólo en Sistema (`cwop_latitude`/`cwop_longitude`, el nombre es
      histórico). AWEKAS dejó de tener las suyas (`awekas_latitude/longitude` retiradas;
      eran idénticas) y Publicación sólo las muestra. El asistente las sigue pidiendo
      (es la primera configuración).
- [x] Altitud del GW1100: sólo en Calibración.
- [x] `publish_enabled` de la principal en `/api/stations`: quitado en la etapa 1.
- [x] Adelanto de la etapa 3: la ficha trae accesos directos a Alertas/Calibración con
      `?estacion=<nombre>`, que ambas páginas ya entienden.

### Etapa 3 — pestañas por estación + ficha — HECHA 2026-09-24
- [x] `StationTabs` (components/admin-ui.tsx) en Alertas y Calibración, en lugar del
      `<select>`. La pestaña va en la URL: `?estacion=gw1100` / `?estacion=principal`.
- [x] Alertas con pestaña **General** primero (interruptor maestro, Telegram/correo,
      batería, sensor perdido/atorado, persistencia, aire, sismos, cámara, respaldos,
      redes) y luego Principal y cada secundaria con sus umbrales y su «sin datos».
      Sin secundarias no hay pestañas y todo sale junto, como antes.
- [x] Ficha: los accesos a Alertas y Calibración muestran un resumen de lo que tiene
      esa estación (activas, «sin datos», reglas desactivadas; calibración, presión,
      altitud). Para la principal sale de la configuración global.

### Etapa 4 — menú y documentación — HECHA 2026-09-24
- [x] Menú agrupado (`AdminLayout`, `NAV_GROUPS`); en celular con fondo sólido.
- [x] `docs/GUIA.md` y `README.md` al día (`api-reference.md` no cambia: no hubo
      endpoints nuevos; `registry/secondary` ya sólo cambia la MAC).
- [x] En celular el menú lateral arrancaba ABIERTO encima de la página: ahora empieza
      cerrado bajo `lg` y se cierra al elegir una opción (adelantado en la etapa 3).

## 4. Cuidados (producción en vivo)

- WS2910 + GW1100 empujando: no romper `resolve_station` ni el whitelist; tras cada
  etapa, comprobar que las dos siguen entrando y que un passkey desconocido se rechaza.
- Respaldar `/data/settings.json` antes de tocar claves guardadas.
- El merge de `save_station_config` conserva claves: al retirar una, quitarla también
  de lo guardado (o ignorarla) para que no reaparezca.
