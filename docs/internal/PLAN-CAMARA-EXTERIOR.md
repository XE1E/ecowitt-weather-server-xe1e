# Plan — Cámara del exterior de la estación

> Escrito el 2026-08-05, actualizado el 2026-08-06. Vive en git.
>
> **Estado:** cámara comprada, aún no recibida. **Todo el lado del servidor está hecho
> y desplegado** (endpoints, retención, web y página del kiosco) y probado con una foto
> real; el script de captura también.
>
> **BLOQUEADO por el sitio:** hace falta un equipo encendido en esa red que decodifique
> el H.264 de la cámara, y hoy no hay ninguno —el router no tiene reenvío de puertos y
> lo único permanente allí es un ESP32, que no puede decodificar vídeo—. Ver *El cuello
> de botella*. Mientras tanto funciona con el PC cuando esté encendido.

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

- [x] **Captura en casa.** `scripts/captura-camara.ps1`: `ffmpeg` saca un fotograma
      del RTSP y lo empuja al servidor. Corre en el **PC de siempre**; no hace falta
      hardware nuevo. Ver *Puesta en marcha del script* más abajo.
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

## El cuello de botella: hace falta un equipo en el sitio — VERIFICADO (2026-08-06)

Éste es **el punto que bloquea el proyecto**, y conviene tenerlo escrito con sus
razones para no volver a recorrer el camino.

La Tapo sólo entrega vídeo por **RTSP en H.264**, que hay que **decodificar** para
sacar un JPEG. Todo lo demás está descartado con fuentes:

| Vía | Por qué no |
|---|---|
| Cuenta / nube TP-Link | La *Tapo Open API* es para **partners** y controla dispositivos; no descarga fotogramas. No hay endpoint público de snapshot. |
| Snapshot HTTP u ONVIF | Tapo **no implementa `GetSnapshotUri`** ni una URL de foto por HTTP. [FAQ TP-Link](https://www.tp-link.com/us/support/faq/2680/) |
| FTP / SMTP desde la cámara | Las Tapo no suben por FTP. Sólo microSD y Tapo Care. |
| Que el VPS entre a la cámara | El router de Totalplay del sitio **no tiene reenvío de puertos** (problema histórico de esa conexión). La IP pública sí es real, no CGNAT — pero da igual sin reenvío. |
| El reloj **Svitrix** (Ulanzi TC001) | Es un ESP32: no existe decodificador de H.264 en ese chip. Podría hacer de *túnel TCP* tonto hacia el VPS, pero eso es reescribir firmware que hoy funciona, con el ancho de banda justo. No compensa. |
| La pantalla del kiosco (ESP32-S3) | Mismo problema de decodificación, y además es **portátil**: no está siempre en el sitio. |

**Conclusión:** con esta cámara hace falta, sí o sí, un equipo en esa red capaz de
decodificar H.264. No tiene que ser potente —un fotograma cada diez minutos es trabajo
ridículo— pero tiene que existir y estar encendido.

Opciones, por coste:

1. **El PC de casa, cuando esté encendido.** Coste cero y ya está hecho: el script y
   la tarea programada funcionan. Da fotos mientras el PC esté en marcha y huecos
   cuando no; el sitio lo dice solo marcando la foto como antigua. Es lo razonable
   mientras no haya otra cosa.
2. **Raspberry Pi Zero 2 W (~20 USD)** o cualquier equipo pequeño siempre encendido:
   cobertura 24/7 y timelapse sin huecos. El script se traduce a bash sin cambiar la
   idea.
3. Un **móvil Android viejo** enchufado, si aparece alguno.

## Instalado en la Raspberry Pi (2026-08-06)

Apareció el equipo que faltaba: una **Raspberry Pi 3B+** ya encendida en el sitio,
`stn8952` — que es además un **nodo IRLP en producción**, así que todo se hizo para no
molestar a lo que ya corre ahí.

| | |
|---|---|
| Acceso | `192.168.100.202`, **puerto SSH 22200** (IP estática en `dhcpcd.conf`) |
| SO | Raspbian 10 (buster), armv7l, 871 MB RAM, 101 GB libres |
| ffmpeg | **Ya estaba instalado** (4.1.11): no se tocó `apt` ni una sola librería |
| Instalado | `/opt/camara/{captura-camara.sh,camara.env}` + `camara-clima.{service,timer}` |
| Estado | Timer **instalado y sin activar** hasta que llegue la cámara |
| Impacto medido | Carga antes 0.40, después 0.40. `Nice=10` e `IOSchedulingClass=idle` para no competir con el audio del nodo |
| IP de la cámara | **192.168.100.150**, fuera del pool DHCP del router (que va de .11 a .100) |

### Dos cosas que hubo que resolver ahí

**1. Cloudflare bloquea la salida.** La Pi manda todo por una VPN de AMPRNet
(`tun0`, IP 44.127.49.48) y Cloudflare responde **403 con `cf-mitigated: challenge`**
a esa IP, así que la subida no llegaba nunca. La solución es ir **directo al VPS por
su IP**, saltándose Cloudflare (comprobado: HTTP 200).

Para eso el script trae `VPS_IP` y `TLS_PIN`:

- `--resolve` para que el dominio apunte al VPS.
- El certificado del VPS es un *Origin Certificate* de Cloudflare (válido hasta 2041),
  que no verifica contra una CA pública. En vez de desactivar la validación se **fija
  la clave pública** (`--pinnedpubkey`), que comprueba que se habla exactamente con
  ese servidor. Es lo que protege el token de subida.

**2. La ruta, sin tocar la configuración de red.** El script detecta al vuelo si el
tráfico al VPS sale por un túnel y, si es así, añade **en memoria** una ruta por el
gateway de la LAN. No se escribe nada permanente en el nodo IRLP, se recalcula solo si
cambia la subred o el gateway, y al desinstalar no queda rastro. Probado borrando la
ruta a mano: el script la rehízo y subió la foto.

### Qué falta (cuando llegue la cámara)

1. Cuenta de cámara en la app Tapo y **fijarle la IP 192.168.100.150**.
2. Rellenar `CAMERA_USER` y `CAMERA_PASS` en `/opt/camara/camara.env`.
3. Probar: `/opt/camara/captura-camara.sh -v`
4. Activar: `systemctl enable --now camara-clima.timer`

Para desinstalarlo todo: `systemctl disable --now camara-clima.timer`,
`rm /etc/systemd/system/camara-clima.*`, `rm -rf /opt/camara`.

## Puesta en marcha del script en Windows (2026-08-06)

### Por qué hace falta un proceso en casa, y por qué NO hace falta hardware nuevo

Se planteó si bastaría con la **cuenta TP-Link**, sin nada corriendo en casa. No: el
RTSP/ONVIF de la Tapo sólo responde **dentro de la red local** —lo dice la propia
[FAQ de TP-Link](https://www.tp-link.com/us/support/faq/2680/)— y el servidor está en
el VPS, al otro lado del NAT. La API oficial de Tapo (*Tapo Open API*) es para
**partners** y sirve para controlar dispositivos, no para descargar fotogramas; todo
lo demás que circula son librerías **no oficiales** que, además, siguen hablando con
la cámara **en la LAN**.

Pero eso no implica comprar nada: «algo en casa» es cualquier equipo ya encendido. Se
usa el **PC de siempre**. Si algún día hay una Pi, el script se traduce a bash sin
cambiar la idea.

### Pasos

1. **ffmpeg**: `winget install Gyan.FFmpeg` (y reabrir la terminal).
2. **Cuenta de cámara** en la app Tapo (Configuración del dispositivo → Avanzado).
   No es la cuenta TP-Link; sin ella el RTSP no responde.
3. **Reservar la IP** de la cámara en el router. La URL RTSP la lleva dentro: si el
   router se la cambia, la captura se cae en silencio.
4. `copy scripts\camara.env.example scripts\camara.env` y rellenarlo (IP, usuario y
   contraseña de la cámara, y el `UPLOAD_TOKEN`, que es el mismo `CAMERA_UPLOAD_TOKEN`
   del `.env` del VPS). Ese archivo está en `.gitignore`.
5. Probar: `.\scripts\captura-camara.ps1 -Once`
6. Programar cada 10 min:

```powershell
$acc = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Documents\GitHub\ecowitt-weather-server-xe1e\scripts\captura-camara.ps1"'
$trg = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 10)
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'Ecowitt captura camara' -Action $acc -Trigger $trg -Settings $set
```

`-StartWhenAvailable` recupera la ejecución si el equipo estaba apagado a esa hora, y
`IgnoreNew` evita que se solapen dos capturas si una se atasca.

### Detalles del script que no se ven en la firma

- **`-rtsp_transport tcp`**: por UDP la Tapo pierde paquetes y la foto sale con bandas.
- **`-ss 1` después de `-i`**: descarta el primer segundo. El primer fotograma suele
  llegar a medio decodificar —aún no hay un keyframe completo— y salía media imagen
  gris.
- **Si falla, no sube nada.** Vale más dejar en el servidor la foto anterior, que él
  marcará solo como antigua a los 20 min, que subir un fotograma roto.
- **`MAX_WIDTH=1600`**: el 2K de la cámara son ~600 KB por captura; la web la muestra
  a ~1200 px y el kiosco a 1024, así que a 1600 no se pierde nada visible y el
  histórico ocupa un tercio.
- **UTF-8 con BOM**: Windows PowerShell 5.1 lee los `.ps1` sin BOM como ANSI y los
  acentos salen rotos. Comprobado.
- **`-Archivo <ruta>`** sube ese archivo en vez de capturar: sirve para dejar probada
  la mitad del camino (token, red, servidor) antes de tener la cámara.

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
