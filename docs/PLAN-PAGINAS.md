# Plan de páginas del cintillo (nav) — estilo WeatherNode

La referencia (meteouitgeest / WeatherNode) tiene un menú: Home, Forecast, History,
Statistics, Radar, Satellite, Air & Pollen, Astronomy, Sky & Water, Fire Weather,
Community Stations. Aquí decidimos **cuáles conviene** para la estación XE1E, con
qué datos, y cómo construirlas.

## Requisito previo (común a todas)
1. **Barra de navegación** en `/pro` (cintillo con enlaces).
2. **Routing de subrutas** (`/pro/forecast`, `/pro/history`, …). Hoy el router es
   mínimo (`/pro` vs `/`). Opciones:
   - Ampliar el router manual por `pathname` (sin dependencia), o
   - Adoptar `react-router-dom` (más limpio para varias páginas). **Recomendado.**
3. Layout compartido (cabecera + cintillo + footer) reutilizable entre páginas.

---

## Veredicto por página

| Página | ¿Construir? | Datos | Esfuerzo | Notas |
|--------|-------------|-------|----------|-------|
| **Home** | ✅ Hecha (`/pro`) | Estación + Open-Meteo | — | Panel principal actual |
| **Pronóstico** | ✅ Sí | Open-Meteo (diario + horario) | 🟠 Medio | Vista amplia: 7-14 días, horario detallado, precipitación, viento; ya tenemos el fetch |
| **Historia** | ✅ Sí | InfluxDB | 🟠 Medio | Gráficas por rango (día/semana/mes/año) de temp, humedad, viento, lluvia, presión; usa `/api/history` (quizá ampliar rangos/agregación) |
| **Estadísticas** | ✅ Sí | InfluxDB | 🟠 Medio | Récords y extremos (máx/mín histórico, promedios, días de lluvia). Requiere endpoints de agregación nuevos (p. ej. `/api/stats/records`) |
| **Astronomía** | ✅ Sí | Open-Meteo + cálculo | 🟢 Bajo | Ampliar lo que ya hay: sol/luna, fases, horas de luz, quizá planetas visibles |
| **Radar** | ✅ Sí (fácil) | Windy embed | 🟢 Bajo | Página con radar a pantalla completa (ya tenemos el widget chico) |
| **Satélite** | 🟡 Opcional | Windy/NOAA embed | 🟢 Bajo | Otro embed (capa satélite). Externo, no de la estación |
| **Calidad del aire** | 🟡 Opcional (externo) | **Open-Meteo Air Quality** (gratis) | 🟠 Medio | La estación NO mide aire, pero Open-Meteo da PM2.5/PM10/AQI de CDMX gratis. Se puede mostrar como dato **externo** claramente etiquetado |
| **Fire Weather** | 🟡 Opcional | Derivado (temp/hum/viento) | 🟠 Medio | Índice de riesgo de incendio calculado. Nicho; útil en secas |
| **Polen** | ❌ Omitir | — | — | Sin fuente confiable para CDMX; la estación no lo mide |
| **Sky & Water (mareas)** | ❌ Omitir | — | — | CDMX es interior; no aplica |
| **Community Stations** | ❌ Omitir | — | — | Requeriría una red de estaciones |
| **Alertas / Earthquakes / Aurora / METAR** | Parcial | — | — | Alertas y METAR ya están en Home. Sismos/aurora: omitir (no aplican / externos) |

---

## Orden sugerido de implementación
1. **Infraestructura de navegación** (nav bar + routing + layout compartido) — habilita todo lo demás.
2. **Historia** — alto valor para una estación (ver tendencias); usa datos que ya guardamos.
3. **Estadísticas / récords** — muy apreciado por aficionados; añade endpoints de agregación.
4. **Pronóstico** (página amplia) — reutiliza Open-Meteo, poco riesgo.
5. **Astronomía** y **Radar** (páginas dedicadas) — bajo esfuerzo.
6. **Opcionales**: Calidad del aire (Open-Meteo), Satélite, Fire Weather — según interés.

## Decisiones abiertas (a definir contigo)
- ¿`react-router-dom` (recomendado) o seguir con router manual?
- ¿Incluir **Calidad del aire** aunque sea dato externo (no de la estación)? Se etiquetaría claramente.
- ¿Idiomas (i18n) antes o después de las subpáginas? (i18n es un refactor grande; conviene decidir pronto para no traducir dos veces).
- Prioridad real: ¿Historia y Estadísticas primero (mi recomendación) o Pronóstico?
