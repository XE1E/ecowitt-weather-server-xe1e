# Plan: rediseño del panel Admin (config por estación) + depuración

> Estado: **propuesta** (2026-07-24). Ejecutar por etapas, con deploy y verificación
> en cada una. Es un sistema en producción con estaciones reales — cambios
> incrementales, sin romper la resolución de estaciones ni el whitelist.

## 1. Objetivo / visión

Consolidar **todo lo relativo a cada estación en su propia página de configuración**
(Estaciones → eliges una → una sola página con todas sus tarjetas), en vez de tener
el ajuste de una misma estación repartido en varias páginas con selector
(Alertas, Calibración, Publicación…). Objetivo: "todo lo de la estación, junto".

Lo verdaderamente **global** (no por estación) se queda en su propia página.

## 2. Estado actual (as-is)

**Páginas admin (nav):** Dashboard · Estaciones · Alertas · Calibración · Publicación
· Notificaciones · Integraciones · Sistema · Actualizaciones.

**Con selector por-estación (principal/secundaria):** `AdminAlertas`,
`AdminCalibracion`, `AdminEstacionConfig`, `AdminNotificaciones`.

**`AdminEstacionConfig`** (por estación, `isPrincipal = station.name === null`) ya
tiene tarjetas: General (nombre, watchdog), **Registro** (recién integrado), Servicios
(alertas/publicación/MQTT on-off), Sensor integrado (altitud, "a la intemperie"),
Sensores WN31, Otros sensores.

**Modelo de datos: YA es por-estación** (en `settings.json`, `stations.<nombre>`):
`label`, `watchdog_*`, `alerts_enabled`, `publish_enabled`, `mqtt_enabled`,
`treat_indoor_as_outdoor`, `altitude_m`, `calibration` (dict cal_*),
`alert_thresholds` (dict alert_*). El registro (passkey→nombre) vive en
`secondary_stations` (string) + `primary_passkey`. La principal usa los globales de
`settings` (calibración/alertas/altitud globales).

→ El rediseño es sobre todo **consolidación de UI/IA**, no reescritura del backend.

## 3. Deuda técnica a depurar

1. **Dos mecanismos de passkey de secundarias:**
   - `secondary_stations` (string "passkey:nombre,…") → parseado por la @property
     `settings.secondary_station_map` → **es el que USA `resolve_station`** (el real).
   - `station_passkeys` (dict en `settings.json`) → lo escribe `create_station` /
     `delete_station`, pero **NUNCA se lee para resolver** → **código muerto**.
   - **Acción:** eliminar `station_passkeys`; que `create_station`/`delete_station`
     operen sobre `secondary_stations` (usar los helpers del registro).
2. **Bug no-op en `create_station`:** `settings.secondary_station_map[pk] = name`
   modifica el dict TEMPORAL que devuelve la @property → se descarta. Quitar.
3. **Caminos de alta duplicados:** el alta vieja (`AdminEstaciones` → `create_station`,
   con passkey manual, roto) y los endpoints nuevos `/api/admin/registry` (por MAC,
   funcionan). **Unificar** el alta para que pase por el registro (por MAC).
4. **`passkey_hint`** en `/api/stations` sale de `station_passkeys` (muerto) →
   alinear a `secondary_stations` (o a `/api/admin/registry`).
5. **Fuente canónica de `secondary_stations`:** hoy puede estar en `.env` Y en
   `settings.json` (ahora editable). Definir: `settings.json` = fuente en runtime;
   `.env` = solo semilla inicial. Documentarlo.
6. **Consistencia nombre↔config↔registro:** el registro se indexa por passkey→nombre;
   la config por nombre. Garantizar que dar de alta cree ambos y que borrar limpie
   ambos (registro + `stations.<nombre>` opcional, conservando histórico).

## 4. Diseño objetivo (to-be)

**`AdminEstacionConfig` = hub único por estación.** Tarjetas:

| Tarjeta | Contenido | De dónde se mueve |
|---|---|---|
| General | nombre/label, watchdog | ya está |
| **Registro** | MAC→passkey; whitelist (principal) | ya integrado |
| Servicios | on/off de alertas, publicación, MQTT | ya está |
| Alertas | umbrales por estación (temp/presión/…) | de `AdminAlertas` (parte por-estación) |
| Publicación | a qué redes publica esta estación | de `AdminPublicacion` (parte por-estación) |
| Calibración | offsets + altitud | de `AdminCalibracion` (parte por-estación) |
| Sensores | WN31 / otros (nombres, señal) | ya está |

**`AdminEstaciones` (lista):** lista + "Agregar estación" **por MAC** (crea config +
registra en un paso), unificado con el registro.

**Páginas globales que se quedan** (lo que NO es por-estación): credenciales globales
de publicación (cuentas WU/PWS/…), Notificaciones (Telegram/correo global),
Integraciones, Sistema, Actualizaciones, Dashboard.

**Se retiran / simplifican:** `AdminRegistro` (ya retirada). `AdminAlertas`,
`AdminCalibracion`, `AdminPublicacion`: quitan su selector por-estación (esa función
pasa a la config); quedan solo con lo global/principal, o se integran del todo.
Decidir por página en su etapa.

## 5. Cambios backend (depuración)

- Eliminar `station_passkeys` (escritura + `passkey_hint`); leer/escribir todo desde
  `secondary_stations`.
- `create_station`: aceptar **MAC** (derivar con `passkey_from_mac`), registrar en
  `secondary_stations` (vía los helpers de `/api/admin/registry`), crear la config
  por defecto, y quitar el no-op. Alternativa: que el alta del frontend llame a
  `POST /api/admin/registry/secondary` + crear config.
- `delete_station`: quitar de `secondary_stations` (ya hay `DELETE
  /api/admin/registry/secondary/{name}`), opcional borrar la config.
- Migración: al arrancar, si existe `station_passkeys` con entradas y no están en
  `secondary_stations`, fusionarlas una vez y luego ignorar/eliminar la clave.
- Semilla: si `settings.json` no trae `secondary_stations`, usar el `.env` (ya pasa
  por el orden de overrides).

## 6. Cambios frontend

- Mover las secciones por-estación de `AdminCalibracion` / `AdminAlertas` /
  `AdminPublicacion` a tarjetas dentro de `AdminEstacionConfig` (reusar sus endpoints
  por-estación: `/api/admin/stations/{name}/calibration`, `/alerts`, y el toggle de
  publicación de la config).
- Simplificar las páginas origen (dejar solo lo global) o retirarlas del nav.
- Alta por MAC en `AdminEstaciones`.
- Limpiar nav/rutas y `docs/GUIA.md` / `docs/api.md` según lo que cambie.

## 7. Migración / compatibilidad

- Respaldar `settings.json` antes de tocar backend (`cp .env`/`settings.json`).
- No perder histórico de InfluxDB (el registro/config no toca datos).
- Preservar el **whitelist**: no romper `resolve_station`; probar que WS2910 +
  GW1100 siguen entrando y que un passkey desconocido se rechaza tras cada cambio.

## 8. Plan por etapas (incremental, con deploy + verificación en cada una)

- **Etapa 0 (HECHA):** whitelist de passkey; registro por MAC (`/api/admin/registry`);
  tarjeta Registro integrada en la config; página `/admin/registro` retirada.
- **Etapa 1 — depuración backend del registro:** eliminar `station_passkeys`, arreglar
  `create_station` (por MAC → `secondary_stations`), unificar alta/baja, `passkey_hint`.
  Verificar resolución + alta/baja end-to-end.
- **Etapa 2 — Alertas a la config:** mover umbrales por-estación a la tarjeta Alertas
  de la config; `AdminAlertas` queda global (toggle global, Telegram/correo).
- **Etapa 3 — Publicación a la config:** tarjeta de publicación por-estación; dejar
  credenciales globales en `AdminPublicacion`.
- **Etapa 4 — Calibración a la config:** tarjeta de calibración + altitud por-estación;
  `AdminCalibracion` global/principal o retirada.
- **Etapa 5 — limpieza:** retirar selectores/páginas redundantes, ajustar nav, docs.

## 9. Riesgos

- Producción en vivo (WS2910 + GW1100 empujando). Cambios chicos, deploy por etapa,
  verificar tras cada uno.
- No romper el whitelist (resolución) ni la config existente (el merge de
  `save_station_config` ya conserva claves — mantener ese cuidado).
- Frontend: `AdminEstacionConfig` crece; considerar dividir en subcomponentes por
  tarjeta para que sea mantenible.
