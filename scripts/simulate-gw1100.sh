#!/usr/bin/env bash
# Simula los envíos de un GW1100 (sensor interconstruido) al receiver, para
# probar la estación remota SIN el hardware.
#
# Uso:
#   ./scripts/simulate-gw1100.sh [URL] [PASSKEY]
#
#   URL      endpoint del receiver (default: http://localhost:8080/data/report)
#   PASSKEY  passkey ficticio del GW1100
#            (default: F00DCAFEF00DCAFEF00DCAFEF00DCAFE)
#
# Requisito previo: registrar el passkey como estación secundaria en .env:
#   SECONDARY_STATIONS=F00DCAFEF00DCAFEF00DCAFEF00DCAFE:gw1100
# y reiniciar el receiver. Luego abre /pro/remota en el dashboard.
#
# Envía 12 lecturas (una cada 3 s) variando temperatura/humedad/presión para
# ver moverse la gráfica de histórico.

set -euo pipefail

URL="${1:-http://localhost:8080/data/report}"
PASSKEY="${2:-F00DCAFEF00DCAFEF00DCAFEF00DCAFE}"
N="${N:-12}"

echo "[sim] POST -> $URL   passkey=$PASSKEY   lecturas=$N"

for i in $(seq 1 "$N"); do
  # Valores plausibles de interior (imperial, como manda Ecowitt) con variación.
  tempinf="$(awk -v i="$i" 'BEGIN{printf "%.1f", 72 + (i % 5) * 0.6}')"
  humidityin="$(awk -v i="$i" 'BEGIN{printf "%d", 50 + (i % 7)}')"
  baromrel="$(awk -v i="$i" 'BEGIN{printf "%.2f", 29.90 + (i % 3) * 0.02}')"
  baromabs="$(awk -v i="$i" 'BEGIN{printf "%.2f", 29.80 + (i % 3) * 0.02}')"
  dateutc="$(date -u +'%Y-%m-%d+%H:%M:%S')"

  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
    --data-urlencode "PASSKEY=$PASSKEY" \
    --data-urlencode "stationtype=GW1100A_V2.3.4" \
    --data-urlencode "model=GW1100A" \
    --data-urlencode "freq=915M" \
    --data-urlencode "dateutc=$dateutc" \
    --data-urlencode "tempinf=$tempinf" \
    --data-urlencode "humidityin=$humidityin" \
    --data-urlencode "baromrelin=$baromrel" \
    --data-urlencode "baromabsin=$baromabs")"

  echo "[sim] $i/$N  tempinf=$tempinf humidityin=$humidityin  -> HTTP $code"
  [ "$i" -lt "$N" ] && sleep 3
done

echo "[sim] listo. Revisa /pro/remota y /api/current?station=gw1100"
