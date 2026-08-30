# Plan — Respaldo externo a Cloudflare R2 (sensores, fotos, vídeos)

> Escrito el 2026-08-30. Vive en git.
>
> **Estado:** diagnóstico y capacidad medidos en el VPS real. Falta decidir la
> **política de retención en R2** (§Decisiones pendientes) antes de tocar código.
> El respaldo de InfluxDB ya tiene script y documentación (`scripts/backup-influx.sh`,
> `docs/backups-r2.md`) pero **las credenciales R2 no están configuradas** — hoy el
> cron diario sólo hace copia local. Fotos y vídeos de la cámara no tienen respaldo
> externo en absoluto.

## Objetivo

Tener, fuera del VPS, una copia de todo lo que el sitio no podría reconstruir si el
servidor se perdiera: histórico de sensores (InfluxDB), fotos y vídeos de la cámara
del exterior, y el histórico de análisis del cielo. Si el VPS desaparece hoy, todo
eso se pierde para siempre — no viene de ninguna fuente externa que se pueda volver
a descargar.

No es sobre servir estos datos desde R2 (eso sería otro proyecto): es un **respaldo**,
para recuperar si hace falta, no para consultar en el día a día.

## Qué ya existe

- **`scripts/backup-influx.sh`**: genera un `.tar.gz` con `influx backup` (formato
  nativo, se restaura con `influx restore`), rota copias locales, y si hay
  credenciales R2 en el `.env` las sube con `rclone`. Programado por cron diario
  a las 3:30 am (`crontab -l` en el VPS lo confirma corriendo).
- **`docs/backups-r2.md`**: guía completa para crear el bucket, las API keys y
  configurar `rclone` — ya escrita, sólo falta ejecutarla.
- **Lo que falta:** las variables `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` no están en el `.env` del VPS (verificado
  2026-08-30) — el script corre pero nunca sube nada, sólo rota la copia local.
  Nada de fotos, vídeos ni análisis del cielo se respalda hoy, en ningún lado.

## Capacidad medida en el VPS (2026-08-30, no estimada de memoria)

| Qué | Tamaño real hoy | Retención local actual | Por día (medido) |
|---|---|---|---|
| Fotos (JPG, cámara exterior) | 313 MB (7 días de historial) | 7 días (`CAMERA_RETENTION_DAYS`) | **~34 MB/día** |
| Timelapse (MP4) | 78 MB (~13 días desde que existe la cámara) | 90 días (`CAMERA_TIMELAPSE_RETENTION_DAYS`) | **~6 MB/día** |
| Sensores (InfluxDB, principal + remota) | 42 MB (desde jul-2026, ~2 meses) | para siempre | **~0.7 MB/día** |
| Análisis del cielo (JSON) | 128 KB (~13 días) | para siempre | **~10 KB/día** |
| Logs del receiver | 11 MB | rotan solos | — (no se recomienda respaldar: efímeros, sin valor histórico) |

**Total a respaldar: ~40 MB/día ≈ 14.6 GB/año**, dominado por las fotos (~85 % del
volumen). Los vídeos pesan poco por foto-equivalente porque son MP4 comprimido; las
fotos sueltas son JPEG sin comprimir más allá de lo que ya hace la cámara.

Método: `du -sh` dentro del contenedor `receiver` sobre `/data/camera` y sus
subcarpetas, más `docker system df -v` para el volumen de InfluxDB. Los "por día"
de fotos/timelapse salen de dividir el tamaño real entre los días que la cámara
lleva instalada (2026-08-17 → 2026-08-30, ~13 días); el de sensores, entre los días
desde que arrancó la estación (jul-2026, ~60 días). Son promedios reales medidos,
no la cifra optimista que a veces queda escrita en un plan antes de operar (ver
nota de `docs/DEPLOY.md` §8b sobre el caché de Docker, mismo error categoría:
confiar en un número de cuando se diseñó en vez de medirlo en producción).

## En qué formato respaldar cada cosa

- **Sensores:** ya resuelto, sin cambios de formato — `influx backup` en `.tar.gz`,
  restaurable con `influx restore`.
- **Fotos y timelapse:** son archivos sueltos (JPG/MP4), **no conviene empaquetarlos
  en tar**. Mejor `rclone sync` directo de `<camera_dir>/YYYY-MM-DD/` y
  `<camera_dir>/timelapse/` contra el mismo bucket R2, con prefijos propios
  (p. ej. `camara/fotos/`, `camara/timelapse/`). Ventaja sobre empaquetar: se puede
  restaurar o inspeccionar un solo día sin bajar todo el histórico, y R2 no cobra
  por objetos pequeños de forma que importe a este volumen.
- **Análisis del cielo:** JSON chico (~6-10 KB/día) — mismo mecanismo, `rclone sync`
  de `<camera_dir>/analysis/`, o meterlo dentro del backup diario de Influx si se
  prefiere un solo paquete. Dado que ya se retiene para siempre en el VPS (a
  diferencia de fotos/vídeos), perderlo sólo importa si se pierde el VPS entero —
  mismo motivo que el resto.

Los tres casos reutilizan la MISMA infraestructura (`rclone`, mismas credenciales,
mismo bucket) que ya pide `docs/backups-r2.md` — no hace falta una herramienta
nueva, sólo activar las credenciales que faltan y agregar 2-3 líneas de `rclone
sync` al script existente (o uno hermano que corra en el mismo cron).

## Costo aproximado en R2

Con ~15 GB/año acumulándose y **R2 sin costo de salida de datos** (a diferencia de
S3), el almacenamiento a este volumen cuesta centavos de dólar al mes durante
varios años. Lo que sí conviene decidir es la **retención en R2** (ver abajo): si
se guarda todo para siempre el volumen crece sin techo (aunque a este ritmo tardaría
años en ser significativo), mientras que en el VPS las fotos y vídeos ya se podan
solos.

> No se cita aquí un precio exacto por GB/mes de R2 a propósito: las tarifas de
> proveedores cloud cambian: hay que confirmar contra el panel de Cloudflare al
> momento de decidir, no contra lo que diga este documento.

## Decisiones pendientes (antes de escribir código)

1. **¿Qué retención tiene el respaldo en R2, por categoría?** Ejemplos a elegir
   entre (no son la única opción):
   - Fotos: ¿para siempre, o sólo N meses/años? (a diferencia del VPS, que las poda
     a los 7 días sí o sí).
   - Timelapse: ¿para siempre, o alinear con lo que ya dura en el VPS (90 días)?
   - Sensores y análisis del cielo: ya se retienen para siempre en el VPS, así que
     lo natural es igual para siempre en R2 (es barato, ~0.7 MB/día).
2. **¿Un solo script (`backup-influx.sh` extendido) o uno nuevo por categoría?**
   Más simple de operar un solo cron con 2-3 pasos de `rclone sync` adicionales;
   más aislado (un fallo de fotos no afecta el backup de Influx) si son scripts
   separados.
3. **¿Notificar si el respaldo falla?** Hoy `backup-influx.sh` sólo escribe a un
   log (`~/ecowitt-backups/backup.log`); nadie lo revisa a menos que se acuerde.
   Se podría enganchar a las alertas de Telegram/correo que ya existen para la
   cámara (mismo patrón que "cámara sin señal").

## Siguiente paso concreto

1. Decidir la retención por categoría (punto 1 de arriba) — es lo único que de
   verdad requiere una decisión humana; el resto es mecánico.
2. Crear el bucket y las API keys en Cloudflare (`docs/backups-r2.md` §1) y
   poner las variables en el `.env` del VPS (§2 del mismo doc) — esto por sí solo
   ya activa el respaldo de InfluxDB que estaba escrito pero apagado.
3. Extender `scripts/backup-influx.sh` (o agregar un script hermano) con los
   `rclone sync` de fotos/timelapse/análisis, con los prefijos y la retención
   decididos en el punto 1.
