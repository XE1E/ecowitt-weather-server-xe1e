#!/usr/bin/env bash
# Respaldo a Cloudflare R2 del HISTÓRICO de análisis del cielo
# (<camera_dir>/analysis/YYYY-MM-DD.json). En el VPS ya se retiene para siempre
# por omisión (camera_analysis_retention_days=0); en R2 la retención es propia
# (r2_analisis_retention_days, editable en Admin → Sistema → Respaldos; 0 =
# para siempre, el valor por omisión — es el registro más barato de la cámara,
# ~6-10 KB/día).
# Ver docs/internal/PLAN-RESPALDO-R2.md.
#
# Uso:   ./scripts/backup-camera-analisis.sh
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
  echo "[backup-analisis] AVISO: 'rclone' no está instalado; se omite." >&2
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "[backup-analisis] copiando $CAMERA_DIR/analysis desde el contenedor..."
if ! docker compose cp "receiver:$CAMERA_DIR/analysis" "$WORKDIR/analysis" 2>/dev/null; then
  echo "[backup-analisis] no hay histórico de análisis que respaldar todavía."
  exit 0
fi

REMOTE="$(r2_remote)"
DESTPATH="${R2_BUCKET}/camara/analisis"
echo "[backup-analisis] subiendo a R2: $DESTPATH/ (nunca se borra en destino; la retención la aplica la purga de abajo)"
rclone copy "$WORKDIR/analysis" "${REMOTE}${DESTPATH}/" --s3-no-check-bucket

prune_r2_by_date "${REMOTE}${DESTPATH}/" "${R2_ANALISIS_RETENTION_DAYS:-0}"

echo "[backup-analisis] listo."
mark_backup_success analisis "retención R2: ${R2_ANALISIS_RETENTION_DAYS:-0} días (0=para siempre)"
