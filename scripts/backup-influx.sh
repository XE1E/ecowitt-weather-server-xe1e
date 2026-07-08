#!/usr/bin/env bash
# Backup de la base de datos InfluxDB del stack Ecowitt.
# Genera un .tar.gz con timestamp y conserva solo los últimos N (rotación).
#
# Uso:   ./scripts/backup-influx.sh
# Cron:  ver docs/DEPLOY.md (sección Backups)
#
# Variables opcionales:
#   BACKUP_DIR   destino de los backups (default: $HOME/ecowitt-backups)
#   BACKUP_KEEP  cuántos backups conservar (default: 7)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

if [ ! -f .env ]; then
  echo "[backup] ERROR: no encuentro .env en $REPO_DIR" >&2
  exit 1
fi

TOKEN="$(grep -E '^INFLUXDB_TOKEN=' .env | cut -d= -f2-)"
if [ -z "$TOKEN" ]; then
  echo "[backup] ERROR: INFLUXDB_TOKEN vacío en .env" >&2
  exit 1
fi

DEST="${BACKUP_DIR:-$HOME/ecowitt-backups}"
KEEP="${BACKUP_KEEP:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

echo "[backup] generando backup de InfluxDB..."
docker compose exec -T influxdb influx backup /tmp/wxb -t "$TOKEN" >/dev/null
docker compose cp influxdb:/tmp/wxb "$DEST/influx-$STAMP" >/dev/null
docker compose exec -T influxdb rm -rf /tmp/wxb

tar -C "$DEST" -czf "$DEST/influx-$STAMP.tar.gz" "influx-$STAMP"
rm -rf "$DEST/influx-$STAMP"

# Rotación: conservar solo los últimos KEEP
ls -1t "$DEST"/influx-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "[backup] listo -> $DEST/influx-$STAMP.tar.gz"
ls -lh "$DEST"/influx-*.tar.gz
