#!/usr/bin/env bash
# Poda la cache de build de Docker, que crece sin límite con cada
# `docker compose build` y no se libera sola -- se encontró el 2026-09-15 con
# 26GB acumulados (100% sin uso) llenando el disco al 69%. Las imágenes en uso
# y los volúmenes de datos NO se tocan.
#
# Uso:   ./scripts/cleanup-docker.sh
# Cron:  semanal, domingo de madrugada:
#   0 4 * * 0 cd ~/ecowitt-weather-server-xe1e && ./scripts/cleanup-docker.sh >> ~/ecowitt-backups/backup.log 2>&1

set -euo pipefail

echo "[cleanup-docker] $(date -Iseconds) uso de disco antes:"
df -h / | tail -1

# --filter until=168h (7 días): no toca cache de un build que pudiera estar
# corriendo ahora mismo o haber terminado hace poco (deploy en curso), solo
# capas que ya llevan más de una semana sin usarse.
docker builder prune -af --filter until=168h

echo "[cleanup-docker] uso de disco después:"
df -h / | tail -1
