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
- **Cámara:** histórico diario con gráfica de cobertura y estadísticas

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
