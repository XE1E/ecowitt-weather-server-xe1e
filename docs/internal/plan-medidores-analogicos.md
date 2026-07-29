# Plan: Medidores Analógicos de Alta Calidad

**Fecha**: 2026-07-29  
**Estado**: Pendiente  
**Referencia visual**: Estilo AWEKAS - medidores analógicos con toque digital

## Objetivo

Crear componentes de medidores (gauges) con apariencia de instrumentos analógicos de alta calidad, similar a los de AWEKAS. Deben simular medidores físicos reales con detalles como:
- Bisel metálico con reflejos
- Carátula con gradientes sutiles
- Agujas con sombra y centro decorativo
- Marcas de escala precisas
- Números legibles y bien posicionados
- Efecto de cristal/vidrio sutil

## Medidores a Implementar

### 1. Termómetro (Temperatura)

```
┌─────────────────────────────┐
│      ╭───────────────╮      │
│     ╱   TEMPERATURA   ╲     │
│    │    ·  ·  ·  ·     │    │
│    │  -10  0  10  20   │    │
│    │ ·               · │    │
│   -20       ↗        30│    │
│    │ ·    23.5°C     · │    │
│    │  40          50   │    │
│    │    ·  ·  ·  ·     │    │
│     ╲       °C        ╱     │
│      ╰───────────────╯      │
└─────────────────────────────┘
```

**Especificaciones:**
- Rango: -20°C a +50°C (configurable para imperial: -4°F a 122°F)
- Zonas de color:
  - Azul: < 10°C (frío)
  - Verde: 10-25°C (confortable)
  - Amarillo: 25-35°C (cálido)
  - Rojo: > 35°C (caliente)
- Valor digital centrado debajo de la aguja
- Indicador de tendencia (flecha arriba/abajo)

### 2. Barómetro (Presión Atmosférica)

```
┌─────────────────────────────┐
│      ╭───────────────╮      │
│     ╱    BARÓMETRO    ╲     │
│    │ LLUVIA    SECO   │     │
│    │  960  980 1000   │     │
│    │ ·               · │    │
│  950       ↗       1020│    │
│    │ ·  1013.2 hPa   · │    │
│    │  1040        1060 │    │
│    │    VARIABLE      │     │
│     ╲      hPa        ╱     │
│      ╰───────────────╯      │
└─────────────────────────────┘
```

**Especificaciones:**
- Rango: 950-1050 hPa (o 28.0-31.0 inHg)
- Zonas con etiquetas:
  - "TORMENTA" / "LLUVIA" (< 1000 hPa)
  - "VARIABLE" (1000-1020 hPa)
  - "BUEN TIEMPO" / "SECO" (> 1020 hPa)
- Tendencia de 3 horas (flecha)
- Segunda aguja fina para "presión hace 3h" (opcional)

### 3. Anemómetro (Velocidad del Viento)

```
┌─────────────────────────────┐
│      ╭───────────────╮      │
│     ╱     VIENTO      ╲     │
│    │   0   10   20    │     │
│    │ ·               · │    │
│    │30      ↗       40│     │
│    │ ·    15 km/h    · │    │
│    │  50          60   │    │
│    │    RÁFAGA: 23    │     │
│     ╲     km/h        ╱     │
│      ╰───────────────╯      │
│         N                   │
│       W ✦ E    [brújula]    │
│         S                   │
└─────────────────────────────┘
```

**Especificaciones:**
- Rango: 0-100 km/h (escala no lineal, más detalle en 0-40)
- Zonas Beaufort con colores:
  - Verde: Calma a brisa (0-20 km/h)
  - Amarillo: Viento moderado (20-40 km/h)
  - Naranja: Viento fuerte (40-60 km/h)
  - Rojo: Temporal (> 60 km/h)
- Indicador de ráfaga máxima
- Mini brújula de dirección debajo o integrada

## Arquitectura Técnica

### Componente Base: `AnalogGauge.tsx`

```typescript
interface GaugeProps {
  value: number
  min: number
  max: number
  unit: string
  title: string
  zones?: Array<{start: number, end: number, color: string, label?: string}>
  ticks?: {major: number, minor: number}
  trend?: 'up' | 'down' | 'stable'
  secondary?: {value: number, label: string}  // segunda aguja
  size?: 'sm' | 'md' | 'lg'
}
```

### Renderizado SVG

1. **Capa base**: Círculo con gradiente radial (efecto 3D)
2. **Bisel**: Anillo exterior con gradiente metálico
3. **Zonas de color**: Arcos con colores semitransparentes
4. **Marcas de escala**: Líneas major/minor con rotación
5. **Números**: Texto posicionado en arco
6. **Aguja**: Path con gradiente, sombra drop-shadow
7. **Centro**: Círculo decorativo (tornillo/pivote)
8. **Cristal**: Overlay con gradiente de brillo

### Animaciones

- Aguja: Transición suave con easing (spring physics)
- Valor: Contador animado al cambiar
- Tendencia: Fade in/out sutil

## Archivos a Crear

```
dashboard/src/components/gauges/
├── AnalogGauge.tsx      # Componente base reutilizable
├── TemperatureGauge.tsx # Wrapper con config de temperatura
├── PressureGauge.tsx    # Wrapper con config de presión
├── WindGauge.tsx        # Wrapper con velocidad + dirección
├── gauges.css           # Estilos compartidos (gradientes, sombras)
└── index.ts             # Exports
```

## Página de Destino

Crear nueva página `GaugesPage.tsx` accesible desde el menú, o integrar en página existente como sección "Instrumentos".

## Estimación

- AnalogGauge base: 2-3 horas (el más complejo, SVG detallado)
- TemperatureGauge: 30 min
- PressureGauge: 30 min  
- WindGauge: 1 hora (incluye brújula)
- Integración y ajustes: 1 hora

**Total estimado: 5-6 horas**

## Notas

- Usar SVG nativo, no librerías externas (mantener bundle pequeño)
- Responsive: tamaños sm/md/lg con escalado proporcional
- Tema: Adaptar colores a dark/light mode
- Accesibilidad: Incluir aria-labels con valores actuales
