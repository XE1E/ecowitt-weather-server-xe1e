# Plan de mejoras (roadmap)

Ideas para agregar/cambiar, priorizadas por valor y esfuerzo. Se irá marcando el
estado conforme avancemos, paso a paso.

## Estado actual (ya hecho)
Servidor desplegado en `https://clima.xe1e.net` (HTTPS/Cloudflare/Caddy). Vista
clásica `/` y vista `/pro` estilo WeatherNode con cintillo completo: Inicio,
Pronóstico (Open-Meteo), Historia, Estadísticas, Radar (Ventusky), Astronomía,
Calidad del aire (WAQI). Alertas por umbral + Telegram, MQTT/HA discovery, toggle
de unidades y FX, backups de InfluxDB, simulador de datos, cuenta PAYG.

**Añadido después:** récords históricos con fecha/hora, tile "vs ayer", lluvia
acumulada, exportar CSV, responsive + skeletons, **panel de administración**
(`/pro/admin`, login usuario/contraseña, edición en caliente sin tocar el `.env`).
Y las **mejoras inspiradas en WeeWX** (ver sección al final): control de calidad,
calibración de sensores, variables derivadas ampliadas, pronóstico local por
tendencia barométrica y publicación a redes públicas.

---

## 🔔 Fiabilidad / alertas
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 1 | **Alerta de "estación caída"** (avisar si no llegan datos en X min) | 🔴 Alto | 🟢 Bajo | ✅ Hecho |
| 2 | **Terminar Telegram** (crear bot + token) | 🔴 Alto | 🟢 Bajo (acción del usuario) | ⏳ Pendiente usuario (ya editable en panel) |
| 3 | **Monitor de uptime externo** (Cloudflare Worker + cron) | 🟠 | 🟢 | ✅ Código listo (`uptime-worker/`); falta desplegar |

## 📊 Datos / features
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 4 | Récords "histórico" con fecha/hora de la máx/mín | 🟠 | 🟠 | ✅ Hecho |
| 5 | Tile "vs ayer" / vs promedio | 🟢 | 🟢 | ✅ Hecho |
| 6 | Gráfica de lluvia acumulada (barras diarias) | 🟢 | 🟢 | ✅ Hecho |
| 7 | Exportar CSV del histórico | 🟢 | 🟢 | ✅ Hecho |
| 8 | Configurar umbrales de alertas desde la web | 🟠 | 🟠 | ✅ Hecho (panel admin) |

## 🎨 UX / pulido
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 9 | **Revisar responsive/móvil** de `/pro` | 🟠 | 🟢 | ✅ Hecho |
| 10 | **Skeletons de carga** (evitar tarjetas vacías) | 🟢 | 🟢 | ✅ Hecho |
| 11 | Tema claro opcional | 🟢 | 🟠 | ✅ Hecho (toggle ☀️/🌙 en el header) |
| 12 | i18n / inglés | 🟢 | 🔴 | Pendiente (decisión) |
| 13 | PWA (instalable) | 🟢 | 🟠 | ✅ Hecho (manifest + service worker + íconos) |
| 14 | Widget "Share & Embed" de condiciones actuales | 🟢 | 🟠 | ✅ Hecho (/embed + página Compartir) |

## 🔐 Administración / seguridad
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 19 | **Panel de administración web** (login seguro) para ver/editar ajustes (umbrales de alertas, calibración, QC, Telegram, WAQI, redes públicas) sin tocar el `.env`; edición en caliente | 🟠 Medio-alto | 🔴 Alto | ✅ Hecho |

> Nota de seguridad para #19 (panel de administración): es una superficie sensible.
> Requisitos: **autenticación fuerte** (usuario+contraseña o token), HTTPS (ya lo hay),
> e idealmente restringir por IP o poner **Cloudflare Access** delante. Diseño posible:
> - Guardar los ajustes en un archivo/tabla (JSON/SQLite) en vez del `.env`, para
>   editarlos y recargarlos **en caliente** sin reiniciar el contenedor.
> - Endpoints protegidos en el receiver (GET/POST /admin/settings) + una página
>   `/pro/admin` con login.
> - Nunca mostrar secretos en claro (tokens enmascarados).

## 📝 Contenido
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 18 | **Redactar artículo para el blog** (sobre el proyecto/estación) | 🟠 | 🟠 | ✅ Borrador listo (`docs/blog-articulo.md`); falta publicar |

## ☁️ Arquitectura / experimentos
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 15 | Laboratorio "todo Cloudflare" (Workers + D1 + Pages) | 🟢 | 🔴 | Pendiente (ver CLOUDFLARE-WORKERS.md) |
| 16 | Backups fuera del VPS (R2 / almacenamiento externo) | 🟠 | 🟠 | Pendiente |
| 17 | Grafana (ya en compose, perfil opcional) | 🟢 | 🟢 | Pendiente |

---

## Top 3 en curso (orden)
1. **Alerta de estación caída** (backend)
2. **Terminar Telegram** (acción del usuario, guiada)
3. **Responsive/móvil + skeletons de carga** (frontend)

## Pendientes concretos ya identificados
- Poner **WAQI_TOKEN** en el `.env` del VPS (para Calidad del aire).
- Decidir **i18n / inglés**.
- **~2026-07-17**: llega el WS2910 → apagar simulador, limpiar datos falsos, apuntar la estación.

---

## Procedimiento: activar Telegram (para hacer más tarde)
Desbloquea las alertas por umbral y la de estación caída.

1. **Crear el bot**: en Telegram, abre **@BotFather** → `/newbot` → sigue los pasos → copia el **token**.
2. **Obtener chat_id**: escríbele algo a tu bot; abre
   `https://api.telegram.org/bot<TOKEN>/getUpdates` y busca `"chat":{"id":123456789}`.
3. **En el VPS**, edita `.env`:
   ```
   ALERTS_ENABLED=true
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=<token>
   TELEGRAM_CHAT_ID=<chat id>
   ```
4. Aplica: `docker compose up -d receiver` (o desde el **panel admin**, sin reiniciar).
5. Prueba: `curl -s -X POST http://localhost:8080/data/report -d "tempf=104&humidity=20&model=WS2910&stationtype=SIMULATOR"`
   → debe llegar la alerta a Telegram.

---

# Mejoras inspiradas en WeeWX (y similares)

> **Prioridad del proyecto (XE1E):** lo que más interesa es **sacar el máximo
> provecho a los datos LOCALES generados por la estación Ecowitt**, porque son
> los datos reales y cercanos → información precisa de nuestro punto exacto.
> Todo lo de abajo va en esa dirección: primero limpiar y enriquecer el dato
> propio, luego compartirlo.
>
> **Nota de alcance:** el proyecto, en sentido estricto, **no** trata de radios,
> antenas ni cosas de radioafición. Eso no impide que, como radioaficionado, el
> usuario se involucre; por eso **CWOP queda como opción válida** (no descartada).

## Lo aprobado y ya implementado

| # | Mejora | Qué hace | Editable en panel |
|---|--------|----------|-------------------|
| W1 | **Control de calidad (QC)** | Descarta lecturas imposibles (temp −80 °C, humedad 150 %, picos absurdos) antes de guardarlas. Evita ensuciar gráficas y disparar alertas falsas. | `qc_enabled` |
| W2 | **Calibración de sensores** | Offsets (temp/humedad/presión) y multiplicadores (viento/lluvia) para corregir sesgos conocidos del sensor sin tocar hardware. | `cal_*` |
| W3 | **Variables derivadas ampliadas** | Además de punto de rocío, sensación térmica, heat index y wind chill (ya existían): **humidex** y **base de nubes** estimada. Se recalculan tras calibrar/QC. | — |
| W4 | **Pronóstico local propio** | Tendencia barométrica (presión a nivel del mar + su cambio en 3 h) → texto de pronóstico corto. **No depende de Open-Meteo**: es 100 % dato de nuestra estación. Endpoint `/api/forecast/local`. | — |
| W5 | **Publicar a redes públicas** | Uploaders a Weather Underground, PWSWeather, Windy, OpenWeatherMap y **CWOP/APRS**. Toggle + credenciales por red. | `wu_*`, `pws_*`, `windy_*`, `owm_*`, `cwop_*` |

El pipeline del receiver quedó así (orden tipo WeeWX):
`parsear → convertir a métrico → calibrar → QC → derivar → guardar → MQTT → alertas → publicar`.

## Redes públicas: a cuál conviene conectarse

Estación en CDMX (zona con **pocas estaciones PWS** → tu aporte cuenta).

| Red | Qué le aportas | Qué te aporta | Esfuerzo |
|-----|----------------|---------------|----------|
| **Weather Underground** | Alimenta el pronóstico de The Weather Company | **Mayor audiencia** + página propia + histórico largo + apps | Bajo |
| **Windy.com** | Mejora cobertura del mapa en zona con pocas estaciones | **Mejor visibilidad visual** + mapa | Bajo |
| **PWSWeather** | Alimenta productos de Aeris/Xweather | Página limpia, respaldo | Bajo |
| **OpenWeatherMap** | Mejora su modelo donde hay pocos datos | **Acceso a su API** (útil para dev) | Medio |
| **CWOP** | **Mayor aporte científico real**: entra a MADIS → modelos de NOAA, con QC del NWS | Validación/prestigio | Medio (origen APRS) |
| Ecowitt.net | (nube del fabricante) | App móvil oficial | Nulo |

- **Dónde aportas más:** CWOP (único que entra a los modelos de NOAA). Es de origen APRS/radioafición → **opción válida** dado que al usuario no le molesta involucrarse como radioaficionado.
- **Qué te aporta más:** Weather Underground (audiencia + histórico + apps) y Windy (mapa).
- **Decisión del usuario:** aportar a **TODAS** las redes (le gusta contribuir; algunas dan cuenta *business* de agradecimiento — misma filosofía que su receptor ADSB, que alimenta 5 sistemas). Las cinco quedan implementadas y activables desde el panel; solo falta poner las credenciales de cada una.
- **Ampliables a futuro** (mismo patrón, si se quiere aún más alcance): Weathercloud, AWEKAS, Met Office WOW, Windguru.

## Otros software tipo WeeWX (para revisar y sacar más ideas)

| Software | Por qué mirarlo |
|----------|-----------------|
| **CumulusMX** ⭐ | Estación completa (C#, muy activo, v5.1.4 jun-2026); soporta Ecowitt; tablero en tiempo real, **alarmas**, sube a WU/PWS/Windy/OWM/CWOP/WOW/AWEKAS/Weathercloud. Buenas páginas de **récords/extremos**, "este mes/año", **tendencias**, reportes NOAA. |
| **Meteotemplate** | ⚠️ **Descontinuado** (operó 2013–2026). Fue web (PHP) con decenas de plugins. Ya no es adoptable, pero sus ideas de **interfaz** (récords, extremos, comparativas, "en este día") siguen siendo válidas como inspiración. |
| Skins de WeeWX: **Belchertown**, **neowx-material**, **weewx-wdc** | Referencia de **diseño/UX** para el pulido visual. |
| **Grafana** ⭐ | Encaja con nuestro **InfluxDB**; dashboards meteorológicos comunitarios → ideas de métricas/agregaciones. |
| **pywws** | Ligero; ideas de resúmenes horarios/diarios y agregación. |
| **Meteobridge / Weather Display** | Comerciales; útiles por su **lista de integraciones**. |

## Revisión de CumulusMX (ideas concretas a adoptar)

Filtradas a lo que aprovecha el **dato local** y encaja en nuestro stack:

| Idea de CumulusMX | Qué nos daría | Prioridad |
|-------------------|---------------|-----------|
| **Resumen diario ("Dayfile")** — un registro por día con mín/máx/prom/total + horas | **Base** de récords, climatología y "en este día"; hace rápidas las consultas largas. Es la pieza de **arquitectura de WeeWX** (acumuladores) | 🔴 Fundacional |
| **Récords ampliados** — histórico de siempre + récord por cada mes calendario + "este mes/año/ayer" con fecha/hora | Página de récords tipo CumulusMX | ✅ Hecho (Climatología) |
| **Reporte climatológico NOAA** (mensual/anual): medias, extremos, días de lluvia, grados-día | Sección "Climatología" | ✅ Hecho (Climatología) |
| **Más alarmas**: batería baja, sensor perdido, pico, **ráfaga**, **lluvia diaria**, **presión alta/baja** | Cobertura de avisos como CumulusMX | ✅ Hecho |
| **"En este día"** (efeméride) — qué pasó tal día en años previos | Enganche/curiosidad | 🟢 (depende de Dayfile) |
| **Wind run + dirección dominante + rosa de vientos** | Estadística de viento del sitio | 🟢 |
| **Grados-día** (calefacción/refrigeración) y **chill hours** | Estadística energética/agrícola local | 🟢 |
| **Rachas de lluvia**: días secos/húmedos consecutivos, día más lluvioso | Analítica de lluvia | 🟢 |
| **Editor de datos** (admin) para corregir registros erróneos | Higiene de datos | 🟢 |
| **Comparación de años** en gráficas | Ver tendencias interanuales | 🟢 |

De Meteotemplate (descontinuado) se rescatan las mismas ideas de **récords/extremos/"en este día"** y gauges; no aporta nada que CumulusMX no cubra.

## Ideas WeeWX aún NO implementadas (candidatas futuras)

Todas explotan el **dato local** (la prioridad):

| Idea | Qué daría | Estado |
|------|-----------|--------|
| **Acumuladores/resumen diario (Dayfile)** | Rollups min/máx/prom/total por día (arquitectura WeeWX) para históricos largos rápidos | 🔧 En curso |
| **Reportes de climatología** (mensual/anual estilo NOAA) | Resúmenes con medias, extremos, días de lluvia, grados-día. Depende del Dayfile | Pendiente |
| **Grados-día** (calefacción/refrigeración) y **wind run** | Estadísticas agrónomas/energéticas del propio sitio | Pendiente |
| **Evapotranspiración (ET)** | Útil para riego/jardinería, con solar + temp + viento + humedad locales | Pendiente |
| **Filtro de picos (spike)** | Rechazar saltos imposibles entre lecturas consecutivas (extensión del QC) | ✅ Hecho (quality.py, toggle en panel) |
| **Almanaque ampliado** | Crepúsculos (civil/náutico/astronómico), % de iluminación lunar, orto/ocaso de planetas | ✅ Hecho (pyephem, en Astronomía) |
| **Alarmas batería baja + sensor perdido** | Avisos WN31/WS69 sin batería o sin contacto | ✅ Hecho (panel) |
| **"En este día"** (efeméride) | Qué pasó tal día en años previos — en Climatología | ✅ Hecho |
| **Rosa de vientos** | Distribución dirección/velocidad — en Estadísticas | ✅ Hecho |
| **Grados-día** (visibles) + **evapotranspiración (ET)** | ET0 Hargreaves; grados-día y ET en Climatología y reporte NOAA | ✅ Hecho |
