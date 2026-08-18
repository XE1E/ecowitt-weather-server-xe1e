# Nodo IRLP stn8952 — los niveles de audio no se quedaban quietos

Diagnóstico y corrección del **2026-08-17**. La Raspberry Pi `stn8952`
(`192.168.100.202`, SSH puerto `22200`) es un **nodo IRLP en producción** y además la
que **captura las fotos de la cámara** de la estación, por eso queda documentado aquí.

## Síntoma

El control `Speaker` de la tarjeta de audio (fob USB C-Media `0d8c:0008`) bajaba solo de
**110 (73 %, −7.75 dB)** a **44 (29 %, −20.13 dB)**, mientras `Mic` y `Auto Gain Control`
no se movían. Pasaba al **conectar o desconectar** con un nodo o reflector, y también
"de improviso". Siempre al mismo valor → no era una deriva, era algo que **escribía** un
valor concreto.

## Causa raíz: un `~` que apuntaba a otro usuario

`/home/irlp/custom/rc.mixer` hacía:

```sh
alsactl --file ~/.config/asound.state restore
```

Ese script lo ejecuta el usuario **`repeater`**, cuyo HOME es `/home/irlp/`. Así que el
`~` resolvía a `/home/irlp/.config/asound.state`, **que no existía** (el fichero bueno
estaba en `/root/.config/`).

**El detalle que lo explica todo:** cuando `alsactl restore` no encuentra el fichero de
estado **no se queda quieto** — cae en su rutina de inicialización ("Hardware is
initialized using a generic method") y aplica los **valores de fábrica** del driver. De
ahí que siempre acabara en el mismo número. Y como `rc.mixer` se invoca desde `end`,
`connect_to_reflector` y `experimental_call`, el nivel se caía en **cada conexión y
desconexión**.

## Segunda causa (encadenada)

Al probar el arreglo apareció otra: `alsactl` serializa con el fichero de bloqueo
`/var/lock/asound.state.lock`. Si lo crea `root` (0644), **`repeater` no puede abrirlo**,
`alsactl` falla con `lock error: File exists` y **vuelve a caer en el init genérico**. Por
sí sola habría bastado para mantener la avería. Se resolvió con `--no-lock` (la
restauración es de sólo lectura, el bloqueo no aporta nada ahí).

## Por qué los intentos anteriores no aguantaban

Había **cuatro** puntos que restauraban niveles, cada uno leyendo un **fichero distinto**.
El único que se dispara durante la operación normal era, justo, el roto:

| Cuándo | Quién | Fichero | ¿Existía? |
|---|---|---|---|
| Login de root | `/root/.bashrc` | `/root/.config/asound1.state` | ✅ |
| Arranque (×2) | `/etc/rc.local` | `/root/.config/asound.state` | ✅ |
| Arranque de IRLP | `rc.irlp` → `MIXER_LOAD` | `/var/lib/alsa/asound.state` | ✅ |
| **Conexión/desconexión** | **`rc.mixer`** | `/home/irlp/.config/asound.state` | ❌ **no** |

Además, la línea de `/root/.bashrc` **ocultaba el fallo**: reponía el nivel al entrar por
SSH, así que el estado averiado era inobservable desde un login.

## Solución aplicada

Un **único fichero canónico**, `/var/lib/alsa/asound.state`, y todos los puntos apuntando
ahí con **ruta absoluta** (así el HOME de quien ejecute deja de importar):

- **`rc.mixer`**: ruta absoluta + `--no-lock` + una **guarda que comprueba que el fichero
  existe** antes de llamar a `alsactl` (si algún día falta, mejor no restaurar que
  reinicializar la tarjeta).
- **`/etc/rc.local`**: una sola restauración (antes dos), ruta absoluta.
- **`/root/.bashrc`**: comentada la línea parche.
- **`MIXER_LOAD`** (en `custom/environment`): sin cambios; `alsactl restore` sin `--file`
  ya usa el canónico.

Copias de seguridad de los originales en `/root/backup-audio-20260817-101031`.

## Verificación

Bajando primero a 44 y ejecutando cada ruta:

| Ruta | Resultado |
|---|---|
| `rc.mixer` como `repeater` (la que fallaba) | 44 → 110, salida 0 (antes daba 99) |
| `MIXER_LOAD` como root | 44 → 110, salida 0 |
| Restauración de `/etc/rc.local` | 44 → 110, salida 0 |

Sobrevive a reinicios: tras el apagón del 2026-08-17 arrancó con `Speaker 110` correcto.

## Cómo cambiar los niveles (¡son DOS pasos!)

```sh
alsamixer        # ajustar
alsactl store    # como root — congela en /var/lib/alsa/asound.state
```

Sin `--file` y sin `~`: `alsactl store` escribe por omisión justo en el fichero que leen
los tres puntos de restauración. **Si se ajusta y no se guarda, la siguiente conexión
devuelve el valor almacenado.**

## Descartado con pruebas (para no repetir la investigación)

- `ispeaker` / `imike`: abren `/dev/mixer` y corren con `libaoss`, pero el desensamblado
  **no contiene ni un ioctl de volumen** OSS.
- `dtmf`: sólo `SOUND_MIXER_WRITE_RECSRC` (la fuente de grabación, nunca un nivel).
- Re-enumeración del fob USB: `dmesg` no registra ninguna desde el arranque.
- `alsa-restore.service` / `alsa-state.service`: *masked*.
- Regla udev `90-alsa-restore.rules`: cae en la rama `nrestore`, inerte sin demonio.

## Herramienta que quedó

`/root/mixerwatch.sh` — vigilante que registra en `/root/mixerwatch.log` cualquier cambio
de niveles con hora y contexto de procesos:

```sh
systemd-run --unit=mixerwatch --collect --nice=15 /root/mixerwatch.sh   # arrancar
systemctl stop mixerwatch                                               # parar
```

Es una unidad transitoria: no sobrevive a un reinicio.

## Pendientes (vistos de paso)

- Arranca un **PulseAudio** solo con cada `aplay` de IRLP (usuario `repeater`) y mueve el
  `Speaker` ±1 paso por redondeo. Con `flat-volumes = yes` (el defecto) podría arrastrar
  más. Se saca de la ruta con `autospawn = no` + un `/etc/asound.conf` que fije el
  dispositivo por omisión a `hw:0`, sin desinstalar nada.
- `dmesg` muestra `Under-voltage detected!`: vigilar la fuente de alimentación de la Pi.
