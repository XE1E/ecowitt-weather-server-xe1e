# Plan de mejoras (roadmap)

Ideas para agregar/cambiar, priorizadas por valor y esfuerzo. Se irá marcando el
estado conforme avancemos, paso a paso.

## Estado actual (ya hecho)
Servidor desplegado en `https://clima.xe1e.net` (HTTPS/Cloudflare/Caddy). Vista
clásica `/` y vista `/pro` estilo WeatherNode con cintillo completo: Inicio,
Pronóstico (Open-Meteo), Historia, Estadísticas, Radar (Ventusky), Astronomía,
Calidad del aire (WAQI). Alertas por umbral + Telegram, MQTT/HA discovery, toggle
de unidades y FX, backups de InfluxDB, simulador de datos, cuenta PAYG.

---

## 🔔 Fiabilidad / alertas
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 1 | **Alerta de "estación caída"** (avisar si no llegan datos en X min) | 🔴 Alto | 🟢 Bajo | ⏳ Top 3 |
| 2 | **Terminar Telegram** (crear bot + token en .env) | 🔴 Alto | 🟢 Bajo (acción del usuario) | ⏳ Top 3 |
| 3 | **Monitor de uptime externo** (Cloudflare Worker + cron) | 🟠 | 🟢 | Pendiente |

## 📊 Datos / features
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 4 | Récords "histórico" con fecha/hora de la máx/mín | 🟠 | 🟠 | Pendiente |
| 5 | Tile "vs ayer" / vs promedio | 🟢 | 🟢 | Pendiente |
| 6 | Gráfica de lluvia acumulada (barras diarias) | 🟢 | 🟢 | Pendiente |
| 7 | Exportar CSV del histórico | 🟢 | 🟢 | Pendiente |
| 8 | Configurar umbrales de alertas desde la web | 🟠 | 🟠 | Pendiente |

## 🎨 UX / pulido
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 9 | **Revisar responsive/móvil** de `/pro` | 🟠 | 🟢 | ⏳ Top 3 |
| 10 | **Skeletons de carga** (evitar tarjetas vacías) | 🟢 | 🟢 | ⏳ Top 3 |
| 11 | Tema claro opcional | 🟢 | 🟠 | Pendiente |
| 12 | i18n / inglés | 🟢 | 🔴 | Pendiente (decisión) |
| 13 | PWA (instalable) | 🟢 | 🟠 | Pendiente |
| 14 | Widget "Share & Embed" de condiciones actuales | 🟢 | 🟠 | Pendiente |

## ☁️ Arquitectura / experimentos
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 15 | Laboratorio "todo Cloudflare" (Workers + D1 + Pages) | 🟢 | 🔴 | Pendiente (ver CLOUDFLARE-WORKERS.md) |
| 16 | Backups fuera del VPS (R2 / almacenamiento externo) | 🟠 | 🟠 | Pendiente |
| 17 | Grafana (ya en compose, perfil opcional) | 🟢 | 🟢 | Pendiente |

---

## Top 3 en curso (orden)
1. **Alerta de estación caída** (backend)
2. **Terminar Telegram** (acción del usuario, guiada)
3. **Responsive/móvil + skeletons de carga** (frontend)

## Pendientes concretos ya identificados
- Poner **WAQI_TOKEN** en el `.env` del VPS (para Calidad del aire).
- Decidir **i18n / inglés**.
- **~2026-07-17**: llega el WS2910 → apagar simulador, limpiar datos falsos, apuntar la estación.
