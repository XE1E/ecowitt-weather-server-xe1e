# Plan — Respaldo externo a Cloudflare R2 (sensores, fotos, vídeos)

> Escrito el 2026-08-30. Vive en git.
>
> **Estado (2026-08-30): implementado.** Las 3 decisiones pendientes de la primera
> versión de este plan ya se tomaron (§Decisiones tomadas) y el código está escrito:
> 4 scripts (`scripts/backup-influx.sh` + `scripts/backup-camera-{fotos,timelapse,analisis}.sh`),
> credenciales y retención editables desde Admin → Sistema → Respaldos, alerta de
> "respaldo desactualizado" en Admin → Alertas. **Falta la parte que sólo puede hacer
> un humano en el VPS real** (§Siguiente paso concreto): crear el bucket/API keys en
> Cloudflare, ponerlas en Admin, generar `BACKUP_API_TOKEN` (en ambos lados), instalar
> `rclone` y programar el cron. Ver `docs/backups-r2.md` para los pasos exactos.

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

## Decisiones tomadas (2026-08-30)

1. **Retención en R2, por categoría:**
   - Fotos: **7 días, igual que el VPS** (`camera_retention_days`) — sin ajuste
     propio en R2, el script sólo sube lo que exista hoy en el contenedor.
   - Timelapse: **para siempre** (como sensores), con retención propia opcional
     (`r2_timelapse_retention_days`, editable en Admin, 0 = para siempre).
   - Sensores y análisis del cielo: **para siempre** — análisis también con
     retención propia opcional (`r2_analisis_retention_days`).
2. **Un script por categoría** (`scripts/backup-camera-{fotos,timelapse,analisis}.sh`,
   además de `scripts/backup-influx.sh`), no uno solo extendido: un fallo de fotos
   no afecta el backup de InfluxDB. Comparten helpers en `scripts/lib-backup.sh`.
3. **Notificación:** se reutiliza el mismo canal de alertas (Telegram/correo) que
   ya existe para "cámara sin señal", pero con vigilancia de FRESCURA en vez de
   push-on-failure: el receiver revisa periódicamente cuándo fue la última corrida
   exitosa de cada categoría (`AlertService.check_backup_stale`) y avisa si pasa de
   `alert_backup_stale_hours` (Admin → Alertas, 30h por omisión). Cubre tanto un
   fallo real como un cron que dejó de correr — lo segundo se le habría escapado a
   un aviso que sólo dispara desde dentro del script que falló.

Decisión adicional, no prevista en la primera versión de este plan: las
credenciales de R2 (y la retención) terminaron siendo **editables desde Admin**
(Sistema → Respaldos), no solo en el `.env` como se planteó al principio. Como los
scripts corren fuera del contenedor y no pueden leer `settings.json`, se agregó un
endpoint interno (`GET /api/backup/r2-credentials`) protegido con un token propio
(`backup_api_token`/`BACKUP_API_TOKEN`, el único secreto que sigue viviendo en el
`.env` — ver docs/backups-r2.md §2).

## Pendiente (fuera de este plan, evaluado y diferido)

**Vigilar la cuota del tier gratis de Cloudflare R2** (cuánto storage/operaciones
llevas usados vs. el límite gratis): posible vía la API GraphQL de Analytics de
Cloudflare, pero requiere un Cloudflare API Token DISTINTO a las claves S3 de R2
(scope de Account Analytics), que el usuario tendría que crear a mano. Diferido
2026-08-30 porque al ritmo medido (~15 GB/año) falta mucho para acercarse a un
tier gratis típico (~10 GB) — no es urgente.

## Siguiente paso concreto (sólo posible en el VPS real)

1. Crear el bucket y las API keys en Cloudflare (`docs/backups-r2.md` §1).
2. Ponerlas en Admin → Sistema → Respaldos (Account ID, Access Key ID, Secret
   Access Key, Bucket) — ahí mismo ajustar la retención en R2 si no se quieren los
   valores por omisión.
3. Generar `BACKUP_API_TOKEN` y ponerlo EN LOS DOS LADOS: `.env` del VPS y Admin →
   Sistema → Respaldos (§2 de `docs/backups-r2.md`).
4. Instalar `rclone` en el VPS (§3 del mismo doc).
5. Probar los 4 scripts a mano (§4) y programar el cron (§5).
