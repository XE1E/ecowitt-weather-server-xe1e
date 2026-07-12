# Plan — GW1100 como segunda estación (solo lectura)

> Estado: **etapa 1 completada** y mergeada a `main`. El código está listo:
> backend (tagging, filtro, aislamiento), frontend (`/pro/remota` + tarjeta),
> tests y docs. **Pendiente solo**: apuntar el GW1100 real, capturar su passkey,
> ponerlo en `SECONDARY_STATIONS` y desplegar. Ver "Cómo probar sin hardware".
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

---

# Etapa 2 — Multi-Estación Completa

> Estado: **planificada**. Requiere etapa 1 funcionando con hardware real.

## Objetivo

Convertir el sistema de "principal + una secundaria aislada" en una plataforma
**multi-estación completa**: alertas, publicación, watchdog y climatología
configurables por estación; gestión desde el panel admin; vistas comparativas
en el dashboard.

---

## Fase 2.1: Infraestructura Multi-Estación

### A. API de Estaciones (`/api/stations`)

Nuevo endpoint para listar y consultar estaciones:

```
GET /api/stations
```

Respuesta:
```json
{
  "stations": [
    {
      "name": null,
      "label": "Principal (WS2910)",
      "passkey_hint": "...a1b2",
      "last_received": "2026-07-12T22:14:59Z",
      "status": "online",
      "sensors": ["WS69", "WN31x8"]
    },
    {
      "name": "gw1100",
      "label": "Oficina (GW1100)",
      "passkey_hint": "...c3d4",
      "last_received": "2026-07-12T22:10:32Z",
      "status": "online",
      "sensors": ["interior"]
    }
  ]
}
```

- `GET /api/stations/{name}/status` — estado detallado de una estación
- Útil para el panel admin y monitoreo externo (uptime checks)

**Archivos:** `main.py` (endpoints), `config.py` (registro de estaciones)

### B. Vigilancia offline por estación (`station_watchdog`)

Actualmente el watchdog solo vigila la principal. Extender para todas:

1. **Configuración por estación** en `settings.json`:
   ```json
   {
     "stations": {
       "gw1100": {
         "label": "Oficina",
         "watchdog_enabled": true,
         "watchdog_minutes": 10
       }
     }
   }
   ```

2. **Alertas específicas:**
   - Disparo: "⚠️ Estación **Oficina** sin datos hace 10 minutos"
   - Normalización: "✅ Estación **Oficina** de vuelta online"

3. **Lógica:** en el loop del watchdog, iterar `latest_by_station` y verificar
   cada estación con watchdog habilitado.

**Archivos:** `main.py` (watchdog loop), `alerts.py` (mensajes), `settings_store.py`

### C. Resumen diario por estación (`weather_daily`)

El aggregator actualmente solo procesa la principal. Extender:

1. En `rebuild_daily_summaries()` y el cron de resumen:
   - Obtener lista de estaciones desde config
   - Para cada estación: `get_daily_stats(station=name)` → `write_daily_summary(station=name)`

2. El tag `station` ya existe en el schema; solo hay que pasarlo.

3. **Habilita:** climatología, récords y reporte NOAA por estación.

**Archivos:** `aggregator.py`, `storage.py` (ya tiene el param)

---

## Fase 2.2: Panel Admin Multi-Estación

### A. Gestión de estaciones (`/pro/admin` → sección "Estaciones")

Tabla de estaciones con acciones:

| Nombre | Label | Passkey | Última lectura | Estado | Acciones |
|--------|-------|---------|----------------|--------|----------|
| *(principal)* | Casa | ...a1b2 | hace 32s | 🟢 | Editar |
| gw1100 | Oficina | ...c3d4 | hace 2m | 🟢 | Editar · Eliminar |

**Funcionalidades:**
- **Agregar estación:** ingresar passkey + nombre + label (sin tocar `.env`)
- **Editar:** cambiar label, configuración de alertas/publicación
- **Eliminar:** quita del registro (datos históricos permanecen en InfluxDB)
- **Auto-descubrir:** listar passkeys vistos que no están registrados

**Persistencia:** en `settings.json`, no en `.env` (más flexible).

```json
{
  "stations": {
    "gw1100": {
      "label": "Oficina",
      "passkey": "ABC123...",
      "alerts_enabled": false,
      "publish_enabled": false,
      "mqtt_enabled": false,
      "watchdog_enabled": true,
      "watchdog_minutes": 10
    }
  }
}
```

**Archivos:** `admin.py` (CRUD), `AdminPage.tsx` (UI), `settings_store.py`

### B. Configuración por estación

En la pantalla de edición de cada estación:

**Alertas:**
- [ ] Alertas habilitadas
- Umbrales: heredar de principal / personalizar
  - Temp alta/baja, viento, lluvia, presión

**Publicación:**
- [ ] Weather Underground
- [ ] Windy
- [ ] PWSWeather
- [ ] OpenWeatherMap
- [ ] CWOP/APRS
- (cada uno con sus credenciales propias o compartidas)

**MQTT:**
- [ ] Publicar a MQTT
- Topic prefix: `weather/{station}/` (default) o personalizado

**Watchdog:**
- [ ] Vigilar conexión
- Timeout: ___ minutos

### C. Vista de estado / salud

Dashboard de monitoreo (en admin o página dedicada):

- **Tarjetas** por estación: estado, última lectura, latencia
- **Gráfica de uptime** (últimos 7/30 días): barras verdes/rojas por hora
- **Gaps detectados:** periodos sin datos > 5 min
- **Métricas:** lecturas/día, % válidas, latencia promedio

---

## Fase 2.3: Frontend Multi-Estación

### A. Selector de estación global

En la barra superior del dashboard, junto al reloj:

```
[ Principal ▾ ]  →  despliega lista de estaciones
```

- Al seleccionar otra estación, la vista actual recarga con sus datos
- Persiste en `localStorage` (recordar última selección)
- Algunas páginas no aplican (Aeronáutica, Sismos) → selector deshabilitado

**Archivos:** `StationLayout.tsx`, nuevo hook `useStationSelector()`

### B. Página multi-estación (`/pro/estaciones`)

Vista resumen de todas las estaciones en tarjetas lado a lado:

```
┌─────────────────┐  ┌─────────────────┐
│ 🏠 Casa         │  │ 🏢 Oficina      │
│ 24.5°C  58% HR  │  │ 22.1°C  48% HR  │
│ 1014.6 hPa      │  │ 1014.8 hPa      │
│ hace 32s  🟢    │  │ hace 2m  🟢     │
└─────────────────┘  └─────────────────┘
```

- Click en tarjeta → navega a `/pro` o `/pro/remota` según corresponda
- Muestra diferencia de temperatura entre estaciones
- Útil como "home" cuando hay múltiples sitios

**Archivos:** nuevo `MultiStationPage.tsx`, ruta en `main.tsx`

### C. Comparación entre estaciones (`/pro/comparar`)

Seleccionar 2-4 estaciones y ver gráficas superpuestas:

- **Temperatura:** líneas de colores distintos, mismo eje Y
- **Humedad:** ídem
- **Presión:** ídem (útil para validar sensores)

Tabla de diferencias actuales:
| Métrica | Casa | Oficina | Δ |
|---------|------|---------|---|
| Temp | 24.5°C | 22.1°C | -2.4°C |
| Humedad | 58% | 48% | -10% |

Casos de uso:
- Detectar microclimas entre ubicaciones
- Validar calibración de sensores
- Ver desfase temporal de frentes de clima

**Archivos:** nuevo `ComparePage.tsx`, componentes de gráficas compartidos

### D. Widget por estación

Actualizar el sistema de widgets para soportar cualquier estación:

- URL: `/embed?station=gw1100&units=metric&theme=dark`
- En `/pro/compartir`: selector de estación antes de generar código
- El widget muestra el nombre/label de la estación

**Archivos:** `EmbedWidget.tsx`, `ShareEmbedPage.tsx`

---

## Fase 2.4: Sensores Externos del GW1100

### A. Parseo de sensores adicionales

El GW1100 puede conectar sensores externos vía RF 433/915 MHz:
- **WN31/WH31** (hasta 8 canales): temp + humedad
- **WS69/WH65** (sensor 7-en-1): temp, humedad, viento, lluvia, UV, solar

Campos a detectar en el payload:
```
temp1, humidity1, batt1  →  canal 1
temp2, humidity2, batt2  →  canal 2
...
tempf, humidity, windspeed, windgust, winddir, rainrate, uv, solarradiation  →  exterior
```

**Parser:** detectar estos campos y mapearlos igual que en la principal.

**Archivos:** `parser.py` (ya soporta la mayoría), verificar edge cases

### B. UI para sensores remotos

En `/pro/remota`, mostrar dinámicamente según sensores detectados:

- **Solo interior** (default GW1100): tarjeta de interior actual
- **+ Canales WN31:** tarjetas de sensores adicionales (como en principal)
- **+ Exterior:** tarjetas de viento, lluvia, UV/solar

Detectar qué campos tiene `latest_by_station["gw1100"]` y renderizar
componentes correspondientes.

**Archivos:** `RemoteStationPage.tsx`, reutilizar componentes existentes

### C. Alertas de clima para estación remota

Si la estación remota tiene sensores exteriores, habilitar alertas de:
- Temperatura exterior alta/baja
- Viento fuerte / ráfaga
- Lluvia intensa

Configurables en el panel admin por estación (Fase 2.2).

---

## Fase 2.5: Extras (baja prioridad)

Funcionalidades opcionales para considerar después:

- **Exportación por estación:** en Historia, selector de estación para CSV/JSON
- **Notificaciones diferenciadas:** canal de Telegram distinto por estación
- **Métricas de calidad:** dashboard con % lecturas válidas, gaps, latencia
- **Soporte N estaciones:** el código ya está preparado; solo UI para > 2
- **Nombres de canales por estación:** en admin, nombrar "Canal 1" → "Jardín"
  de forma independiente por estación

---

## Resumen de archivos a tocar (Etapa 2)

| Archivo | Cambios |
|---------|---------|
| `receiver/app/config.py` | Cargar estaciones desde settings.json + .env |
| `receiver/app/main.py` | `/api/stations`, watchdog multi-estación |
| `receiver/app/services/alerts.py` | Alertas configurables por estación |
| `receiver/app/services/aggregator.py` | Resumen diario para todas las estaciones |
| `receiver/app/services/mqtt_publisher.py` | MQTT configurable por estación |
| `receiver/app/services/publishers.py` | Publicación configurable por estación |
| `receiver/app/services/admin.py` | CRUD de estaciones, config por estación |
| `receiver/app/services/settings_store.py` | Schema de estaciones en settings |
| `dashboard/src/pages/StationLayout.tsx` | Selector de estación global |
| `dashboard/src/pages/AdminPage.tsx` | Sección gestión de estaciones |
| `dashboard/src/pages/RemoteStationPage.tsx` | Sensores adicionales dinámicos |
| `dashboard/src/pages/MultiStationPage.tsx` | **Nuevo:** vista multi-estación |
| `dashboard/src/pages/ComparePage.tsx` | **Nuevo:** comparación de estaciones |
| `dashboard/src/pages/ShareEmbedPage.tsx` | Selector de estación para widget |
| `dashboard/src/components/station/EmbedWidget.tsx` | Soporte `?station=` |
| `dashboard/src/main.tsx` | Nuevas rutas |
| `tests/` | Tests para nuevas funcionalidades |

---

## Orden de implementación sugerido

1. **Fase 2.1** (infraestructura): API de estaciones, watchdog, resumen diario
2. **Fase 2.2** (admin): gestión y configuración por estación
3. **Fase 2.3** (frontend): selector, multi-estación, comparación
4. **Fase 2.4** (sensores): soporte de sensores externos del GW1100
5. **Fase 2.5** (extras): según necesidad

Cada fase es deployable de forma independiente y añade valor incremental.
