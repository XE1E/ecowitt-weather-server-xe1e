# HDR automático por posición del sol (cámara del exterior)

## El problema

La cámara del exterior (Tapo C325WB) mira al **sureste** y no se puede reorientar
por temas de visibilidad del sitio. En las mañanas el sol entra al encuadre como
una bola y sobreexpone el aire a su alrededor — no tapa toda la imagen (los
laterales se ven bien), pero **ese halo se confunde con bruma o nubosidad
ligera**, tanto a simple vista como para el análisis del cielo con IA
(`docs/guias/analisis-cielo.md`). Confirmado sobre fotos reales, 2026-08-31.

Un parasol físico no resuelve esto: el C325WB tiene un lente muy gran angular
(**106° horizontal / 56° vertical**, spec de fábrica), así que durante esas
horas el sol no está *rozando* el borde del lente desde fuera del encuadre —
está **dentro** de él. Un parasol bloquea luz que entra desde fuera del cono de
la imagen; cuando la fuente está dentro de ese cono, no hay forma de taparla sin
recortar la imagen (es tapar con la mano algo que se está mirando de frente, no
algo que entra de lado).

Tapo tampoco tiene un ajuste llamado "WDR" o "BLC" — el equivalente es **HDR**
(Ajustes de cámara → Video y pantalla en la app), que reduce el contraste entre
sombras y altas luces. Mitiga el efecto, no lo elimina.

## La solución: encender HDR sólo cuando el sol está realmente en el encuadre

En vez de un horario fijo (el arco por donde amanece se mueve mucho a lo largo
del año — un horario fijo se queda corto en unas épocas y sobra en otras),
`scripts/camara-hdr-auto.py` calcula la posición **real** del sol (azimut y
altura) contra el rumbo fijo de la cámara, usando el mismo dato astronómico que
ya sirve la página de Astronomía: `GET /api/almanac` (público, sin
credenciales, con caché de 10 min en el servidor).

Cuando el sol entra en el rectángulo geométrico del campo de visión, enciende
el HDR vía **pytapo** (librería no oficial pero madura, ya usada por la
integración de Home Assistant para este mismo modelo) hablando con la
**misma cuenta de cámara** que usa `captura-camara.sh` para RTSP — sin
credenciales nuevas, sin exponer nada más.

```
¿sol en el encuadre?
  diferencia_angular(azimut_sol, CAMERA_BEARING_DEG) ≤ CAMERA_FOV_H_DEG / 2   Y
  CAMERA_TILT_DEG − CAMERA_FOV_V_DEG/2 ≤ altura_sol ≤ CAMERA_TILT_DEG + CAMERA_FOV_V_DEG/2   Y
  altura_sol > 0
```

Corre por systemd cada 5 min (`scripts/systemd/camara-hdr.{service,timer}`,
mismo patrón que `camara-clima.*`) y sólo llama a la cámara cuando el estado
deseado **cambia** — no en cada corrida — para no escribir en su flash cada
5 minutos porque sí.

## Instalación (en la Raspberry Pi de la cámara, `stn8952`)

Mismo equipo donde ya corre `captura-camara.sh` — ver
`docs/archivo/PLAN-CAMARA-EXTERIOR.md`. Es un **nodo IRLP en producción**: no
tocar nada de `apt`/audio, sólo lo de `/opt/camara`.

```bash
# 1. Copiar el script (junto a captura-camara.sh, que ya vive en /opt/camara)
scp -P 22200 scripts/camara-hdr-auto.py pi@192.168.100.202:/opt/camara/

# 2. pytapo (única dependencia nueva)
ssh -p 22200 pi@192.168.100.202
pip3 install --user pytapo   # o en un venv si se prefiere

# 3. Agregar las variables nuevas a /opt/camara/camara.env
#    (ver scripts/camara.env.example — CAMERA_HDR_AUTO, CAMERA_BEARING_DEG,
#    CAMERA_FOV_H_DEG, CAMERA_FOV_V_DEG, CAMERA_TILT_DEG). SIN CAMERA_BEARING_DEG
#    puesto, el script no hace nada — no adivina el rumbo (ver calibración abajo).

# 4. Systemd
scp -P 22200 scripts/systemd/camara-hdr.* pi@192.168.100.202:/tmp/
ssh -p 22200 pi@192.168.100.202
sudo cp /tmp/camara-hdr.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now camara-hdr.timer

# Probar una corrida manual (con -v para ver el resultado en pantalla):
python3 /opt/camara/camara-hdr-auto.py -e /opt/camara/camara.env -v
```

## Calibrar `CAMERA_BEARING_DEG`

No basta con leer un compás apuntando a la casa: la orientación real del sensor
dentro de la carcasa puede no coincidir exactamente con hacia dónde "se ve" que
apunta. El método fiable es comparar **fotos reales** contra lo que dice el
propio servidor:

1. Una mañana con sol, revisa las fotos guardadas
   (`<camera_dir>/YYYY-MM-DD/`) y anota la hora en que el sol **entra** al
   encuadre por un lado y la hora en que **sale** por el otro.
2. Para cada una de esas dos horas, consulta `GET /api/almanac` (se puede abrir
   en el navegador: `https://clima.xe1e.net/api/almanac`) y anota
   `sun.azimuth` — como el azimut cambia lento, basta con mirarlo cerca de esa
   hora, no exactamente en el segundo.
3. `CAMERA_BEARING_DEG` = el punto medio entre esos dos azimuts. Si el rango
   entre ambos no se parece a los 106° del spec, `CAMERA_TILT_DEG` probablemente
   también necesita ajuste (una cámara no perfectamente a nivel ve una franja de
   cielo distinta a la calculada con `CAMERA_FOV_V_DEG` centrado en 0).

## Limitaciones

- **No hay forma de leer el HDR actual de la cámara** (pytapo no expone un
  `getHDR`): el script recuerda el último estado que él mismo puso en
  `.camara-hdr.state`, junto al script. Si alguien lo cambia a mano desde la
  app Tapo, ese archivo queda desincronizado hasta el siguiente cambio real de
  estado — no es grave (las transiciones son ~2 veces al día), pero conviene
  saberlo si algún día "no coincide".
- **Mitiga, no elimina.** El HDR comprime el rango dinámico; el halo alrededor
  del sol se reduce, no desaparece. Si no basta, el siguiente paso sería que el
  análisis del cielo con IA reciba una nota de "sol en el encuadre ahora" para
  no confundir ese halo con nubosidad — pendiente de evaluar según cuánto ayude
  esto primero.
- Requiere que el reloj de la Pi esté razonablemente sincronizado (NTP) — si no,
  el azimut/altura que usa para decidir estaría desfasado respecto a la
  posición real del sol.
