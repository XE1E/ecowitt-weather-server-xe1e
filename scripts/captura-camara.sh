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

# ── Localizar la cámara por su MAC ───────────────────────────────────────────
#
# La Tapo NO permite fijar una IP estática desde la app --no está escondido en un
# submenú, sencillamente no existe la opción-- y el router del sitio no da garantías
# de reserva DHCP. Así que la dirección puede cambiar sola, sobre todo al mover la
# cámara de sitio buscando cobertura. La MAC, en cambio, no cambia nunca.
#
# Por eso CAMERA_IP funciona aquí como CACHÉ de la última dirección buena: primero
# se prueba esa --caso normal, coste cero-- y sólo si no responde se barre la red.
# Cuando se encuentra, se reescribe la caché para que la siguiente vez vaya directa.
#
# Comprobar la MAC no es paranoia: en esta LAN hay DOS cámaras Tapo. Si el DHCP les
# intercambia las direcciones y no lo comprobáramos, estaríamos subiendo tan
# tranquilos la foto de la cámara equivocada.
#
# Si CAMERA_MAC está vacío no se ejecuta nada de esto y se usa CAMERA_IP tal cual,
# que es como se comportaba el script antes.

CAMERA_MAC="${CAMERA_MAC:-}"

# MAC del vecino que tenga esa IP. El ping previo fuerza la resolución ARP: sin él
# la entrada puede no existir todavía o estar en estado STALE.
mac_de() {
    ping -c1 -W1 "$1" >/dev/null 2>&1
    ip neigh show "$1" 2>/dev/null | awk '{print tolower($5)}' | head -1
}

# Prefijo /24 de la interfaz por la que se sale hacia la cámara. Se calcula al vuelo
# en vez de fijarlo, por lo mismo que la ruta del VPS: aquí no se da nada por hecho
# sobre la red de una máquina que además es un nodo IRLP en producción.
prefijo_lan() {
    local dev addr
    dev=$(ip route get "$1" 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)
    case "$dev" in
        ''|tun*|ppp*|wg*)
            dev=$(ip route show default 2>/dev/null | grep -vE 'dev (tun|ppp|wg)' \
                  | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1) ;;
    esac
    [ -n "$dev" ] || return 1
    addr=$(ip -o -4 addr show dev "$dev" 2>/dev/null | sed -n 's#.*inet \([0-9.]*\)/.*#\1#p' | head -1)
    [ -n "$addr" ] || return 1
    echo "${addr%.*}"
}

# Barrido por tandas de 24. Lanzar 254 pings a la vez en una Raspberry Pi que está
# decodificando audio de un repetidor se nota; así el pico queda repartido. Sólo se
# llega aquí cuando la caché ha fallado, que es raro.
buscar_por_mac() {
    local mac="$1" base i j encontrada
    base=$(prefijo_lan "$CAMERA_IP") || return 1
    i=1
    while [ "$i" -le 254 ]; do
        j=0
        while [ "$j" -lt 24 ] && [ "$i" -le 254 ]; do
            ping -c1 -W1 "$base.$i" >/dev/null 2>&1 &
            i=$((i + 1)); j=$((j + 1))
        done
        wait
        encontrada=$(ip neigh show 2>/dev/null \
                     | awk -v m="$mac" 'tolower($5) == m { print $1; exit }')
        [ -n "$encontrada" ] && { echo "$encontrada"; return 0; }
    done
    return 1
}

resolver_camara() {
    local mac nueva
    # "CAMBIAR" es el marcador de "sin rellenar": cuenta como vacio, o el script
    # se pasaria 12 s barriendo la red buscando una MAC que no existe.
    case "$CAMERA_MAC" in ""|CAMBIAR|cambiar) return 0 ;; esac
    mac=$(echo "$CAMERA_MAC" | tr 'A-Z' 'a-z')

    [ "$(mac_de "$CAMERA_IP")" = "$mac" ] && return 0   # la caché sigue valiendo

    log "la camara no responde en $CAMERA_IP; la busco por su MAC $mac"
    nueva=$(buscar_por_mac "$mac") || {
        log "no encuentro la MAC $mac en la red; sigo con $CAMERA_IP"
        return 1
    }
    log "camara localizada en $nueva (antes $CAMERA_IP): actualizo la cache"
    CAMERA_IP="$nueva"
    sed -i "s#^CAMERA_IP=.*#CAMERA_IP=$nueva#" "$ENV_FILE" 2>/dev/null \
        || log "aviso: no pude guardar la nueva IP en $ENV_FILE"
}

# Sólo cuando se va a capturar de verdad: con -f no hay cámara que buscar, y sin
# credenciales el script se va a salir limpiamente unas líneas más abajo.
# ── ¿Toca capturar AHORA? Lo decide el PANEL, no el timer ─────────────
# El timer corre seguido, pero quien manda es /api/camera/capture-config: on/off, franja
# horaria (de noche la cámara sólo ve negro y gasta cuota) e intervalo entre capturas. Si
# el servidor no responde, se captura igual (fail-open): un hipo del server no debe cegar
# la cámara. Con -f (archivo dado) no hay nada que decidir.
decidir_captura() {
    [ -n "$ARCHIVO" ] && return 0
    asegurar_ruta
    local host cfg enabled ival h0 h1 hora last ahora
    host=$(echo "$API_URL" | sed -E 's#^https?://##; s#/.*##')
    local extra=()
    [ -n "$VPS_IP" ] && [ -n "$TLS_PIN" ] && extra=(--resolve "${host}:443:${VPS_IP}" --pinnedpubkey "$TLS_PIN" -k)
    cfg=$(curl -s -m 10 "${extra[@]}" "${API_URL}/api/camera/capture-config" 2>/dev/null)
    [ -z "$cfg" ] && { log "no pude leer capture-config; capturo igual (fail-open)"; return 0; }
    enabled=$(printf '%s' "$cfg" | python3 -c "import sys,json;print(json.load(sys.stdin).get('enabled'))" 2>/dev/null)
    ival=$(printf '%s' "$cfg" | python3 -c "import sys,json;print(int(json.load(sys.stdin).get('interval_min') or 0))" 2>/dev/null)
    h0=$(printf '%s' "$cfg" | python3 -c "import sys,json;print(int(json.load(sys.stdin).get('hour_start') or 0))" 2>/dev/null)
    h1=$(printf '%s' "$cfg" | python3 -c "import sys,json;print(int(json.load(sys.stdin).get('hour_end') or 0))" 2>/dev/null)

    if [ "$enabled" = "False" ]; then log "captura DESACTIVADA en el panel; no captura"; exit 0; fi

    hora=$(date +%-H)
    if [ -n "$h0" ] && [ -n "$h1" ] && [ "$h0" != "$h1" ]; then
        if [ "$h0" -lt "$h1" ]; then
            if [ "$hora" -lt "$h0" ] || [ "$hora" -ge "$h1" ]; then log "fuera de horario ($h0-$h1 h); no captura"; exit 0; fi
        else
            if [ "$hora" -ge "$h1" ] && [ "$hora" -lt "$h0" ]; then log "fuera de horario ($h0-$h1 h); no captura"; exit 0; fi
        fi
    fi

    if [ "${ival:-0}" -gt 0 ] && [ -f "$DIR/.ultima-captura" ]; then
        last=$(cat "$DIR/.ultima-captura" 2>/dev/null || echo 0)
        ahora=$(date +%s)
        [ $(( (ahora - last) / 60 )) -lt "$ival" ] && exit 0
    fi
}
decidir_captura

if [ -z "$ARCHIVO" ] && [ "$CAMERA_USER" != "CAMBIAR" ] && [ "$CAMERA_PASS" != "CAMBIAR" ]; then
    resolver_camara || true
fi

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
    date +%s > "$DIR/.ultima-captura" 2>/dev/null || true
    log "subida OK: $((BYTES / 1024)) KB"
    exit 0
fi
# El servidor distingue los casos y vale la pena verlos en el log:
#   401 token mal · 400 lo enviado no es un JPEG · 503 falta configurar el token
log "ERROR al subir (HTTP $CODE): $(echo "$RESP" | cut -c1-160)"
exit 1
