# TP-Link Archer C6 como Punto de Acceso

Guía para instalar un **TP-Link Archer C6 (AC1200)** detrás del router de Totalplay,
en **modo Punto de Acceso**, sin romper la red de la estación. Reemplaza el AP chino
barato (SSID `STARLINK-6G`) cuyo 2.4 GHz caía en el canal 13 y las cámaras Tapo —con
dominio regulatorio US— no lo escaneaban.

## Cómo va conectado

```
Fibra ──► Router Totalplay ──► [WAN] Archer C6 [4 LAN + WiFi] ──► Pi · cámaras · PC
          gateway · DHCP         (modo Access Point)
          192.168.100.1
```

**Todo queda en la misma red `192.168.100.x`** y se ve entre sí, como ahora.

## ⚠ La decisión que importa: modo AP, no Router

Ponlo en **modo Punto de Acceso (Access Point)**, **no** en modo Router.

- En **modo router** crearía una **segunda NAT** con otra subred (p.ej. `192.168.0.x`).
  La Pi y las cámaras quedarían en redes distintas y **la Pi dejaría de alcanzar a las
  cámaras** → se rompería la captura.
- En **modo AP**, los **4 puertos LAN + el WiFi** quedan en la red del Totalplay. **Sí
  puedes usar los 4 puertos ethernet.**

## Paso a paso

1. **Configúralo primero SIN conectarlo al Totalplay** (para no chocar de direcciones).
   Enciéndelo y conéctate a su WiFi de fábrica (SSID y clave en la etiqueta) o por cable
   a un puerto LAN. Lo más cómodo: la app **TP-Link Tether** (misma familia que las Tapo).

2. **Entra a su panel y crea la contraseña.** En el navegador: `http://tplinkwifi.net`
   (o `192.168.0.1`). Puedes saltarte el asistente de internet: en modo AP no hace falta.

3. **Cambia a modo Punto de Acceso.** `Avanzado → Modo de operación → Punto de Acceso`.
   Guardar. Se reinicia solo.

4. **Configura el WiFi y FIJA EL CANAL:**
   - **SSID y contraseña** con WPA2/WPA3-Personal.
   - **Canal 2.4 GHz = 1 o 6**, ancho **20 MHz**. Esto elimina el problema del canal 13.
   - **Región: México.**
   - Recomendado: **separa 2.4 y 5 GHz en dos SSID** (p.ej. `Casa-24` y `Casa-5`), así las
     cámaras/IoT usan siempre el de 2.4.

5. **Ahora sí, conéctalo a la red.** Cable del **puerto WAN (azul) del C6** → **un puerto
   LAN del Totalplay** (el ethernet de la fibra). El C6 tomará una IP `192.168.100.x` por
   DHCP; es cliente, no manda.

6. **Migra los equipos.** Conecta la **Tapo** al nuevo SSID de 2.4 GHz —con el canal fijo
   ya la ve— y los equipos por cable a los 4 puertos LAN.

## ✓ Cómo saber que quedó bien

Un dispositivo en el WiFi del C6 recibe una IP `192.168.100.x` y hace ping a la Pi
(`192.168.100.202`) y a las cámaras. Si todos están en esa red, listo.

## Conectar la cámara: mejor por ethernet (PoE)

Aunque el C6 quede a ~2 m de la cámara, conviene pasar la **Tapo C325WB a ethernet** en
vez de WiFi:

- **Fiabilidad 24/7**: sin cortes de WiFi ni congestión de canal ni reconexiones.
- **Se salta el problema del canal** por completo — la cámara ni usa el WiFi.
- La C325WB **soporta PoE 802.3af/at**, así que **un solo cable ethernet le da corriente y
  red a la vez** (ideal en fachada, sin enchufe cerca).

El detalle: **los puertos del Archer C6 NO son PoE.** Dos caminos:

1. **Con PoE** (recomendado si no hay enchufe junto a la cámara): un **inyector PoE
   802.3af** barato (~$150–300 MXN). El inyector se queda junto al router y un solo cable
   llega a la cámara:

   ```
   C6 (LAN) ──► Inyector PoE ──► cable único ──► Cámara (corriente + red)
   ```

   **Inyector recomendado: TP-Link TL-POE160S** (PoE+ Gigabit 802.3af/at, un puerto,
   ~$300–450 MXN en Amazon MX). Misma marca que el router y la cámara. Alternativa más
   barata: **TL-POE150S** (802.3af Gigabit, ~$250–350 MXN); da 15.4 W, suficiente para la
   Tapo (consume ~5–8 W).

   Al comprar, confirma en el listado:
   - Que diga **802.3af** o **802.3af/at** — **NO** un PoE "pasivo" de 24V/48V (esos no son
     estándar y podrían dañar la cámara).
   - Que sea **Gigabit / 10-100-1000**.
   - Que sea **inyector** (injector), no "splitter" ni "extractor".

2. **Sin PoE** (si hay enchufe cerca de la cámara): el **adaptador de corriente de la
   cámara** en el sitio + un cable ethernet normal del C6 a la cámara.

Notas al pasar a cable:

- La cámara tomará IP por DHCP igual que por WiFi; el script de captura la localiza por su
  **MAC**, así que aunque cambie de IP no hay que tocar nada.
- Para la configuración inicial la app Tapo quizá la pida por WiFi/Bluetooth una vez;
  después, cableada, queda sólida.
- Con cable, el WiFi de la cámara ya no hace falta.

## Ajustes de referencia

| Ajuste | Valor |
|---|---|
| Modo de operación | Access Point (Punto de Acceso) |
| Cable de subida | WAN del C6 → LAN del Totalplay |
| Canal 2.4 GHz | 1 o 6 (fijo, no Auto) |
| Ancho de banda 2.4 GHz | 20 MHz |
| Región | México |
| Seguridad | WPA2/WPA3-Personal |
| Panel del C6 | `tplinkwifi.net` · IP en la lista del Totalplay |

## Buenos a saber

- Para volver a entrar al panel del C6, su IP la ves en los clientes del Totalplay o en
  la app Tether; o resérvale una IP fija.
- Deja **20 MHz** en 2.4 GHz: más estable para IoT que 40 MHz.
- Si un equipo cambia de IP al reconectar (como el display ESP32), es normal —DHCP del
  Totalplay— y se busca por su MAC.
- ¿Comprando? Confirma que sea **Archer C6** (AC1200); el **Archer A6** es equivalente y
  sirve igual. Evita los modelos con USB (C6U).
