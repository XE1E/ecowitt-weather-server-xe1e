# Convenciones de Diseño

Documento de referencia para uniformizar estilos en todo el dashboard y kiosko.

## Colores por Variable Meteorológica

| Variable | Color | Hex | Tailwind |
|----------|-------|-----|----------|
| Temperatura | Naranja | `#f97316` | `orange-500` |
| Presión atmosférica | Morado magenta | `#7f00b2` | — |
| Precipitación | Azul claro | `#38bdf8` | `sky-400` |
| Humedad | Azul oscuro | `#2563eb` | `blue-600` |
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
| Subiendo | `TrendArrow trend="up"` | `#22c55e` | `text-green-500` |
| Bajando | `TrendArrow trend="down"` | `#ef4444` | `text-red-500` |
| Estable | `TrendArrow trend="stable"` | `#94a3b8` | `text-slate-400` |

> El dibujo lo hace **`dashboard/src/components/TrendArrow.tsx`**, con SVG propio, y
> **no** `ArrowUp`/`ArrowDown` de Lucide: la flecha propia va RELLENA y a 16-24 px
> --el tamaño en que se usa-- se lee mejor que la de trazo. Esta tabla decía Lucide y
> el código nunca lo fue; se alinea el documento con el código (2026-08-18). Lucide
> se sigue usando para la iconografía de INTERFAZ (botones, navegación), no para los
> datos. Quien pinte tendencias debe usar `TrendArrow` y `getTrend`, no dibujar
> flechas propias, que es justo lo que esta tabla existe para evitar.

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

> **Fuente de verdad en código:** `dashboard/src/theme/icons.ts`. La escala y las
> familias graduadas viven ahí; este documento las describe, no las define.
> Si cambian los tamaños, hay que actualizar ambos.

### Qué librería usar

| Para | Librería | Regla |
|------|----------|-------|
| Variables meteorológicas | **Meteocons** (`@meteocons/svg`, MIT) | Siempre. Vía `<WeatherIcon name="...">` |
| UI (flechas, menús, botones) | **Lucide** (`lucide-react`, ISC) | Siempre |
| Conceptos que Meteocons no cubre | Lucide | **Solo si no hay de otra** — ver lista abajo |

**No mezclar estilos en el mismo rol.** Si un dato meteorológico ya tiene icono en
Meteocons, no se usa Lucide para él aunque el de Lucide se vea mejor.

Casos legítimos de "no hay de otra" (Meteocons es una galería *meteorológica* y
estos no son variables del clima):

- **Interior / exterior.** Una casita para la lectura de dentro y otra marcada
  expresamente para la de fuera. Meteocons no tiene el par.
- **Señal WiFi / RF por sensor**, estado de batería, sensor perdido.
- **Avión** para METAR, **actividad sísmica** para sismos.
- Controles de UI: menús, flechas de navegación, botones, arrastre.

En estos casos el icono se tiñe con el color de la variable que acompaña
(`currentColor` en Lucide), para que siga leyéndose como parte del mismo sistema.

### Escala de tamaños

Cinco pasos. Antes había **12 tamaños distintos** en uso (18/20/24/28/32/34/36/40/
64/72/96/120) y no coincidían con lo que decía este documento.

| Token | px | Uso |
|-------|-----|-----|
| `ICON.inline` | 32 | Inline en texto, celdas de tabla, chips |
| `ICON.compact` | 48 | Tarjetas compactas, tiras de resumen |
| `ICON.card` | 64 | Tarjeta estándar (el valor por defecto) |
| `ICON.hero` | 96 | Destacados: condiciones actuales, encabezados |
| `ICON.kiosk` | 140 | Kiosco y pantalla completa |

### Familias graduadas

El icono **cambia con el valor**, así que informa en vez de decorar:

| Función | Qué hace |
|---------|----------|
| `iconTendenciaPresion(delta)` | Chevron rojo si sube, azul si baja, **nada si está estable** |
| `iconViento(kmh)` | Manga normal; `wind-alert` con temporal (Beaufort ≥ 8) |
| `iconAire(indice)` | `code-green/yellow/orange/red/purple` por nivel de AQI o IMECA |
| `iconUv(uv)` | El numerado del paquete; `uv-index-alert` de 11 en adelante |
| `iconLluvia(tasa, acum)` | Distingue "llueve ahora" de "hay acumulado" |
| `iconAlerta(clave)` | Icono por VARIABLE de la alerta, no un triángulo genérico |

### Regla de contraste: si no se lee, no se pone

Un icono que no se distingue al tamaño en que se usa no vale la pena. Se verifica
midiendo, no a ojo: `scratchpad/audita_contraste.py` renderiza cada icono sobre el
color real de `.card` (`#131c2e`) y calcula la diferencia media de luminancia.
Referencia: la mayoría del conjunto queda entre 50 y 130.

**Descartados por esta regla:**

| Icono | Δ luminancia | Por qué |
|-------|--------------|---------|
| `barometer` y sus 5 variantes | **26** | Carátula gris oscuro sobre fondo oscuro: borrón del que solo se ve la aguja, incluso a 96 px. Se usan los chevrones `pressure-high/low` |
| `compass` | 33 | Mismo problema; 0 usos reales |
| `wind-beaufort-0..12` | — | Trazo blanco muy fino con número diminuto: no se lee ni a 72 px, aunque calce 1 a 1 con el grado |

**Casos inherentes, no defectos:** `moon-new` es oscura porque una luna nueva **es**
oscura, y `not-available` es un marcador de "sin dato" a propósito.

## Pendientes

- [ ] Revisar contraste de colores en tema claro vs oscuro
