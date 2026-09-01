# Análisis del Cielo con IA — Referencia Rápida

El sistema analiza cada foto de la cámara exterior con **Gemini** o **Claude** para
extraer información sobre el estado del cielo.

## Qué detecta
- Condición general (clear, partly_cloudy, stormy, etc.)
- Tipo de nubes (cumulus, cumulonimbus, cirrus, etc.)
- Porcentaje de cobertura (0-100%)
- Visibilidad (excellent, good, poor)
- Estado de desarrollo (building, stable, dissipating)
- Precipitación visible en horizonte
- Pronóstico a corto plazo

## Dónde se ve
- **Homepage:** tarjeta "Estado del cielo" con análisis actual + tendencia + validación
- **Cámara:** histórico diario con gráfica de cobertura y estadísticas, más "Mejor foto
  del día" (mayor visibilidad reportada ese día, excluye la noche)
- **METAR** (Homepage y `/pro/aeronautica`): junto a las capas de nubes del aeropuerto
  MMMX se muestra qué ve la cámara en ese momento, para comparar a ojo (sin puntaje:
  son dos sitios distintos)
- **Astronomía:** tarjeta "¿Buena noche para observar?" cuando es de noche, cruzando la
  cobertura de nubes de la cámara con el % de iluminación lunar

## Tendencia y validación (redacción 2026-08-29)
Desde 2026-08-29 ambos bloques son frases completas en español, sin flechas ni
símbolos (antes: `↑`/`↓`/`→` para la tendencia, `✓`/`≈`/`?`/`⚠` para la validación).
Ej.: "Nublándose: la cobertura de nubes subió 18%" o "La cámara ve algo distinto al
modelo: la cámara ve parcialmente nublado, el modelo predice cubierto".

## Precisión del pronóstico (`/pro/camara`)
Cada captura ahora guarda si coincidió con el pronóstico de ese momento
(`match`: exact/close/differ/conflict) en el histórico diario -- antes esa
validación se calculaba al vuelo y se descartaba. `GET
/api/camera/analysis/accuracy?days=30` tabula el % de acierto de los últimos N
días; la tarjeta "Precisión del pronóstico" lo muestra como barra apilada. Esta
persistencia es también la base para una futura corrección de sesgo del
pronóstico (ver `docs/internal/PENDIENTES.md` §2.e, pendiente hasta acumular
suficientes semanas de datos).

## Sol directo sin obstrucción (mitiga el halo de la cámara)

La cámara mira al sureste con un lente muy gran angular (106°/56°) y, cuando el sol
pega sin obstrucción de nubes durante varias horas cada mañana, satura buena parte del
encuadre (sale blanco/gris claro por límite de exposición) — confirmado con fotos
reales, no es sólo una bola con halo cerca del sol, puede ser casi todo el cielo
visible durante horas. Sin avisarle nada al modelo, eso se puede leer como nubosidad
que no existe.

Antes de cada análisis, el servidor calcula la altura del sol (pyephem) y la compara
con la radiación solar medida por la propia estación contra una curva de "cielo
despejado esperado para esa altura" (`sky_analyzer.sun_glare_likely`, calibrada con
datos reales de esta estación). Si la radiación medida está acorde a un cielo
despejado, el prompt recibe un aviso explícito: la zona blanca/saturada es
sobreexposición, no nube — que busque nubes reales (textura, sombras, bordes) en el
resto de la imagen antes de reportar cobertura alta. Si en cambio la radiación está
por debajo de lo esperado (nubes reales tapando el sol), no se manda ningún aviso y el
modelo juzga como siempre.

Se descartó tocar el HDR/WDR de la cámara para esto — bloqueado por un bug de
`pytapo` con el firmware del C325WB y porque el ONVIF de esta cámara no expone esos
ajustes. Detalle completo: `docs/archivo/PLAN-HDR-CAMARA.md`.

**Calibración:** la curva viene de UN día confirmado despejado (2026-08-31, 6 puntos
de 7am a 12pm). Separa bien ese día (razón medido/esperado 0.86-1.14 en los puntos
despejados vs. 0.47 en un punto ya nublado esa tarde), pero conviene revisarla si con
más días el umbral (`_CLEAR_SKY_RATIO_THRESHOLD` en `sky_analyzer.py`) deja de separar
tan limpio.

## Alertas visuales
Notifica por Telegram/correo cuando detecta:
- Nubes de tormenta en desarrollo
- Lluvia visible en horizonte
- Visibilidad reducida

Requiere 2 análisis consecutivos (histéresis). Activar en Admin → Notificaciones → "Visual (cielo)".

## Configuración
Admin → Sistema:
- Proveedor: auto (usa Gemini si hay key), gemini, anthropic
- API Key Gemini: tier gratuito (1500 req/día)
- API Key Anthropic: de pago

## Documentación técnica completa
Ver **[GUIA.md](../GUIA.md)** → sección "La cámara del exterior" → "Análisis del cielo con IA".
