#!/usr/bin/env bash
# Helpers compartidos por scripts/backup-influx.sh y scripts/backup-camera-*.sh.
# Ver docs/internal/PLAN-RESPALDO-R2.md y docs/backups-r2.md.
#
# Uso:  source "$(dirname "$0")/lib-backup.sh"
#
# Las credenciales de R2 se configuran desde el panel de Admin (Sistema →
# Respaldos), NO en el .env: este archivo sólo necesita BACKUP_API_TOKEN (un
# token propio, ver docs/backups-r2.md) para pedirlas vía API cada vez que
# corre un script. Así, rotar las claves de R2 no requiere tocar el VPS a mano.

# Lee una clave del .env del repo (o del entorno si ya está exportada).
getenv() {
  local v="${!1:-}"
  if [ -z "$v" ]; then v="$(grep -E "^$1=" "$REPO_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"; fi
  printf '%s' "$v"
}

# Extrae un campo de un JSON plano de un nivel (sin objetos/arrays anidados),
# suficiente para la respuesta de /api/backup/r2-credentials. Evita depender de
# `jq`, que no está entre las herramientas ya requeridas por este repo.
json_field() {
  local json="$1" key="$2" val
  val="$(printf '%s' "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\(\"[^\"]*\"\|null\|[0-9.]*\)" | head -1 \
    | sed -E "s/\"$key\"[[:space:]]*:[[:space:]]*//; s/^\"//; s/\"\$//")"
  [ "$val" = "null" ] && val=""
  printf '%s' "$val"
}

# Pide las credenciales R2 (y la retención configurada) al propio receiver.
# Rellena R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET /
# R2_TIMELAPSE_RETENTION_DAYS / R2_ANALISIS_RETENTION_DAYS / R2_INFLUX_KEEP.
# Devuelve 1 si BACKUP_API_TOKEN no está puesto o la llamada falla.
fetch_r2_config() {
  local token base_url resp
  token="$(getenv BACKUP_API_TOKEN)"
  if [ -z "$token" ]; then
    echo "[backup] BACKUP_API_TOKEN vacío en .env; ver docs/backups-r2.md" >&2
    return 1
  fi
  # localhost:8080 es el dashboard (nginx) publicado directo en el host, sin
  # pasar por Caddy (que en :80/:443 fuerza HTTPS con el certificado del
  # dominio real, no de "localhost") — mismo puerto que ya usa docs/DEPLOY.md
  # para probar la API desde el propio VPS. BACKUP_API_URL permite apuntar a
  # otro host si hiciera falta.
  base_url="${BACKUP_API_URL:-http://localhost:8080/api/backup/r2-credentials}"
  resp="$(curl -fsS --max-time 10 -H "X-Backup-Token: $token" "$base_url")" || {
    echo "[backup] no se pudo contactar $base_url" >&2
    return 1
  }
  R2_ACCOUNT_ID="$(json_field "$resp" r2_account_id)"
  R2_ACCESS_KEY_ID="$(json_field "$resp" r2_access_key_id)"
  R2_SECRET_ACCESS_KEY="$(json_field "$resp" r2_secret_access_key)"
  R2_BUCKET="$(json_field "$resp" r2_bucket)"
  R2_TIMELAPSE_RETENTION_DAYS="$(json_field "$resp" r2_timelapse_retention_days)"
  R2_ANALISIS_RETENTION_DAYS="$(json_field "$resp" r2_analisis_retention_days)"
  R2_INFLUX_KEEP="$(json_field "$resp" r2_influx_keep)"
  [ -z "$R2_BUCKET" ] && { echo "[backup] R2 no configurado en Admin (Sistema → Respaldos); nada que hacer." && return 1; }
  return 0
}

# Arma el remote de rclone (S3 compatible) para Cloudflare R2 a partir de las
# variables que dejó fetch_r2_config.
r2_remote() {
  local endpoint
  # El campo de Admin pide sólo el Account ID, pero Cloudflare lo muestra en el
  # dashboard pegado al endpoint completo (https://<id>.r2.cloudflarestorage.com)
  # y es fácil copiar ese en vez del ID solo. Si ya viene como URL, se usa tal cual.
  if [[ "$R2_ACCOUNT_ID" == http*://* ]]; then
    endpoint="$R2_ACCOUNT_ID"
  else
    endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  fi
  printf ':s3,provider=Cloudflare,access_key_id=%s,secret_access_key=%s,endpoint=%s:' \
    "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" "$endpoint"
}

# Marca la corrida de una categoría como exitosa: lo lee el receiver (Admin y
# la alerta de "respaldo desactualizado", ver AlertService.check_backup_stale).
# Un fallo NO llama a esto: se conserva la fecha del último éxito, para que la
# alerta mida la antigüedad desde ahí y no desde un intento fallido sin fecha.
# Purga objetos de R2 cuyo nombre EMPIEZA con una fecha YYYY-MM-DD anterior a
# `retention_days`. 0 (o vacío) = para siempre, no purga nada. Pensado para
# timelapse/análisis, cuyos archivos ya se llaman YYYY-MM-DD.* (ver camera.py).
prune_r2_by_date() {
  local remote_path="$1" retention_days="$2" cutoff
  if [ -z "$retention_days" ] || [ "$retention_days" -le 0 ] 2>/dev/null; then
    return 0
  fi
  cutoff="$(date -u -d "-${retention_days} days" +%Y-%m-%d)"
  rclone lsf "$remote_path" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.' | while read -r NAME; do
    local day="${NAME:0:10}"
    if [[ "$day" < "$cutoff" ]]; then
      echo "[backup] R2: eliminando $NAME (más viejo que $retention_days días)"
      rclone deletefile "${remote_path}${NAME}" 2>/dev/null || true
    fi
  done
}

mark_backup_success() {
  local category="$1" detail="${2:-}" tmpfile iso status_dir
  status_dir="${BACKUP_STATUS_DIR:-/data/backups}"
  iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmpfile="$(mktemp)"
  printf '{"last_success":"%s","detail":"%s"}\n' "$iso" "$detail" > "$tmpfile"
  docker compose exec -T receiver mkdir -p "$status_dir" >/dev/null 2>&1
  docker compose cp "$tmpfile" "receiver:$status_dir/status-$category.json" >/dev/null 2>&1
  rm -f "$tmpfile"
}
