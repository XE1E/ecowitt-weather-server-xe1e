# Plan — Integración del análisis del cielo en pronóstico y condiciones

> Escrito el 2026-08-11. Cerrado como **✅ TERMINADO el 2026-08-19**: las 5 fases y
> las 4 decisiones de más abajo quedaron resueltas. Vive en git.
>
> **Estado:** análisis del cielo implementado y funcionando con Gemini (gratis),
> con sus 5 fases desplegadas y sus decisiones de diseño ya cerradas (ver
> *Decisiones*, al final).
>
> **Nota del 2026-08-29:** la redacción con flechas/íconos que describe este plan
> (`↑`/`↓`/`→`, `✓`/`≈`/`?`/`⚠`) se reemplazó por frases completas en español, sin
> símbolos — no se entendían sin leyenda. También se agregó persistencia de la
> validación (antes se calculaba al vuelo y se descartaba) y un endpoint de % de
> acierto. Ver `docs/guias/analisis-cielo.md` para el estado actual; este plan
> queda tal cual como registro histórico de la decisión original.

## Contexto

El sistema ya analiza cada foto de la cámara con Gemini Vision y extrae:

```json
{
  "cloud_type": "cumulonimbus",
  "cloud_coverage_pct": 90,
  "sky_condition": "stormy",
  "visibility": "good",
  "precipitation_visible": false,
  "development": "building",
  "description": "Cielo amenazante con cumulonimbos...",
  "forecast_hint": "Alta probabilidad de precipitaciones en 30-60 min"
}
```

La pregunta es: **¿cómo usar esta información visual para complementar los datos de
sensores y los pronósticos de modelos numéricos?**

---

## Opción 1: Condiciones actuales enriquecidas

### Qué es
Mostrar el análisis del cielo junto a los datos de sensores en la página principal
y/o en la tarjeta de condiciones actuales.

### Implementación
- Agregar sección "Estado del cielo" en la página de inicio
- Mostrar: descripción, condición, tipo de nubes, cobertura
- Opcional: icono dinámico basado en `sky_condition`

### Pros
- **Inmediato**: ya tenemos los datos, solo hay que mostrarlos
- **Valor único**: ninguna otra estación meteorológica casera tiene esto
- **Contexto visual**: "hace 25°C con cielo parcialmente nublado" es más útil que solo "25°C"
- **Bajo costo**: solo es UI, no requiere lógica adicional

### Contras
- **Dependencia de la cámara**: si no hay foto reciente, no hay análisis
- **Subjetivo**: la descripción puede variar entre análisis consecutivos
- **Redundancia parcial**: el icono del clima ya intenta representar la condición

### Beneficio estimado: ⭐⭐⭐⭐ Alto
Es el "low-hanging fruit" — máximo valor con mínimo esfuerzo.

---

## Opción 2: Nowcasting (pronóstico 0-2 horas)

### Qué es
Usar el análisis visual para predecir el clima de las próximas 1-2 horas, comparando
análisis consecutivos y detectando tendencias.

### Implementación
1. Guardar historial de análisis (últimas 6-12 capturas, ~30-60 min)
2. Comparar campos clave entre análisis:
   - `cloud_coverage_pct`: ¿aumentando o disminuyendo?
   - `development`: ¿building → stable → dissipating?
   - `precipitation_visible`: ¿apareció?
   - `sky_condition`: ¿cambió de partly_cloudy a stormy?
3. Generar predicción basada en tendencias:
   - Cobertura subiendo + development=building → "Nublándose, posible lluvia"
   - Cobertura bajando + development=dissipating → "Despejando"
   - precipitation_visible=true → "Lluvia aproximándose"

### Pros
- **Pronóstico hiperlocal**: los modelos numéricos tienen resolución de km, esto es metros
- **Tiempo real**: actualiza cada 5 min vs cada hora de los modelos
- **Detecta lo visible**: una cortina de lluvia en el horizonte aparece aquí antes que en el radar

### Contras
- **Complejidad**: requiere lógica de tendencias y umbrales
- **Ruido**: el análisis puede variar aunque el cielo no cambie (luz, ángulo del sol)
- **Limitado a lo visible**: no predice lo que viene de atrás del horizonte
- **Noche**: el análisis nocturno es menos preciso

### Beneficio estimado: ⭐⭐⭐ Medio-Alto
Valor real pero requiere calibración y manejo de casos edge.

---

## Opción 3: Validación/ajuste del pronóstico de modelos

### Qué es
Comparar lo que DICEN los modelos (Open-Meteo, WeatherAPI) con lo que SE VE en la
cámara, y ajustar la confianza o el pronóstico mostrado.

### Implementación
1. Al consultar el pronóstico, también consultar el último análisis del cielo
2. Comparar condiciones:
   ```
   Modelo dice: "Despejado"
   Cámara ve: "stormy, cumulonimbus, 90%"
   → Discrepancia alta → Mostrar advertencia o ajustar
   ```
3. Reglas de validación:
   - Modelo=clear + cámara=clear → ✓ Alta confianza
   - Modelo=clear + cámara=stormy → ⚠ "Modelos desactualizados, se observan tormentas"
   - Modelo=rain + cámara=clear → ⚠ "Lluvia prevista pero cielo despejado por ahora"

### Pros
- **Corrección en tiempo real**: los modelos se actualizan cada 1-6h, la cámara cada 5 min
- **Honestidad**: muestra cuando hay incertidumbre
- **Detecta errores de modelos**: los modelos fallan especialmente con tormentas convectivas

### Contras
- **Complejidad de mapeo**: ¿cómo comparar "partly_cloudy" de la cámara con códigos WMO?
- **Alcance temporal**: la cámara ve el AHORA, los modelos predicen FUTURO
- **Falsos positivos**: discrepancias que no significan error (nubes pasajeras)

### Beneficio estimado: ⭐⭐⭐ Medio
Interesante pero difícil de calibrar bien.

---

## Opción 4: Alertas automáticas visuales

### Qué es
Disparar alertas basadas en lo que la cámara detecta, independiente de los sensores.

### Implementación
Agregar reglas al sistema de alertas existente:

| Condición detectada | Alerta |
|---|---|
| `cloud_type=cumulonimbus` + `development=building` | ⛈️ Tormenta formándose |
| `precipitation_visible=true` | 🌧️ Lluvia aproximándose |
| `visibility=poor` o `very_poor` | 🌫️ Visibilidad reducida |
| `sky_condition=stormy` | ⚠️ Condiciones tormentosas |

### Pros
- **Anticipación**: alerta ANTES de que los sensores detecten lluvia/cambio de presión
- **Integración natural**: usa el sistema de alertas existente (Telegram, correo)
- **Único**: ninguna estación casera tiene alertas basadas en visión

### Contras
- **Falsos positivos**: nubes lejanas que nunca llegan
- **Spam potencial**: si el análisis oscila, puede generar muchas alertas
- **Requiere histéresis**: igual que las alertas de sensores, necesita persistencia

### Beneficio estimado: ⭐⭐⭐⭐ Alto
Valor claro y tangible, especialmente para tormentas.

---

## Opción 5: Histórico y estadísticas

### Qué es
Guardar todos los análisis para generar estadísticas de cielo a lo largo del tiempo.

### Implementación
1. Guardar cada análisis en archivo o InfluxDB (ya se guarda la foto, agregar el JSON)
2. Consultas tipo:
   - "Promedio de cobertura de nubes por hora del día"
   - "Días con cielo despejado este mes"
   - "Frecuencia de cada tipo de nube"

### Pros
- **Climatología visual**: dato único que no existe en estaciones convencionales
- **Validación a posteriori**: comparar análisis vs lluvia real registrada
- **Interesante para el usuario**: "tu cielo típico a las 3pm es parcialmente nublado"

### Contras
- **Almacenamiento**: ~1KB por análisis × 288/día × 365 = ~100 MB/año (manejable)
- **Valor diferido**: no es útil hasta tener semanas/meses de datos
- **Complejidad de visualización**: requiere gráficas nuevas

### Beneficio estimado: ⭐⭐ Medio-Bajo a corto plazo, alto a largo plazo

---

## Comparativa resumen

| Opción | Esfuerzo | Beneficio | Prioridad sugerida |
|---|---|---|---|
| 1. Condiciones actuales | Bajo | Alto | **1º** |
| 4. Alertas visuales | Medio | Alto | **2º** |
| 2. Nowcasting | Medio-Alto | Medio-Alto | **3º** |
| 3. Validación de modelos | Alto | Medio | 4º |
| 5. Histórico | Bajo-Medio | Bajo→Alto | 5º (paralelo) |

---

## Plan de implementación propuesto

### Fase 1: Condiciones actuales (1-2 horas) — COMPLETADA (2026-08-11)
- [x] Agregar resumen del análisis en página de inicio (SkyAnalysisCard)
- [x] Mostrar descripción + condición + cobertura + visibilidad + pronóstico
- [x] Diseño compacto, se oculta si no hay análisis

### Fase 2: Alertas visuales (2-3 horas) — COMPLETADA (2026-08-11)
- [x] Agregar categoría "visual" al sistema de alertas
- [x] Reglas: sky_storm, sky_precipitation, sky_visibility
- [x] Histéresis: requerir 2 análisis consecutivos para disparar
- [x] Configurable desde Admin (alert_visual_enabled, alert_visual_rules_disabled)

### Fase 3: Nowcasting básico (3-4 horas) — COMPLETADA (2026-08-11)
- [x] Guardar últimos 12 análisis en archivo (analysis_history.json)
- [x] Calcular tendencia de cobertura (delta >10% = significativo)
- [x] Calcular tendencia de desarrollo (building→stable→dissipating)
- [x] Detectar aparición de precipitación visible
- [x] Mostrar en UI: "↑ Nublándose", "↓ Despejando", "→ Estable", "⛈️ Posible tormenta"
- [x] Endpoint /api/camera/analysis incluye campo `trend` con detalles

### Fase 4: Histórico (2-3 horas) — COMPLETADA (2026-08-11)
- [x] Guardar análisis en archivo diario JSON (analysis.json por carpeta de día)
- [x] Endpoint `/api/camera/analysis/history` (sin params: lista días, con ?date=: datos del día)
- [x] Componente SkyAnalysisHistory con gráfica de barras de cobertura
- [x] Estadísticas del día: promedio, mín, máx cobertura + condiciones observadas
- [x] Navegación entre días disponibles

### Fase 5: Validación de modelos (4-5 horas) — COMPLETADA (2026-08-11)
- [x] Mapear sky_condition a códigos WMO (sky_validation.py)
- [x] Comparar con pronóstico actual de Open-Meteo
- [x] Niveles de coincidencia: exact, close, differ, conflict
- [x] Confianza ajustada: 95% exact, 80% close, 60% differ, 30% conflict
- [x] Endpoint /api/camera/analysis/validation
- [x] Indicador visual en SkyAnalysisCard

---

## Decisiones — revisadas 2026-08-19

1. **¿Dónde mostrar el análisis en la página principal?** — ✅ **Resuelto: Opción A.**
   `SkyAnalysisCard` es tarjeta propia en Inicio (`HomePage.tsx`) y también en Mi
   Tablero (añadida el 2026-08-18), separada de `CameraCard`.

2. **¿Alertas visuales van a Telegram/correo o solo se muestran en la web?** —
   ✅ **Resuelto: van a los dos.** La categoría `visual` (`sky_storm`,
   `sky_precipitation`, `sky_visibility`) usa el mismo enrutamiento por categoría
   que el resto de alertas (`alerts.py::_channel_allows`, `telegram_categories`/
   `email_categories`) — nada especial que decidir, ya se comporta como cualquier
   otra alerta y es configurable por canal desde Admin.

3. **¿Historial de análisis en InfluxDB o en archivos JSON?** — ✅ **Resuelto: JSON.**
   Implementado con el patrón de las fotos (`camera.py`: `analysis_history.json` +
   un `analysis/YYYY-MM-DD.json` por día). No se ha necesitado InfluxDB.

4. **¿Análisis solo de día?** — ✅ **Resuelto, por otra vía.** No es por
   `sunrise`/`sunset` del almanac como proponía este punto, sino por horario fijo
   configurable: Admin → Cámara tiene `camera_capture_hour_start`/`_hour_end`
   (`AdminCamara.tsx`), que la Pi lee de `/api/camera/capture-config` para decidir
   si captura. Como el análisis sólo corre sobre capturas recibidas
   (`_analyze_sky_background` se dispara desde `/api/camera/upload`), acotar el
   horario de captura acota también el de análisis — mismo ahorro de cuota que
   buscaba esta decisión, con un horario fijo en vez de dinámico por amanecer/
   atardecer.

---

## Referencias

- Análisis implementado: `receiver/app/services/sky_analyzer.py`
- Documentación de cámara: `docs/archivo/PLAN-CAMARA-EXTERIOR.md`
- Sistema de alertas: `receiver/app/services/alerts.py`
- Pronóstico consensus: `receiver/app/services/forecast_consensus.py`
