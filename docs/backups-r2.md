# Backups a Cloudflare R2

Cuatro scripts respaldan, cada uno una categoría, **fuera del VPS**: si el servidor
se pierde, el histórico sigue a salvo. Ver el diagnóstico completo y las decisiones
de retención en `docs/internal/PLAN-RESPALDO-R2.md`.

| Script | Qué respalda | Retención en R2 |
|---|---|---|
| `scripts/backup-influx.sh` | Histórico de sensores (InfluxDB) | por cantidad (`r2_influx_keep`, 30 por omisión) |
| `scripts/backup-camera-fotos.sh` | Fotos del día (`<camera_dir>/YYYY-MM-DD/`) | igual que en el VPS (`camera_retention_days`) — sin ajuste propio |
| `scripts/backup-camera-timelapse.sh` | Vídeos del timelapse | por días (`r2_timelapse_retention_days`, 0 = para siempre) |
| `scripts/backup-camera-analisis.sh` | Histórico JSON del análisis del cielo | por días (`r2_analisis_retention_days`, 0 = para siempre) |

Los cuatro comparten helpers en `scripts/lib-backup.sh` (credenciales, el remote de
`rclone`, marcar una corrida como exitosa).

## 1. Crear el bucket y las claves en Cloudflare

1. En el panel de Cloudflare → **R2** → *Create bucket* (p. ej. `ecowitt-backups`).
2. **R2 → Manage R2 API Tokens → Create API token** (permiso *Object Read & Write*).
   Copia el **Access Key ID** y el **Secret Access Key**.
3. Anota tu **Account ID** (aparece en R2; el endpoint es
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

## 2. Configurar las credenciales — Admin, NO el `.env`

A diferencia de antes, las credenciales de R2 **no se ponen en el `.env`**: se
configuran desde el panel → **Sistema → Respaldos** (Account ID, Access Key ID,
Secret Access Key, Bucket) y quedan en `settings.json`, igual que las claves de
Gemini/Anthropic. Ahí mismo se ajusta la retención en R2 (timelapse, análisis,
cuántos backups de Influx conservar).

Los scripts corren por cron en el VPS, **fuera** del contenedor, y no pueden leer
`settings.json` (vive dentro del volumen Docker). Por eso piden las credenciales
al propio receiver vía `GET http://localhost:8080/api/backup/r2-credentials`
(mismo puerto directo al dashboard que ya usa `docs/DEPLOY.md` para probar la API
desde el VPS — el `:80`/`:443` los atiende Caddy, que fuerza HTTPS con el
certificado del dominio real y no sirve para pegarle a "localhost"), autenticado
con un token propio — no el del panel de administración, para que si se filtra
sólo permita leer estas credenciales.

Ese token sí va en el `.env` del VPS, porque es lo único que un script fuera del
contenedor necesita para arrancar la cadena:

```bash
# Genera uno:
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Pon el mismo valor en **dos lugares**:
- `.env` del VPS → `BACKUP_API_TOKEN=...`
- Admin → Sistema → Respaldos → *Token de API de respaldo*

Si algún día hay que rotarlo, cambia ambos a la vez (un valor desincronizado deja
los scripts sin poder pedir las credenciales, con un aviso claro en su log).

## 3. Instalar rclone (una vez)

```bash
sudo apt-get update && sudo apt-get install -y rclone
# o:  curl https://rclone.org/install.sh | sudo bash
```

No hace falta `rclone config`: los scripts arman la conexión S3 (proveedor
Cloudflare) en caliente, con las credenciales que acaban de pedir por API.

## 4. Probar

```bash
./scripts/backup-influx.sh
./scripts/backup-camera-fotos.sh
./scripts/backup-camera-timelapse.sh
./scripts/backup-camera-analisis.sh
```

Cada uno debe terminar con `listo.` y, si subió algo, mostrar `subiendo a R2:` /
`sincronizando con R2:`. Verifica en el panel de R2 que aparecen los objetos bajo
`influx/`, `camara/fotos/`, `camara/timelapse/` y `camara/analisis/`. En el panel
de Admin (Sistema → Respaldos) debe aparecer "Última: hace unos segundos" en las
cuatro categorías.

## 5. Programar con cron

```bash
crontab -e
# añade (InfluxDB a las 3:15, cámara escalonada detrás para no pisarse):
15 3 * * * /bin/bash ~/ecowitt-weather-server-xe1e/scripts/backup-influx.sh >> ~/ecowitt-backups/backup.log 2>&1
20 3 * * * /bin/bash ~/ecowitt-weather-server-xe1e/scripts/backup-camera-fotos.sh >> ~/ecowitt-backups/backup.log 2>&1
25 3 * * * /bin/bash ~/ecowitt-weather-server-xe1e/scripts/backup-camera-timelapse.sh >> ~/ecowitt-backups/backup.log 2>&1
30 3 * * * /bin/bash ~/ecowitt-weather-server-xe1e/scripts/backup-camera-analisis.sh >> ~/ecowitt-backups/backup.log 2>&1
```

## Retención

- **Local (VPS):** `BACKUP_KEEP` para InfluxDB (default 7); `camera_retention_days`
  para fotos y `camera_timelapse_retention_days` para timelapse (Admin → Cámara).
  El análisis no se poda en el VPS por omisión.
- **En R2:** desde Admin → Sistema → Respaldos — `r2_influx_keep` (por cantidad),
  `r2_timelapse_retention_days` y `r2_analisis_retention_days` (por días, 0 = para
  siempre). Fotos no tiene ajuste propio: el script sólo sube lo que exista hoy en
  el VPS, así que ya sigue automáticamente `camera_retention_days`.

## Si un respaldo falla o el cron deja de correr

El receiver revisa periódicamente (mismo mecanismo que "cámara sin señal") cuándo
fue la última corrida exitosa de cada categoría, leyendo el estado que cada script
deja en el volumen tras terminar bien. Si alguna lleva más de `alert_backup_stale_hours`
(Admin → Alertas → 💾 Respaldo a R2, 30 h por omisión) sin una corrida exitosa,
avisa por Telegram/correo — y también cuando se pone al día. Esto cubre tanto un
fallo real (rclone, credenciales vencidas) como un cron que simplemente dejó de
disparar.

## Restaurar

```bash
# Descargar un backup de InfluxDB desde R2 (con rclone) y extraer:
tar -xzf influx-YYYYMMDD-HHMMSS.tar.gz
# Copiar al contenedor y restaurar:
docker compose cp influx-YYYYMMDD-HHMMSS ecowitt-influxdb:/tmp/restore
docker compose exec -T influxdb influx restore /tmp/restore -t "$INFLUXDB_TOKEN" --full
```

> Nota: `--full` restaura todo. Para restaurar solo el bucket, consulta
> `influx restore --help` (opción `--bucket`).

Fotos/timelapse/análisis son archivos sueltos: basta con `rclone copy` desde el
prefijo correspondiente (`camara/fotos/YYYY-MM-DD/`, etc.) de vuelta al volumen del
contenedor, sin pasar por `tar`.

## Pendiente

Vigilar el uso/cuota del tier gratis de Cloudflare R2 requeriría un Cloudflare API
Token aparte (no las claves S3 de arriba) y la API GraphQL de Analytics de
Cloudflare — deliberadamente no implementado aún: al ritmo medido (~15 GB/año) falta
mucho para acercarse a un tier gratis típico. Ver `docs/internal/PLAN-RESPALDO-R2.md`.
