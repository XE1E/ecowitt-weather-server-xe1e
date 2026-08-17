// Detector de lluvia - FASE 1: caracterizacion del piezo
//
// Esto NO es el detector. Es la herramienta para contestar la unica pregunta
// que puede tumbar el diseno del PLAN-DETECTOR-LLUVIA.md:
//
//   una gota de agua, ¿da una senal distinguible de un golpe en la mesa,
//   del viento o de que alguien cierre una puerta?
//
// Por eso mide y ensena, en vez de decidir. Saca la amplitud de pico y la
// duracion del "campaneo" de cada impacto, y sabe volcar la forma de onda
// completa en CSV para que la mires en una grafica.
//
// Salida por serie a 115200.
//
// ---------------------------------------------------------------------------
// CIRCUITO
// ---------------------------------------------------------------------------
//
// El piezo se polariza a media alimentacion para ver los dos semiciclos. Si lo
// cuelgas directo a masa, los negativos se recortan y pierdes justo la parte
// del campaneo que sirve para discriminar.
//
//                        3V3
//                         |
//                       [100k]
//                         |
//   piezo(+) --[1k]--+----+----+------> pin ADC
//                    |         |
//                  [1M]      [100k]
//                    |         |
//   piezo(-) --------+---------+------> GND
//
//   Ademas, dos diodos SCHOTTKY de proteccion desde el pin ADC:
//     - anodo al pin, catodo a 3V3
//     - anodo a GND,  catodo al pin
//
// Los diodos NO son opcionales: un piezo golpeado con fuerza genera picos de
// decenas de voltios y el ADC del ESP32 aguanta 3.3. Usa Schottky (BAT85,
// BAT43) y no 1N4148: los 0.2-0.3 V de caida dejan el pin dentro de rango,
// mientras que los 0.7 V del 1N4148 lo meten en negativo, que esta fuera de
// especificacion.
//
// La de 1M descarga el piezo (si no, se queda cargado y la linea base deriva).
// La de 1k limita la corriente por los diodos en los picos.
//
// Pega el piezo con cianoacrilato a la cara de ABAJO de la placa que reciba
// las gotas. Rigido: si lo montas sobre algo blando, absorbe el impacto y no
// veras nada.
//
// ---------------------------------------------------------------------------
// COMANDOS POR SERIE (una tecla)
// ---------------------------------------------------------------------------
//
//   c  recalibrar linea base y suelo de ruido (hazlo en silencio)
//   w  volcar en CSV la forma de onda del PROXIMO impacto
//   r  reiniciar estadisticas
//   +  subir el umbral   (menos sensible)
//   -  bajar el umbral   (mas sensible)
//   ?  ayuda y estado actual
//
// ---------------------------------------------------------------------------
// COMO USARLO
// ---------------------------------------------------------------------------
//
//   1. Enciende en silencio y deja que calibre. Anota el suelo de ruido.
//   2. Deja caer gotas con un cuentagotas desde ~30 cm. Anota los picos.
//   3. Da un golpe suave en la mesa. Anota los picos.
//   4. Si las dos nubes de valores no se solapan, el diseno sale adelante.
//   5. Con 'w' saca la forma de onda de cada caso y comparalas: aunque los
//      picos se parezcan, la duracion del campaneo suele separarlos.

// --- pin del ADC ---------------------------------------------------------
// Tiene que ser de ADC1: el ADC2 se pelea con el WiFi. Aqui no usamos WiFi,
// pero mas vale acostumbrarse al pin bueno desde ya.
//   ESP32 clasico : 32..39 (34..39 son solo entrada, ideales)
//   ESP32-S3      : 1..10
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  #define PIN_PIEZO 4
#else
  #define PIN_PIEZO 34
#endif

// --- parametros de deteccion --------------------------------------------
static const int   K_UMBRAL       = 6;    // umbral = suelo de ruido * K
static const int   UMBRAL_MINIMO  = 12;   // suelo, en cuentas de ADC
static const int   DIV_LIBERACION = 3;    // suelta a umbral/3 (histeresis)
static const uint32_t SILENCIO_US = 25000; // 25 ms callado = fin del impacto
static const uint32_t EVENTO_MAX_US = 500000; // corta a los 0.5 s pase lo que pase
static const uint32_t RESUMEN_MS  = 10000;
// Cada cuantas muestras se corrige la linea base en +-1 cuenta. Con ~40 kHz de
// muestreo esto son ~10 cuentas/s: de sobra para la deriva termica, que va por
// minutos, y lo bastante lento como para no ir persiguiendo la propia senal.
static const uint32_t DIV_DERIVA  = 4096;

// --- captura de forma de onda -------------------------------------------
static const int N_PRE  = 60;    // muestras ANTES del disparo
static const int N_POST = 540;   // y despues
static const int N_BUF  = N_PRE + N_POST;

static uint16_t bufAnillo[N_PRE];
static int      idxAnillo = 0;
static uint16_t bufOnda[N_BUF];
static bool     pedidaOnda = false;

// --- estado --------------------------------------------------------------
static int32_t  base       = 0;      // linea base (media movil)
static int      sueloRuido = 0;
static int      umbral     = 0;

static uint32_t nEventos      = 0;
static int      picoMin       = INT32_MAX;
static int      picoMax       = 0;
static uint64_t picoSuma      = 0;
static uint32_t ultimoResumen = 0;
static uint32_t tUltimoEvento = 0;

static uint32_t muestrasPorSeg = 0;   // se mide de verdad, no se supone

// -------------------------------------------------------------------------

static inline int leer() { return analogRead(PIN_PIEZO); }

// Mide la linea base y el ruido con el sensor quieto.
static void calibrar() {
  Serial.println(F("\n[cal] midiendo en silencio, no toques nada..."));
  delay(300);

  const int N = 4000;
  int64_t suma = 0;
  int mn = 4095, mx = 0;
  for (int i = 0; i < N; i++) {
    int v = leer();
    suma += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    delayMicroseconds(100);
  }

  base = suma / N;
  // El suelo de ruido es la mayor desviacion vista respecto a la base, no el
  // rango completo: lo que importa es cuanto se aleja un pico del centro.
  int desvArriba = mx - (int)base;
  int desvAbajo  = (int)base - mn;
  sueloRuido = max(desvArriba, desvAbajo);

  umbral = max(sueloRuido * K_UMBRAL, UMBRAL_MINIMO);

  Serial.printf("[cal] base=%ld  ruido=+-%d  umbral=%d cuentas\n",
                (long)base, sueloRuido, umbral);
  if (base < 300 || base > 3795) {
    Serial.println(F("[cal] OJO: la base esta pegada a un extremo."));
    Serial.println(F("[cal] Revisa el divisor de 100k: deberia dar ~1.65 V (~2048)."));
  }
}

// Mide cuantas muestras por segundo da de verdad este bucle.
static void medirVelocidad() {
  uint32_t t0 = micros();
  const int N = 20000;
  for (int i = 0; i < N; i++) (void)leer();
  uint32_t dt = micros() - t0;
  muestrasPorSeg = (uint32_t)((uint64_t)N * 1000000ULL / dt);
  Serial.printf("[vel] %lu muestras/s (%.1f us por muestra)\n",
                (unsigned long)muestrasPorSeg, dt / (float)N);
}

static void ayuda() {
  Serial.println(F("\n--- comandos ---"));
  Serial.println(F("  c recalibrar | w volcar onda | r reiniciar"));
  Serial.println(F("  + menos sensible | - mas sensible | ? esta ayuda"));
  Serial.printf("  base=%ld ruido=+-%d umbral=%d eventos=%lu\n",
                (long)base, sueloRuido, umbral, (unsigned long)nEventos);
}

static void reiniciarStats() {
  nEventos = 0; picoMin = INT32_MAX; picoMax = 0; picoSuma = 0;
  Serial.println(F("[stats] a cero"));
}

static void volcarOnda(int nTotal, int picoIdx) {
  Serial.println(F("\n--- ONDA CSV (pega esto en una grafica) ---"));
  Serial.printf("# base=%ld umbral=%d pico_en_muestra=%d us_por_muestra=%.1f\n",
                (long)base, umbral, picoIdx,
                muestrasPorSeg ? 1000000.0 / muestrasPorSeg : 0.0);
  Serial.println(F("n,crudo,desviacion"));
  for (int i = 0; i < nTotal; i++) {
    Serial.printf("%d,%u,%d\n", i, bufOnda[i], (int)(bufOnda[i] - base));
  }
  Serial.println(F("--- FIN ONDA ---\n"));
}

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println(F("\n=== Detector de lluvia - prueba de piezo (fase 1) ==="));
  Serial.printf("pin ADC: GPIO%d\n", PIN_PIEZO);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);   // rango util ~0..3.1 V

  medirVelocidad();
  calibrar();
  ayuda();
  Serial.println(F("\nlisto. deja caer una gota.\n"));
  ultimoResumen = millis();
}

void loop() {
  // --- comandos ---
  if (Serial.available()) {
    switch (Serial.read()) {
      case 'c': calibrar(); break;
      case 'w': pedidaOnda = true;
                Serial.println(F("[onda] esperando al proximo impacto...")); break;
      case 'r': reiniciarStats(); break;
      case '+': umbral += max(umbral / 5, 1);
                Serial.printf("[umbral] %d\n", umbral); break;
      case '-': umbral = max(umbral - max(umbral / 5, 1), 2);
                Serial.printf("[umbral] %d\n", umbral); break;
      case '?': ayuda(); break;
      default: break;
    }
  }

  int v = leer();
  int desv = v - (int)base;
  int mag  = abs(desv);

  // Guarda contexto para poder ensenar lo de ANTES del disparo.
  bufAnillo[idxAnillo] = (uint16_t)v;
  idxAnillo = (idxAnillo + 1) % N_PRE;

  if (mag <= umbral) {
    // Silencio: arrastra la base muy despacio. Una correccion de +-1 por
    // muestra parece inocente, pero a 40 kHz son 40000 cuentas por segundo:
    // la base perseguiria a la senal y el umbral dejaria de significar nada.
    static uint32_t nDeriva = 0;
    if (++nDeriva >= DIV_DERIVA) {
      nDeriva = 0;
      base += (desv > 0) ? 1 : (desv < 0 ? -1 : 0);
    }
    return;
  }

  // ---------------------------------------------------------------- impacto
  const uint32_t tIni = micros();
  const int liberacion = max(umbral / DIV_LIBERACION, 2);

  int pico = mag;
  uint32_t nMuestras = 0;
  uint32_t nOnda = 0;
  int idxPicoEnOnda = 0;
  bool truncado = false;
  const bool capturando = pedidaOnda;

  if (capturando) {
    // Vuelca primero el anillo (pre-disparo) en orden cronologico.
    for (int i = 0; i < N_PRE; i++) {
      bufOnda[nOnda++] = bufAnillo[(idxAnillo + i) % N_PRE];
    }
  }

  uint32_t tUltimoFuerte = micros();
  while (micros() - tUltimoFuerte < SILENCIO_US) {
    // Sin este tope, un ruido continuo por encima de la liberacion dejaria el
    // bucle girando para siempre y saltaria el watchdog.
    if (micros() - tIni > EVENTO_MAX_US) { truncado = true; break; }

    int s = leer();
    int m = abs(s - (int)base);
    nMuestras++;

    if (capturando && nOnda < (uint32_t)N_BUF) bufOnda[nOnda++] = (uint16_t)s;
    if (m > pico) {
      pico = m;
      if (capturando && nOnda > 0) idxPicoEnOnda = nOnda - 1;
    }
    if (m > liberacion) tUltimoFuerte = micros();
  }

  const uint32_t durUs = micros() - tIni;
  const uint32_t ahora = millis();
  const uint32_t desdeAnterior = tUltimoEvento ? (ahora - tUltimoEvento) : 0;
  tUltimoEvento = ahora;

  nEventos++;
  picoSuma += pico;
  if (pico < picoMin) picoMin = pico;
  if (pico > picoMax) picoMax = pico;

  // El campaneo es lo que mas separa una gota de un golpe: una gota da un
  // impulso corto y seco, un golpe en la mesa resuena bastante mas.
  const float mv = pico * (3100.0f / 4095.0f);
  Serial.printf("#%-4lu pico=%4d (%5.1f mV)  campaneo=%5lu us  n=%4lu",
                (unsigned long)nEventos, pico, mv,
                (unsigned long)(durUs > SILENCIO_US ? durUs - SILENCIO_US : 0),
                (unsigned long)nMuestras);
  if (desdeAnterior) Serial.printf("  (+%lu ms)", (unsigned long)desdeAnterior);
  if (truncado) Serial.print(F("  [TRUNCADO: ruido continuo, sube el umbral]"));
  Serial.println();

  if (capturando) {
    pedidaOnda = false;
    volcarOnda(nOnda, idxPicoEnOnda);
  }

  // --- resumen periodico ---
  if (ahora - ultimoResumen >= RESUMEN_MS) {
    if (nEventos) {
      Serial.printf("  [%lus] eventos=%lu  pico min/med/max = %d/%lu/%d  umbral=%d\n",
                    (unsigned long)(RESUMEN_MS / 1000), (unsigned long)nEventos,
                    picoMin, (unsigned long)(picoSuma / nEventos), picoMax, umbral);
    }
    ultimoResumen = ahora;
  }
}
