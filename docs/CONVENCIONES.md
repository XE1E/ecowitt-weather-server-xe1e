# Convenciones de Diseño

Documento de referencia para uniformizar estilos en todo el dashboard.

## Colores por Variable Meteorológica

| Variable | Color | Hex | Tailwind |
|----------|-------|-----|----------|
| Temperatura | Naranja | `#f97316` | `orange-500` |
| Presión atmosférica | Morado | `#a78bfa` | `violet-400` |
| Precipitación | Azul claro | `#38bdf8` | `sky-400` |
| Humedad | Azul oscuro | `#3b82f6` | `blue-500` |
| Viento | Verde | `#22c55e` | `green-500` |
| Punto de rocío | Verde esmeralda | `#10b981` | `emerald-500` |
| Radiación UV | Violeta | `#a78bfa` | `violet-400` |
| Radiación solar | Ámbar | `#f59e0b` | `amber-500` |

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

| Tendencia | Icono | Color |
|-----------|-------|-------|
| Subiendo | `▲` / `TrendingUp` | `#22c55e` verde |
| Bajando | `▼` / `TrendingDown` | `#ef4444` rojo |
| Estable | `–` / `Minus` | `#94a3b8` gris |

### Umbrales de tendencia
- **Temperatura**: ±0.5°C en 1 hora
- **Humedad**: ±3% en 1 hora
- **Presión**: ±1 hPa en 3 horas

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
- Tamaño fuente: 11px

### Tooltip
- Fondo: `var(--surface)` o `#0f1a2a`
- Borde: `1px solid var(--line)` o `#334155`
- Border radius: 8px
- Cursor: línea punteada `strokeDasharray: '4 4'`

### Grid
- Estilo: punteado `strokeDasharray: '3 3'`
- Color: `rgba(148,163,184,0.15)` o `0.2`

## Tipografía

| Elemento | Tamaño | Peso |
|----------|--------|------|
| Títulos de tarjeta | `text-lg` (18px) | `font-semibold` |
| Valores principales | `text-3xl` a `text-5xl` | `font-bold` |
| Etiquetas | `text-xs` (12px) | normal |
| Ejes de gráficas | 9-11px | normal |

## Tarjetas

- Clase base: `.card`
- Título: `.card-title`
- Fondo: `bg-white/5` o similar con transparencia
- Border radius: `rounded-lg` (8px) o `rounded-xl` (12px)

## Iconos

- Librería principal: `lucide-react`
- Iconos meteorológicos: `WeatherIcon` component (basweather)
- Tamaños estándar: 16, 20, 24, 28, 32, 48px

## Pendientes de Uniformizar

- [ ] Revisar todas las gráficas y aplicar colores consistentes
- [ ] Verificar que todas las tendencias usen los mismos umbrales
- [ ] Estandarizar tamaños de iconos en tarjetas similares
- [ ] Unificar estilos de tooltips en todas las gráficas
- [ ] Revisar contraste de colores en tema claro vs oscuro
