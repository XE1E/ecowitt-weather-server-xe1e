# Auditoría de datos desplegados

**Fecha:** 2026-08-04
**Alcance:** todo dato mostrado en las páginas públicas, el kiosco y los servicios externos
(Kiosko/Waveshare y Svitrix/Ulanzi): sensores, cálculos derivados, historial, estadística,
tendencias, gráficas y tablas.
**Método:** lectura de código + verificación contra datos reales de `clima.xe1e.net`
(muestra tomada 2026-08-04 15:19 hora local / 21:19 UTC) + recálculo independiente de
las fórmulas meteorológicas y astronómicas.

Severidades:

| Nivel | Significado |
|---|---|
| **A — dato incorrecto** | lo que se muestra es numéricamente falso o está en otra unidad |
| **B — etiqueta engañosa** | el número es correcto pero el rótulo dice otra cosa |
| **C — dato ausente como cero** | falta el dato y se pinta `0`, indistinguible de un cero real |
| **D — código muerto / deuda** | no afecta lo que se ve, pero sobra o es trampa de mantenimiento |

---

## Corregidos el 2026-08-04

| # | Arreglo | Archivos |
|---|---|---|
| 1 | IMECA: volumen molar a la presión real de la estación | `imeca.py`, `main.py` |
| 21b | `/api/svitrix` responde 503 si no hay ninguna lectura, en vez de nulos | `main.py` |
| 22 | Kiosco pág. 3: exterior (WN32) e interior (GW1100) separados | `KioskPage.tsx` |
| 7 + 31 | `uv` → `uv_index`: el QC de UV ya se aplica y el UV ya se publica a las 4 redes | `quality.py`, `publishers.py` |
| 23 | `local_day_bounds_utc()` resuelve el día local por sí misma; fuera los 3 `datetime.now()` naive | `aggregator.py`, `main.py` |
| 33 | Selector de día de Historia con fecha local | `HistoryPage.tsx` |
| 35 | Antigüedad del METAR con `parseServerDate` (que ahora normaliza el separador) | `AtmosphericProfile.tsx`, `weather.ts` |
| 32 | Docstring de AWEKAS corregido: son mm directos, con advertencia de no "arreglarlo" | `publishers.py` |
| 2 + 8 | La gráfica multivariable convierte al sistema activo; ejes, tooltip y datos coinciden | `MultiVariableChart.tsx`, `units.tsx` |
| 3 | `groupByDay` usa el máximo de `rain_daily` en vez de sumar tasas | `MultiVariableChart.tsx` |
| 16 | Fuera `connectNulls`: los huecos de datos se ven como huecos | `MultiVariableChart.tsx` |
| 19 | Ausencia → `--` en lugar de `0` (kiosco, Inicio, MiniStats, Precipitación) | 4 componentes |
| 13 | "Sin lluvia en N h" derivado de la ventana real, no un "24h" fijo | `PrecipitationCard.tsx` |

Detalle de #2: `data` se mantiene en métrico y un `useMemo` lo convierte según el sistema, así
que cambiar de unidades no vuelve a pedir datos. Se añadieron `rainN` y `rateN` a `units.tsx`,
que solo tenía conversores numéricos de temperatura, viento y presión.

Dos trampas que aparecieron al convertir, ambas resueltas:

- **El rango mínimo de los ejes era un delta en unidades métricas.** Para temperatura no vale
  `tempN`, que es afín: 5 °C de rango son **9 °F**, no 41. Presión y viento sí son
  multiplicativos y `pressN(5)` funciona como delta.
- **Los límites y ticks se redondeaban a entero.** Con la presión en inHg (~30.3) eso dejaba
  el eje en `[30, 31]` y **los cinco ticks en "30"**. Ahora los decimales salen del ancho del
  rango. Verificado: en inHg salen `30.2 / 30.25 / 30.3 / 30.34 / 30.39`.

Detalle de #3: la serie de lluvia cambia de magnitud con el modo, a propósito — intensidad
(mm/h, pico de la hora) en día y 48 h, acumulado (mm, máximo de `rain_daily`) en semana. El
nombre de la serie y la unidad del eje siguen al modo, porque presentar las dos como
"Precipitación · mm" era parte del problema. Con las lecturas de un día de lluvia real: antes
la barra semanal marcaba 7 "mm" de sumar tasas, ahora marca los **6.8 mm** que cayeron.

Verificación: `npx tsc --noEmit` limpio, `pytest receiver/tests` 97 pasan, y cada arreglo
probado contra su síntoma:

| Arreglo | Antes | Ahora |
|---|---|---|
| IMECA (ozono 150 µg/m³) | 62 "Regular" | 104 "Mala" |
| QC de UV (`uv_index=99`) | pasaba sin filtrar | rechazado |
| UV a WU / Windy / AWEKAS | campo ausente | `UV=7`, `uv=7`, campo 18 = `7` |
| Día local a las 20:00 de CDMX | rango desde `2026-08-05T06:00Z` (futuro) | `2026-08-04T06:00Z` |
| Antigüedad de un METAR de 90 min | "hace 0 min" | "hace 90 min" |

`parseServerDate` se comprobó retrocompatible con los tres formatos que ya recibía
(naive con `T`, con offset `+00:00`, y con `Z`).

El IMECA además se validó en sus tres propiedades: las partículas no cambian (ya vienen en
µg/m³), solo suben los gases, y sin presión el resultado es idéntico al anterior.

Detalle del #21b — por qué 503 solo en ese caso: el firmware de Svitrix reinicia el ESP32
tras `max(5 × intervalo, 15 min)` sin un fetch con HTTP 200
(`DataFetcher.cpp:150-156`, `ESP.restart()`). Devolver error mientras la estación está caída
lo dejaría en **ciclo de reinicios cada 15 minutos**, que es peor que mostrar un dato viejo.
Con lectura disponible —aunque sea vieja— se sigue sirviendo; el 503 cubre solo el arranque en
frío sin histórico, que es transitorio.

El arreglo redondo de #21b necesita también el firmware: distinguir *"el servidor respondió
pero no tiene dato"* de *"no pude hablar con el servidor"*, para no contar el primero como
fallo de red. Hoy el firmware ya hace eso cuando falta el objeto `current`
(*"leave health/retry untouched"*), pero **tampoco** actualiza `lastWeatherSuccessMs_`, así
que a la larga reinicia igual.

---

## Resumen

| # | Hallazgo | Sev. | Dónde se ve |
|---|---|---|---|
| 1 | ~~IMECA subestimado ~28 % por volumen molar de otra altitud~~ **CORREGIDO** | **A** | Calidad del aire, Inicio, kiosco pág. 1 |
| 2 | Gráfica multivariable: tooltip dice °F/mph con valores en °C/km-h | **A** | Historia, kiosco pág. 5 |
| 3 | `groupByDay` suma intensidades de lluvia (mm/h) como si fueran mm | **A** | Historia (modo semana) |
| 4 | VPD servido en pulgadas de mercurio y guardado así en InfluxDB | **A** | `/api/current`, MQTT/HA |
| 5 | Grados-día y ET₀ sin convertir en modo imperial | **A** | Estadísticas |
| 6 | Base de nubes siempre en metros, aun en imperial | **A** | Inicio |
| 7 | QC de UV nunca se ejecuta (clave mal escrita) | **A** | todo el sitio |
| 8 | Eje de precipitación rotulado "mm" siendo mm/h | **B** | Historia, kiosco pág. 5 |
| 9 | "Lluvia diaria": promedio y mínimo de un contador acumulado | **B** | Estadísticas |
| 10 | "vs ayer" es en realidad 24 h rodantes vs las 24 h previas | **B** | Inicio (MiniStats) |
| 11 | Dos tarjetas "Días de lluvia" con cálculos distintos en la misma página | **B** | Estadísticas |
| 12 | Grados-día etiquetados "estándar NOAA" con otro método de cálculo | **B** | Estadísticas |
| 13 | "24h sin lluvia" mirando solo 8 horas de pronóstico | **B** | Inicio |
| 14 | Condición del tiempo por radiación absoluta: "Nublado" al amanecer despejado | **B** | Inicio, Svitrix, kiosco |
| 15 | Base de nubes AGL sin decirlo (2 412 m ≈ altitud de CDMX: confusión) | **B** | Inicio |
| 16 | `connectNulls`: las líneas atraviesan los huecos de datos | **B** | Historia, kiosco pág. 5 |
| 17 | Tendencia "estable" cuando no hay dato para compararla | **B** | Inicio |
| 18 | Flechas verde/rojo por sube/baja en magnitudes sin valencia | **B** | Inicio |
| 19 | Ausencia→cero en humedad, presión, viento, lluvia y UV | **C** | kiosco pág. 1, Inicio |
| 20 | O₃/NO₂/SO₂ como `0` hacia Svitrix — *revisado: el firmware ya trata 0 como inválido* | **D** | reloj Ulanzi |
| 21 | `last_updated` de Svitrix mal formado — *revisado: el firmware no lo lee* | **D** | — |
| 21b | Estación caída → el reloj Svitrix muestra **0 °C** como medición válida | **A** | reloj Ulanzi |
| 21c | Falta `is_day`: el reloj no puede distinguir ícono diurno de nocturno | **B** | reloj Ulanzi |
| 21d | Presión absoluta del BME280 y relativa de la estación con el mismo formato | **B** | kiosco pág. 1 vs 2 |
| 21e | `POST /api/kiosk/local` sin autenticación, sin rate-limit y sin QC | **D** (seg) | kiosco pág. 2 |
| 22 | GW1100: se lee solo `temperature_indoor` (se rompe al activar "intemperie") | **A** (latente) | kiosco pág. 3 |
| 23 | `datetime.now()` sin zona en 3 endpoints | **A** (latente) | Estadísticas, kiosco |
| 24 | `/api/display` duplicado y sin consumidores (~190 líneas) | **D** | — |
| 25 | `/api/climate/daily` sin consumidores | **D** | — |
| 26 | `/api/rain/last` baja 90 días de datos para hallar un valor | **D** (perf) | Inicio |
| 27 | `get_daily_stats`: 42 consultas a InfluxDB por llamada | **D** (perf) | varias |
| 28 | Cachés sin cota en endpoints públicos sin rate-limit | **D** (seg) | — |
| 29 | Tres convenciones de rumbo simultáneas | **D** | varias |
| 30 | `runtime`/`heap`/`interval` escritos como mediciones | **D** | InfluxDB |

---

## A — Dato incorrecto

### 1. IMECA subestimado ~28 % (`imeca.py:72-74`)

```python
def _ugm3_to_ppm(v: float, mw: float) -> float:
    """µg/m³ → ppm a 25 °C y 1 atm (volumen molar 24.45 L/mol)."""
    return v * 24.45 / (mw * 1000.0)
```

24.45 L/mol es el volumen molar a **1 atm** (1013 hPa). La estación está a ~779 hPa. El
volumen molar local es ~31.3 L/mol, así que las ppm salen ~28 % bajas — y O₃, NO₂, SO₂ y
CO se evalúan **en ppm** contra las tablas de la norma.

Con ozono de 150 µg/m³:

| Volumen molar | ppm | IMECA | Categoría |
|---|---|---|---|
| 24.45 (actual) | 0.0764 | **62** | Regular |
| 31.3 (local) | 0.0978 | **103** | **Mala** |

Cruza el umbral donde aparecen las recomendaciones para grupos sensibles. Las **seis tablas
de puntos de corte están correctas** (verificadas contra NADF-009-AIRE-2017); el error está
solo en la conversión.

Nota: en cualquiera de las dos lecturas posibles de la norma (condiciones locales reales, o
las condiciones de referencia de la CDMX ~780 hPa/25 °C → 31.8 L/mol) el valor correcto está
cerca de 31, no de 24.45.

**Se ve en:** `AirQualityPage` (vía `ImecaCard`), `MiniStats` en Inicio, y **página 1 del
kiosco** (`KioskPage.tsx:82`) — o sea también en el display físico.

### 2. Tooltip de la gráfica multivariable con la unidad equivocada (`MultiVariableChart.tsx`)

Los datos se grafican en **métrico crudo** (líneas 81-85: `p.temperature_outdoor` sin
convertir) y los ejes están rotulados con literales `'°C'`, `'hPa'`, `'mm'`, `'km/h'`
(líneas 194, 207, 220, 233). Pero el tooltip sí consulta el sistema activo:

```ts
formatter={(v: number, name: string) => {
  const unit = getUnit(name, u)      // devuelve u.tempU  → '°F' en imperial
  return [`${nf(v)} ${unit}`, name]
}}
```

→ **En modo imperial el tooltip muestra "28.6 °F" para un valor que son 28.6 °C.** El eje
sigue diciendo °C. Igual con viento (km/h etiquetado mph) y presión.

`units.tsx` tiene `tempN`, `windN` y `pressN` documentados como *"Conversores numéricos (para
gráficas)"* — y este componente no los usa.

### 3. `groupByDay` suma intensidades de lluvia (`MultiVariableChart.tsx:415`)

```ts
rain: sum(pts.map((p) => p.rain ?? 0)),   // p.rain = rain_rate, en mm/h
```

En modo semana la barra de precipitación **suma las tasas horarias**. Sumar mm/h no da mm ni
da una intensidad: si lloviznó a 2 mm/h durante todo un día, la barra marca 2 880. El modo
horario sí usa `Math.max` (línea 390), que es lo correcto para intensidad.

Para un acumulado real hay que usar el máximo diario de `rain_daily`, o integrar la tasa en
el tiempo.

### 4. VPD en pulgadas de mercurio (`parser.py`, `converter.py`)

`vpd` llega del gateway y **no aparece en ninguna línea del repo**: no está en
`FIELD_MAPPING`, así que pasa crudo por `FIELD_MAPPING.get(raw_key, raw_key)`, y no está en
ninguna lista de `convert_to_metric`, así que nunca se convierte.

Valor real observado: `vpd: 0.809`. El VPD verdadero con T=28.6 °C y HR=30 % es **2.73 kPa**;
2.73 kPa ÷ 3.38639 = 0.807 inHg. Confirmado: es inHg.

Consecuencia: se **guarda en InfluxDB en imperial** mientras todo lo demás está en métrico, y
se expone en `/api/current` (que alimenta MQTT/Home Assistant). Un consumidor que lo lea como
kPa ve un valor 3.4 veces menor.

Mismo camino siguen `runtime`, `heap` e `interval` (ver #30).

### 5. Grados-día y ET₀ sin convertir (`StatisticsPage.tsx:213-215`)

```tsx
<SummaryCard label="Grados-día de enfriamiento" value={sum!.cdd.toFixed(0)} unit="°C·día" />
<SummaryCard label="Grados-día de calefacción"  value={sum!.hdd.toFixed(0)} unit="°C·día" />
<SummaryCard label="Evapotranspiración (ET₀)"   value={sum!.et_total.toFixed(0)} unit="mm" />
```

`°C·día` y `mm` están fijos en el código. En modo imperial las tres cifras siguen en métrico
con rótulo métrico, mientras el resto de la página cambia a °F/in. (NOAA además usa base
65 °F y grados-día en °F·día.)

Contraste: los umbrales del season tracker sí se convierten bien (líneas 200-201, con `u.temp()`).

### 6. Base de nubes siempre en metros (`CurrentConditions.tsx:57`)

```tsx
<p>Base de nubes <span>≈ {Math.round(data.cloud_base).toLocaleString('es-MX')} m</span></p>
```

Sin `useUnits`. En imperial debería ser pies. `units.tsx` no tiene formateador de altura.

### 7. El QC de UV nunca se ejecuta (`quality.py:36`)

```python
BOUNDS = { ..., "uv": (0.0, 20.0), ... }
```

El campo se llama `uv_index` (`parser.py:52` lo mapea así). La clave `"uv"` no existe en el
dict de datos, así que **el límite nunca se aplica**: un UV corrupto entraría al histórico sin
filtrar.

Además `BOUNDS` y `SPIKE_LIMITS` no cubren `humidity_ch1..ch8`, aunque sí cubren
`temperature_ch1..ch8` y la humedad por canal se muestra y se promedia.

### 21b. Estación caída → el reloj muestra 0 °C (`main.py:1676`, `svitrix.py:89`)

```python
data = latest_by_station.get(None) or {}      # sin lecturas → {}
...
"temp_c": round(tc, 1) if tc is not None else None,
```

Si la estación no ha reportado (arranque en frío, consola caída), `/api/svitrix` responde
**200 OK** con `temp_c: null`, `humidity: null`, `pressure_mb: null`. Y en el firmware
(`DataFetcher.cpp:803-806`):

```cpp
weatherData.outdoorTemp = timeConfig.isCelsius ? current["temp_c"].as<float>() : ...
...
weatherData.valid = true;
```

ArduinoJson convierte `null` a **0.0f**, y `valid` se marca `true` igual. → **el reloj muestra
0 °C, 0 % y 0 mb como si fueran mediciones reales**, sin ninguna señal de que el dato no
existe. En invierno un 0 °C en CDMX es verosímil, así que no se detecta a simple vista.

Corrección: que `/api/svitrix` devuelva 503 (o `current` ausente) cuando no hay lectura, en
lugar de un objeto lleno de nulos. El firmware ya maneja bien ese caso: si falta `current`
registra el error y **conserva el último valor** (`DataFetcher.cpp:796-800`).

### 21c. Falta `is_day` en el contrato de Svitrix

`svitrix.py` no emite `current.is_day`, que WeatherAPI sí incluye, y el firmware mapea el
ícono solo por código (`Apps_NativeApps.cpp:433`, `getWeatherConditionIcon(conditionCode)`),
sin lógica día/noche propia. `_condition()` devuelve `code 1000` de noche, que en WeatherAPI
es *Sunny* de día y *Clear* de noche. Resultado probable: **ícono de sol de madrugada.**

### 21d. Dos presiones distintas con el mismo formato (`KioskPage.tsx:193` vs `:360`)

El BME280 del display mide presión **absoluta local** (~779 hPa) y el firmware la manda cruda
(`kiosk/src/net.h:137-140`), sin reducción a nivel del mar. La página 2 la muestra con
`u.press()`, el mismo formateador que la página 1 usa para la presión **relativa** de la
estación (~1024 hPa).

→ el mismo display alterna entre *"Presión 1024 mb"* (pág. 1) y *"Presión 779 mb"* (pág. 2)
sin distinguir de qué presión habla. Quien compare concluirá que un sensor está averiado.

### 21e. `POST /api/kiosk/local` sin protección ni QC (`main.py:859-875`)

Escribe estado persistente (`_kiosk_local_save()`) y **no tiene token, ni allowlist de IP, ni
rate-limit**, a diferencia de `/data/report` (`main.py:322-340`). Cualquiera puede falsear la
lectura del sensor local del display y, peor, **fijar sus mín/máx del día**, que son
acumulativos:

```python
_kiosk_local["min"][k] = round(min(_kiosk_local["min"].get(k, fv), fv), 1)
```

Tampoco pasa por `quality_check`/`spike_check`, así que una lectura espuria del BME280 al
arrancar (fría o sin calibrar) queda fijada como extremo del día sin filtro.

Nota: el reset diario (`main.py:862-864`) usa `datetime.now(_MX_TZ)` **con zona explícita**,
correctamente — al contrario que los tres casos del hallazgo #23.

### 21 (revisado). `last_updated` mal formado, pero sin consumidor

```python
"last_updated": d.get("received_at"),   # "2026-08-04T21:19:24.307401" (UTC naive)
```

El módulo declara imitar WeatherAPI *"de modo que el firmware pueda apuntar aquí cambiando
solo la URL"*, y WeatherAPI entrega este campo en **hora local** con formato
`"2026-08-04 15:19"`. Aquí va UTC sin marca de zona, en ISO con `T` y microsegundos.

**Pero el firmware no lo lee:** `last_updated` no aparece en ninguna línea del repo de
Svitrix, y `weatherData.lastUpdate` se toma de `millis()` local
(`DataFetcher.cpp:834`). Así que **no produce ningún desfase visible**. Queda como
incumplimiento del contrato que el propio módulo declara, relevante solo si algún día otro
cliente lo consume.

Contexto: el frontend web sí compensa los timestamps naive con `parseServerDate()`
(`weather.ts:104`), cuyo comentario documenta este desfase de 6 h.

### 22. GW1100: solo se lee `temperature_indoor` (latente)

`KioskPage.tsx:278` (vivo) y `main.py:1860` (código muerto):

```tsx
value={remote?.temperature_indoor != null ? `${u.temp(remote.temperature_indoor)}°` : '--'}
```

Al activar el toggle "intemperie" (`treat_indoor_as_outdoor`), `main.py:391-395` promueve
`temperature_indoor` → `temperature_outdoor`. Entonces la página 3 del kiosco mostrará `--`
en temperatura, humedad y presión de la remota.

El bucle genérico de `/api/display` (`main.py:1871`) sí contempla ambos campos; el bloque
específico de gw1100 corre antes y solo mira `indoor`.

**Inminente:** el GW1100 va a su ubicación definitiva en estos días.

### 23. `datetime.now()` sin zona (`main.py:556, 1781, 1977`)

```python
start_iso, _, _ = aggregator.local_day_bounds_utc(datetime.now())
```

`local_day_bounds_utc` toma solo la **fecha** del argumento. `datetime.now()` es naive y
depende de `TZ` del contenedor, cuyo default en `docker-compose.yml:39` es **UTC**. Con
TZ=UTC, entre las 00:00Z y 06:00Z (18:00–24:00 hora local) la fecha UTC ya avanzó al día
siguiente y el rango pedido empieza **en el futuro** → `/api/stats/daily` devolvería
estadísticas vacías cada noche de 18:00 a medianoche (máx/mín del día en blanco, en la web y
en el kiosco).

El resto del código sí usa `datetime.now(_TZ)` explícito (`aggregator.py:291, 361, 416`), lo
que hace de estas tres líneas una asimetría clara.

**No confirmado en producción:** `.env.example:138` define `TZ=America/Mexico_City`. Si el
`.env` del VPS lo tiene, el bug está latente, no activo. **Falta verificar el `.env` del VPS.**

---

## B — Etiqueta engañosa

### 8. Eje de precipitación rotulado "mm" siendo mm/h (`MultiVariableChart.tsx:220` vs `:363`)

La serie es `rain_rate` (mm/h). El eje dice `'mm'` y el tooltip dice `'mm/h'`: **la misma
serie con dos unidades distintas en la misma gráfica.** El tooltip es el correcto.

### 9. "Lluvia diaria": promedio y mínimo de un contador (`StatisticsPage.tsx:125, 251-257`)

La tarjeta muestra `avg` como **"promedio"** y también `min`. `rain_daily` es el contador
acumulado de la consola, que se reinicia a medianoche:

- el **promedio** del valor de un contador a lo largo de 30 días no es la lluvia media diaria
  (que sería suma ÷ días) ni ninguna otra magnitud meteorológica;
- el **mínimo** es siempre 0 (el instante posterior a medianoche);
- solo el **máximo** es útil: el día más lluvioso del periodo.

Lo mismo se sirve en `stats` de `/api/display` (`storage.py:219`).

### 10. "vs ayer" no es ayer (`MiniStats.tsx:90` ← `/api/compare` ← `storage.py:371`)

`get_comparison` promedia `-24h → now` contra `-48h → -24h`. A las 15:19 eso compara
*"desde ayer 15:19"* contra *"de anteayer 15:19 a ayer 15:19"*. El tile lo rotula **"vs
ayer"** con subtexto "más cálido/más frío". El propio docstring del backend admite
*"(aprox. 'vs ayer')"*.

Consecuencia observable en la muestra real: `/api/display` trae a la vez
`stats.temperature_outdoor.avg = 19.6` (día local) y `compare.…today = 20.0` (24 h rodantes)
— dos promedios del "mismo" día en una sola respuesta.

### 11. Dos "Días de lluvia" distintos en la misma página (`StatisticsPage.tsx:155` y `:202`)

| Tarjeta | Fuente | Trata los días sin datos |
|---|---|---|
| línea 155 (Resumen del año) | `period_summary.rain_days` (`aggregator.py:193`) | como **0 mm** → cuentan como secos |
| línea 202 (Contadores de días) | `season_tracker.rain_days` (`aggregator.py:349`) | los **excluye** |

Dos tarjetas con la **misma etiqueta** y potencialmente números distintos. En `period_summary`:

```python
rain_vals = [r.get("rain_total") or 0.0 for r in rows]   # None → 0.0 mm
```

Un día sin datos no es un día sin lluvia. Además, en `season_tracker`
`rain_days + dry_days ≠ days` cuando hay huecos, así que las cuatro tarjetas de contadores no
suman al total del periodo.

### 12. Grados-día "estándar NOAA" con otro método (`StatisticsPage.tsx:218`, `aggregator.py:195-196`)

El texto dice *"base 18.3 °C (estándar NOAA)"*. La base es correcta (65 °F), pero NOAA calcula
grados-día con **(Tmax+Tmin)/2**, y aquí se usa `temp_avg`, que es el promedio integrado de
todas las lecturas del día (`mean()` en `storage.py:261`). Con muestreo por minuto la
diferencia típica es 0.3–1 °C/día, así que **las cifras no son comparables con las oficiales**
aunque se presenten como tal. Igual afecta a `hdd`/`cdd` por día del reporte NOAA
(`aggregator.py:256-257`) y a `daily_et0`, que pasa `temp_avg` donde Hargreaves espera el
punto medio.

### 13. "24h sin lluvia" mirando 8 horas (`PrecipitationCard.tsx:20, 45`)

```ts
const next = forecast?.hours?.slice(0, 8) ?? []
...
return '24h sin lluvia'
```

El mensaje afirma 24 h sobre una ventana de 8. Además las barras de probabilidad se normalizan
al máximo del periodo (`height = prob / peakProb * 100`, línea 90), así que un 10 % se dibuja
a altura completa si es el máximo — la escala visual no es absoluta (lo mitiga el porcentaje
impreso debajo).

### 14. Condición del tiempo por radiación absoluta (`weather.ts:55-58`, `svitrix.py:52-58`)

```ts
if (solar > 450) return 'Despejado'
if (solar > 120) return 'Parcialmente nublado'
return 'Nublado'
```

Los umbrales no se normalizan por la elevación solar. A las 07:30 con cielo perfectamente
despejado la radiación es ~100 W/m² → **"Nublado"**. Igual a las 18:30. Y al mediodía nublado
con 450 W/m² → "Despejado".

Está duplicado con umbrales **distintos**: 450/120 en la web, 400/120 en Svitrix. Afecta al
ícono principal de Inicio, al efecto de fondo (`WeatherFX`), al kiosco y al reloj.

Confirmado el impacto en el reloj: el firmware elige el GIF con
`getWeatherConditionIcon(weatherData.conditionCode)` (`Apps_NativeApps.cpp:433`) sobre el
`code` que calcula `svitrix.py`. Es decir, **el ícono del reloj sale de este cálculo**, y
corregirlo en el backend lo arregla sin tocar el firmware.

Se puede normalizar contra la radiación teórica de cielo claro, que es calculable: el
almanaque ya expone la altitud del sol.

Relacionado (`weather.ts:27, 38`): se usa `rain_event` **como sustituto de rayos**
(el comentario lo admite: *"not real lightning; placeholder"*), así que toda lluvia fuerte con
evento acumulado > 0 se rotula **"Tormenta"**. El parser ya mapea `lightning_count` y
`lightning_distance` (`parser.py:121-123`): hay dato real disponible si existe el sensor.

### 15. Base de nubes AGL sin decirlo

`calculate_cloud_base` (`converter.py:225`) devuelve metros **sobre el suelo** (fórmula de
Espy, 125 m/°C). La tarjeta muestra "≈ 2 412 m" sin aclararlo. Coincidencia desafortunada:
2 412 se parece a la altitud de CDMX (~2 240 m), así que se lee natural como altitud sobre el
nivel del mar. La base real MSL serían ~4 650 m. Importa especialmente junto a la página
Aeronáutica, donde los METAR dan bases en pies AGL.

### 16. `connectNulls` oculta los huecos (`MultiVariableChart.tsx:296, 309, 322, 335`)

Las cuatro líneas llevan `connectNulls`. Si la estación estuvo caída seis horas, la línea se
dibuja recta a través del hueco como si hubiera datos. Se combina con dos cosas que producen
nulos legítimamente: el filtro de picos del QC (`quality.py:103` pone `None`) y
`rain: p.rain_rate ?? 0` (línea 83), que convierte ausencia en cero.

### 17. Tendencia "estable" sin datos (`TrendArrow.tsx:27`)

```ts
if (current == null || previous == null) return 'stable'
```

No existe estado `unknown`, así que "no sé" y "no cambió" se dibujan igual. `historicValue`
está bien hecho (descarta si el punto más cercano se aleja >30 min del objetivo,
`weather.ts:136`), pero su `null` termina pintado como flecha de estabilidad. El comentario de
`CurrentConditions.tsx:14-17` describe justo este síntoma.

### 18. Flechas verde/rojo sin valencia (`TrendArrow.tsx:9`)

`up` → verde, `down` → rojo. Para presión funciona (sube = mejora). Para temperatura, en una
ola de calor, "subiendo" se pinta **verde**; para humedad el color no significa nada. El
verde/rojo comunica bueno/malo sobre magnitudes que no lo tienen.

---

## C — Dato ausente presentado como cero

### 19. `?? 0` en lugar de `--`

| Archivo:línea | Campo | Se ve |
|---|---|---|
| `KioskPage.tsx:359` | `humidity_outdoor` | `0 %` |
| `KioskPage.tsx:360` | `pressure_relative` | `0` mb |
| `KioskPage.tsx:361` | `wind_speed` | `0` km/h |
| `KioskPage.tsx:362` | `rain_daily` | `0.0` mm |
| `KioskPage.tsx:337` | `uv_index` | `0` |
| `CurrentConditions.tsx:65` | `humidity_outdoor` | `0 %` |
| `CurrentConditions.tsx:71` | `uv_index` | `0` |
| `MiniStats.tsx:59` | `humidity_outdoor` | `0 %` |
| `PrecipitationCard.tsx:68` | `rain_event` | `0.0` |

En la misma pantalla del kiosco la **temperatura sí** usa `'--'` correctamente
(`KioskPage.tsx:347`), así que una caída de sensor se ve como *temperatura `--` y presión
0 mb* — y una presión de 0 mb en un display físico es alarmante y falsa.

El propio renderer asume lo contrario: su comentario dice *"mostrará placeholders `--`"*
(`renderer/app.py:108-110`).

Los formateadores de `units.tsx` **sí** distinguen ausencia (`na()` en línea 32 devuelve
`'--'` y no confunde el 0 con el nulo). El problema es el `?? 0` **antes** de llamarlos.

### 20 (revisado a D). O₃/NO₂/SO₂ como cero hacia Svitrix (`svitrix.py:109-114`)

```python
"o3": poll.get("o3", 0), "no2": poll.get("no2", 0), "so2": poll.get("so2", 0),
```

Confirmado en la respuesta real: `"o3":0,"no2":0,"so2":0`, y un ozono de 0 µg/m³ en la CDMX es
imposible.

**Pero no produce un dato falso en el reloj.** El firmware ya trata el 0 como ausencia
—`AirQualityLevels::level()` documenta *"@return 1..6 …; **0 when the value is invalid
(<= 0)**"*— y solo destaca contaminantes con nivel ≥ 4. Mandar `null` daría el mismo resultado,
porque ArduinoJson convierte `null` a `0.0f`.

Así que el contrato "0 = sin dato" está honrado en ambos extremos. Queda como cuestión de
claridad: `/api/svitrix` es público y está documentado en el README, y ahí un `0` se lee como
medición. Si se cambia, hay que cambiarlo **en los dos repos a la vez**; por sí solo, el
backend no arregla nada.

---

## D — Código muerto, rendimiento y deuda

### 24. `/api/display` duplicado y sin consumidores

Dos definiciones de la misma ruta con el mismo nombre de función: `main.py:1751` y
`main.py:1942`. En FastAPI gana la primera; las ~100 líneas de la segunda son inalcanzables.
Confirmado por la forma de la respuesta real (trae `moonrise`/`moonset`, no trae
`generated_at`).

Y **ningún cliente lo consume**: el grep de todo el repo solo encuentra referencias a
`/api/display.jpg`, que es otro endpoint (nginx → renderer). `docs/GUIA.md:263` lo confirma:
*"sirve como JPEG …; el ESP32 solo la baja y la pinta"*. El JSON quedó del enfoque LVGL
abandonado.

Las dos versiones **divergieron**, lo que hace fácil corregir la equivocada:

| | activa (1751) | muerta (1942) |
|---|---|---|
| respaldo de acumulados de lluvia | no | sí |
| `airquality` | objeto completo | `{aqi, pm25, dominant}` |
| `stations.ch1` | desde la principal ✓ | busca una estación `"ch1"` que no existe → vacío |
| `moonrise`/`moonset` | sí | no |
| `generated_at` | no | sí |

Bug dentro del código muerto (documentado por si se decide arreglar en vez de borrar):
`main.py:1832` comprueba `aq.get("available", False)`, pero `get_air_quality()`
(`air_quality.py:51-64`) **nunca devuelve esa clave**, así que `airquality` sería siempre
`null`. Prueba cruzada de que el token sí funciona: Svitrix obtiene AQI usando
`aq.get("aqi")` directo.

**Confirmado borrable.** Revisado el firmware del Kiosko
(`github.com/XE1E/ecowitt-display-kiosk-xe1e`): solo usa dos endpoints del backend,
`GET /api/display.jpg?page=N` y `POST /api/kiosk/local` (`kiosk/src/net.h:4-5, 62, 132`;
`my_config.h.template:40-42`). Los demás `/api/...` que aparecen en `portal.h` son del
**servidor web propio del ESP32** (su portal de configuración), no del backend.

→ se pueden borrar **las dos** definiciones de `/api/display` (~190 líneas) sin romper nada.

### 25. `/api/climate/daily` sin consumidores (`main.py:1614`)

No aparece en el inventario de endpoints usados por el frontend.

### 26. `/api/rain/last` baja 90 días para hallar un valor (`main.py:1712-1721`)

```python
records = await storage.query(start="-90d", fields=["rain_rate"])
rain_records = [r for r in records if (r.get("rain_rate") or 0) > 0]
last = max(rain_records, key=lambda r: r.get("_time", ""))
```

~130 000 registros traídos a Python para quedarse con uno. Se llama desde
`PrecipitationCard` en cada carga de Inicio. En Flux es
`filter(fn: (r) => r._value > 0) |> last()`.

### 27. `get_daily_stats`: 42 consultas por llamada (`storage.py:232-266`)

Tres consultas (`min`, `max`, `mean`) × 14 campos, en bucle secuencial. Lo llaman
`/api/stats/daily`, `/api/stats/records`, el rollup diario y el kiosco. Con el periodo
"Histórico" de Estadísticas (`-3650d`) son 42 consultas sobre diez años de datos crudos.
Se puede resolver con una sola consulta Flux por agregación usando `group()` + `reduce`, o
apoyarse en `weather_daily`.

### 28. Cachés sin cota en endpoints públicos (`air_quality.py:16`, `imeca.py:23`)

`_CACHE` es un dict con clave `lat,lon` redondeada, sin límite de tamaño ni expulsión, y
`/api/airquality` e `/api/airquality/imeca` son públicos y **sin rate-limit** (a diferencia de
`/data/report` y del login, que sí lo tienen). Llamadas con coordenadas variadas hacen crecer
el dict indefinidamente y consumen cuota del token WAQI.

### 29. Tres convenciones de rumbo simultáneas

| Fuente | Rumbos | Idioma | 247° |
|---|---|---|---|
| `weather.ts:95` | 8 | español | `SO` |
| `windrose.py:11` | 16 | español | `OSO` |
| `svitrix.py:15` | 16 | inglés | `WSW` |

El inglés de Svitrix es correcto (contrato WeatherAPI). Los otros dos deberían coincidir: el
mismo viento se rotula distinto según la tarjeta.

### 30. Campos de diagnóstico escritos como mediciones

`runtime`, `heap` e `interval` llegan del gateway, no están en `FIELD_MAPPING`, y terminan
como campos de InfluxDB y en `/api/current`. Ruido en la base y en la API pública. Junto con
`station_type`, `model` y `frequency`, infla el payload.

### Otros de menor peso

- `pressU` es `'mb'` (`units.tsx:41`) mientras el backend y la documentación usan hPa.
- `category()` triplicada con etiquetas divergentes: `AirQualityCard.tsx:13`
  ("Dañina a sensibles"), `AirQualityPage.tsx:16` ("Dañina a grupos sensibles"),
  `imeca.py:89` (escala IMECA, correctamente distinta).
- `forecaster.py:36`: con umbral `high ≥ 1022` sobre presión reducida desde 2240 m, la
  estación está **permanentemente** en nivel "high" (hoy: 1023.7–1028.0). El "nivel" del
  barómetro es en la práctica una constante, y solo la tendencia informa. Además la reducción
  ISA amplifica los cambios ~31 %, así que los umbrales de tendencia (±1.0/±3.5 hPa, pensados
  para baja altitud) se cruzan antes de lo debido.
- `get_field_value_ago` (`storage.py:346`) usa `first()` en la ventana `-3h` sin comprobar la
  antigüedad real del punto: tras un hueco, un delta de 10 minutos se presenta como delta de
  3 horas.
- `pressure_absolute: (650, 850)` en `quality.py:30` codifica la altitud de CDMX; a nivel del
  mar el QC rechazaría toda la presión absoluta (relevante porque el README presenta el
  proyecto como reutilizable).
- `wetBulb` (`weather.ts:66`) usa la aproximación de Stull, válida cerca de 1013 hPa; a 779 hPa
  el error es de algunas décimas.
- `StatisticsPage.tsx:68`: el año de inicio del selector está fijo en 2026.
- `StatisticsPage.tsx:240`: `available.length === 0` es inalcanzable, porque
  `get_daily_stats` siempre devuelve las 14 claves (con nulos). El mensaje "No hay datos para
  este periodo" nunca aparece; se muestran tarjetas con `--`.
- `/api/wind/rose` y `/api/stats/records` no aceptan `station`: siempre son de la principal.
- `windrose.py`: `calm_threshold` y `SPEED_EDGES[0]` son independientes aunque el docstring
  los asume iguales; si divergen, la leyenda de bandas miente.
- `HistoryData` (`types.ts:77`) declara solo 6 campos y los charts hacen `keyof HistoryData`,
  lo que impide tipar series como radiación, UV o ráfaga.
- `types.ts`: `temperature_outdoor` es requerido, pero el QC puede anularlo → en runtime
  llega `undefined` donde el tipo promete `number`.

---

## Segunda pasada (publicación a redes, Historia, Aeronáutica)

### 31. El índice UV nunca se publica a ninguna red (**A**) — `publishers.py:120, 139, 209`

Es **el mismo error del hallazgo #7**, repetido en otro módulo: el código pide `data.get("uv")`
cuando el campo se llama `uv_index`.

| Línea | Red | Campo |
|---|---|---|
| 120 | Weather Underground y PWSWeather | `UV` |
| 139 | Windy | `uv` |
| 209 | AWEKAS | campo 18 |

Las tres devuelven `None` siempre, y `_q()` / `_fmt()` descartan los nulos. Confirmado contra
el dato real: `/api/current` trae `uv_index: 1` y **no existe ninguna clave `uv`**. El sensor
mide UV, el panel de administración dice que publica, y nunca ha salido.

Un solo arreglo (renombrar la clave en los 4 sitios) cierra #7 y #31 a la vez.

### 32. AWEKAS: el docstring miente, el código está bien (**D**) — `publishers.py:182` · CORREGIDO

El docstring decía *"lluvia en décimas de mm"* mientras el código manda mm directos. Resuelto
por el operador: **la documentación de AWEKAS es la que está mal**; se corrigió en su momento a
mm directos y así funciona.

El riesgo era el docstring, no el código: invita a "arreglar" la línea multiplicando por 10 y
publicar 10× la lluvia real. Se reescribió el comentario con la advertencia explícita.

Lección para el resto de esta auditoría: donde el comentario y el código discrepan, el código
puede ser el correcto. Verificar antes de alinear uno con otro.

### 33. El selector de día de Historia arranca en el futuro (**A**) — `HistoryPage.tsx:42`

```ts
const todayIso = now.toISOString().slice(0, 10)
```

`toISOString()` da **UTC**. Entre las 18:00 y medianoche hora local, la fecha UTC ya avanzó,
así que la vista de Día abre **mañana** y el detalle diario pide un día que no ha ocurrido.
Seis horas cada día. Es el mismo error de zona del hallazgo #23, ahora en el frontend.

Contraste: `weekdayName()` (líneas 14-17) sí construye la fecha como local, correctamente.

### 34. El CSV se descarga en métrico aunque la pantalla esté en imperial (**A**) — `HistoryPage.tsx:118-133`

```ts
header = 'fecha,temp_max,temp_min,temp_prom,...'
body = (month?.days ?? []).map((d) => [d.date, d.high ?? '', ...].join(','))
```

Los valores salen **crudos**, sin pasar por `u.temp()`, y los encabezados no declaran unidad.
Un usuario en imperial ve la tabla en °F y descarga un archivo en °C sin saberlo. Conviene
exportar en la unidad activa con la unidad en el encabezado (`temp_max_C` / `temp_max_F`).

### 35. La antigüedad del METAR siempre dice "hace 0 min" (**B**) — `AtmosphericProfile.tsx:83`

```ts
const ageMin = m.observed ? Math.max(0, Math.round((now.getTime() - new Date(m.observed).getTime()) / 60000)) : null
```

`metar.py:42` pasa `reportTime` tal cual, que llega como `"2026-08-04 21:00:00"` — UTC **sin
zona y con espacio** en vez de `T`. `new Date()` lo interpreta como hora **local**, así que en
CDMX el instante calculado queda 6 h en el futuro, la diferencia sale negativa y
`Math.max(0, …)` la aplana a **0**. Resultado: un METAR de hace tres horas se anuncia como
recién emitido.

Aquí también existe el helper adecuado sin usar (`parseServerDate`, `weather.ts:104`).

### 36. La gráfica multivariable ignora el periodo elegido (**B**) — `HistoryPage.tsx:189`

Dentro de la vista de un mes o año concreto, `<MultiVariableChart mode={multiMode} />` consulta
`/api/history?start=-24h` (o `-7d`) **relativo a ahora**. Así que bajo el encabezado
"Marzo 2026" y el título "Resumen multivariable" se dibujan los últimos días de hoy. Hay que
pasarle el rango del periodo o dejar claro en el título que son las últimas 24 h / 7 días.

### 37. "Viento máximo" mezcla dos magnitudes (**B**) — `HistoryPage.tsx:164`

```tsx
{stat('Viento máximo', (s!.gust_max ?? s!.wind_max) ? ... )}
```

Usa la **ráfaga** si existe y si no la **velocidad sostenida máxima**, bajo la misma etiqueta,
sin que el lector sepa cuál está viendo. `StatisticsPage` sí las distingue ("Viento" y
"Ráfaga"). La tabla de la misma página (línea 220) muestra solo `gust_max` pero la rotula
"Viento máx".

### 38. Lluvia ausente como 0 en las gráficas de Historia (**C**) — `HistoryPage.tsx:75`

```ts
const rN = (v?: number | null) => (v == null ? 0 : +u.rain(v))
```

Las otras cuatro conversiones (`tN`, `wN`, `pN`, `rrN`) devuelven `null` correctamente; solo la
lluvia convierte ausencia en cero, así que un día sin datos se grafica como día seco.

### Otros de esta pasada

- **`_owm` omite `dt`** (`publishers.py:152`): el comentario asume que el servidor usa "now",
  pero la Stations API de OpenWeatherMap documenta `dt` como obligatorio. Si lo es, **todas
  las publicaciones a OWM fallan** silenciosamente (solo queda un warning en el log).
- **AWEKAS va por HTTP plano** (`_AWEKAS_URL`, línea 32) con el MD5 de la contraseña en la
  query string: credenciales en claro por la red y en logs de proxies. Es limitación de
  AWEKAS, pero conviene anotarlo en `docs/SEGURIDAD.md`.
- **Caché de METAR de un solo slot** (`metar.py:15`): alternar entre dos aeropuertos invalida
  el caché en cada cambio. El de TAF sí es un dict por estación.
- **`metar.py:35`**: cuando no hay METAR devuelve `{}` sin cachear, así que un aeropuerto sin
  datos se consulta en cada petición.
- **`AtmosphericProfile.tsx:78`**: `night = hour < 7 || hour >= 19` con umbrales fijos y hora
  del navegador, cuando el almanaque ya calcula amanecer y atardecer reales. La ilustración
  puede mostrar noche estrellada con sol aún fuera.
- **`AtmosphericProfile.tsx:64`**: un `setInterval` de 1 s re-renderiza el SVG completo (~30
  edificios con ventanas, nubes, 60 estrellas) solo para mover el reloj.
- **`AtmosphericProfile.tsx:8`**: `temp_c` se declara en la interfaz y no se usa.
- **`HistoryPage.tsx:305`** admite años desde 2020 y `StatisticsPage.tsx:68` desde 2026.

### Verificado como correcto en esta pasada

- **`HistoryPage` sí convierte las unidades de sus gráficas** (`tN`/`wN`/`pN`/`rrN` con
  `u.tempN`, líneas 72-76). Es la prueba de que el patrón correcto existe en el repo y que el
  hallazgo #2 de `MultiVariableChart` es un descuido aislado.
- **Visibilidad del METAR** (`MetarCard.tsx:122-126`): convierte SM → km o millas según el
  sistema y maneja el caso en que la API devuelve un string (`"10+"`).
- **Bases de nubes en pies AGL** sin convertir a métrico: correcto, es el estándar aeronáutico
  universal. Igual los nudos de viento y el QNH en hPa.
- **CWOP**: humedad de 100 % codificada como `h00`, presión en décimas de hPa, `...` para los
  campos sin dato, timestamp Zulu. Todo conforme a la especificación APRS.
- **Windy** en SI (m/s, Pa) y **WU/PWSWeather** en imperial: las conversiones de cada
  protocolo son correctas, salvo el UV que nunca llega.
- **`_due()`** marca el intento antes de enviar, de modo que un fallo no adelanta el siguiente
  envío. Es intencional y está documentado.

---

## Verificado como correcto

Conviene registrarlo para no volver a auditarlo, y porque descarta sospechas iniciales:

- **Almanaque astronómico.** Recalculé amanecer/atardecer con el algoritmo NOAA de forma
  independiente: 06:14 / 19:12 y mediodía solar 12:43, contra 06:13 / 19:11 y 12:43 del API.
  La diferencia de un minuto es el limbo superior con refracción a 2 240 m. `local_day_bounds_utc`
  y el manejo de zonas de `almanac.py` son correctos.
- **Punto de rocío** (Magnus): con 28.6 °C y 30 % → 9.3 °C. Coincide.
- **Humidex** (Environment Canada): 29.6. Coincide.
- **Base de nubes** (Espy): 125 × 19.3 = 2 412. Coincide con la fórmula (el problema es el
  rótulo, no el número).
- **ET₀ de Hargreaves** (`aggregator.py:134`): dr, declinación, ángulo horario y Ra siguen
  FAO-56 correctamente.
- **Las seis tablas de puntos de corte del IMECA** contra NADF-009-AIRE-2017.
- **Reducción de presión al nivel del mar** (`converter.py:21`): fórmula ISA correcta;
  778.8 hPa → 1024.0 con altitud ~2 247 m. Y se recalcula en el servidor desde la absoluta,
  independiente de la consola (`main.py:406-414`), que es lo correcto para un WS2910.
- **Sectores de la rosa de vientos** (`windrose.py:53`): el desplazamiento de 11.25° reparte
  bien los 16 sectores.
- **Escala Beaufort** (`weather.ts:79`): los 12 límites son los estándar.
- **Rumbo de 16 puntos de Svitrix**: 247° → WSW. Correcto.
- **Orden del pipeline de ingesta** (`main.py:397-419`): calibrar → QC de rangos → QC de picos
  → derivar. Es el orden correcto (estilo WeeWX) y los derivados se limpian antes de
  recalcularse (`converter.py:157`).
- **`historicValue`** (`weather.ts:123`): razona con tiempo y no con índices de arreglo, y
  descarta puntos alejados más de 30 min. Bien resuelto, con la trampa documentada.
- **`parseServerDate`** (`weather.ts:104`): compensa correctamente los timestamps UTC sin zona.
- **Conversión del delta de temperatura** (`MiniStats.tsx:49`): usa `×9/5` sin `+32`, que es lo
  correcto para una diferencia. Es el error clásico y aquí está bien.
- **`new Date(d.date + 'T12:00:00')`** (`KioskPage.tsx:298`): mediodía para evitar el
  corrimiento de día por zona horaria.
- **Baterías binarias** (`parser.py:193`): `0 = OK` → `True`, con los sensores de voltaje
  correctamente excluidos.

---

## Pendiente de revisar

Páginas y componentes que aún no he auditado:

- Historia (`HistoryPage`, `HistoryCharts`, `HistoryDayDetail`, `StationTempChart`)
- Climatología (`ClimatePage`)
- Tablas (`TablesPage`, `StationSummaryTable`)
- Consola (`ConsoleReplica`) — 571 líneas
- Estación remota (`RemoteStationPage`, `RemoteStationCard`)
- Pronóstico (`ForecastPage`, `forecast.ts`, `ForecastCompareCard`, `LocalForecastCard`)
- Aeronáutica (`AeronauticaPage`, `MetarCard`, `AtmosphericProfile`) y `metar.py`
- Astronomía (`AstronomyPage`, `SunMoonDetailCard`, `DaylightChart`)
- Sismos (`EarthquakesPage`, `quakes.ts`) y `earthquakes.py`
- Inicio y Mi Tablero (`HomePage`, `MiTableroPage`), `WindCard`, `WindRose`, `PressureCard`,
  `UvSolarCard`, `ExtraSensorsCard`, `AlmanacCard`, `HistoricalRecords`
- Widget embebible (`EmbedWidget`, `ShareEmbedPage`)
- `smn.py`, `satellite.py`, `publishers.py` (publicación a redes públicas), `alerts.py`
- Panel de administración

## Decisiones sobre los repos externos — resueltas

Revisados `XE1E/ecowitt-display-kiosk-xe1e` y `XE1E/svitrix-firmware-XE1E`:

| Pregunta | Respuesta | Efecto |
|---|---|---|
| ¿El Kiosko llama a `/api/display` JSON? | **No.** Solo `display.jpg` y `kiosk/local` | #24 pasa a borrado seguro |
| ¿Svitrix tolera `null` en `air_quality`? | Da igual: `null` y `0` acaban ambos en `0.0f`, y el firmware ya trata `0` como inválido | #20 baja de C a D |
| ¿Cómo parsea `last_updated`? | **No lo lee**; usa `millis()` | #21 baja de A a D |

Lo que apareció al leerlos —y que no se veía desde este repo— es más serio que las tres
preguntas: **#21b** (el reloj muestra 0 °C cuando la estación está caída) y **#21d/21e** (las
dos presiones indistinguibles y el POST sin protección).

Cambios que exigen tocar los dos repos a la vez:

- **#20**: dejar de mandar `0` requiere que el firmware distinga ausente de cero.
- **#21b**: el backend debe responder 503 sin lectura; el firmware **ya** conserva el último
  valor en ese caso, así que este lado basta.
- **#21c**: añadir `is_day` al backend y usarlo en el mapeo de íconos del firmware.
- **#14**: los umbrales de radiación viven duplicados en `weather.ts` y `svitrix.py`; el
  ícono del reloj depende del `code` que calcula el backend, así que corregir el backend
  arregla el reloj sin tocar el firmware.
