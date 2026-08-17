# Plan — Detector de lluvia (no medidor)

> Escrito el 2026-08-16. Vive en git.
>
> **Estado:** fase 1 lista para ejecutar en cuanto llegue el piezo. El firmware de
> caracterización está escrito y **compilado** (`firmware/piezo-test/`); falta el
> hardware. El lado del servidor no está hecho: el parser sólo conoce los campos de
> lluvia estándar de Ecowitt (`receiver/app/services/parser.py:46-54`) y no maneja
> ningún sensor propio.
>
> **Decidido:** desarrollo propio, alimentado de la red, con **fusión de dos sensores**
> (piezo + capacitivo). Ver *Decisión final*.
>
> **Siguiente paso concreto:** comprar la lista de *Fase 1 — banco de pruebas* y correr
> el sketch. Todo lo que hace falta para eso está en este documento.

## Objetivo

Registrar **que está lloviendo** desde la primera gota, aunque caiga tan poca agua que
el pluviómetro nunca llegue a bascular.

No sustituye al pluviómetro ni compite con él: el pluviómetro sigue midiendo cuánta
agua cae. Esto responde a otra pregunta —¿está lloviendo ahora mismo?— que hoy el
sistema no puede contestar.

Es un complemento, no una pieza necesaria. Se construye porque es útil, barato y
entretenido, en ese orden.

## El hueco que tapa

Un pluviómetro de cazoletas necesita acumular una cantidad fija de agua para que el
balancín vuelque. En los sensores domésticos ese paso ronda los **0.1–0.3 mm** según
el modelo — *conviene confirmarlo en la ficha del WS2910 antes de citar la cifra*.

Consecuencia: una llovizna que moja la calle entera puede no volcar el balancín ni una
vez. En los datos eso queda como `rain_rate = 0.0`, indistinguible de un día seco. Y
no es un caso raro en CDMX, donde la llovizna de tarde es habitual.

El hueco tiene además un segundo filo: el **instante de inicio**. Aunque acabe
lloviendo de verdad, el primer vuelco llega minutos después de las primeras gotas. Para
avisar de "empezó a llover" esos minutos son justo los que importan.

## El problema real no es detectar la gota

Detectar humedad es trivial. Lo difícil es saber **cuándo dejó de llover**: una
superficie mojada sigue mojada un buen rato después de la última gota, así que un
detector ingenuo se queda clavado en "lloviendo".

De ahí salen dos requisitos que condicionan todo el diseño:

1. Hay que distinguir **evento** ("está cayendo agua ahora") de **estado** ("la
   superficie está húmeda"). Son cosas distintas y las miden sensores distintos.
2. Hay que sobrevivir al **rocío**. En una noche despejada la placa amanece empapada
   sin que haya caído una gota. Cualquier detector basado sólo en humedad va a cantar
   lluvia casi todas las madrugadas, y eso lo convierte en ruido que se acaba ignorando.

## Análisis de opciones

| Opción | Coste aprox. | Por qué sí / por qué no |
|---|---|---|
| **Hydreon RG-11 / RG-15** | 60–100 USD | Óptico, domo sellado, haz infrarrojo: nada se moja por dentro, el secado no existe como problema. Tiene modo "detección de gota". Es la respuesta profesional y la que menos mantenimiento pide. **Descartada** porque el objetivo explícito es construirlo, no comprarlo. |
| **Capacitivo casero** | ~5 USD | Cobre interdigitado bajo máscara de soldadura y barniz: sin metal al aire no hay electrólisis. Duradero y baratísimo. Mide **estado**, no evento: por sí solo no sabe cuándo paró ni distingue el rocío. |
| **Piezoeléctrico** | ~1 USD | Detecta el **impacto** de cada gota. Resuelve gratis el final de la lluvia —sin impactos, no llueve— y es inmune al rocío, que no golpea. A cambio: viento, granizo, hojas y bichos generan falsos positivos. |
| **Resistivo FC-37 / YL-83** | ~2 USD | El típico de dos dólares. **Descartado:** las pistas van al aire y con excitación continua se corroen en semanas. Se mitiga alimentándolo sólo al medir, pero queda una pieza consumible a la intemperie, que es justo lo contrario de "que funcione solo". |
| **Ecowitt WH55 (fugas)** | ~20 USD | Entraría por el GW1100 en el push que ya se recibe, lo que suena ideal. **Descartado por física:** está pensado para agua estancada puenteando dos contactos en un suelo; cuatro gotas puede que no lo activen. Además habría que añadir los campos `leak_*` al parser. |
| **Sólo software** | 0 | Ya existe `precipitation_visible` en el análisis de cielo (`sky_analyzer.py:48`). No es un detector —la cámara es periódica y de noche va a ciegas— pero **se conserva como señal de validación cruzada**, no como alternativa. |

## Decisión final: fusión piezo + capacitivo

Dos sensores baratos en vez de uno, porque **cada uno tapa el defecto del otro**:

| | Piezo | Capacitivo |
|---|---|---|
| Mide | impacto de gota (evento) | superficie mojada (estado) |
| Inicio de lluvia | inmediato | con retraso |
| Fin de lluvia | inmediato | muy lento |
| Rocío | inmune | falso positivo garantizado |
| Falsos positivos | viento, granizo, bichos | rocío, niebla |

Fusionados, las combinaciones son legibles:

- Impactos repetidos **y** placa mojándose → **lluvia**.
- Impacto aislado sin que suba la humedad → bicho o ráfaga, se ignora.
- Placa mojada **sin** impactos → rocío, o lluvia que ya paró y se está secando.
- Placa seca y sin impactos → seco.

Esa tabla es el corazón del diseño. Todo lo demás es implementación.

### Máquina de estados

```
                impactos ≥ N en ventana T
      SECO ─────────────────────────────────► LLUVIA
        ▲                                        │
        │ capacitivo vuelve a la línea base      │ sin impactos
        │ (calefactor ayudando)                  │ durante T_fin
        │                                        ▼
      SECANDO ◄──────────────────────────────────┘
        │                    ▲
        └────────────────────┘
           vuelve un impacto → LLUVIA
```

Se reportan **dos booleanos**, no uno, porque son dos hechos distintos y ambos son
útiles: `rain_detected` (estado `LLUVIA`) y `surface_wet` (capacitivo sobre umbral).

Valores de partida, a ajustar en campo: `N = 3` impactos, `T = 60 s`, `T_fin = 5 min`.

### Alternativas al piezo que se consideraron

El piezo no es la única forma de detectar el impacto de una gota. Se descartaron éstas,
y conviene dejar escrito por qué para no volver a recorrer el camino.

| Vía | Veredicto |
|---|---|
| **Micrófono MEMS** (INMP441 por I²S) | Es la idea del disdrómetro acústico y sale digital, sin electrónica analógica ni diodos de protección. **Descartado:** un micro oye *todo* el barrio —tráfico, perros, truenos, voces—, mientras que un piezo pegado a una placa sólo oye lo que toca la placa. Esa sordera selectiva es precisamente lo que hace útil al piezo. |
| **Acelerómetro MEMS** (ADXL345, LIS3DH) | **Plan B real.** Mide lo mismo —impulso mecánico— pero digital, sin acondicionamiento analógico, y algunos traen detección de *tap* por hardware con interrupción, que ahorraría el muestreo continuo. En contra: menos ancho de banda que un piezo, así que puede que no capte bien el flanco de una gota, y cuesta más. Si el frente analógico del piezo da guerra, éste es el sustituto. |
| **Óptico: LED IR + fotodiodo** | Físicamente **la mejor opción**: sin contacto, sin persistencia de humedad, inmune a la vibración. Es lo que hace el RG-11 por dentro. **Descartado por dificultad:** hace falta óptica, modulación para rechazar la luz ambiente y resolver la condensación sobre la ventana. Es un proyecto en sí mismo. |
| **Térmico: termistor autocalentado** | Una gota enfría el elemento y eso se detecta. Funciona —se usa en sensores de humectación foliar— pero es lento, consume calentando todo el rato, y el viento y la temperatura ambiente lo confunden. |
| **Cazoletas más finas** | Reducir el paso del balancín es seguir teniendo un volumen mínimo. No cierra el hueco, sólo lo hace más pequeño. |
| **Pesada con celda de carga** | La **otra forma de verdad** de cerrar el mismo hueco: un colector sobre una celda de carga detecta acumulaciones muy por debajo de lo que vuelca un balancín, y además *mide* en vez de detectar. Descartado por coste y complejidad —deriva, viento, evaporación— pero es honesto reconocer que resolvería el problema original mejor que un detector booleano. |

**Conclusión:** el piezo gana por coste y sencillez, no por ser el único camino. Su
ventaja estructural sobre las alternativas baratas es que, al estar acoplado
mecánicamente sólo a la placa, ignora el ruido acústico del entorno sin tener que
filtrarlo.

### Las dos cosas que lo hacen "funcionar solo"

**Línea base autocalibrante.** La capacitancia en seco cambia con la temperatura, la
humedad ambiente y la mugre acumulada. Con un umbral absoluto, en tres meses da falsos
positivos. La referencia tiene que ser una media lenta del estado seco, y la detección
una desviación rápida sobre ella. Esto es lo que decide si el cacharro sigue siendo
útil al año o acaba desenchufado — más importante que la elección del sensor.

**Calefactor.** Como hay corriente, un par de vatios detrás de la placa la secan en
minutos y dan un flanco limpio de "dejó de llover". Se activa **sólo en `SECANDO`**,
con tiempo máximo, para no estar calentando de balde ni falsear la temperatura de un
sensor cercano.

Montar la placa inclinada **30–45°** para que el agua escurra y no se encharque.

## Comunicación: WiFi, y el sensor empuja

**Sí, WiFi**, pero la dirección importa y es la lección que ya dejó escrita la cámara:
el sensor vive en la red de casa, detrás del NAT, y el servidor está en el VPS. **El
VPS no puede ir a buscarlo.** Tiene que ser el ESP32 el que empuje hacia fuera.

Se copia el patrón de la cámara, que ya está probado en producción: POST autenticado
con **token propio** en cabecera, distinto del de administración, que sólo permita
reportar. Si se filtra, lo único que consigue quien lo tenga es mandar lecturas de
lluvia falsas — malo, pero acotado.

Alternativas descartadas:

- **MQTT.** Está soportado en el receiver pero hoy deshabilitado. Añadiría un broker al
  camino a cambio de nada; el POST directo es menos piezas. Queda como opción si algún
  día se quiere que Home Assistant lo vea de primera mano.
- **Meterlo en el GW1100** como un sensor Ecowitt más. No es posible: el protocolo de
  915 MHz es propietario y no admite sensores de terceros.
- **Que lo recoja la Raspberry Pi del sitio.** Funcionaría, pero mete un salto extra y
  una dependencia de un equipo que además es un nodo IRLP en producción. Sólo tiene
  sentido si la cobertura WiFi en el punto de montaje resulta mala.

Con alimentación de red no hace falta *deep sleep*: WiFi permanente y reporte inmediato
en cada cambio de estado, más un **heartbeat cada 5 minutos**. El heartbeat no es
opcional — sin él, "no llueve" y "el sensor está muerto" se ven exactamente igual desde
el servidor.

### Riesgo a verificar temprano: Cloudflare

La Pi del sitio **no podía subir** a `clima.xe1e.net`: sale por una VPN de AMPRNet y
Cloudflare le respondía **403 con `cf-mitigated: challenge`**. Se resolvió yendo
directo a la IP del VPS con `--resolve` y fijando la clave pública del certificado
(ver PLAN-CAMARA-EXTERIOR.md).

El ESP32 saldría por el gateway normal de la LAN, no por el túnel, así que *en
principio* no le afecta. **Pero conviene probarlo con un POST tonto antes de construir
nada**, porque si vuelve a aparecer, cambia el diseño del firmware: habría que meter
validación de certificado fijada en un chip donde eso es bastante más incómodo que en
un `curl`.

## Contrato con el servidor

```
POST /api/rain-detector/report      cabecera: X-Rain-Token
{
  "state": "LLUVIA",              // SECO | LLUVIA | SECANDO
  "rain_detected": true,
  "surface_wet": true,
  "drops_per_min": 12,            // del piezo; pista de intensidad, no medida
  "since": "2026-08-16T18:04:11Z",
  "cap_raw": 1234,                // crudo y línea base: para depurar y reajustar
  "cap_baseline": 1100,
  "heater_on": false,
  "uptime_s": 86400,
  "fw": "0.1.0"
}

GET /api/rain-detector/status   -> lo último recibido + age_seconds
```

Se manda el crudo y la línea base a propósito: los primeros meses van a hacer falta
para afinar umbrales, y sale más barato guardarlos desde el principio que volver a
salir al tejado con un portátil.

En InfluxDB, medida propia — **no** mezclada con los campos `rain_*` del pluviómetro,
que son milímetros y no deben contaminarse con un booleano.

## Integración en lo que ya existe

| Dónde | Qué |
|---|---|
| Alertas | Regla nueva "empezó a llover", que es el caso de uso que más justifica el proyecto: llega antes que el pluviómetro. |
| Tablero web | Indicador en la tarjeta de precipitación; el dato interesante es "lloviendo ahora" junto a los mm del día. |
| Kiosco | Nada nuevo si entra en la página de precipitación que ya existe. |
| E-paper | Es cliente gordo y dibuja lo suyo: quedaría para una segunda vuelta. |
| Consola | Encaja mal con la réplica de la consola física, que imita un aparato real. Probablemente no. |

## Validación en campo

Aquí está lo que convierte esto en algo medible en vez de una corazonada. Hay **dos
referencias independientes** ya en producción:

- El **pluviómetro**: dice cuándo coinciden.
- El **`precipitation_visible`** de la cámara: confirma de día.

La métrica que justifica el proyecto entero es contar los eventos **"el detector dice
lluvia y el balancín marca 0.0"**. Ése es exactamente el hueco que se quiere tapar, y
tras unas semanas se podrá decir cuántas veces al mes pasa en lugar de suponerlo.

Conviene además contar los **falsos positivos nocturnos** —detector activo con cámara a
oscuras y balancín a cero— para saber si la discriminación del rocío funciona de verdad.

## Fases

Ordenadas para que lo más incierto y barato vaya primero.

- [x] **1a. Firmware de caracterización escrito** (2026-08-16). `firmware/piezo-test/`,
      compilado sin warnings para `esp32dev` y `esp32-s3-devkitc-1` con arduino-esp32
      3.3.9 (RAM 7.2 %, flash 23.1 %). Detalle en *Fase 1 — banco de pruebas*.
- [ ] **1b. Piezo en el escritorio.** ESP32 y un cuentagotas, a ver qué señal da una
      gota y si se distingue de un golpe en la mesa. Es la parte con más incertidumbre
      de todo el plan y la más barata de descartar; si el piezo no discrimina, el
      diseño cambia y mejor saberlo antes de pedir PCBs. **Bloqueado: falta el piezo.**
- [ ] **2. Prueba de POST.** Un ESP32 mandando un JSON fijo al VPS, para descartar lo de
      Cloudflare antes de invertir en hardware.
- [ ] **3. Placa capacitiva.** Empezar con el periférico táctil del ESP32-S3, que ya se
      maneja y no cuesta nada. Si la deriva térmica molesta, entonces el FDC1004.
- [ ] **4. Fusión y máquina de estados**, con los umbrales de arriba como punto de
      partida.
- [ ] **5. Endpoint, almacenamiento y tarjeta en el tablero.**
- [ ] **6. Calefactor**, al final, cuando ya se sepa cuánto tarda en secarse de verdad.
      Puede que con la inclinación baste.
- [ ] **7. Alerta de "empezó a llover"**, sólo cuando haya semanas de datos que digan
      que no da falsos positivos. Una alerta que se equivoca se silencia y ya no vuelve
      a servir para nada.

## Fase 1 — banco de pruebas del piezo

Todo lo necesario para ejecutarla está aquí. El firmware ya existe; falta comprar
cuatro cosas y sentarse una tarde.

### Qué comprar

| Pieza | Cant. | Nota |
|---|---|---|
| Disco piezo, **dos tamaños**: ~27–35 mm y ~50 mm | 3–5 de cada | Cuestan céntimos. Compra varios: se despegan y se rompen los cables. Ver *Qué tamaño de piezo*. |
| Resistencia 100 kΩ | 2 | Divisor de polarización |
| Resistencia 1 MΩ | 1 | Descarga del piezo |
| Resistencia 1 kΩ | 1 | Limita la corriente por los diodos |
| Diodo **Schottky** (BAT85, BAT43, 1N5819) | 2 | **No 1N4148** — ver abajo |
| Placa de ESP32 | 1 | Cualquiera sirve; probablemente ya haya una |
| Protoboard, cables, cianoacrilato | — | |
| Cuentagotas o jeringa | 1 | Para dosificar gotas repetibles |
| Retal rígido (acrílico, PCB, chapa) | 1 | Donde pegar el piezo |

### Qué tamaño de piezo — lo decide la fase 1

**El diámetro del piezo no fija el área de captación.** El disco va pegado *debajo* de
una placa rígida, así que lo que recoge las gotas es la placa. Un piezo mayor no capta
más gotas: capta mejor la vibración de la placa.

Lo que sí cambia con el diámetro es la **frecuencia de resonancia**, que en un disco de
este tipo cae aproximadamente con el cuadrado del diámetro — de 27 a 50 mm baja del
orden de tres veces. Y eso corta por los dos lados:

- **A favor:** campaneo más lento, más fácil de muestrear y de medir.
- **En contra:** se acerca a donde vive el ruido ambiental —viento, vibración de la
  estructura, pasos—, que es de baja frecuencia. Justo de lo que hay que separarse.

En lo práctico, el de 50 mm es más frágil y bastante más difícil de pegar sin dejar
huecos bajo la cerámica; un hueco te quita la sensibilidad que creías ganar por tamaño.

*(Lo anterior es razonamiento, no medida. La fase 1 lo resuelve empíricamente.)*

Por eso la lista pide **los dos tamaños**: cuestan céntimos y el sketch ya mide justo lo
que hace falta para elegir. El criterio no es cuál da el pico más alto, sino **cuál
separa mejor la gota del golpe**. Puede ganar el pequeño.

### Circuito

El piezo se polariza a **media alimentación** para ver los dos semiciclos. Colgado
directo a masa se recortan los negativos, que es justo donde vive el campaneo — la
señal que sirve para discriminar.

```
                     3V3
                      |
                    [100k]
                      |
  piezo(+) --[1k]--+--+--+------> pin ADC
                   |     |
                 [1M]  [100k]
                   |     |
  piezo(-) --------+-----+------> GND

  Ademas, dos SCHOTTKY de proteccion en el pin ADC:
    - anodo al pin,  catodo a 3V3
    - anodo a GND,   catodo al pin
```

**Los diodos no son opcionales.** Un piezo golpeado con fuerza genera picos de decenas
de voltios y el ADC del ESP32 aguanta 3.3. Y que sean Schottky y no 1N4148: los
0.2–0.3 V de caída dejan el pin dentro de rango, mientras que los 0.7 V del 1N4148 lo
meten en negativo, fuera de especificación.

Pega el piezo con cianoacrilato a la cara de **abajo** del retal rígido. Si lo montas
sobre algo blando, el material absorbe el impacto y no se ve nada.

Pin por defecto: **GPIO34** en ESP32 clásico, **GPIO4** en ESP32-S3. Tiene que ser de
ADC1; el ADC2 se pelea con el WiFi, que aquí no se usa pero conviene coger la costumbre.

### El sketch

`firmware/piezo-test/piezo-test.ino`, salida por serie a **115200**.

No es el detector: no decide nada, sólo mide y enseña. De cada impacto saca la
**amplitud de pico** y la **duración del campaneo**, y sabe volcar la forma de onda
completa en CSV.

Comandos, una tecla por el monitor serie:

| | |
|---|---|
| `c` | recalibrar línea base y suelo de ruido (en silencio) |
| `w` | volcar en CSV la onda del **próximo** impacto, con contexto previo |
| `r` | reiniciar estadísticas |
| `+` / `-` | subir o bajar el umbral |
| `?` | ayuda y estado |

### Protocolo de la prueba

1. Enciende **en silencio** y deja que calibre. Anota el suelo de ruido: si sale muy
   alto, hay algo mal en el montaje antes de seguir.
2. Comprueba que la línea base ronda las **2048 cuentas** (~1.65 V). Si está pegada a
   un extremo, el divisor de 100 k no está bien; el sketch te lo avisa solo.
3. **20 gotas** con el cuentagotas desde ~30 cm. Anota pico y campaneo de cada una.
4. **20 golpes suaves** en la mesa. Anota lo mismo.
5. Con `w`, saca la onda de una gota y la de un golpe.
6. **Repite del 1 al 5 con el otro tamaño de piezo** y compara la separación entre las
   dos nubes, no los picos absolutos.

### Criterio de aceptación

**Si las dos nubes de valores no se solapan, el diseño sale adelante.**

Si se solapan en amplitud, mira el campaneo antes de dar nada por perdido: lo normal es
que una gota dé un impulso corto y seco y un golpe resuene bastante más, así que separan
aunque los picos se parezcan. Y si tampoco separa, compara las ondas de `w` — puede que
la diferencia esté en la forma y baste con un filtro.

Sólo si nada de eso discrimina hay que replantear, y entonces el camino sería el
capacitivo en solitario con lógica de secado, o rendirse y comprar el RG-11.

### Qué anotar para la fase siguiente

El tamaño de piezo elegido, el suelo de ruido y el umbral que acabe funcionando, el
rango de picos de una gota, y el campaneo típico de gota frente a golpe. Esos números
son los que fijan los umbrales de la máquina de estados y evitan tener que repetir la
caracterización más adelante.

## Cómo se mide la placa capacitiva: táctil del ESP32 o FDC1004

Dos formas, y el orden importa: **empezar por la gratis**.

### v1 — periférico táctil del ESP32

El ESP32 mide capacitancia contando tiempos de carga y descarga. No cuesta nada, ya se
maneja, y sirve de sobra para validar que la idea funciona. Su punto flaco es la
**deriva**: la lectura se mueve con la temperatura y con la alimentación, y a la
intemperie en CDMX, con el salto que hay entre el mediodía y la madrugada, es de
esperar que se note. La línea base autocalibrante existe justamente para absorber eso;
la pregunta es si le basta.

### v2 — FDC1004, si la deriva molesta

Conversor de capacitancia a digital de Texas Instruments, por I²C.

| | |
|---|---|
| Canales | 4 |
| Resolución | 0.5 fF (24 bits) |
| Rango | ±15 pF por canal |
| Offset (CAPDAC) | hasta 100 pF |
| Muestreo | 100 / 200 / 400 por segundo |
| Alimentación | 3.3 V, 750 µA activo |
| Temperatura | −40 a 125 °C |

Dos características suyas resuelven problemas concretos de este montaje:

- **CAPDAC.** La placa tendrá decenas de pF en reposo y lo que interesa es el cambio
  pequeño que provoca el agua. El CAPDAC resta esa base **en hardware**, así que los
  ±15 pF de rango se dedican enteros a la variación útil. Es el patrón de "sensor
  remoto con placa grande" para el que está pensado el chip.
- **Drivers de guarda.** El cable hasta la electrónica tiene su propia capacitancia, que
  cambia si se moja, si lo mueve el viento o si alguien se acerca. El chip saca una
  señal de apantallamiento que la anula. Con el táctil del ESP32 el cable es parte de
  lo que mides, y eso a la intemperie da guerra.

Además mide de forma ratiométrica, así que deriva mucho menos con temperatura y
alimentación — que es exactamente el punto flaco de la v1.

**Ojo con un malentendido:** sus 400 muestras por segundo son pocas para un impacto,
pero el FDC1004 **no toca el piezo**. Ése va por el ADC del ESP32 a unas 40 000
muestras por segundo. El FDC1004 sólo mediría el canal capacitivo, que es "está
mojado": una variable lenta donde 400 por segundo sobran.

## Coste

| Pieza | Aprox. |
|---|---|
| ESP32 (cualquiera) | 5 USD |
| PCB interdigitado ~50×50 mm (5 uds) | 5 USD |
| Disco piezo | 1 USD |
| FDC1004 — *opcional, sólo si la deriva molesta* | 5–8 USD |
| Resistencias de potencia (calefactor) | 2 USD |
| Caja, soporte y fuente de 5 V | 10 USD |

**~25–30 USD**, o menos si la v1 se queda en el táctil del ESP32. Precios de memoria,
tómalos como orden de magnitud.

## Decisiones abiertas

- **Dónde se monta.** Tiene que ver cielo abierto sin que lo tape el alero, y estar
  cerca de corriente. Condiciona la longitud del cable del calefactor.
- **Qué hacer con el granizo.** El piezo lo va a detectar con fuerza; se puede
  aprovechar como detección de granizo, o simplemente no distinguirlo. Es una idea
  bonita para más adelante, no para la v1.
- **Si el `drops_per_min` sirve como estimación de intensidad.** Probablemente sí de
  forma cualitativa (llovizna / moderada / fuerte), pero no como medida. No prometerlo
  hasta tener datos contra el pluviómetro.
- **Publicación externa.** CWOP y AWEKAS no tienen campo para esto; no se publica.

## Fuentes

- [Hydreon RG-11 — sensor óptico de lluvia](https://rainsensors.com/products/rg-11/)
- [TI FDC1004 — convertidor de capacitancia a digital](https://www.ti.com/product/FDC1004)
- [ESP32-S3 — periférico táctil capacitivo](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/cap_touch_sens.html)
- PLAN-CAMARA-EXTERIOR.md — patrón de push autenticado y el asunto de Cloudflare
