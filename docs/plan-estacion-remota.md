# Plan — GW1100 como segunda estación (solo lectura)

> Estado: **etapa 1 implementada** en la rama `feat/estacion-remota` (backend +
> frontend + tests + script de simulación). Pendiente: apuntar el GW1100 real,
> capturar su passkey, ponerlo en `SECONDARY_STATIONS` y desplegar. Ver
> "Cómo probar sin hardware" más abajo.
> Hardware: Ecowitt **GW1100** (gateway WiFi con sensor interconstruido de
> temperatura, humedad y presión barométrica de interior). Se usará en primera
> etapa **solo** con su sensor interconstruido, enviando al mismo VPS que la
> estación principal (WS2910 + WS69 + WN31).

## Objetivo y principios

- **Meta:** el GW1100 envía sus datos de interior al **mismo VPS**, quedan
  **separados** de la estación principal, y se muestran en una **pestaña nueva**
  del dashboard (`/pro/remota`) en modo solo lectura: condiciones actuales,
  historial y estadística.
- **Principio rector:** *cero impacto* en la estación principal. Ni alertas, ni
  publicación a redes públicas (WU / PWSWeather / Windy / OWM / CWOP), ni MQTT
  para el GW1100. Si algo falla en la etapa 1, la principal sigue igual.

## Decisión de arquitectura clave

**Solo se etiquetan las estaciones secundarias.** La principal se queda *sin*
tag `station`, igual que hoy.

Motivo: el histórico actual en InfluxDB **no tiene** tag `station`. Si
etiquetáramos la principal con `station="principal"`, toda consulta con filtro
dejaría fuera los datos viejos (sin tag) → habría que reescribir el histórico
(backfill), doloroso en InfluxDB.

Con "solo etiquetar secundarias":

- **Principal** = registros *sin* tag `station` (viejos y nuevos) → semántica
  idéntica a hoy.
- **GW1100** = registros con `station="gw1100"`.
- Lógica de consulta centralizada:
  - `station=None` → filtro `not exists r["station"]` (principal).
  - `station="gw1100"` → filtro `r["station"] == "gw1100"`.
- **Solo hay que configurar el passkey del GW1100.** Cualquier passkey
  desconocido se trata como principal.

⚠️ **Riesgo a cuidar:** como la secundaria *sí* lleva tag, cualquier consulta
que se nos olvide filtrar incluiría datos del GW1100 mezclados en los campos de
interior (`tempinf` / `humidityin` / presión, que ambos comparten). Por eso el
filtro "principal = `not exists r["station"]`" debe inyectarse en **todos** los
métodos de `storage.py`, no solo en los tres que alimentan la página nueva.

---

## Parte A — Backend (receiver)

### A1. Registro de estaciones (config)

- `config.py` + `.env.example`: nueva variable con el mapa de secundarias:

  ```
  SECONDARY_STATIONS=<passkey_gw1100>:gw1100
  ```

  (formato `passkey:nombre`, separado por comas para futuras estaciones).
  Parsear a `dict {passkey: nombre}` en settings.

- **Cómo obtener el passkey del GW1100:** apuntarlo al VPS y leer el log. Hoy
  `describe_device()` (`parser.py`) ya loguea `stationtype`; añadir
  temporalmente el `passkey` al log o mirar el raw. Se captura una vez y se pone
  en `.env`.

### A2. `parser.py`

- Nueva función `resolve_station(parsed) -> Optional[str]`: si
  `passkey ∈ SECONDARY_STATIONS` → devuelve el nombre; si no → `None`
  (principal).
- Guardar el resultado en `parsed["station"]` **solo si no es None**.
- Añadir `"station"` a `TAG_FIELDS` para que `get_tags()` lo escriba como tag.
  `passkey` sigue como metadato (no tag).

### A3. Estado en memoria por estación (`main.py`)

- Convertir el global `latest_data` en `latest_by_station: Dict[Optional[str], dict]`.
- En `receive_ecowitt_data`:
  1. Determinar `station` tras parsear.
  2. Pasar al `spike_check` la lectura **previa de esa misma estación**
     (`latest_by_station.get(station)`), no la global → evita falsos picos por
     mezclar estaciones.
  3. Guardar en `latest_by_station[station]`.
- En el arranque (`get_latest`): restaurar por estación (principal + cada
  secundaria).

### A4. Aislar alertas / MQTT / publicadores (el "sin alarmas")

En `receive_ecowitt_data`, envolver estos bloques con `if station is None:`
(solo principal):

- `mqtt_publisher.publish`
- `alert_service.process`
- `publish_all`

El `station_watchdog` sigue vigilando **solo la principal** en etapa 1 (el
GW1100 offline no dispara aviso). Nota para etapa 2.

### A5. `storage.py` — hilo del parámetro `station`

Añadir `station: Optional[str] = None` a **todos** estos métodos e inyectar el
filtro correspondiente (`not exists r["station"]` si es None,
`r["station"] == station` si no):

- `get_latest`
- `query`
- `get_daily_stats`
- `get_comparison`
- `get_field_value_ago`
- `query_daily_summaries` / `write_daily_summary` (weather_daily)

`write()` **no cambia**: ya escribe tags vía `get_tags()`, así que el nuevo tag
`station` sale gratis.

### A6. Endpoints (`main.py`)

- Añadir query param `station: Optional[str] = None` a los tres que alimentan la
  página nueva:
  - `/api/current`
  - `/api/history`
  - `/api/stats/daily`
- Los demás endpoints (records, climate, wind/rose, almanac, forecast/local,
  alerts, metar, satellite, airquality, earthquakes) quedan **solo-principal**
  automáticamente porque sus métodos de storage llevan por defecto el filtro
  `not exists r["station"]`. No se les añade param.

### A7. `aggregator.py`

- Revisar que el resumen diario (`weather_daily`) consulte y escriba **solo
  principal** (pasar `station=None`). El resumen diario del GW1100 queda fuera
  de la etapa 1.

---

## Parte B — Frontend (dashboard)

### B1. Página y ruta nuevas

- `main.tsx`: nueva ruta bajo `/pro`, p. ej.
  `<Route path="remota" element={<RemoteStationPage />} />`.
- `StationLayout.tsx`: añadir a `NAV_ACTIVE` un link
  `{ to: '/pro/remota', label: 'Estación remota' }` (o el nombre del sitio del
  GW1100).

### B2. Datos: página autocontenida (no tocar `StationDataProvider`)

- Crear `RemoteStationPage.tsx` con su **propio hook de fetch** (patrón de
  `App.tsx`), apuntando a:
  - `/api/current?station=gw1100`
  - `/api/history?start=-24h&station=gw1100`
  - `/api/stats/daily?station=gw1100`
- Así el proveedor de datos de la principal **no se modifica** → garantiza "sin
  afectar la principal".

### B3. Componentes a reutilizar / adaptar

- **`InteriorCard`** — ya muestra temp/humedad/presión de interior (campos que
  envía el GW1100: `temperature_indoor`, `humidity_indoor`,
  `pressure_absolute` / `pressure_relative`). Reutilizable casi tal cual.
- **`StatsSummary` / `MiniStats`** — min/máx/prom de temperatura y humedad
  interior.
- **`TemperatureChart` / `HistoryCharts` / `StationTempChart`** — ⚠️ hoy hacen
  `fetch('/api/history')` sin parámetro. Hay que **añadirles un prop `station`**
  (o `historyUrl`) para que consulten `?station=gw1100`. Es el punto de frontend
  que más cuidado pide.
- La página **no** incluye: `AlertsPanel`, viento, lluvia, UV/solar, pronóstico,
  publicación. Solo interior + historial + estadística (y "algo más" que se
  decida después, en esa misma página).

---

## Parte C — Config, datos y docs

- `.env.example`: documentar `SECONDARY_STATIONS` y cómo capturar el passkey.
- Config del GW1100 en la app **WSView Plus**: Customized → Protocol: Ecowitt →
  Server/IP = dominio o IP del VPS, Path `/data/report`, Port según Caddy/8080,
  Upload Interval ~60 s.
- Actualizar `docs/GUIA.md` con la sección de estación remota.

## Parte D — Pruebas

- `tests/test_parser.py`: casos de `resolve_station` (passkey conocido → nombre;
  desconocido → None) y de que `station` aparece en tags solo para secundarias.
- Manual / skill `verify`: apuntar el GW1100, confirmar en InfluxDB dos series
  separadas, confirmar que el dashboard principal **no cambia**, y que
  `/pro/remota` muestra el interior del GW1100.

## Cómo probar sin hardware

Con el stack corriendo (VPS o PC nueva con Docker + `.env`):

1. Registrar un passkey ficticio en `.env` y reiniciar el receiver:
   ```
   SECONDARY_STATIONS=F00DCAFEF00DCAFEF00DCAFEF00DCAFE:gw1100
   ```
2. Ejecutar el simulador (envía 12 lecturas de interior):
   ```
   ./scripts/simulate-gw1100.sh              # localhost:8080
   ./scripts/simulate-gw1100.sh https://tu-dominio/data/report
   ```
3. Abrir `/pro/remota` en el dashboard → deben aparecer temperatura/humedad/
   presión de interior, estadística e histórico. Confirmar que la estación
   **principal** (`/pro`) no cambia.

Cuando llegue el GW1100 real: capturar su passkey del log del receiver,
sustituirlo en `SECONDARY_STATIONS` y listo (el nombre `gw1100` ya está cableado
en el frontend; si usas otro nombre, ajústalo en `RemoteStationPage.tsx`).

## Orden de despliegue sugerido

1. **Backend** (tagging + filtro primario + aislar alertas + estado por
   estación) → desplegar. La principal sigue igual; aún no hay secundaria.
2. **Apuntar el GW1100** al VPS, capturar passkey, ponerlo en `.env`, reiniciar.
3. **Frontend** (página `/pro/remota` + props `station` en los charts).
4. **Verificar** end-to-end.

## Resumen de archivos a tocar

| Archivo | Cambio |
|---|---|
| `receiver/app/config.py` | var `SECONDARY_STATIONS` |
| `receiver/app/services/parser.py` | `resolve_station()`, `station` en `TAG_FIELDS` |
| `receiver/app/main.py` | estado por estación, aislar alertas/mqtt/publish, param `station` en 3 endpoints |
| `receiver/app/services/storage.py` | param `station` + filtro en todos los métodos de consulta |
| `receiver/app/services/aggregator.py` | forzar `station=None` (solo principal) |
| `dashboard/src/main.tsx` | ruta `/pro/remota` |
| `dashboard/src/pages/StationLayout.tsx` | link en el nav |
| `dashboard/src/pages/RemoteStationPage.tsx` | **nuevo**, autocontenido |
| `dashboard/src/components/*Chart*.tsx` | prop `station` para el fetch |
| `.env.example`, `docs/GUIA.md`, `tests/test_parser.py` | config, docs, tests |

## Notas para etapa 2 (futuro, fuera de alcance ahora)

- Alertas y publicación configurables por estación.
- Vigilancia offline (`station_watchdog`) también para secundarias.
- Resumen diario (`weather_daily`) por estación.
- Selector de estación en el dashboard y panel admin del mapa passkey→nombre.
- Soporte para sensores externos del GW1100 (si más adelante se le añaden T/H
  exterior, viento, lluvia, etc.).
