#!/usr/bin/env bash
# Respaldo a Cloudflare R2 de las FOTOS de la cámara del exterior (carpetas
# YYYY-MM-DD dentro de <camera_dir>). Sin ajuste de retención propio: la
# retención en R2 es la MISMA que en el VPS (camera_retention_days, editable en
# Admin → Cámara) — el script sólo respalda las carpetas de día que existan hoy
# en el contenedor, así que un `rclone sync` simple ya mantiene R2 igual de
# podado que el disco local, sin lógica de purga propia.
# Ver docs/internal/PLAN-RESPALDO-R2.md.
#
# Uso:   ./scripts/backup-camera-fotos.sh
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
  echo "[backup-fotos] AVISO: 'rclone' no está instalado; se omite." >&2
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "[backup-fotos] listando carpetas de días en el contenedor..."
DAYS="$(docker compose exec -T receiver sh -c "ls -1 '$CAMERA_DIR' 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\$'" || true)"

if [ -z "$DAYS" ]; then
  echo "[backup-fotos] no hay carpetas de fotos que respaldar todavía."
  exit 0
fi

while IFS= read -r DAY; do
  [ -z "$DAY" ] && continue
  docker compose cp "receiver:$CAMERA_DIR/$DAY" "$WORKDIR/$DAY" >/dev/null
done <<< "$DAYS"

REMOTE="$(r2_remote)"
DESTPATH="${R2_BUCKET}/camara/fotos"
echo "[backup-fotos] sincronizando con R2: $DESTPATH/ (mismo retención que el VPS; se borra lo que ya no está)"
rclone sync "$WORKDIR" "${REMOTE}${DESTPATH}/" --s3-no-check-bucket

echo "[backup-fotos] listo."
mark_backup_success fotos "$(echo "$DAYS" | wc -l) días"
