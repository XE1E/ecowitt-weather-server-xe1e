# Plan — Estaciones vecinas (Xweather + Netatmo)

> Escrito el 2026-09-13. Cerrado como **✅ HECHO Y EN PRODUCCIÓN**, queda solo en
> **observación pasiva** (ver `docs/internal/PENDIENTES.md` §0). Vive en git.
>
> **Estado:** fases 1, 2 y 3 **HECHAS, conectadas y en producción**
> (2026-09-13). Netatmo desplegado, login OAuth completado desde Admin →
> Integraciones y ya sirviendo datos reales en `/api/nearby-stations` (10
> estaciones Netatmo en 15 km, contra 10 combinadas de Xweather en 40 km —
> confirma la mejora de densidad que anticipaba la prueba de factibilidad).
>
> **Decidido (fase 1-2):** Xweather (ex-AerisWeather), tier gratis
> **Developer** (15,000 llamadas/mes, sin tarjeta, sin vencimiento). Se
> descartaron MADIS directo, Synoptic Data, Weather Underground directo y
> Ecowitt.net — ver *Opciones descartadas*.
>
> **Punto 4 del checklist CERRADO con datos reales (2026-09-13):** la
> `pressure` de `getpublicdata` SÍ viene ya corregida a nivel del mar, no
> absoluta. Verificado comparando las 10 estaciones Netatmo reales más
> cercanas (1017-1027 hPa) contra la propia `pressure_relative` (1023.1 hPa)
> y `pressure_absolute` (778.1 hPa) en el mismo instante: si `pressure` de
> Netatmo fuera absoluta sin corregir, a la altitud de CDMX rondaría los
> ~770-790 hPa como la propia -- en vez de eso cae en el mismo rango que la
> relativa. No hace falta ningún ajuste adicional (a diferencia de Xweather,
> que sí necesitó preferir `altimeterMB` sobre `pressureMB`).
>
> **Pendiente real, no bloqueante:** validar en producción unos días (punto
> 6 del checklist) antes de dar la fase por cerrada del todo -- confirmar
> que el filtro de rango plausible no está descartando estaciones válidas
> ni dejando pasar ninguna mal calibrada con el tiempo.

## Objetivo

Reforzar pronóstico y tendencias **locales** con lo que están midiendo *ahora
mismo* las estaciones (PWS + METAR + mesonet) más cercanas a la estación
propia, en vez de depender solo de modelos (Open-Meteo, SMN) o del dato de un
único punto (el nuestro).

Dos usos concretos, no uno:

1. **Comparar contra la zona** — "En tu zona ahora" en el sitio: qué están
   viendo 3-5 estaciones cercanas (temp, presión, viento), para dar contexto
   inmediato y como validación cruzada de la propia estación (si el dato
   propio se desvía mucho de la zona, algo puede estar mal calibrado o
   fallando — mismo espíritu que el QC estadístico que ya existe).
2. **Tendencias** (fase 2, no bloquea la fase 1): comparar la variación de
   presión/temp de la zona en las últimas horas contra la del sitio propio,
   para detectar frentes acercándose antes de que lleguen, o confirmar que
   una tendencia local no es ruido de un sensor.

## El hueco que tapa

El sistema ya tiene tendencias **propias** (`alerts.py`, ventana de presión y
temperatura por estación) y pronóstico de **modelos** (Open-Meteo, SMN). Lo
que no tiene es una tercera pata: **qué está pasando ahora mismo alrededor**,
que ni el modelo (actualiza cada hora, resolución de rejilla) ni el propio
sensor (un único punto) pueden dar.

## Investigación ya hecha

Se evaluaron cuatro caminos antes de elegir Xweather. Queda documentado para
no repetir la investigación si se revisita esto más adelante.

| Opción | Veredicto |
|---|---|
| **MADIS directo** (NOAA) | Descartado. No es autoservicio: hay que pedir acceso institucional con aprobación semanal, y el feed es LDM/OPeNDAP con netCDF — pensado para un daemon corriendo indefinidamente, no para llamadas HTTP puntuales. No encaja con el patrón del proyecto (httpx + caché TTL). |
| **Synoptic Data** (ex-MesoWest) | Descartado. API REST simple y bien documentada, pero ya no tiene free tier permanente — es producto comercial (solo prueba de 14 días). |
| **Weather Underground directo** | Descartado. El API público clásico de lectura ("geolookup") está descontinuado. El reemplazo (`api.weather.com`, IBM/The Weather Company) es empresarial de pago, sin tier gratis self-service — esto pese a que **ya publicamos ahí** como dueños de estación. |
| **Ecowitt.net** (nube del propio fabricante) | Descartado. Verificado contra implementaciones de terceros (CumulusMX, un MCP server): la API v3 (`api.ecowitt.net`) solo devuelve los dispositivos vinculados a la cuenta propia — no expone estaciones de otros usuarios. No sirve para "estaciones vecinas". |
| **Xweather** (ex-AerisWeather), vía tier Developer | **Elegido.** Registro de autoservicio inmediato, 15,000 llamadas/mes gratis de por vida, sin tarjeta. El programa "Contributor" de PWSWeather (que hubiera exigido 4 días de validación de calidad) ya no existe como tal — se fusionó en este tier gratis genérico, sin esa espera. |

## La API: Xweather `/observations/closest`

```
GET https://data.api.xweather.com/observations/closest
    ?p=<lat>,<lon>
    &radius=<N>mi          -- ojo: millas en la query, km en la respuesta
    &limit=<N>
    &filter=allstations     -- SIN esto, solo devuelve METAR (ver Prueba real)
    &client_id=<...>
    &client_secret=<...>
```

Autenticación: `client_id` + `client_secret` como query params (no header,
no OAuth). Ambos son secretos de igual peso — ninguno es "público".

### Prueba real (2026-09-13, credenciales ya activas)

Contra 19.380359,-99.174564 (Benito Juárez), `radius=50mi&limit=30&filter=allstations`:

| Estación | `dataSource` | Distancia | Frescura |
|---|---|---|---|
| PWS_EDELGRIM | PWS | 3.1 km | minutos |
| PWS_VIRREYES | PWS | 5.3 km | minutos |
| MID_TEZD3 | MADIS_MESONET2 | 7.9 km | ~20 min |
| MMMX (aeropuerto) | METAR_NOAA | 10.4 km | ~1 h |
| PWS_MXAZCPHJC | PWS | 10.7 km | minutos |
| PWS_SCALA | PWS | 11.7 km | minutos |
| *(9 más hasta 44 km, mezcla PWS/METAR/mesonet)* | | | |

**15 estaciones en 50 km**, 4 PWS a menos de 12 km actualizándose cada pocos
minutos. Mucho mejor cobertura que la que hubiera dado MADIS/CWOP (estaciones
escasas en la zona). Como bonus, `dataSource: MADIS_MESONET2` aparece en la
mezcla — Xweather ya agrega datos de MADIS por su cuenta, así que se obtiene
acceso indirecto a eso sin el trámite que se descartó.

**Detalle importante para el diseño:** con `radius=25mi` y sin
`filter=allstations` la respuesta trae **solo METAR** (1 estación). El filtro
es obligatorio para ver PWS/mesonet — fácil de pasar por alto si se prueba
sin él y concluir erróneamente que "no hay estaciones cerca".

### Campos relevantes de cada estación

```jsonc
{
  "id": "PWS_EDELGRIM",
  "dataSource": "PWS",               // PWS | METAR_NOAA | MADIS_MESONET2 | ...
  "loc": { "lat": ..., "long": ... },
  "ob": {
    "dateTimeISO": "2026-09-13T00:45:00-06:00",
    "tempC": 14.6,
    "pressureMB": 771,                // ¡OJO! ver Calidad del dato abajo
    "spressureMB": ...,                // presión de estación (no siempre presente)
    "humidity": ...,
    "windSpeedKPH": ..., "windDirDEG": ...,
    "trustFactor": 100                 // 0-100, calidad estimada del dato
  },
  "relativeTo": { "distanceKM": 3.09, "bearing": ..., "bearingENG": "..." }
}
```

### Calidad del dato: TRES presiones distintas, y dos bugs encontrados en vivo

Cada estación trae `pressureMB`, `spressureMB` y `altimeterMB` — no son
intercambiables:

| Campo | Qué es |
|---|---|
| `spressureMB` | Presión **absoluta** de estación, sin corregir |
| `pressureMB` | Reducida a nivel del mar con **fórmula meteorológica** (usa temperatura) |
| `altimeterMB` | **QNH** — fórmula estándar de aviación (la misma familia que la fórmula ISA que usa nuestra propia `pressure_relative`) |

**Bug 1 (de la PWS, no nuestro):** varias PWS mandan `pressureMB`/`altimeterMB`
en **771, 757, 779 hPa** — valores de presión **absoluta**, ni siquiera
corregidos. Exactamente el mismo bug que se corrigió en nuestro propio GW1100
(ver `project_gw1100_pressure_fix` en memoria): la estación tiene mal puesta
su altitud. Se filtra con el rango plausible de abajo.

**Bug 2 (nuestro, encontrado y corregido el mismo día del deploy):** el
primer código usaba `pressureMB` para comparar contra la lectura propia. En
vivo, MMMX (METAR del aeropuerto) traía `pressureMB=1013` pero
`altimeterMB=1027` — y la estación propia marcaba **1027.3 hPa**, casi
idéntica al `altimeterMB`. Las dos fórmulas de reducción a nivel del mar
divergen bastante a la altitud de CDMX (~2250 m), cada vez más cuanto más
alto. **`_normalize` en `xweather.py` usa `altimeterMB` (con fallback a
`pressureMB` si la fuente no trae altímetro)** — no volver a usar
`pressureMB` como campo principal.

**Filtro de calidad restante:** descartar cualquier presión (ya sea
`altimeterMB` o el fallback) fuera de un rango plausible a nivel del mar —
**950-1050 hPa** — sin importar el `trustFactor` (que en los ejemplos vistos
venía en 100 igual para las lecturas mal corregidas del Bug 1; ese campo mide
otra cosa, no valida rangos físicos).

**Residual esperado, no es un bug:** incluso ya usando `altimeterMB`, las PWS
vecinas (sensores baratos, sin calibración profesional) siguen mostrando
8-13 hPa de dispersión entre sí y contra la estación propia/METAR, que sí
coinciden casi exacto. Es ruido normal de sensores de bajo costo en redes
ciudadanas, no algo que Xweather "ajuste" por nosotros ni que tenga arreglo
de nuestro lado — el METAR del aeropuerto es la referencia más confiable de
la zona para validar la propia estación, más que la mediana de PWS.

## Diseño del lado del servidor

Mismo patrón que `openmeteo.py`/`smn.py`: caché TTL en memoria, `stale` si el
origen no responde pero hay copia previa.

**`receiver/app/services/xweather.py`** (nuevo):

```python
async def get_nearby_stations(lat: float, lon: float,
                               radius_km: float = 40,
                               limit: int = 10) -> Dict[str, Any]:
    """
    Devuelve estaciones cercanas (PWS/METAR/mesonet) vía Xweather, con caché
    TTL de ~10-15 min (coincide con el ritmo de actualización típico de una
    PWS; con esta cadencia el consumo mensual queda muy por debajo de la
    cuota de 15,000/mes del tier gratis).

    Filtra: pressureMB fuera de [950, 1050] se descarta (estación con
    altitud mal configurada, ver PLAN-ESTACIONES-VECINAS.md). trustFactor
    bajo (< 50, a ajustar con datos reales) se excluye.
    """
```

- **TTL:** 10-15 min. Con 4-6 llamadas/hora esto usa ~100-150/mes... **ojo,
  no de las 15,000/mes** — el presupuesto real es generoso incluso a 1
  llamada/minuto (43,200/mes excedería la cuota; a 5 min de TTL son
  ~8,600/mes, cómodo).
- **Radio:** empezar con 40 km (cubre lo visto en la prueba real: 4 PWS +
  variedad de fuentes). Configurable, no hace falta exponerlo en el panel
  de entrada — puede ser una constante ajustable en código al principio.
- **Filtro de calidad:** rango de presión plausible (arriba) + `trustFactor`
  mínimo. Sin esto, una sola PWS mal configurada puede ensuciar la
  comparación "tu estación vs la zona".
- **Fallback:** igual que Open-Meteo — si Xweather no responde, servir la
  última copia cacheada marcada `stale`, nunca romper la tarjeta.

**Endpoint nuevo:** `GET /api/nearby-stations` — sin auth (dato público, como
`/api/forecast`). Devuelve la lista ya filtrada y con `age_minutes`/`stale`.

## Credenciales

`client_id` y `client_secret` son secretos de servidor, mismo trato que
`waqi_token` u `owm_api_key`: campo en `config.py` (`Settings`), editable
desde **Admin → Integraciones** (enmascarado, en blanco al guardar =
conserva), persistido en `/data/settings.json`. **No** van al `.env` ni al
cliente — a diferencia de las project keys de PostHog, estos SÍ son secretos
que no deben llegar al navegador.

```python
# config.py
xweather_enabled: bool = False
xweather_client_id: Optional[str] = None
xweather_client_secret: Optional[str] = None
```

## Integración en el sitio (fase 1)

Tarjeta nueva **`NearbyStationsCard.tsx`** (mismo patrón que `MetarCard.tsx`,
otra tarjeta que muestra dato de una fuente externa puntual), en `/pro`:

- Lista corta (3-5) de las estaciones más cercanas: nombre/ID, distancia,
  temp, presión (si pasó el filtro de calidad), hace cuánto reportó.
- Comparación visual simple contra el dato propio: flecha o color si la
  propia estación está notablemente arriba/abajo de la mediana de la zona
  (candidato a "algo raro con mi sensor" si la desviación es grande y
  sostenida — no una alerta todavía, solo una señal visual).
- Kiosco/e-paper: **no** en fase 1 — son clientes con layout fijo, esto
  puede esperar a que la tarjeta del sitio esté validada.

## Fases

- [ ] **1. Guardar credenciales.** Campos en `config.py` + Admin →
      Integraciones (enmascarados). `client_id`/`client_secret` ya
      obtenidos y probados (ver *Prueba real*), falta darles un hogar
      persistente en el panel.
- [ ] **2. `xweather.py`** — fetch + caché TTL + filtro de calidad
      (rango de presión + `trustFactor`), mismo patrón que `openmeteo.py`.
- [ ] **3. Endpoint `GET /api/nearby-stations`.**
- [ ] **4. `NearbyStationsCard.tsx`** en `/pro`, con la comparación visual
      contra el dato propio.
- [ ] **5. Validar en producción unos días**: ¿la lista de vecinas es
      estable? ¿el filtro de presión descarta lo que debe sin tirar datos
      buenos? ¿el `trustFactor` observado en la práctica sirve para algo?
- [x] **6 (fase 2). Tendencias.** HECHA (2026-09-13). `xweather.py` guarda un
      historial corto por estación vecina (mismo patrón que
      `_pressure_hist`/`_push_and_delta` en `alerts.py`) y calcula su
      tendencia en la misma ventana de 3 h que `/api/forecast/local` (para
      que sean comparables). `_zone_trend` agrega esto a una tendencia "de
      la zona" (prefiere el METAR si tiene historia suficiente, si no cae a
      la mediana de las PWS vecinas — mismo criterio que la comparación de
      presión absoluta). Expuesto en `/api/nearby-stations` como
      `zone_trend_mb`/`zone_trend`/`zone_trend_reference`, y mostrado en
      `NearbyStationsCard.tsx` junto a la tendencia propia (prop `lf`,
      reutilizando `localForecast` que ya traían `HomePage`/`MiTableroPage`)
      — solo como contexto visual, sin alerta automática todavía (ver
      "Decisiones abiertas" abajo).

## Decisiones abiertas

- **Umbral de `trustFactor`** para excluir una estación: no hay datos de
  campo todavía; empezar permisivo (p. ej. ≥ 50) y ajustar con lo que se
  observe en producción.
- **Radio final** (40 km de partida): depende de cuántas estaciones útiles
  (no solo METAR lejano) aparecen consistentemente; puede ajustarse tras
  unos días de datos reales.
- **Si vale la pena mostrar viento/humedad de la zona** además de
  temp/presión, o si eso satura la tarjeta sin aportar tanto — a decidir
  viendo el diseño real.
- **Fase 2 (tendencias):** la ventana quedó fija en 3 h (igual que
  `/api/forecast/local`). Falta decidir qué umbral de divergencia
  zona-vs-propio justificaría una alerta automática — necesita datos de
  varias semanas de la comparación visual ya desplegada antes de fijar
  números, igual que se hizo con el detector de lluvia y el QC estadístico.

## Fuentes

- [Xweather API — Observations](https://www.xweather.com/docs/weather-api/endpoints/observations)
- [Xweather — planes y precios](https://www.xweather.com/pricing)
- `receiver/app/services/openmeteo.py` — patrón de caché TTL + stale-fallback a seguir
- `receiver/app/services/alerts.py` (`_pressure_hist`/`_temp_hist`) — patrón de historial por estación, para la fase 2 de tendencias
- `project_gw1100_pressure_fix` (memoria) — mismo bug de presión sin corregir por altitud, ya visto una vez en la estación propia

---

## Fase 3: sumar Netatmo (red adicional) — HECHA, conectada 2026-09-13

**Implementado:**
- `receiver/app/services/netatmo.py` — OAuth2 (`authorize_url`/`exchange_code`/
  `_ensure_access_token` con rotación de refresh_token), `_normalize` (combina
  los módulos de `getpublicdata` por `type`, no hay `module_types` explícito
  en esta API pública — confirmado contra ejemplos reales de la API, no
  supuesto), filtro de presión plausible (mismo rango que Xweather) y
  tendencia por estación (mismo mecanismo que `xweather.py`). Tests en
  `receiver/tests/test_netatmo.py`.
- `forecaster.zone_trend()` (antes `xweather._zone_trend`, movida para
  reusarla entre las dos redes y en la fusión) — METAR-primero-si-hay, si no
  mediana.
- `main.py`: `GET /api/admin/netatmo/oauth/start` (requiere sesión admin,
  genera un `state` de un solo uso) + `GET /api/admin/netatmo/oauth/callback`
  (sin auth header a propósito — es un redirect de navegador, la protección
  real es el `state`; intercambia el `code` de inmediato y persiste el
  `refresh_token`). `/api/nearby-stations` ahora consulta Xweather y Netatmo
  por separado y fusiona ambas listas — si una red falla se ignora (con log)
  en vez de tumbar la tarjeta completa.
- `Admin → Integraciones`: sección "Netatmo" (toggle, client_id/secret,
  botón "Conectar con Netatmo" que guarda y redirige al login).
- `NearbyStationsCard.tsx`: `SOURCE_LABEL.NETATMO` y el pie ("vía Xweather +
  Netatmo") ya no asumen una sola red.

**Cerrado el mismo día (2026-09-13):** login OAuth completado desde Admin →
Integraciones (el intento fallido de esta sesión, con el `code` pasado por
el chat, fue justo lo que motivó construir el callback server-side — ver
*Nota de la prueba real* abajo) y el punto 4 (¿la presión de Netatmo es
absoluta o a nivel del mar?) verificado con datos reales -- **es a nivel del
mar**, ver el resumen al principio del documento. El filtro de rango
plausible (950-1050 hPa) queda como red de seguridad permanente, no como
sustituto de la verificación.

**Sigue pendiente:** validar en producción unos días (punto 6) antes de dar
la fase por cerrada del todo.

### Por qué

Xweather (fase 1-2) cubre PWS + METAR + mesonet, pero su red de PWS es la
propia de Aeris/PWSWeather + lo que agrega de CWOP/MADIS — **no** incluye la
red de Netatmo, que es independiente y tiene buena adopción como estación
doméstica. Vale la pena sumarla como **segunda fuente**, no reemplazo.

### Prueba real de factibilidad (2026-09-13)

Con el API pública de Netatmo (`getpublicdata`, ver *La API* abajo), en un
bbox de ±0.05° (~10x10 km) alrededor de 19.380359,-99.174564:

**6 estaciones Netatmo encontradas** — donde Xweather, en un radio
comparable (`radius=3mi` ≈ 4.8 km), solo había encontrado **1** (ver
*Prueba real* de Xweather arriba). Mejora real de densidad, no marginal:
vale la pena construirlo.

### Diferencia clave vs. Xweather: OAuth2, no llave fija

A diferencia de Xweather (`client_id`+`client_secret` como query params,
sin más), Netatmo usa **OAuth2 completo**:

1. Registrar una app gratis en `dev.netatmo.com` → dá `client_id` +
   `client_secret` (ya se hizo en esta sesión — ver *Credenciales ya
   generadas* abajo).
2. Flujo `authorization_code`: redirigir al dueño de la cuenta a
   `https://api.netatmo.com/oauth2/authorize?client_id=...&redirect_uri=...&scope=read_station`,
   inicia sesión/acepta, Netatmo redirige de vuelta con `?code=...`.
3. Intercambiar ese `code` por `access_token` + `refresh_token` en
   `POST https://api.netatmo.com/oauth2/token`.
4. **El `refresh_token` se ROTA cada vez que se usa** para pedir un
   `access_token` nuevo — hay que persistir el nuevo cada vez, no es un
   secreto estático como `xweather_client_secret`. Si se pierde el
   `refresh_token` vigente, hay que rehacer el paso 2-3 a mano.

### Nota de la prueba real: el `code` expira en segundos

En esta sesión se intentó pasar el `code` generado por el usuario a través
del chat para que Claude hiciera el intercambio — falló con
`invalid_grant` porque el código de un solo uso ya había expirado (vida muy
corta, ~30-60 s) en el ir y venir de la conversación. **Lección para la
implementación real:** el intercambio código→token debe pasar
inmediatamente, del lado del servidor, apenas Netatmo redirige — por eso
la fase 3 necesita un **endpoint callback propio** (`GET
/api/admin/netatmo/oauth/callback` o similar) en vez de pedirle al usuario
que copie el `code` de la URL a mano.

### Credenciales ya generadas (esta sesión, 2026-09-13)

Ya existe una app de desarrollador Netatmo con `client_id` conocido
(visible en el historial de esta conversación) — **reusar esa app en vez
de crear una nueva** cuando se retome. El `client_secret` NO se guarda en
este archivo (no debe vivir en git) — está en el historial de chat de la
sesión `originSessionId` de la memoria `project-estaciones-vecinas-xweather`,
o se puede regenerar en `dev.netatmo.com` si se perdió. Aún **no** se
obtuvo un `refresh_token` válido (el único intento expiró) — hay que
rehacer el login OAuth cuando se implemente el callback.

### La API: Netatmo `getpublicdata`

```
GET https://api.netatmo.com/api/getpublicdata
    ?lat_ne=<...>&lon_ne=<...>&lat_sw=<...>&lon_sw=<...>
Authorization: Bearer <access_token>
```

Respuesta: lista de estaciones, cada una con:

```jsonc
{
  "_id": "70:ee:...",                    // MAC de la estación base
  "place": { "location": [lon, lat], "altitude": ..., "timezone": "..." },
  "modules": [
    { "type": "NAMain",    "measures": { ...: { "pressure": [...] } } },  // base: presión (¡verificar si ya es a nivel del mar o absoluta -- mismo tipo de bug visto 2 veces, ver Xweather arriba y project_gw1100_pressure_fix!)
    { "type": "NAModule1", "measures": { ...: { "temperature": [...], "humidity": [...] } } }, // módulo exterior
    { "type": "NAModule2", "measures": { ... } },  // anemómetro (si tiene)
    { "type": "NAModule3", "measures": { ... } }   // pluviómetro (si tiene)
  ]
}
```

Hay que combinar el módulo exterior (temp/humedad) + la base (presión) en
una sola lectura por estación, y **verificar contra datos reales** si
`pressure` de Netatmo ya viene reducida a nivel del mar o es absoluta de
estación antes de compararla con `pressure_relative` propia — no asumir,
dado el historial de este mismo bug (GW1100 propio, y `pressureMB` vs
`altimeterMB` de Xweather).

### Diseño del lado del servidor

- **`receiver/app/services/netatmo.py`** (nuevo), mismo patrón de caché
  TTL + stale-fallback que `xweather.py`/`openmeteo.py`, más:
  - `_ensure_access_token()`: usa el `refresh_token` guardado para pedir
    un `access_token` nuevo cuando el actual expira (~3 h de vida); en
    cuanto Netatmo devuelve un `refresh_token` nuevo, **persistirlo de
    inmediato** (mismo mecanismo que usa `config.py`/Admin para guardar
    ajustes) antes de seguir, para no perderlo si el proceso se cae justo
    después.
  - `_normalize()`: combina módulos por estación, filtra estaciones sin
    módulo exterior o con presión fuera de rango plausible (mismo rango
    950-1050 hPa que Xweather, mismo motivo).
- **Config nuevo** (`config.py`):
  ```python
  netatmo_enabled: bool = False
  netatmo_client_id: Optional[str] = None
  netatmo_client_secret: Optional[str] = None
  netatmo_refresh_token: Optional[str] = None
  ```
- **Endpoint callback OAuth** (nuevo, en `main.py`): recibe `?code=...`
  de la redirección de Netatmo, intercambia por tokens de inmediato
  (server-side, sin pasar por el usuario) y guarda `refresh_token` en
  settings. Solo accesible desde Admin (mismo nivel de protección que el
  resto de `/admin`).
- **Admin → Integraciones:** sección nueva "Netatmo" con campos
  `client_id`/`client_secret` (enmascarados, como Xweather) + un botón
  "Conectar con Netatmo" que arma la URL de `authorize` y manda al dueño
  ahí; el callback hace el resto solo.
- **Merge en `/api/nearby-stations`:** combinar la lista de Netatmo con la
  de Xweather en la misma respuesta (agregar un campo `network` o
  reusar `source` con un valor nuevo, p. ej. `"NETATMO"`). No hay forma
  confiable de deduplicar entre redes (IDs distintos) — mostrar ambas por
  separado está bien, mismo espíritu que ya mezclar PWS/METAR/mesonet de
  Xweather.

### Límites de la API

Netatmo free tier: límite de peticiones por hora por app (verificar cifra
exacta al implementar, históricamente generoso — cientos/hora). Con el
mismo TTL de caché de 10-15 min que Xweather, muy por debajo de cualquier
límite razonable.

### Checklist (fase 3)

- [x] **1. Callback OAuth server-side** — `GET /api/admin/netatmo/oauth/start`
      (sesión admin, genera `state`) + `GET /api/admin/netatmo/oauth/callback`
      (público a propósito, protegido por el `state`) en `main.py`.
- [x] **2. Config + Admin → Integraciones:** campos `netatmo_*` en
      `config.py`, sección "Netatmo" en el panel con botón "Conectar con
      Netatmo".
- [x] **3. `netatmo.py`:** fetch + refresh de token + normalize + caché
      TTL, mismo patrón que `xweather.py`. Tests en `test_netatmo.py`.
- [x] **4. Verificar con datos reales** si `pressure` de Netatmo es
      absoluta o a nivel del mar — **es a nivel del mar** (verificado
      2026-09-13 contra 10 estaciones reales, ver resumen al principio del
      documento). No hace falta ningún ajuste tipo `altimeterMB`.
- [x] **5. Fusionar con Xweather** en `/api/nearby-stations` y en
      `NearbyStationsCard.tsx` (marca la red de origen de cada estación).
- [ ] **6. Validar en producción unos días**, mismo criterio que la fase
      1 de Xweather, antes de dar la fase por cerrada del todo.
