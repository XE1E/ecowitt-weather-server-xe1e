#!/usr/bin/env bash
# Respaldo a Cloudflare R2 del sitio estático rubik.xe1e.net (/opt/rubik-site
# en el VPS) -- sin relación con la estación, ver caddy/Caddyfile. Vive fuera
# del repo a propósito, así que este script sólo sincroniza esa carpeta del
# HOST directo (no hay contenedor de por medio, a diferencia de los otros
# backup-*.sh). Usa el MISMO bucket/credenciales de R2 ya configurados en
# Admin -> Sistema -> Respaldos, bajo su propio prefijo (rubik-site/).
# Ver docs/internal/PLAN-RESPALDO-R2.md.
#
# Uso:   ./scripts/backup-rubik-site.sh
# Cron:  ver docs/backups-r2.md

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"
source "$REPO_DIR/scripts/lib-backup.sh"

RUBIK_DIR="/opt/rubik-site"

if ! fetch_r2_config; then
  exit 0
fi
if ! command -v rclone >/dev/null 2>&1; then
  echo "[backup-rubik-site] AVISO: 'rclone' no está instalado; se omite." >&2
  exit 0
fi
if [ ! -d "$RUBIK_DIR" ]; then
  echo "[backup-rubik-site] $RUBIK_DIR no existe; nada que respaldar."
  exit 0
fi

REMOTE="$(r2_remote)"
DESTPATH="${R2_BUCKET}/rubik-site"
echo "[backup-rubik-site] sincronizando $RUBIK_DIR con R2: $DESTPATH/"
rclone sync "$RUBIK_DIR" "${REMOTE}${DESTPATH}/" --s3-no-check-bucket

echo "[backup-rubik-site] listo."
