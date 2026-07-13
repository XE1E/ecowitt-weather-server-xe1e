# Plan — Panel de Administración

> Estado: **diseño en progreso**. Definir estructura antes de implementar.

## Objetivo

Crear un panel de administración unificado y bien organizado que permita
configurar toda la estación meteorológica. El usuario normal solo ve datos;
el administrador controla el funcionamiento del sistema.

---

## 1. Inventario de Configuración

### 1.1 Estaciones

| Configuración | Descripción | Frecuencia |
|---------------|-------------|------------|
| Registro de estación | Passkey, nombre interno, label visible | Inicial |
| Sensores detectados | Auto-detectado, solo lectura | — |
| Watchdog | Habilitar vigilancia, timeout en minutos | Inicial |
| Alertas por estación | Habilitar, umbrales propios o heredar | Ocasional |
| Publicación por estación | Habilitar envío a redes públicas | Ocasional |
| MQTT por estación | Habilitar, topic personalizado | Ocasional |

### 1.2 Alertas

| Configuración | Descripción | Frecuencia |
|---------------|-------------|------------|
| Habilitar alertas | On/off global | Inicial |
| Umbral temp alta/baja | °C | Ocasional |
| Umbral viento/ráfaga | km/h | Ocasional |
| Umbral lluvia (tasa/diaria) | mm/h, mm | Ocasional |
| Umbral presión alta/baja | hPa | Ocasional |
| Estación offline | Minutos sin datos | Inicial |
| Batería baja | On/off | Inicial |
| Sensor perdido | On/off | Inicial |
| Calidad del aire | AQI/IMECA umbrales | Ocasional |

### 1.3 Notificaciones

| Configuración | Descripción | Frecuencia |
|---------------|-------------|------------|
| Telegram habilitado | On/off | Inicial |
| Bot token | Token de @BotFather | Inicial |
| Chat ID | ID del chat/grupo | Inicial |
| (Futuro) Canal por estación | Diferentes chats por estación | Ocasional |

### 1.4 Calibración

| Configuración | Descripción | Frecuencia |
|---------------|-------------|------------|
| Habilitar calibración | On/off | Inicial |
| Offset temperatura | °C (se suma) | Ocasional |
| Offset humedad | % (se suma) | Ocasional |
| Offset presión | hPa (se suma) | Ocasional |
| Multiplicador viento | Factor (1.0 = sin cambio) | Ocasional |
| Multiplicador lluvia | Factor (1.0 = sin cambio) | Ocasional |

### 1.5 Control de Calidad (QC)

| Configuración | Descripción | Frecuencia |
|---------------|-------------|------------|
| QC por rangos | Descartar valores imposibles | Inicial |
| QC por picos | Descartar saltos imposibles | Inicial |

### 1.6 Publicación a Redes

| Red | Configuración | Frecuencia |
|-----|---------------|------------|
| Weather Underground | Station ID, Key | Inicial |
| PWSWeather | Station ID, Password | Inicial |
| Windy | API Key | Inicial |
| OpenWeatherMap | API Key, Station ID | Inicial |
| CWOP/APRS | Callsign, Passcode, Lat/Lon | Inicial |

### 1.7 Integraciones

| Configuración | Descripción | Frecuencia |
|---------------|-------------|------------|
| MQTT habilitado | On/off | Inicial |
| Broker, puerto, user/pass | Conexión MQTT | Inicial |
| Topic base | Prefijo de topics | Inicial |
| Home Assistant discovery | On/off | Inicial |
| Token WAQI | Para calidad del aire | Inicial |

### 1.8 Sistema (solo .env, no editable en panel)

| Configuración | Descripción |
|---------------|-------------|
| InfluxDB URL/token/org/bucket | Conexión a la base de datos |
| Admin user/password | Credenciales del panel |
| Debug mode | Logging verboso |

---

## 2. Clasificación por Momento

### 2.1 Configuración Inicial (Setup)

Se hace una vez al instalar el sistema:

- Credenciales de admin (en .env)
- Conexión a InfluxDB (en .env)
- Registro de estación principal (passkey se auto-detecta)
- Telegram (bot token, chat ID)
- Habilitar/deshabilitar alertas
- Configuración básica de watchdog

**Posible implementación:** Wizard de primera configuración que guíe paso a paso.

### 2.2 Configuración de Operación Diaria

Ajustes que se modifican según necesidad durante el uso normal:

- Umbrales de alertas (ajustar según temporada)
- Activar/desactivar publicación a redes
- Activar/desactivar alertas específicas

**Acceso:** Panel principal, secciones claramente visibles.

### 2.3 Configuración Ocasional/Avanzada

Se toca raramente, requiere más conocimiento:

- Calibración de sensores
- Control de calidad (QC)
- Agregar/eliminar estaciones secundarias
- Configuración MQTT avanzada
- Configuración por estación (alertas, publicación, watchdog propios)

**Acceso:** Sección "Avanzado" o tabs secundarios.

### 2.4 Configuración del Sistema (No en panel)

Se configura en `.env` y requiere reinicio:

- Conexión a InfluxDB
- Credenciales de admin
- Debug mode

**Motivo:** Seguridad y estabilidad. Cambiar esto en caliente podría romper el sistema.

---

## 3. Roles y Permisos

### 3.1 Administrador

- Acceso completo al panel `/pro/admin`
- Puede modificar toda la configuración
- Requiere autenticación (user/password)
- Sesión con expiración (12h actualmente)

### 3.2 Usuario (visitante)

- Acceso a todas las páginas públicas (`/pro/*` excepto `/pro/admin`)
- Solo lectura de datos
- Puede ver estado de alertas (activas/inactivas) pero no modificar
- Puede personalizar su vista (Mi tablero, unidades, tema) — se guarda en su navegador

### 3.3 (Futuro) Roles intermedios

Posibilidad de agregar:
- **Operador:** puede silenciar alertas, ver logs, pero no cambiar configuración
- **Multi-admin:** diferentes admins para diferentes estaciones

---

## 4. Organización del Panel

### 4.1 Opción A: Tabs/Secciones planas

```
/pro/admin
├── Dashboard (estado general)
├── Estaciones
├── Alertas
├── Calibración
├── Publicación
├── Notificaciones
├── Integraciones
└── Avanzado (QC, sistema)
```

**Pros:** Simple, todo visible, fácil de encontrar.
**Contras:** Puede sentirse largo si hay muchas opciones.

### 4.2 Opción B: Jerarquía básico/avanzado

```
/pro/admin
├── Dashboard
├── Configuración Básica
│   ├── Alertas (umbrales comunes)
│   ├── Notificaciones (Telegram)
│   └── Publicación (on/off por red)
├── Configuración Avanzada
│   ├── Estaciones (multi-estación)
│   ├── Calibración
│   ├── Control de calidad
│   ├── MQTT
│   └── Por estación (config específica)
└── Sistema (solo lectura: versión, estado, logs)
```

**Pros:** Separa lo común de lo técnico, menos abrumador.
**Contras:** Requiere más clicks para llegar a opciones avanzadas.

### 4.3 Opción C: Por flujo de trabajo

```
/pro/admin
├── Estado (dashboard con acciones rápidas)
├── Mi Estación
│   ├── Principal (config, calibración, alertas)
│   └── Remotas (lista, agregar, config cada una)
├── Compartir (publicación a redes, widget)
├── Alertas y Notificaciones
└── Sistema (QC, MQTT, tokens)
```

**Pros:** Organizado por "qué quiero hacer", más intuitivo.
**Contras:** Algunas configuraciones podrían estar en varios lugares lógicos.

---

## 5. Flujo de Primera Configuración (Wizard)

Posible wizard para nuevos usuarios:

```
Paso 1: Bienvenida
  "Tu estación está enviando datos. Configuremos lo básico."

Paso 2: Verificar estación
  - Mostrar datos actuales detectados
  - Confirmar sensores
  - Asignar nombre/label

Paso 3: Alertas
  - ¿Quieres recibir alertas?
  - Configurar Telegram (con instrucciones paso a paso)
  - Umbrales recomendados para tu ubicación

Paso 4: Publicación
  - ¿Quieres compartir tus datos?
  - Seleccionar redes (WU, Windy, etc.)
  - Ingresar credenciales

Paso 5: Listo
  - Resumen de configuración
  - Enlace al panel completo
  - Enlace a la guía
```

**Implementación:** Flag `setup_completed` en settings.json. Si es false, redirigir a wizard.

---

## 6. Lo que ve el Usuario vs Admin

### Usuario ve (sin autenticación):

| Página | Contenido |
|--------|-----------|
| `/pro` | Datos en tiempo real, pronóstico, historia, etc. |
| `/pro/remota` | Datos de estación secundaria |
| `/pro/estaciones` | Vista multi-estación (solo lectura) |
| Alertas | Banner si hay alerta activa, pero no puede modificar |
| Mi tablero | Personalización local (localStorage) |
| Widget | Código para insertar |

### Admin ve (con autenticación):

| Página | Contenido |
|--------|-----------|
| `/pro/admin` | Panel completo de configuración |
| Dashboard | Estado de todas las estaciones, alertas, uptime |
| Todas las secciones | Configuración completa |
| Logs | (Futuro) Ver logs del sistema |

---

## 7. Preguntas por Resolver

1. **¿Wizard de primera configuración?** — ¿Vale la pena implementarlo o es suficiente con documentación?

2. **¿Estructura del panel?** — ¿Opción A (plana), B (básico/avanzado), o C (por flujo)?

3. **¿Configuración por estación en el mismo panel o página separada?** — Al editar una estación secundaria, ¿se abre modal, página nueva, o sección expandible?

4. **¿Roles futuros?** — ¿Planear para multi-admin o mantenerlo simple con un solo admin?

5. **¿Separar `/admin` de `/pro`?** — Actualmente es `/pro/admin`. ¿Mejor tenerlo en `/admin` completamente separado?

6. **¿Indicadores visuales de estado?** — En el panel, ¿mostrar estado de conexión a servicios (InfluxDB, Telegram, redes) en tiempo real?

---

## 8. Siguiente Paso

Definir respuestas a las preguntas del punto 7 y elegir:
1. Estructura del panel (A, B, o C)
2. Si incluir wizard
3. Alcance de la Fase 2.2 (qué implementar primero)

Una vez definido, crear mockups o wireframes simples y luego implementar.

---

*Documento creado: 2026-07-12*
