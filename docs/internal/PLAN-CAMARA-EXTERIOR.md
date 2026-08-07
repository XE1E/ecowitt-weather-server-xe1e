# Plan — Cámara del exterior de la estación

> Escrito el 2026-08-05, actualizado el 2026-08-06. Vive en git.
>
> **Estado:** cámara comprada, aún no recibida. **Todo el lado del servidor está hecho
> y desplegado** (endpoints, retención, página del kiosco) y probado con una foto real.
> Lo que falta depende del hardware: la puesta en marcha física y el script de casa
> que saque el JPEG del RTSP y lo empuje.

## Objetivo

Dar vista del exterior de la estación de clima junto al resto de los datos: en el
dashboard web y como una página más del kiosco. No es videovigilancia — es el
complemento visual a la lectura de los sensores.

## Hardware elegido: TP-Link Tapo C325WB

### Por qué esa

Se compararon tres, con el **campo de visión** como criterio decisivo: es lo que
hace que una cámara sirva como cámara de clima y no como cámara de vigilancia.

| | Tapo C500 | **Tapo C325WB** | Reolink ColorX P320X |
|---|---|---|---|
| Montaje | pan/tilt | fijo | fijo |
| **FOV horizontal** | 73.5° | **127°** | 89° |
| Apertura | F2.0 | **F1.0** | F1.0 |
| Sensor | no publicado | no publicado | 1/1.8" |
| Noche | IR 850 nm | **ColorPro, color sin IR** | ColorX, color sin IR |
| Resolución | 1080p | 2K | 2K 4MP |
| Alimentación | sólo DC | **PoE u 9V DC** | PoE o 12V DC |
| Precio aprox. | ~40-50 USD | **~60-70 USD** | ~80-90 USD |

- El **C500** se descartó por tres motivos: el pan/tilt se desencuadra y parte la
  serie del timelapse, 73.5° es poco campo, y su visión nocturna IR ilumina lo
  cercano — con lluvia, los reflejos de las gotas arruinan la toma.
- La **Reolink** daría mejor imagen nocturna (sensor de 1/1.8", bastante mayor), pero
  a 89° se pierde demasiada escena.
- Se descartaron también **Annke NightChroma** (~89 USD, Hikvision de marca blanca:
  mismo perfil que la Reolink sin ventaja clara), **Dahua Full-Color / Hikvision
  ColorVu** (excelentes pero por distribuidor de seguridad) y **SV3C** (barata, marca
  genérica, firmware impredecible para algo que debe durar años).

También se valoró y se descartó por presupuesto el camino **Raspberry Pi + AllSky**
(`github.com/AllskyTeam/allsky`): es la única opción que da cámara de cielo de verdad
—exposiciones largas, estrellas, timelapse/keogram/startrails automáticos y subida
remota incluida, que resolvería el NAT por sí sola—, pero sale por **150-250 USD**, no
por los ~60 de la Tapo. La Pi Zero 2 está desaconsejada por el propio proyecto (poca
RAM y CPU), así que hace falta una Pi 4 o 5, más domo, carcasa estanca y resistencia
antirrocío. Queda anotado por si algún día el objetivo cambia de "ver el exterior" a
"fotografiar el cielo".

### Especificaciones confirmadas

| | |
|---|---|
| FOV | 127° |
| Apertura / noche | F1.0, ColorPro (color sin IR ni foco) |
| Vídeo | H.264, 2K, 20 fps |
| Wi-Fi | 802.11b/g/n **2.4 GHz solamente** (sin 5 GHz) |
| Alimentación | 9V DC o **PoE 802.3af/at** |
| Intemperie | IP66 |
| Temperatura | −20 °C a 45 °C |
| Protocolos | RTSP y ONVIF Profile S |

Hay **discrepancia en la resolución** entre fuentes: la ficha de TP-Link para la V2
dice 2560×1440 y el datasheet/Amazon anuncian 2688×1520 (4 MP). Parece diferencia
entre revisiones de hardware; irrelevante para este uso.

### Límites conocidos

1. **Máxima de 45 °C.** El ambiente en CDMX no llega, pero una carcasa a pleno sol de
   mediodía puede acercarse. Tenerlo en cuenta al elegir orientación.
2. **IP66, no IP67.** Para lluvia sobra; sólo importaría si quedara donde se encharca.
3. **2.4 GHz.** Irrelevante si se cablea por PoE, que es la intención.

## Restricciones de integración

- **El RTSP exige crear antes una "cuenta de cámara"** en la app Tapo, con usuario y
  contraseña **distintos** de los de la cuenta Tapo. Sin ese paso el RTSP no responde
  y parece que la cámara no lo soporta.
- URLs: `rtsp://usuario:clave@IP:554/stream1` (alta) y `/stream2` (baja).
- **RTSP es sólo de red local.** La cámara queda en casa detrás del NAT y el dashboard
  corre en el VPS de Oracle, así que el VPS **no puede ir a buscarla**: hace falta algo
  en casa que empuje hacia fuera.
- **Nunca abrir puertos hacia la cámara.** Es una cámara de consumo con las
  credenciales en la propia URL; exponerla a internet es justo lo que no se quiere.

## Decisión de arquitectura: fotos, no directo 24/7

Se acordó **una captura cada 5-10 minutos más un timelapse diario**, en vez de
streaming continuo. Razones:

- Encaja en el kiosco como una página más, sin reproductor ni códecs.
- Un directo 1080p continuo son ~2-4 Mbps de subida sostenida desde casa, del orden de
  **1 TB/mes**, y deja un proceso de vídeo corriendo para siempre.
- Para un sitio de clima, la foto periódica y el timelapse son más útiles que el
  directo.

El **directo queda como añadido posterior**, no descartado. Si se hace: `ffmpeg` en
casa tirando del RTSP con **`-c copy`** (sin recodificar) empujando a **MediaMTX** en
el VPS, que reexpone en HLS para un `<video>` en el React. Sin transcodificar: el ARM
del free tier de Oracle no aguanta 1080p continuo.

## Puesta en marcha (cuando llegue) — pendiente

Antes de escribir una línea de código:

- [ ] Crear la **cuenta de cámara** en la app Tapo (Configuración → Avanzado).
- [ ] **Reservar su IP** por DHCP en el router. La URL RTSP lleva la IP dentro; si el
      router se la cambia, el pipeline se cae sin avisar.
- [ ] **Cablear PoE** si es posible: quita el adaptador de corriente de la intemperie y
      saca a la cámara del 2.4 GHz.
- [ ] Probar el RTSP desde la LAN con VLC o
      `ffprobe rtsp://usuario:clave@IP:554/stream1`. Si eso responde, el resto es
      trabajo del servidor.
- [ ] Decidir el encuadre **como fijo y definitivo**: con timelapse, cualquier
      reajuste posterior parte la serie en dos.

## Implementación

**El lado del SERVIDOR está hecho y desplegado (2026-08-06).** Falta sólo lo de casa,
que depende de tener la cámara físicamente.

- [ ] **Captura en casa.** `ffmpeg` sacando un JPEG del RTSP cada N minutos.
      Decidir dónde corre (¿PC de siempre, una Pi, el propio router?) y cómo se
      programa.
- [x] **Transporte al VPS.** POST autenticado contra el FastAPI, con **token propio**
      (`CAMERA_UPLOAD_TOKEN`) y no el de administración: lo lleva un script
      desatendido y, si se filtra, sólo permite subir fotos. Sin token, la ruta
      responde 503 y no guarda nada.

      ```bash
      curl -H "X-Camera-Token: $TOKEN" --data-binary @foto.jpg \
           https://clima.xe1e.net/api/camera/upload
      ```
- [x] **Endpoint en el receiver.** `upload`, `latest.jpg`, `status` y `days`, en
      `receiver/app/services/camera.py`. Retención por **días completos**
      (`CAMERA_RETENTION_DAYS`, 7 por defecto): si un día la cadencia falla y sólo
      llegan diez capturas, borrar "las más viejas" se comería días enteros de
      historia buena a cambio de nada.
- [ ] **Timelapse diario.** Generarlo en el VPS o en casa, y dónde se publica. El
      histórico ya se está guardando en `<camera_dir>/YYYY-MM-DD/HHMMSS.jpg` y
      `GET /api/camera/days` dice qué hay.
- [x] **Kiosco.** Página `camara`, en el menú que abre el reloj. **No hizo falta tocar
      el firmware**: ver la sección de arriba.
- [x] **Dashboard web.** `/pro/camara` con su entrada en la navegación, tarjeta en
      `components/station/CameraCard.tsx`. La URL de la foto lleva la marca de la
      captura (`?t=<captured_at>`): con `max-age=150` en la respuesta, sin nada el
      navegador reusaría la vieja, y con un timestamp cambiante se saltaría la caché
      en cada render y volvería a bajar los mismos ~120 KB cada minuto.
- [x] **Degradar con gracia.** Sin foto dice «SIN IMAGEN · LA CÁMARA AÚN NO ESTÁ
      CONFIGURADA»; con foto de más de 20 min (el doble de la cadencia acordada) marca
      **FOTO ANTIGUA** sobre la propia imagen, no en un pie que nadie miraría.

Probado de punta a punta contra producción con una foto real de la estación: subida
correcta, rechazo de lo que no es JPEG (400), rechazo sin token (401) y la página del
kiosco renderizando la imagen encuadrada con su hora de captura.

## Orientación: al horizonte — DECIDIDO (2026-08-05)

La cámara **mira al horizonte**, no al cielo ni a la estación. Consecuencias:

- **Confirma la elección de la C325WB.** Los 127° de FOV son exactamente lo que un
  plano de horizonte aprovecha; era el punto donde la Reolink (89°) se quedaba corta.
- **La visión nocturna ColorPro sí aporta.** Con un plano de horizonte hay estructuras,
  vegetación y luces lejanas que el F1.0 puede levantar en color. Habría sido casi
  inútil apuntando al cielo, donde lo que hace falta son exposiciones largas.
- **Encuadre**: dejar la línea de horizonte por debajo del centro, para que entre cielo
  suficiente — es donde se ve llegar el tiempo, y lo que da valor a la foto junto a los
  datos. Fijarlo de una vez: con timelapse, reajustar después parte la serie en dos.
- **Cuidado con el sol.** Un plano de horizonte se come el amanecer o el atardecer de
  frente según hacia dónde apunte. Eso satura la imagen a esas horas y, si además le da
  el sol directo a la carcasa, acerca la temperatura a los 45 °C de máxima. Preferir una
  orientación que no encare al sol; si no hay opción, contar con un par de tomas
  quemadas al día.

## Dónde se muestra: página propia en los dos — DECIDIDO (2026-08-05)

Página propia **en el kiosco y en la web**, no incrustada en una existente.

### Web

Ruta nueva bajo `/pro` en `dashboard/src/main.tsx` (junto a `radar`, `astronomia`,
`calidad-aire`…) más su entrada en la navegación de `StationLayout`. Es la parte
barata: no toca nada de lo que ya existe.

### Kiosco — YA NO arrastra firmware *(actualizado 2026-08-06)*

Esta sección decía que la cámara sería la 7ª pestaña, que el número de pestañas estaba
cableado en dos repos y que había que reflashear. **Ya no es así**, y por el camino que
apuntaba el segundo de sus "dos detalles": se generalizó el mapeo del toque. Ahora el
servidor manda con cada imagen las zonas táctiles de esa pantalla en la cabecera
`X-Kiosk-Nav`, medidas del DOM, y el firmware no sabe qué páginas existen. Ver
[PLAN-KIOSCO-NAVEGACION.md](PLAN-KIOSCO-NAVEGACION.md).

Lo del kiosco está **hecho**, todo del lado del servidor:

| Dónde | Qué |
|---|---|
| `dashboard/src/kiosk-nav.ts` | slug `camara`, TTL de 5 min (la captura se acordó cada 5-10) |
| `dashboard/src/pages/kiosk/CamaraPage.tsx` | la página, degradando con gracia mientras no haya foto |
| `dashboard/src/pages/kiosk/MenuPage.tsx` | entrada CÁMARA en el menú que abre el reloj de la consola |
| `renderer/app.py` | ya no hay lista de páginas: valida por forma, así que no había nada que añadir |

Falta sólo el **backend de la foto**. La página ya consume este contrato:

```
GET /api/camera/status      -> { available, captured_at, age_seconds }
GET /api/camera/latest.jpg
```

Mientras no exista, muestra «SIN IMAGEN · LA CÁMARA AÚN NO ESTÁ CONFIGURADA». Cuando
exista, marca **FOTO ANTIGUA** encima de la propia imagen si pasa de 20 minutos (el
doble de la cadencia acordada) — que es la parte de *degradar con gracia* de la lista
de implementación de más arriba, ya resuelta.

Sigue teniendo sentido **hacer primero la web** y validar el encuadre ahí, pero ya no
por el coste de reflashear: sólo porque conviene fijar el encuadre antes de que empiece
la serie del timelapse.

## Decisiones abiertas
- Retención de las fotos: cuántos días, y si se archiva a R2 como los backups.

## Fuentes

- [Tapo C325WB — TP-Link](https://www.tp-link.com/us/home-networking/cloud-camera/tapo-c325wb/)
- [Ver cámara Tapo por RTSP/ONVIF (cuenta de cámara y URLs)](https://www.tp-link.com/us/support/faq/2680/)
- [Cámaras Tapo compatibles con RTSP](https://us.store.tapo.com/collections/rtsp-cameras)
- [Reolink ColorX P320X](https://reolink.com/product/colorx-series-p320x/)
- [AllskyTeam/allsky — requisitos de hardware](https://github.com/AllskyTeam/allsky)
