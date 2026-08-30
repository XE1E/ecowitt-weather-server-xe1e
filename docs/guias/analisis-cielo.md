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
