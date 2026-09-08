#!/usr/bin/env bash
# Captura una foto de la cámara Tapo y la sube al servidor.
#
# Saca un fotograma del stream RTSP con ffmpeg y lo empuja a
# POST /api/camera/upload. Pensado para correr cada N minutos desde un timer de
# systemd en una Raspberry Pi (o cualquier equipo Linux de la red de la cámara).
#
# POR QUÉ HACE FALTA ESTO Y NO SE HACE DESDE EL SERVIDOR:
# la cámara sólo habla RTSP/ONVIF dentro de la RED LOCAL --lo dice la propia FAQ de
# TP-Link-- y el servidor vive en un VPS, al otro lado del NAT. Además, el router del
# sitio no tiene reenvío de puertos, así que el VPS tampoco puede entrar. Alguien
# dentro de casa tiene que sacar la foto y EMPUJARLA hacia fuera. Ver
# docs/archivo/PLAN-CAMARA-EXTERIOR.md.
#
# Uso:
#   ./captura-camara.sh              captura y sube (modo normal, silencioso)
#   ./captura-camara.sh -v           además escribe lo que hace por pantalla
#   ./captura-camara.sh -f foto.jpg  sube ESE archivo en vez de capturar
#
# Configuración en camara.env (ver camara.env.example), NUNCA aquí dentro.

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${CAMERA_ENV_FILE:-$DIR/camara.env}"
VERBOSE=0
ARCHIVO=""

while getopts "vf:e:" opt; do
    case $opt in
        v) VERBOSE=1 ;;
        f) ARCHIVO="$OPTARG" ;;
        e) ENV_FILE="$OPTARG" ;;
        *) echo "uso: $0 [-v] [-f archivo.jpg] [-e camara.env]" >&2; exit 2 ;;
    esac
done

[ -r "$ENV_FILE" ] || { echo "Falta $ENV_FILE (copia camara.env.example)" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

: "${CAMERA_IP:?falta CAMERA_IP en $ENV_FILE}"
: "${CAMERA_USER:?falta CAMERA_USER}"
: "${CAMERA_PASS:?falta CAMERA_PASS}"
: "${API_URL:?falta API_URL}"
: "${UPLOAD_TOKEN:?falta UPLOAD_TOKEN}"
CAMERA_STREAM="${CAMERA_STREAM:-stream1}"
MAX_WIDTH="${MAX_WIDTH:-1600}"
RETRIES="${RETRIES:-3}"
VPS_IP="${VPS_IP:-}"
TLS_PIN="${TLS_PIN:-}"

# ── Ruta hacia el servidor, si algo la desvía ────────────────────────────────
#
# En el nodo donde corre esto, TODO el tráfico sale por una VPN (AMPRNet), y
# Cloudflare responde 403 a esa IP --`cf-mitigated: challenge`--, así que la subida
# no llegaba nunca. La salida es ir directo al VPS por su IP, y para eso el tráfico
# tiene que salir por la conexión normal.
#
# La ruta se arregla AQUÍ, en memoria, en vez de escribirla en la configuración de red
# de la máquina: así no se toca nada permanente de lo que ya corre ahí (es un nodo
# IRLP en producción), sobrevive a cambios de IP o de subred --el gateway se detecta
# al vuelo-- y al desinstalar no queda rastro. Si la ruta ya es correcta, no hace nada.
asegurar_ruta() {
    [ -n "$VPS_IP" ] || return 0
    local dev gw
    dev=$(ip route get "$VPS_IP" 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)
    case "$dev" in
        tun*|ppp*|wg*) ;;      # va por un túnel: hay que sacarlo de ahí
        *) return 0 ;;         # ya sale por una interfaz normal
    esac
    # Gateway de la LAN: el de la ruta por defecto que NO pase por el túnel.
    gw=$(ip route show default 2>/dev/null | grep -vE 'dev (tun|ppp|wg)' \
         | sed -n 's/.*via \([0-9.]*\).*/\1/p' | head -1)
    if [ -z "$gw" ]; then
        log "aviso: el trafico al servidor va por '$dev' y no encuentro gateway de LAN"
        return 0
    fi
    ip route replace "$VPS_IP" via "$gw" 2>/dev/null \
        && log "ruta: $VPS_IP via $gw (fuera del tunel $dev)"
}

TMP="$(mktemp -t captura-XXXXXX.jpg)"
ERR="$(mktemp -t ffmpeg-XXXXXX.log)"
trap 'rm -f "$TMP" "$ERR"' EXIT

log() {
    # A journald si corre bajo systemd (el timer lo recoge solo); a pantalla con -v.
    echo "$(date '+%Y-%m-%d %H:%M:%S')  $*"
    [ "$VERBOSE" = 1 ] || true
}

# ── 1. Sacar el fotograma ────────────────────────────────────────────────────
# -rtsp_transport tcp: por UDP la Tapo pierde paquetes y la foto sale con bandas.
# -ss 1 DESPUÉS de -i: descarta el primer segundo. El primer fotograma suele llegar a
#   medio decodificar --aún no hay un keyframe completo-- y sale media imagen gris.
# -q:v 3: calidad JPEG buena sin irse a 1 MB por foto.
capturar() {
    ffmpeg -hide_banner -loglevel error \
        -rtsp_transport tcp \
        -i "rtsp://${CAMERA_USER}:${CAMERA_PASS}@${CAMERA_IP}:554/${CAMERA_STREAM}" \
        -ss 1 -frames:v 1 -q:v 3 \
        -vf "scale='min(${MAX_WIDTH},iw)':-2" \
        -f image2 -y "$TMP" 2>"$ERR"
}

if [ -n "$ARCHIVO" ]; then
    [ -r "$ARCHIVO" ] || { echo "No existe $ARCHIVO" >&2; exit 1; }
    cp "$ARCHIVO" "$TMP"
    log "usando archivo $ARCHIVO (sin capturar de la camara)"
elif [ "$CAMERA_USER" = "CAMBIAR" ] || [ "$CAMERA_PASS" = "CAMBIAR" ]; then
    # Todavía no hay cámara: se sale LIMPIAMENTE en vez de intentarlo y fallar.
    #
    # Así el timer puede quedar activo desde antes de tener el hardware sin dejar el
    # servicio en `failed` cada cinco minutos ni llenar el journal de una máquina que
    # además es un nodo IRLP. El día que se rellenen las credenciales, empieza a
    # funcionar solo, sin tocar nada.
    log "camara sin configurar (CAMERA_USER/PASS en CAMBIAR): no se intenta"
    exit 0
else
    ok=0
    for i in $(seq 1 "$RETRIES"); do
        if capturar && [ -s "$TMP" ] && [ "$(stat -c%s "$TMP")" -gt 1024 ]; then
            ok=1; break
        fi
        log "intento $i/$RETRIES fallo: $(tr -d '\n' < "$ERR" | cut -c1-160)"
        [ "$i" -lt "$RETRIES" ] && sleep $((5 * i))
    done
    if [ "$ok" != 1 ]; then
        # NO se sube nada: más vale dejar en el servidor la foto anterior, que él ya
        # marcará como antigua pasados 20 min, que subir un fotograma roto.
        log "SIN CAPTURA tras $RETRIES intentos; no se sube nada"
        exit 1
    fi
fi

# ── 2. Subirla ───────────────────────────────────────────────────────────────
BYTES=$(stat -c%s "$TMP")
asegurar_ruta

# Con VPS_IP se va DIRECTO al servidor, saltándose Cloudflare (que bloquea la IP de
# la VPN). El certificado del VPS es un "Origin Certificate" de Cloudflare, válido
# sólo para el proxy y no para una CA pública, así que la cadena no verifica: en su
# lugar se FIJA la clave pública del servidor (--pinnedpubkey). Eso no es "desactivar
# la seguridad": comprueba que se está hablando exactamente con ese servidor, que es
# lo que protege el token de subida. Sin TLS_PIN configurado no se envía nada.
HOST=$(echo "$API_URL" | sed -E 's#^https?://##; s#/.*##')
EXTRA=()
if [ -n "$VPS_IP" ]; then
    if [ -z "$TLS_PIN" ]; then
        log "ERROR: VPS_IP sin TLS_PIN; no se sube nada (el token viajaria sin validar el servidor)"
        exit 1
    fi
    EXTRA+=(--resolve "${HOST}:443:${VPS_IP}" --pinnedpubkey "$TLS_PIN" -k)
fi

CODE=$(curl -s -o /tmp/camara-resp.$$ -w '%{http_code}' \
        --max-time 60 "${EXTRA[@]}" \
        -H "X-Camera-Token: ${UPLOAD_TOKEN}" \
        -H 'Content-Type: image/jpeg' \
        --data-binary "@$TMP" \
        "${API_URL}/api/camera/upload") || CODE=000
RESP=$(cat /tmp/camara-resp.$$ 2>/dev/null); rm -f /tmp/camara-resp.$$

if [ "$CODE" = "200" ]; then
    log "subida OK: $((BYTES / 1024)) KB"
    exit 0
fi
# El servidor distingue los casos y vale la pena verlos en el log:
#   401 token mal · 400 lo enviado no es un JPEG · 503 falta configurar el token
log "ERROR al subir (HTTP $CODE): $(echo "$RESP" | cut -c1-160)"
exit 1
