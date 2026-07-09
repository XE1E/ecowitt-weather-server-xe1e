# Backups a Cloudflare R2

El script `scripts/backup-influx.sh` genera un `.tar.gz` de InfluxDB, conserva
los últimos locales (rotación) y —si hay credenciales R2— **lo sube a Cloudflare
R2**, de modo que exista una copia **fuera del VPS**. Así, si el servidor se
pierde, el histórico sigue a salvo.

## 1. Crear el bucket y las claves en Cloudflare

1. En el panel de Cloudflare → **R2** → *Create bucket* (p. ej. `ecowitt-backups`).
2. **R2 → Manage R2 API Tokens → Create API token** (permiso *Object Read & Write*).
   Copia el **Access Key ID** y el **Secret Access Key**.
3. Anota tu **Account ID** (aparece en R2; el endpoint es
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

## 2. Configurar el `.env` del VPS

```
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=ecowitt-backups
R2_PREFIX=influx
R2_KEEP=30
```

## 3. Instalar rclone (una vez)

```bash
sudo apt-get update && sudo apt-get install -y rclone
# o:  curl https://rclone.org/install.sh | sudo bash
```

No hace falta `rclone config`: el script usa las credenciales del `.env`
mediante una conexión S3 en línea (proveedor Cloudflare).

## 4. Probar

```bash
./scripts/backup-influx.sh
```

Debe crear el `.tar.gz` local y mostrar `subiendo a R2:` / `subida completa`.
Verifica en el panel de R2 que aparece el objeto bajo `influx/`.

## 5. Programar con cron (diario, 03:15)

```bash
crontab -e
# añade:
15 3 * * * /bin/bash ~/ecowitt-weather-server-xe1e/scripts/backup-influx.sh >> ~/ecowitt-backups/backup.log 2>&1
```

## Retención

- **Local:** `BACKUP_KEEP` (default 7).
- **En R2:** `R2_KEEP` (default 30) — el script purga los objetos más antiguos.
  También puedes poner una **regla de ciclo de vida** en el bucket R2 para borrar
  automáticamente objetos con más de N días.

## Restaurar

```bash
# Descargar un backup desde R2 (con rclone ya configurado o inline) y extraer:
tar -xzf influx-YYYYMMDD-HHMMSS.tar.gz
# Copiar al contenedor y restaurar:
docker compose cp influx-YYYYMMDD-HHMMSS ecowitt-influxdb:/tmp/restore
docker compose exec -T influxdb influx restore /tmp/restore -t "$INFLUXDB_TOKEN" --full
```

> Nota: `--full` restaura todo. Para restaurar solo el bucket, consulta
> `influx restore --help` (opción `--bucket`).
