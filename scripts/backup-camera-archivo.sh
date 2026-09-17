#!/usr/bin/env bash
# Respaldo a Cloudflare R2 del ARCHIVO PERMANENTE de "1 foto por día"
# (<camera_dir>/archive/YYYY-MM-DD.jpg). En el VPS se guarda para siempre
# (services/camera.py: archive_best_photo); en R2 la retención es propia
# (r2_archivo_retention_days, editable en Admin → Sistema → Respaldos; 0 =
# para siempre, el valor por omisión). Es la única copia de fotos que la
# efeméride "En este día" del dashboard necesita más allá de los 7 días que
# duran las capturas completas -- sin este respaldo, un disco de VPS perdido
# se llevaría fotos que en las demás carpetas ya se dan por desechables.
# Ver docs/internal/PLAN-RESPALDO-R2.md.
#
# Uso:   ./scripts/backup-camera-archivo.sh
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
  echo "[backup-archivo] AVISO: 'rclone' no está instalado; se omite." >&2
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "[backup-archivo] copiando $CAMERA_DIR/archive desde el contenedor..."
if ! docker compose cp "receiver:$CAMERA_DIR/archive" "$WORKDIR/archive" 2>/dev/null; then
  echo "[backup-archivo] no hay fotos archivadas que respaldar todavía."
  exit 0
fi

REMOTE="$(r2_remote)"
DESTPATH="${R2_BUCKET}/camara/archivo"
echo "[backup-archivo] subiendo a R2: $DESTPATH/ (nunca se borra en destino; la retención la aplica la purga de abajo)"
rclone copy "$WORKDIR/archive" "${REMOTE}${DESTPATH}/" --s3-no-check-bucket

prune_r2_by_date "${REMOTE}${DESTPATH}/" "${R2_ARCHIVO_RETENTION_DAYS:-0}"

echo "[backup-archivo] listo."
mark_backup_success archivo "retención R2: ${R2_ARCHIVO_RETENTION_DAYS:-0} días (0=para siempre)"
