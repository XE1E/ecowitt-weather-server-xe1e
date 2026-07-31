# Auditoría de Convenciones de Diseño

Fecha: 2026-07-31

Auditoría de divergencias respecto a las convenciones definidas en `docs/CONVENCIONES.md`.

---

## 1. Colores de Gráficas

**Total: 21 divergencias en 7 archivos**

### Resumen por Variable

| Variable | Color actual | Color convención | Ocurrencias |
|----------|--------------|------------------|-------------|
| Humedad | #38bdf8 / #22d3ee | #3b82f6 | 6 |
| Viento | #38bdf8 / #f97316 / #34d399 | #22c55e | 5 |
| Precipitación | #60a5fa | #38bdf8 | 3 |
| Dirección viento | #84cc16 | #22c55e | 2 |
| Punto de rocío | #22d3ee | #10b981 | 1 |
| Temperatura | #34d399 / #fb923c / #f59e0b | #f97316 | 3 |
| Tasa lluvia | #22d3ee | #38bdf8 | 1 |

### Detalle por Archivo

#### HistoryCharts.tsx
| Línea | Variable | Actual | Convención |
|-------|----------|--------|------------|
| 75 | Viento medio | #38bdf8 | #22c55e |
| 76 | Viento máximo | #f97316 | #22c55e |
| 77 | Dirección viento | #84cc16 | #22c55e |
| 96 | Humedad | #38bdf8 | #3b82f6 |
| 140 | Precipitación (bar) | #60a5fa | #38bdf8 |
| 141 | Tasa lluvia | #22d3ee | #38bdf8 |

#### HistoryDayDetail.tsx
| Línea | Variable | Actual | Convención |
|-------|----------|--------|------------|
| 187 | Viento medio | #38bdf8 | #22c55e |
| 188 | Viento máximo | #f97316 | #22c55e |
| 189 | Dirección viento | #84cc16 | #22c55e |
| 209 | Humedad | #38bdf8 | #3b82f6 |
| 210 | Punto de rocío | #22d3ee | #10b981 |
| 251 | Tasa lluvia (bar) | #60a5fa | #38bdf8 |

#### StationTempChart.tsx
| Línea | Variable | Actual | Convención |
|-------|----------|--------|------------|
| 73 | Temp observada | #34d399 | #f97316 |

#### TemperatureChart.tsx
| Línea | Variable | Actual | Convención |
|-------|----------|--------|------------|
| 28 | Viento | #34d399 | #22c55e |
| 127 | Humedad | #38bdf8 | #3b82f6 |

#### RemoteStationPage.tsx
| Línea | Variable | Actual | Convención |
|-------|----------|--------|------------|
| 385 | Temp exterior | #f59e0b | #f97316 |
| 386 | Humedad exterior | #22d3ee | #3b82f6 |
| 396 | Humedad interior | #22d3ee | #3b82f6 |

#### ClimatePage.tsx
| Línea | Variable | Actual | Convención |
|-------|----------|--------|------------|
| 198 | Lluvia (bar) | #60a5fa | #38bdf8 |

#### KioskPage.tsx
| Línea | Variable | Actual | Convención |
|-------|----------|--------|------------|
| 739 | Temperatura | #fb923c | #f97316 |
| 740 | Humedad | #22d3ee | #3b82f6 |

### Archivos Conformes
- MultiVariableChart.tsx
- PressureCard.tsx

---

## 2. Tendencias

### Colores

| Archivo:Línea | Componente | Problema |
|---------------|------------|----------|
| TrendBadge.tsx:13 | TrendBadge | Colores **invertidos**: up=amber, down=sky (debería ser up=verde, down=rojo) |
| TrendArrow.tsx:9 | TrendArrow | Estable usa #6b7280 (debería ser #94a3b8) |
| PressureCard.tsx:32-34 | PressureCard | Usa emerald-300/red-300 en lugar de #22c55e/#ef4444 |
| StationSummaryTable.tsx:24-26 | Tabla resumen | up=red-400, down=sky-400 (invertidos) |
| KioskPage.tsx:329-331 | Kiosk | up=#37d64a, down=#ff4128, stable=#888 (ligeramente diferentes) |

### Umbrales

| Archivo:Línea | Variable | Actual | Convención |
|---------------|----------|--------|------------|
| PressureCard.tsx:32 | Presión | 0.6 hPa | 1 hPa en 3 horas |
| RemoteStationPage.tsx:206 | Temperatura | 0.2°C | 0.5°C en 1 hora |
| RemoteStationPage.tsx:238 | Temperatura | 0.2°C | 0.5°C en 1 hora |
| StationSummaryTable.tsx:14 | Todas | 2% dinámico | Umbrales fijos por variable |

### Iconos de Tendencia

| Archivo | Icono actual | Convención |
|---------|--------------|------------|
| StationSummaryTable.tsx:24-26 | Flechas Unicode (↑↓→) | lucide (TrendingUp/Down/Minus) |

---

## 3. Tooltips

### Divergencias de Estilo

| Archivo:Línea | Problema |
|---------------|----------|
| TemperatureChart.tsx:121-124 | backgroundColor #1e293b (debería ser #0f1a2a), falta cursor |
| RemoteStationPage.tsx:383,393,402 | backgroundColor #1e293b, falta borderRadius, falta cursor |
| ImecaCard.tsx:138-142 | Falta cursor strokeDasharray |
| PressureCard.tsx:83-85 | backgroundColor fallback #1e293b, strokeDasharray '3 3' (debería ser '4 4') |

### Conformes
- DaylightChart.tsx
- HistoryDayDetail.tsx (líneas 119, 185, 207, 228)
- HistoryCharts.tsx (líneas 51, 73, 94, 114)
- MultiVariableChart.tsx

### Nota
Las gráficas con barras (ComposedChart con Bar) usan `cursor={{ fill: 'rgba(148,163,184,0.12)' }}` intencionalmente para resaltar el área. Esto es una excepción válida a la convención de línea punteada.

---

## 4. Iconos

### Tamaños No Estándar

Los tamaños estándar son: 16, 20, 24, 28, 32, 48px

#### Tamaño 12px (w-3 h-3)
| Archivo:Línea | Icono | Recomendación |
|---------------|-------|---------------|
| SunMoonDetailCard.tsx:102-103 | Sun | → 16px |
| SunMoonDetailCard.tsx:130-131 | Moon | → 16px |
| MiTableroPage.tsx:167 | GripVertical | Aceptable (texto inline) |
| MiTableroPage.tsx:178 | Check | → 16px |

#### Tamaño 14px (w-3.5 h-3.5)
| Archivo:Línea | Icono | Recomendación |
|---------------|-------|---------------|
| TrendBadge.tsx:17 | TrendingUp/Down/Minus | → 16px |

#### Tamaño 18px (size prop)
| Archivo:Línea | Componente | Recomendación |
|---------------|------------|---------------|
| ExtraSensorsCard.tsx:74,84 | TrendArrow | → 16px o 20px |
| RemoteStationCard.tsx:113,121,151 | TrendArrow | → 16px o 20px |
| AdminEstacionConfig.tsx:426,467 | BatteryIcon | → 16px o 20px |
| AdminDashboard.tsx:107 | BatteryIcon | → 16px o 20px |

### Inconsistencias de Spinners (RefreshCw)

| Archivo:Línea | Tamaño actual | Estándar proyecto |
|---------------|---------------|-------------------|
| AirQualityPage.tsx:50 | w-7 h-7 (28px) | w-8 h-8 (32px) |
| RemoteStationPage.tsx:179 | w-6 h-6 (24px) | w-8 h-8 (32px) |

### WeatherIcon — Tamaños Grandes

Los siguientes tamaños se usan pero no están en convenciones:
- 34px: ForecastPage, SunMoonCard
- 36px: InteriorCard
- 38px: ForecastCompareCard
- 40px: ForecastPage, UvSolarCard, ForecastCard
- 42px: KioskPage (MoonGlyph)
- 56px: KioskPage
- 64px: ForecastPage
- 72px: EmbedWidget
- 96px: CurrentConditions
- 120px: KioskPage

**Recomendación:** Actualizar CONVENCIONES.md para incluir tamaños grandes válidos (64, 96, 128) o normalizar a los existentes.

---

## Plan de Corrección

### Prioridad Alta
- [ ] Corregir colores invertidos en TrendBadge.tsx
- [ ] Unificar colores de gráficas (21 cambios)
- [ ] Corregir umbrales de tendencia

### Prioridad Media
- [ ] Unificar estilos de tooltips
- [ ] Normalizar tamaños de spinners

### Prioridad Baja
- [ ] Normalizar tamaños de iconos pequeños
- [ ] Actualizar CONVENCIONES.md con tamaños grandes de WeatherIcon

---

## Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| HistoryCharts.tsx | 6 colores |
| HistoryDayDetail.tsx | 6 colores |
| TrendBadge.tsx | Invertir colores up/down |
| TrendArrow.tsx | Color estable |
| PressureCard.tsx | Umbral, colores tendencia, tooltip |
| StationSummaryTable.tsx | Colores, umbrales, iconos |
| RemoteStationPage.tsx | 3 colores, 2 umbrales, tooltip, spinner |
| TemperatureChart.tsx | 2 colores, tooltip |
| StationTempChart.tsx | 1 color |
| ClimatePage.tsx | 1 color |
| KioskPage.tsx | 3 colores tendencia, 2 colores gráfica |
| AirQualityPage.tsx | Tamaño spinner |
