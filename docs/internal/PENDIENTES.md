# Pendientes — Estación Clima XE1E

> Lista viva de trabajo pendiente. Vive en git (sobrevive cambios de PC).
> Última actualización: 2026-07-25.

## 1. Cuando llegue el WN32 (~2026-08-08) — depende de hardware
En la **estación Remota** habrá 2 sensores: **WN32 = exterior** y el **integrado del
GW1100 = interior** (se **apaga la trampa** `treat_indoor_as_outdoor`).
Nomenclatura se queda: **Principal = WS2910**, **Remota = GW1100**.

- [ ] Apagar la trampa del GW1100 en Admin → Estaciones ("Está a la intemperie").
- [ ] **Alerta de moho:** hoy usa `humidity_high=65` sobre `humidity_outdoor` (por la
      trampa). Al quitarla, la humedad del GW1100 vuelve a `humidity_indoor` → hay que
      **agregar regla de humedad interior** en `alerts.py` (hoy solo evalúa
      `humidity_outdoor`) y mover ahí el umbral de moho.
- [x] Presión: la lógica "presión en fila Exterior cuando no hay sensor interior"
      (`main.py::_detect_sensors_detail`) se **auto-revierte** — al haber interior otra
      vez, la presión vuelve a esa fila. Sin cambio.

## 2. Display de consola — fase 2 (firmware) — diferido
Servidor ya listo: `GET /api/display.jpg?page=consola` (réplica de la consola física,
1024×600). Falta el firmware en el repo **`ecowitt-display-kiosk-xe1e`**:

- [ ] Apuntar el display a `?page=consola` como pantalla inicial.
- [ ] Decidir navegación por touch a las páginas de historial/estadísticas (ya existen).
- [ ] Pequeños ajustes visuales de la consola.
- [ ] Opcional: embeber fuente **7‑segmentos (DSEG)** en el dashboard para clavar los
      dígitos (el Chromium del servidor cae a una fuente de respaldo).

## 3. Rediseño de Admin + depuración de código — plan escrito
Ver **`docs/internal/PLAN-REDISENO-ADMIN.md`**. Consolidar toda la config por estación
dentro de "Estaciones" (publicación, alertas) y limpiar código muerto:

- [ ] `station_passkeys` muerto.
- [ ] Bug no-op de `create_station`.
- [ ] Unificar el registro por MAC.
- [ ] Etapas 1‑5 del plan.

## 4. Seguridad — residuales (auditoría docs/SEGURIDAD.md)
- [ ] Cerrar el puerto `:8080` (DIFERIDO: IP dinámica; se compensa con la whitelist de passkey).
- [ ] Token en el push (además de la whitelist por passkey).
- [ ] Barrer los `str(e)` de errores 500 en el resto de endpoints.

## 5. Bonus (ya se puede) — señal RF por sensor
El GW1100 ya está en línea y reporta `signal_*` (0‑4). Falta la UI: barras/íconos de
señal por sensor (p. ej. en `AdminEstacionConfig` / tarjeta de sensores).

---
### Hecho reciente (referencia)
- Alertas: humedad, tendencia de presión (2 niveles), histéresis anti‑spam,
  habilitar/deshabilitar por alarma, UI en Admin, valores CDMX. (commits 38686c2,
  e9e0423, 2eaa95a, 7a82c4a, 69400dc)
- Página de consola `?page=consola` (commits 544341f, acf7216).
- Presión relativa por altitud, whitelist de passkey, registro por MAC (ver git).
