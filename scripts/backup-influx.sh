#!/usr/bin/env bash
# Backup de la base de datos InfluxDB del stack Ecowitt.
# Genera un .tar.gz con timestamp, conserva solo los últimos N (rotación local)
# y —si hay credenciales R2— lo sube a Cloudflare R2 (backup fuera del VPS).
#
# Uso:   ./scripts/backup-influx.sh
# Cron:  ver docs/backups-r2.md
#
# Variables opcionales (env o .env):
#   BACKUP_DIR   destino local (default: $HOME/ecowitt-backups)
#   BACKUP_KEEP  cuántos backups locales conservar (default: 7)
# Subida a R2 (opcional; si faltan, el backup solo es local):
#   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
#   R2_PREFIX (default: influx)   R2_KEEP (default: 30)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

if [ ! -f .env ]; then
  echo "[backup] ERROR: no encuentro .env en $REPO_DIR" >&2
  exit 1
fi

# Lee una clave del .env (o del entorno si ya está exportada)
getenv() {
  local v="${!1:-}"
  if [ -z "$v" ]; then v="$(grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"')"; fi
  printf '%s' "$v"
}

TOKEN="$(getenv INFLUXDB_TOKEN)"
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

# Rotación local: conservar solo los últimos KEEP
ls -1t "$DEST"/influx-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "[backup] listo -> $DEST/influx-$STAMP.tar.gz"
ls -lh "$DEST"/influx-*.tar.gz

# --- Subida opcional a Cloudflare R2 (S3-compatible) vía rclone ---
R2_ACCOUNT_ID="$(getenv R2_ACCOUNT_ID)"
R2_ACCESS_KEY_ID="$(getenv R2_ACCESS_KEY_ID)"
R2_SECRET_ACCESS_KEY="$(getenv R2_SECRET_ACCESS_KEY)"
R2_BUCKET="$(getenv R2_BUCKET)"
R2_PREFIX="$(getenv R2_PREFIX)"; R2_PREFIX="${R2_PREFIX:-influx}"
R2_KEEP="$(getenv R2_KEEP)"; R2_KEEP="${R2_KEEP:-30}"

if [ -n "$R2_BUCKET" ] && [ -n "$R2_ACCOUNT_ID" ] && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "[backup] AVISO: R2 configurado pero 'rclone' no está instalado; se omite la subida." >&2
  else
    ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    REMOTE=":s3,provider=Cloudflare,access_key_id=${R2_ACCESS_KEY_ID},secret_access_key=${R2_SECRET_ACCESS_KEY},endpoint=${ENDPOINT}:"
    DESTPATH="${R2_BUCKET}/${R2_PREFIX}"
    echo "[backup] subiendo a R2: $DESTPATH/"
    rclone copy "$DEST/influx-$STAMP.tar.gz" "${REMOTE}${DESTPATH}/" --s3-no-check-bucket
    # Purga remota: conservar solo los últimos R2_KEEP
    rclone lsf "${REMOTE}${DESTPATH}/" 2>/dev/null | grep '^influx-.*\.tar\.gz$' | sort -r \
      | tail -n +"$((R2_KEEP + 1))" | while read -r OLD; do
        echo "[backup] R2: eliminando $OLD"
        rclone deletefile "${REMOTE}${DESTPATH}/$OLD" 2>/dev/null || true
      done
    echo "[backup] R2: subida completa."
  fi
fi
