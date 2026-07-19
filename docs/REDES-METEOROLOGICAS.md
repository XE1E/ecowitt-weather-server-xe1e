# Análisis de Redes Meteorológicas Públicas

Guía completa para decidir a cuáles redes aportar los datos de tu estación
meteorológica personal (PWS - Personal Weather Station).

---

## Resumen Ejecutivo

| Red | Impacto Científico | Visibilidad | Dificultad | Recomendación |
|-----|-------------------|-------------|------------|---------------|
| **CWOP/MADIS** | ⭐⭐⭐⭐⭐ | Baja | Media | **Altamente recomendado** |
| **Weather Underground** | ⭐⭐⭐ | Alta | Fácil | Recomendado |
| **Windy** | ⭐⭐⭐ | Alta | Fácil | Recomendado |
| **PWSWeather** | ⭐⭐ | Media | Fácil | Opcional |
| **OpenWeatherMap** | ⭐⭐ | Media | Media | Opcional |

**Veredicto:** Si solo vas a elegir una, elige **CWOP** - tus datos entran a
NOAA/MADIS y se usan en modelos de pronóstico reales. Si quieres visibilidad
pública, agrega **Weather Underground** o **Windy**.

---

## 1. CWOP / MADIS / NOAA

### ¿Qué es?

**CWOP** (Citizen Weather Observer Program) es un programa de ciencia ciudadana
que recolecta datos de estaciones meteorológicas personales y los envía a
**MADIS** (Meteorological Assimilation Data Ingest System) de la **NOAA**.

Los datos de MADIS alimentan:
- Modelos numéricos de pronóstico (GFS, NAM, RAP, HRRR)
- Servicios meteorológicos nacionales de múltiples países
- Investigación climática
- Alertas de tiempo severo

### ¿Por qué es el más importante?

1. **Impacto real en pronósticos**: Tus datos mejoran directamente los modelos
   de predicción meteorológica que usamos todos los días.

2. **Cobertura escasa en México**: Hay muy pocas estaciones CWOP en México
   comparado con EE.UU. o Europa. Cada estación nueva tiene alto valor.

3. **Datos abiertos**: Los datos de MADIS son públicos y usados por
   investigadores de todo el mundo.

4. **Sin intermediarios comerciales**: Los datos van directo a uso científico,
   no a una empresa privada.

### Cobertura actual en México

```
México tiene aproximadamente:
- ~50-100 estaciones CWOP activas (estimado)
- EE.UU. tiene ~30,000+
- Europa tiene ~15,000+

Tu estación en CDMX aportaría datos valiosos a una zona con poca cobertura.
```

### Cómo funciona

1. Obtienes un **indicativo** (callsign):
   - Si tienes licencia de radioaficionado: usas tu indicativo (ej: XE1ABC)
   - Si no: solicitas un designador CW (ej: CW1234)

2. Tu estación envía datos cada 5-15 minutos vía APRS-IS (protocolo de radio
   packet sobre internet)

3. CWOP valida y reenvía a MADIS

4. MADIS lo incorpora a su base de datos pública

### Requisitos

| Requisito | Detalle |
|-----------|---------|
| Callsign | Indicativo ham o designador CW (gratis) |
| Passcode | -1 para CW, calculado para indicativo ham |
| Ubicación | Coordenadas precisas (±10 metros ideal) |
| Calidad | Sensor exterior bien ubicado (no bajo techo) |

### Cómo obtener un designador CW

1. Ir a https://www.findu.com/citizenweather/cw_form.html
2. Llenar el formulario con tus datos
3. Recibes un designador CW#### por email en 24-48 horas
4. Es gratis y no requiere licencia de radio

### Ventajas

✅ Máximo impacto científico  
✅ Datos usados en pronósticos reales  
✅ Gratis, sin publicidad  
✅ Datos abiertos y verificables  
✅ Prestigio en comunidad meteorológica  
✅ Alta necesidad en México  

### Desventajas

❌ No hay app bonita para ver tus datos  
❌ Proceso de registro menos intuitivo  
❌ Sin comunidad social  

### Enlaces

- CWOP: http://wxqa.com/
- Mapa de estaciones: https://www.findu.com/cgi-bin/wxpage.cgi
- Registro CW: https://www.findu.com/citizenweather/cw_form.html
- MADIS: https://madis.ncep.noaa.gov/

---

## 2. Weather Underground (WU)

### ¿Qué es?

La red de estaciones personales más grande del mundo, ahora propiedad de
**The Weather Company** (IBM). Tiene más de 250,000 estaciones activas
globalmente.

### Modelo de negocio

Weather Underground es un servicio comercial:
- Tus datos alimentan sus pronósticos y productos
- Venden datos a terceros (seguros, agricultura, etc.)
- A cambio, te dan visibilidad y herramientas gratuitas

### Características

- **WunderMap**: Mapa interactivo con todas las estaciones
- **Historia**: Gráficas históricas de tu estación
- **Comparación**: Compara con estaciones cercanas
- **Comunidad**: Foros y rankings
- **API**: Acceso a datos (con límites en plan gratuito)

### Cobertura en México

```
México tiene ~3,000-5,000 estaciones WU activas
CDMX tiene buena cobertura (~200+ estaciones)
Pero siempre hay valor en más datos de calidad
```

### Requisitos

| Requisito | Detalle |
|-----------|---------|
| Cuenta | Registro gratuito en wunderground.com |
| Station ID | Se asigna al registrar (ej: ICDMXCOY123) |
| Station Key | Clave secreta para autenticar envíos |

### Cómo registrarse

1. Crear cuenta en https://www.wunderground.com/signup
2. Ir a "My Weather Stations" → "Add New Device"
3. Seguir el wizard de registro
4. Anotar Station ID y Station Key

### Ventajas

✅ Mayor visibilidad pública  
✅ Interfaz amigable y bonita  
✅ Comunidad activa  
✅ Fácil de configurar  
✅ Historial gratuito  
✅ App móvil  

### Desventajas

❌ Empresa comercial (IBM) usa tus datos  
❌ Datos no son verdaderamente "abiertos"  
❌ Publicidad en la plataforma  
❌ API limitada en plan gratuito  
❌ Han cambiado términos de servicio varias veces  

### Enlaces

- Sitio: https://www.wunderground.com/
- Registro: https://www.wunderground.com/member/devices
- Mapa: https://www.wunderground.com/wundermap

---

## 3. Windy.com

### ¿Qué es?

Windy es una aplicación de visualización meteorológica muy popular, conocida
por sus mapas animados de viento. También acepta datos de estaciones personales.

### Modelo de negocio

- Freemium: básico gratis, premium con más funciones
- No venden datos directamente (hasta donde se sabe)
- Ingresos por suscripciones premium y publicidad limitada

### Características

- **Visualización espectacular**: Los mejores mapas animados
- **Múltiples modelos**: GFS, ECMWF, ICON, NAM, etc.
- **PWS en el mapa**: Tu estación aparece en el mapa principal
- **App móvil excelente**: iOS y Android
- **Comunidad activa**: Foros de discusión

### Cobertura en México

```
Windy tiene menos estaciones que WU en México (~500-1000 estimado)
Hay oportunidad de ser más visible en zonas con poca cobertura
```

### Requisitos

| Requisito | Detalle |
|-----------|---------|
| Cuenta | Registro gratuito en windy.com |
| API Key | Se genera al registrar estación |
| Ubicación | Coordenadas precisas |

### Cómo registrarse

1. Crear cuenta en https://www.windy.com/
2. Ir a https://stations.windy.com/
3. "Add new station"
4. Obtener tu API Key
5. Configurar envío desde tu estación

### Ventajas

✅ Mejor visualización del mercado  
✅ App móvil excelente  
✅ Comunidad técnica activa  
✅ No tan "corporativo" como WU  
✅ Fácil de configurar  
✅ Múltiples modelos de pronóstico  

### Desventajas

❌ Menos estaciones = menos comparación local  
❌ Menos historial que WU  
❌ Empresa privada (aunque mejor reputación que WU)  

### Enlaces

- Sitio: https://www.windy.com/
- Estaciones PWS: https://stations.windy.com/
- Comunidad: https://community.windy.com/

---

## 4. PWSWeather / AerisWeather

### ¿Qué es?

PWSWeather es parte de **AerisWeather**, una empresa de datos meteorológicos.
Acepta datos de estaciones personales con un protocolo similar a Weather
Underground.

### Modelo de negocio

- Los datos alimentan productos comerciales de AerisWeather
- Ofrecen servicios de API pagados
- Tu estación ayuda a mejorar su cobertura

### Características

- Interfaz más simple que WU
- Datos accesibles públicamente
- Menos "ruido" que WU
- Compatible con mismo protocolo que WU (fácil configurar ambos)

### Cobertura en México

```
Muy poca cobertura en México (~100-200 estaciones estimado)
Si ya envías a WU, agregar PWS es trivial (mismo protocolo)
```

### Requisitos

| Requisito | Detalle |
|-----------|---------|
| Cuenta | Registro gratuito |
| Station ID | Se asigna al registrar |
| Password | Clave para autenticar |

### Ventajas

✅ Muy fácil si ya usas WU (mismo protocolo)  
✅ Interfaz limpia  
✅ Menos saturado que WU  

### Desventajas

❌ Menos visibilidad que WU o Windy  
❌ Menos funciones  
❌ Empresa menos conocida  

### Enlaces

- Sitio: https://www.pwsweather.com/
- Registro: https://www.pwsweather.com/register

---

## 5. OpenWeatherMap (OWM)

### ¿Qué es?

OpenWeatherMap es un servicio de datos y API meteorológica. Acepta datos de
estaciones personales para mejorar sus productos.

### Modelo de negocio

- API freemium (gratis con límites, pago para más)
- Venden datos y pronósticos a empresas
- Tus datos mejoran su cobertura

### Características

- API muy usada por desarrolladores
- Datos en formato JSON estándar
- Integración con muchas apps y servicios

### Cobertura en México

```
Cobertura moderada, principalmente en ciudades grandes
Menos enfocado en comunidad PWS que WU o Windy
```

### Requisitos

| Requisito | Detalle |
|-----------|---------|
| Cuenta | Registro gratuito |
| API Key | Para enviar y consultar datos |
| Station ID | Se crea vía API |

### Proceso de registro

1. Crear cuenta en https://openweathermap.org/
2. Obtener API Key gratuita
3. Registrar estación vía API (requiere llamada POST)
4. Configurar envío de datos

### Ventajas

✅ API muy usada globalmente  
✅ Formato JSON estándar  
✅ Buenos docs para desarrolladores  

### Desventajas

❌ Proceso de registro más técnico  
❌ Menos enfocado en comunidad PWS  
❌ Interfaz de usuario básica  
❌ Menos visibilidad que WU o Windy  

### Enlaces

- Sitio: https://openweathermap.org/
- API Estaciones: https://openweathermap.org/stations

---

## Comparativa Detallada

### Impacto de tus datos

| Red | ¿Quién usa tus datos? | Impacto |
|-----|----------------------|---------|
| **CWOP/MADIS** | NOAA, servicios meteorológicos, investigadores | Modelos de pronóstico globales |
| **WU** | IBM, apps de clima, seguros, agricultura | Productos comerciales |
| **Windy** | App Windy, usuarios | Visualización, comunidad |
| **PWSWeather** | AerisWeather, sus clientes | Productos comerciales |
| **OWM** | Desarrolladores, apps que usan su API | Miles de aplicaciones |

### Visibilidad de tu estación

| Red | ¿Dónde se ve? | Audiencia |
|-----|---------------|-----------|
| **CWOP** | findu.com, MADIS | Meteorólogos, investigadores |
| **WU** | wunderground.com, app WU | Público general (millones) |
| **Windy** | windy.com, app Windy | Público general (millones) |
| **PWSWeather** | pwsweather.com | Nicho |
| **OWM** | openweathermap.org | Desarrolladores |

### Facilidad de configuración

| Red | Registro | Configuración | Mantenimiento |
|-----|----------|---------------|---------------|
| **CWOP** | Media (CW form) | Fácil | Ninguno |
| **WU** | Fácil | Fácil | Ninguno |
| **Windy** | Fácil | Fácil | Ninguno |
| **PWSWeather** | Fácil | Fácil | Ninguno |
| **OWM** | Media (API) | Media | Ninguno |

### Cobertura en México

| Red | Estaciones estimadas | Densidad CDMX |
|-----|---------------------|---------------|
| **CWOP** | 50-100 | Muy baja |
| **WU** | 3,000-5,000 | Alta |
| **Windy** | 500-1,000 | Media |
| **PWSWeather** | 100-200 | Baja |
| **OWM** | 500-1,000 | Media |

---

## Recomendaciones por Caso de Uso

### "Quiero contribuir a la ciencia"

**→ CWOP es obligatorio**

Tus datos entrarán a MADIS y serán usados por meteorólogos profesionales,
modelos de pronóstico y investigadores. Es la única red donde tus datos
tienen impacto científico directo.

### "Quiero que mi familia vea mis datos fácilmente"

**→ Weather Underground o Windy**

Ambos tienen apps móviles excelentes y mapas interactivos. WU tiene más
historial, Windy tiene mejor visualización.

### "Quiero máxima visibilidad"

**→ WU + Windy + CWOP**

Cubre las tres audiencias: público general (WU), entusiastas (Windy) y
científicos (CWOP).

### "Solo quiero configurar una y olvidarme"

**→ Weather Underground**

Es el más fácil de configurar y tiene la mayor base de usuarios. Tu estación
será fácil de encontrar y comparar con vecinos.

### "Soy radioaficionado"

**→ CWOP con tu indicativo**

Usa tu callsign (XE1ABC) en lugar de un designador CW. Tendrás más credibilidad
en la comunidad CWOP/APRS.

---

## Configuración Recomendada para México

Dada la baja cobertura de estaciones de calidad en México, recomiendo:

### Mínimo (1 red)
```
CWOP → Máximo impacto científico
```

### Recomendado (2 redes)
```
CWOP → Impacto científico
WU   → Visibilidad pública
```

### Completo (3 redes)
```
CWOP  → Impacto científico
WU    → Visibilidad pública  
Windy → Visualización moderna
```

### Máximo (todas)
```
CWOP       → Impacto científico
WU         → Mayor audiencia
Windy      → Mejor visualización
PWSWeather → Cobertura adicional
OWM        → Ecosistema de apps
```

El servidor ya soporta todas estas redes simultáneamente sin esfuerzo
adicional. Una vez configuradas las credenciales, los datos se envían
automáticamente a todas.

---

## Consideraciones de Privacidad

| Red | Ubicación pública | Datos vendidos | Términos |
|-----|-------------------|----------------|----------|
| **CWOP** | Sí (coords exactas) | No (datos públicos) | Abiertos |
| **WU** | Sí (coords exactas) | Sí (a terceros) | Comerciales |
| **Windy** | Sí (coords exactas) | Posible | Comerciales |
| **PWSWeather** | Sí (coords exactas) | Sí (AerisWeather) | Comerciales |
| **OWM** | Sí (coords exactas) | Sí (a clientes API) | Comerciales |

**Nota:** Todas las redes requieren tu ubicación exacta. Si esto es un problema,
no publiques en ninguna red pública.

---

## Calidad de Datos

Todas las redes esperan datos de calidad. Antes de publicar:

1. **Ubicación del sensor**: El sensor exterior debe estar:
   - A la sombra (no sol directo)
   - Ventilado (no en caja cerrada sin flujo de aire)
   - Lejos de fuentes de calor (AC, paredes que absorben sol)
   - A ~1.5-2m del suelo (estándar meteorológico)

2. **Calibración**: Compara tus lecturas con estaciones oficiales cercanas
   y ajusta offsets si es necesario.

3. **Mantenimiento**: Limpia los sensores periódicamente (especialmente
   el pluviómetro).

---

## Resumen Final

| Si quieres... | Elige |
|---------------|-------|
| Contribuir a la ciencia | CWOP |
| Máxima audiencia | WU |
| Mejor app/visualización | Windy |
| Todas las anteriores | CWOP + WU + Windy |

El servidor ya está preparado para enviar a todas las redes. Solo necesitas
las credenciales de cada una, que se configuran en:

**https://clima.xe1e.net/pro/admin** → **Publicación**

---

## Referencias

- CWOP FAQ: http://wxqa.com/faq.html
- MADIS: https://madis.ncep.noaa.gov/
- WU PWS Network: https://www.wunderground.com/pws/overview
- Windy Stations: https://community.windy.com/topic/7544/windy-stations
- OWM Stations API: https://openweathermap.org/stations
