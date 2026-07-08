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

## 🔐 Administración / seguridad
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 19 | **Panel de administración web** (login seguro) para ver/editar ajustes (umbrales de alertas, unidades por defecto, toggles, tokens) sin tocar el `.env` a mano; y potencialmente ver estado/logs y reiniciar servicios | 🟠 Medio-alto | 🔴 Alto | Pendiente |

> Nota de seguridad para #19 (panel de administración): es una superficie sensible.
> Requisitos: **autenticación fuerte** (usuario+contraseña o token), HTTPS (ya lo hay),
> e idealmente restringir por IP o poner **Cloudflare Access** delante. Diseño posible:
> - Guardar los ajustes en un archivo/tabla (JSON/SQLite) en vez del `.env`, para
>   editarlos y recargarlos **en caliente** sin reiniciar el contenedor.
> - Endpoints protegidos en el receiver (GET/POST /admin/settings) + una página
>   `/pro/admin` con login.
> - Nunca mostrar secretos en claro (tokens enmascarados).

## 📝 Contenido
| # | Idea | Valor | Esfuerzo | Estado |
|---|------|-------|----------|--------|
| 18 | **Redactar artículo para el blog** (sobre el proyecto/estación) | 🟠 | 🟠 | Pendiente |

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

---

## Procedimiento: activar Telegram (para hacer más tarde)
Desbloquea las alertas por umbral y la de estación caída.

1. **Crear el bot**: en Telegram, abre **@BotFather** → `/newbot` → sigue los pasos → copia el **token**.
2. **Obtener chat_id**: escríbele algo a tu bot; abre
   `https://api.telegram.org/bot<TOKEN>/getUpdates` y busca `"chat":{"id":123456789}`.
3. **En el VPS**, edita `.env`:
   ```
   ALERTS_ENABLED=true
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=<token>
   TELEGRAM_CHAT_ID=<chat id>
   ```
4. Aplica: `docker compose up -d receiver`
5. Prueba: `curl -s -X POST http://localhost:8080/data/report -d "tempf=104&humidity=20&model=WS2910&stationtype=SIMULATOR"`
   → debe llegar la alerta a Telegram.
