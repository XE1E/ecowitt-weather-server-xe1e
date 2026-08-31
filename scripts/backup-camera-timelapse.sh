#!/usr/bin/env bash
# Respaldo a Cloudflare R2 del TIMELAPSE de la cámara del exterior
# (<camera_dir>/timelapse/*.mp4 + su .jpg/.json). El VPS poda estos vídeos a
# los 90 días (camera_timelapse_retention_days) pero en R2 la retención es
# propia (r2_timelapse_retention_days, editable en Admin → Sistema →
# Respaldos; 0 = para siempre, el valor por omisión).
# Ver docs/internal/PLAN-RESPALDO-R2.md.
#
# Uso:   ./scripts/backup-camera-timelapse.sh
# Cron:  ver docs/backups-r2.md

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"
source "$REPO_DIR/scripts/lib-backup.sh"

CAMERA_DIR="$(getenv CAMERA_DIR)"; CAMERA_DIR="${CAMERA_DIR:-/data/camera}"

if ! fetch_r2_config; then
  exit 0
fi
if ! command -v rclone >/dev/null 2>&1; then
  echo "[backup-timelapse] AVISO: 'rclone' no está instalado; se omite." >&2
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "[backup-timelapse] copiando $CAMERA_DIR/timelapse desde el contenedor..."
if ! docker compose cp "receiver:$CAMERA_DIR/timelapse" "$WORKDIR/timelapse" 2>/dev/null; then
  echo "[backup-timelapse] no hay carpeta de timelapse que respaldar todavía."
  exit 0
fi

REMOTE="$(r2_remote)"
DESTPATH="${R2_BUCKET}/camara/timelapse"
echo "[backup-timelapse] subiendo a R2: $DESTPATH/ (nunca se borra en destino; la retención la aplica la purga de abajo)"
rclone copy "$WORKDIR/timelapse" "${REMOTE}${DESTPATH}/" --s3-no-check-bucket

prune_r2_by_date "${REMOTE}${DESTPATH}/" "${R2_TIMELAPSE_RETENTION_DAYS:-0}"

echo "[backup-timelapse] listo."
mark_backup_success timelapse "retención R2: ${R2_TIMELAPSE_RETENTION_DAYS:-0} días (0=para siempre)"
