# Convenciones de Diseño

Documento de referencia para uniformizar estilos en todo el dashboard y kiosko.

## Colores por Variable Meteorológica

| Variable | Color | Hex | Tailwind |
|----------|-------|-----|----------|
| Temperatura | Naranja | `#f97316` | `orange-500` |
| Presión atmosférica | Morado | `#a78bfa` | `violet-400` |
| Precipitación | Azul claro | `#38bdf8` | `sky-400` |
| Humedad | Azul oscuro | `#3b82f6` | `blue-500` |
| Viento | Verde | `#22c55e` | `green-500` |
| Viento máximo | Verde oscuro | `#16a34a` | `green-600` |
| Punto de rocío | Verde esmeralda | `#10b981` | `emerald-500` |
| Radiación UV | Violeta | `#a78bfa` | `violet-400` |
| Radiación solar | Ámbar | `#f59e0b` | `amber-500` |
| Tasa de lluvia | Azul cielo | `#0ea5e9` | `sky-500` |

### Colores auxiliares en gráficas
- **Temperatura máxima**: `#f97316` (orange-500)
- **Temperatura mínima**: `#38bdf8` (sky-400, convención: azul = frío)
- **Temperatura promedio**: `#94a3b8` (slate-400)

### Convención meteorológica general
- **Temperatura**: rojo/naranja (calor), azul (frío)
- **Agua/Precipitación**: tonos de azul
- **Humedad**: azul
- **Presión**: morado/violeta o gris
- **Viento**: verde o gris

## Colores de Estado

| Estado | Color | Hex | Uso |
|--------|-------|-----|-----|
| En vivo | Verde | `#22c55e` | Badge "en vivo" |
| Sin conexión | Rojo | `#ef4444` | Badge "sin conexión" |
| Cargando | Gris | `#94a3b8` | Spinners, placeholders |

## Tendencias

| Tendencia | Icono | Color Hex | Tailwind |
|-----------|-------|-----------|----------|
| Subiendo | `▲` / `ArrowUp` | `#22c55e` | `text-green-500` |
| Bajando | `▼` / `ArrowDown` | `#ef4444` | `text-red-500` |
| Estable | `–` / `Minus` | `#94a3b8` | `text-slate-400` |

### Umbrales de tendencia
- **Temperatura**: ±0.5°C en 1 hora
- **Humedad**: ±3% en 1 hora
- **Presión**: ±1 hPa en 3 horas

### Constantes centralizadas
Ver `dashboard/src/theme/constants.ts` para colores y umbrales reutilizables.

## Gráficas

### Escalas dinámicas
Las escalas de los ejes Y se ajustan automáticamente según los valores del periodo:
- Calculan min/max de los datos
- Añaden padding (10-20%) para visualización
- Mínimos razonables para evitar escalas muy pequeñas

### Etiquetas de unidades
- Posición: arriba de cada eje vertical
- Offset: -12 para no encimarse con valores
- Color: mismo que la línea/barra correspondiente

### Leyenda
- Posición: abajo de la gráfica
- Iconos: círculos de 8px
- Tamaño fuente: 11-12px

### Tooltip
```typescript
contentStyle: {
  backgroundColor: 'var(--surface, #0f1a2a)',
  border: '1px solid var(--line, #334155)',
  borderRadius: 8,
}
cursor: { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }
```

**Excepción**: Gráficas con barras usan `cursor: { fill: 'rgba(148,163,184,0.12)' }` para resaltar el área.

### Grid
- Estilo: punteado `strokeDasharray: '3 3'`
- Color: `rgba(148,163,184,0.2)`

## Tipografía

| Elemento | Tamaño | Peso |
|----------|--------|------|
| Títulos de tarjeta | `text-lg` (18px) | `font-semibold` |
| Valores principales | `text-3xl` a `text-5xl` | `font-bold` |
| Etiquetas | `text-xs` (12px) | normal |
| Ejes de gráficas | 10-11px | normal |

## Tarjetas

- Clase base: `.card`
- Título: `.card-title`
- Fondo: `bg-white/5` o similar con transparencia
- Border radius: `rounded-lg` (8px) o `rounded-xl` (12px)

## Iconos

### Librería principal
`lucide-react` - iconos usados:
- Activity, AlertTriangle, ArrowDown, ArrowUp
- BarChart3, CalendarDays, Check, CloudSun, Code2
- GripVertical, History, Info, LayoutGrid
- Maximize2, Minus, Moon, MoonStar
- Plane, Radar, RefreshCw, Search
- SlidersHorizontal, Sun, Sunrise, Wind, X

### Iconos meteorológicos
`WeatherIcon` component (basweather)

### Tamaños estándar

**Iconos UI (lucide-react)**:
| Tamaño | Clase | Uso |
|--------|-------|-----|
| 16px | `w-4 h-4` | Badges, inline text |
| 20px | `w-5 h-5` | Tendencias, botones pequeños |
| 24px | `w-6 h-6` | Títulos de tarjeta |
| 32px | `w-8 h-8` | Spinners de carga |

**Iconos meteorológicos (WeatherIcon)**:
| Tamaño | Uso |
|--------|-----|
| 24px | Tarjetas compactas |
| 32px | Tarjetas estándar |
| 48px | Destacados |
| 64px | Pronóstico principal |
| 96px | Condiciones actuales |
| 120px | Kiosko pantalla completa |

## Pendientes

- [ ] Revisar contraste de colores en tema claro vs oscuro
