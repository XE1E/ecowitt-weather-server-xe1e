# Plan — Integración y migración de Home Assistant

> **Estado:** propuesta para revisión (borrador para los próximos días).
> **Objetivo inmediato:** mejorar la integración HA ↔ estación de clima.
> **Objetivo posterior:** consolidar el servidor HA (`tlb.xe1e.net:8123`) en el VPS Oracle que ya aloja este proyecto.

Este documento es un **plan**, no instrucciones ejecutadas. Nada de esto está aplicado todavía.

---

## 1. Estado actual

El repo ya trae integración con HA en dos vías, no se parte de cero:

| Vía | Archivo | Estado | Modelo |
|-----|---------|--------|--------|
| **REST (pull)** | [`homeassistant/ecowitt.yaml`](../homeassistant/ecowitt.yaml) | ✅ Funcional y documentado | HA pide `/api/current` cada 60 s por HTTPS |
| **MQTT Discovery (push)** | [`receiver/app/services/mqtt_publisher.py`](../receiver/app/services/mqtt_publisher.py) | ⚠️ Implementado pero **inactivo** | El receiver auto-crea entidades vía broker (`MQTT_ENABLED=false`, sin broker en `docker-compose.yml`) |
| **Automatizaciones** | [`homeassistant/automations.yaml`](../homeassistant/automations.yaml) | Básico | — |

**Cobertura actual de la vía REST** (`ecowitt.yaml`): temperatura ext/int, sensación térmica, punto de rocío, humedad ext/int, presión relativa, viento + ráfaga + dirección (grados y cardinal), tasa/acumulado de lluvia, UV, radiación solar, y canales WN31 1–8. Solo datos **medidos por la estación**.

**Lo que falta** (aunque el backend ya lo calcula): entidad `weather` nativa, IMECA, AQI, almanaque (sol/luna), sismos, METAR/TAF, y las automatizaciones como blueprint.

### Contexto de decisión (definido con el usuario)

- El HA actual controla **solo integraciones cloud/remotas** → migrarlo a la nube es viable y **no** pierde control local.
- El VPS Oracle es **Ampere A1 (~12 GB RAM)** → sobra memoria para HA + clima + broker.
- **Prioridad:** primero la integración; la migración es fase posterior.

---

## 2. Las dos arquitecturas (cuándo conviene cada una)

```
REST (pull)                          MQTT (push)
HA  ──GET /api/current──▶  VPS       VPS ──publish──▶  broker ◀──sub── HA
    cada 60s, por HTTPS                  al recibir dato de la estación
```

| | REST (pull) | MQTT Discovery (push) |
|---|---|---|
| Latencia | ~60 s (polling) | Tiempo real (al llegar el dato) |
| Entidades | Se definen a mano en YAML | Auto-creadas, agrupadas en un `device` |
| Externos (IMECA, AQI, sol/luna) | ✅ fácil (endpoints distintos) | ✋ solo datos de estación hoy (ver Fase 2) |
| HA remoto (hoy) | ✅ ideal | Requiere broker accesible por internet + TLS |
| HA co-ubicado (tras migración) | Funciona | ✅ ideal (broker local, sin polling) |

**Conclusión:** REST da valor **ya** con el HA remoto; MQTT se vuelve la vía preferente **una vez migrado** HA al VPS. El plan usa ambas de forma complementaria.

---

## 3. Plan por fases

Ordenado para que **cada fase aporte valor con el HA remoto de hoy** y a la vez prepare la migración.

### Fase 1 — Enriquecer la vía REST *(valor inmediato · solo YAML de HA, no toca el backend)*

1. **Entidad `weather.clima_xe1e` nativa.** Habilita las tarjetas de clima de HA y `weather.get_forecasts`.
   - ⚠️ **Ojo:** el backend **no** expone un pronóstico completo (`/api/forecast` no existe; el frontend lo pide directo a Open-Meteo). Dos caminos:
     - **(a) Sin tocar backend:** usar la integración **Open-Meteo** nativa de HA para el pronóstico + una entidad `weather` de plantilla que tome las **condiciones actuales** de `/api/current` (temp, humedad, presión, viento). *Recomendado para empezar.*
     - **(b) Con backend:** agregar un endpoint proxy `/api/forecast` (reusar la lógica de `dashboard/src/forecast.ts` en Python) para servir el pronóstico desde el VPS. Más limpio a futuro; es trabajo de backend.
2. **Sensores externos/derivados** (un bloque `rest:` por endpoint, cada uno con su `scan_interval`):
   - **IMECA** → `GET /api/airquality/imeca` → campos `imeca` (valor), `dominant` (contaminante), `category` (texto). *(Devuelve además `pollutants[]` y `forecast[]`.)*
   - **AQI** → `GET /api/airquality` (requiere `WAQI_TOKEN`).
   - **Almanaque** → `GET /api/almanac`: próximo amanecer/atardecer, fase lunar.
   - **Pronóstico local** (texto) → `GET /api/forecast/local` (tendencia barométrica).
   - *(Opcional)* sismos `GET /api/earthquakes`, METAR `GET /api/metar?station=MMMX`.
3. **Blueprint de automatizaciones** importable, parametrizable: helada, ráfaga alta, lluvia intensa, IMECA malo, estación offline. Reemplaza el `automations.yaml` básico.
4. **Empaquetado**: dejar en `homeassistant/` los YAML listos para copiar a `<config>/packages/`, con README de instalación.

**Entregable:** archivos nuevos/actualizados bajo `homeassistant/`. Sin cambios de backend si se elige 1(a).

### Fase 2 — MQTT nativo *(ideal al co-ubicar HA; también sirve con HA remoto + broker TLS)*

5. **Broker Mosquitto en `docker-compose.yml`** (contenedor nuevo, red interna; expuesto por Caddy con TLS si HA sigue remoto).
6. **Activar el publisher**: `MQTT_ENABLED=true`, apuntar `MQTT_BROKER` al servicio. El discovery (`mqtt_publisher.py`) ya crea sensores + `binary_sensor` de batería con un `device`. Falta **probar** el discovery de punta a punta.
7. **Ampliar cobertura del publisher** (opcional): hoy `build_state_payload()` solo publica campos **numéricos de la estación**. Los externos (IMECA, AQI, pronóstico) vienen de otros endpoints y **no** pasan por MQTT. Si se quieren también por MQTT, hay que publicarlos aparte (tarea de backend). Alternativa: dejar externos por REST y estación por MQTT (**híbrido recomendado**).

**Entregable:** `docker-compose.yml` con Mosquitto + `.env` de ejemplo + validación del discovery.

### Fase 3 — Migrar HA al VPS Oracle *(viable; fase posterior)*

8. **HA Container** en el mismo `docker-compose.yml` (imagen `ghcr.io/home-assistant/home-assistant:stable`), detrás de Caddy en `home.xe1e.net`, con Mosquitto ya presente de la Fase 2.
   - Nota: en un host Docker general se usa **HA Container** (sin Supervisor/add-ons). Los equivalentes de add-ons (broker, etc.) se corren como contenedores aparte — que es justo lo que hace este plan.
9. **Migración de datos** = backup → restore:
   - En el HA actual: *Ajustes → Sistema → Copias de seguridad → Crear* (backup completo).
   - Levantar HA Container en el VPS, restaurar el backup, verificar entidades.
10. **Cutover**: repuntar el DNS de `tlb.xe1e.net` (o usar `home.xe1e.net`) al VPS, validar, y apagar el HA viejo.
11. Al quedar co-ubicados: HA consume MQTT **local** (latencia mínima); la vía REST queda como respaldo.

**Entregable:** servicio `homeassistant` en el compose + entrada en Caddy + guía de backup/restore.

---

## 4. Ideas de aprovechamiento (qué harías con HA una vez integrado)

- **Dashboard Lovelace** del clima dentro de HA (estación principal + estación remota GW1100 + externos) aprovechando el historial y las *long-term statistics* nativas de HA.
- **Automatizaciones accionables** enlazadas con otros dispositivos: no regar si `rain_daily > 0`, avisar de helada/ráfaga, notificar IMECA malo antes de salir, aviso de estación offline (complementa el Telegram que ya existe en el backend).
- **HA como agregador** de todo (clima + resto de dispositivos) en un solo panel.

---

## 5. Decisiones abiertas (a resolver antes de ejecutar)

1. **Pronóstico**: ¿camino 1(a) sin tocar backend (Open-Meteo nativo de HA) o 1(b) agregar `/api/forecast` proxy? → *Sugerencia: 1(a) primero, 1(b) si se quiere autonomía del backend.*
2. **MQTT ¿ahora o tras migrar?** Con HA remoto, MQTT exige exponer el broker con TLS. → *Sugerencia: Fase 1 (REST) ya; Fase 2 (MQTT) al migrar.*
3. **Cobertura MQTT de externos**: ¿híbrido (estación por MQTT, externos por REST) o todo por MQTT? → *Sugerencia: híbrido.*
4. **Dominio de HA**: ¿reusar `tlb.xe1e.net` o estrenar `home.xe1e.net`?

---

## 6. Checklist de ejecución (para marcar cuando se aborde)

- [ ] **F1.1** Entidad `weather` (definir camino a/b)
- [ ] **F1.2** Sensores REST: IMECA, AQI, almanaque, pronóstico local
- [ ] **F1.3** Blueprint de automatizaciones
- [ ] **F1.4** Empaquetado + README en `homeassistant/`
- [ ] **F2.5** Mosquitto en `docker-compose.yml`
- [ ] **F2.6** Activar y probar MQTT Discovery de punta a punta
- [ ] **F2.7** (opc.) Ampliar publisher / definir híbrido
- [ ] **F3.8** HA Container en el compose + Caddy `home.xe1e.net`
- [ ] **F3.9** Backup del HA actual → restore en el VPS
- [ ] **F3.10** Cutover DNS + apagar HA viejo

---

## Referencias

- API real del servidor: [`docs/api-reference.md`](api-reference.md)
- Config REST actual: [`homeassistant/ecowitt.yaml`](../homeassistant/ecowitt.yaml)
- Publisher MQTT: [`receiver/app/services/mqtt_publisher.py`](../receiver/app/services/mqtt_publisher.py)
- Despliegue en el VPS: [`docs/DEPLOY.md`](DEPLOY.md) · Dominio+HTTPS: [`docs/DOMINIO-HTTPS.md`](DOMINIO-HTTPS.md)
