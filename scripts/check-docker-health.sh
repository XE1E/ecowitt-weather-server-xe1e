#!/usr/bin/env bash
# Revisa el healthcheck nativo de Docker de cada servicio del stack y avisa
# al receiver (que ya sabe mandar Telegram/correo, ver AlertService) si
# alguno está "unhealthy" -- y cuando se recupera.
#
# Por qué desde el HOST y no desde dentro de un contenedor: ninguno de ellos
# puede ver a los demás ni tiene acceso al socket de Docker para preguntar
# por su propio estado o el de otro. Este script sí puede, porque corre en
# el VPS directo.
#
# Uso:   ./scripts/check-docker-health.sh
# Cron:  cada 5 min, por ejemplo:
#   */5 * * * * cd ~/ecowitt-weather-server-xe1e && ./scripts/check-docker-health.sh >> ~/ecowitt-backups/backup.log 2>&1
#
# Variables opcionales (env o .env):
#   DOCKER_HEALTH_API_TOKEN  requerido -- ver .env.example y Admin → Sistema
#   DOCKER_HEALTH_API_URL    default: http://localhost:8080/api/admin/docker-health

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

getenv() {
  local v="${!1:-}"
  if [ -z "$v" ]; then v="$(grep -E "^$1=" "$REPO_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"; fi
  printf '%s' "$v"
}

TOKEN="$(getenv DOCKER_HEALTH_API_TOKEN)"
if [ -z "$TOKEN" ]; then
  echo "[docker-health] DOCKER_HEALTH_API_TOKEN vacío en .env; nada que hacer" >&2
  exit 0
fi

# Nombres de SERVICIO (no de contenedor) que declaran healthcheck en
# docker-compose.yml -- a mano, en vez de listarlos con `docker compose ps
# --format json`, cuyo formato de salida varía entre versiones de Compose.
SERVICIOS="receiver influxdb dashboard renderer"

UNHEALTHY_JSON=""
for s in $SERVICIOS; do
  cid="$(docker compose ps -q "$s" 2>/dev/null || true)"
  [ -z "$cid" ] && continue
  estado="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "none")"
  if [ "$estado" = "unhealthy" ]; then
    echo "[docker-health] '$s' está unhealthy"
    UNHEALTHY_JSON="${UNHEALTHY_JSON:+$UNHEALTHY_JSON,}\"$s\""
  fi
done

# Se manda SIEMPRE, aunque no haya nada unhealthy: el receiver compara contra
# la corrida anterior para detectar tanto la caída como la recuperación (ver
# AlertService.check_docker_health). Si no se avisa "ya no hay nadie
# unhealthy", nunca llegaría el mensaje de "normalizado".
BASE_URL="${DOCKER_HEALTH_API_URL:-http://localhost:8080/api/admin/docker-health}"
if ! curl -fsS --max-time 10 -X POST "$BASE_URL" \
    -H "X-Docker-Health-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"unhealthy\":[$UNHEALTHY_JSON]}" >/dev/null; then
  echo "[docker-health] no se pudo avisar a $BASE_URL (¿el receiver mismo está caído?)" >&2
  exit 1
fi
