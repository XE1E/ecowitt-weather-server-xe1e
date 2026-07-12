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
  # Valores realistas de interior. Varían según la HORA DEL DÍA (curva suave)
  # para que sirvan tanto en modo cron (N=1, una lectura por minuto) como en
  # ráfaga manual. 10# fuerza base 10 (evita el error octal con "08"/"09").
  now_min="$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))"
  phase="$(( now_min + i ))"
  PI=3.14159265

  # Interior: base ~22 °C, ±1.5 °C a lo largo del día + rizo fino.
  tempc="$(awk -v p="$phase" -v pi="$PI" 'BEGIN{printf "%.2f", 22 + 1.5*sin(2*pi*(p-360)/1440) + 0.2*sin(p/3.0)}')"
  tempinf="$(awk -v c="$tempc" 'BEGIN{printf "%.1f", c*9/5+32}')"        # Ecowitt manda °F
  humidityin="$(awk -v p="$phase" -v pi="$PI" 'BEGIN{printf "%d", 52 + 6*sin(2*pi*(p+200)/1440)}')"
  baromrel="$(awk -v p="$phase" -v pi="$PI" 'BEGIN{printf "%.2f", 29.90 + 0.06*sin(2*pi*p/1440)}')"
  baromabs="$(awk -v b="$baromrel" 'BEGIN{printf "%.2f", b-0.10}')"
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
