#!/usr/bin/env python3
"""
Probe fiel al WS2910 para validar la ingesta HTTP (útil para el proyecto
"Todo con Cloudflare", antes de tener el hardware real).

Envía un POST idéntico al de un WS2910: HTTP PLANO (sin TLS), cuerpo
application/x-www-form-urlencoded con los campos del protocolo Ecowitt, y
—crucialmente— usando http.client, que **NO sigue redirecciones** (igual que la
consola). Muestra el status, headers y cuerpo de la respuesta.

Interpretación:
  - 200            -> el destino recibió el POST (el WS2910 también podría). ✅
  - 301/302 + https-> el borde fuerza HTTPS; el WS2910 fallaría aquí.        ❌
  - conexión rechazada -> ese puerto no está llegando.

Uso:
  python3 scripts/ws2910_probe.py [URL] [--port N]
Ejemplos:
  python3 scripts/ws2910_probe.py http://estacion-test.xe1e.net/data/report/
  python3 scripts/ws2910_probe.py http://clima.xe1e.net/data/report/
  python3 scripts/ws2910_probe.py http://localhost:8080/data/report/
"""
import sys
import http.client
import urllib.parse
from urllib.parse import urlparse

# Muestra representativa de un envío Ecowitt del WS2910 (imperial, form-urlencoded)
SAMPLE = {
    "PASSKEY": "PROBE-NO-REAL",
    "stationtype": "WS2910_PROBE",
    "dateutc": "now",
    "tempf": "71.6",
    "humidity": "55",
    "baromrelin": "29.92",
    "baromabsin": "22.83",
    "windspeedmph": "5.1",
    "windgustmph": "9.2",
    "winddir": "210",
    "rainratein": "0.000",
    "dailyrainin": "0.098",
    "solarradiation": "640.2",
    "uv": "6",
    "temp1f": "73.0",
    "humidity1": "50",
    "batt1": "0",
}


def main() -> int:
    url = "http://clima.xe1e.net/data/report/"
    port_override = None
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--port" and i + 1 < len(args):
            port_override = int(args[i + 1])
        elif not a.startswith("--"):
            url = a

    u = urlparse(url)
    if u.scheme != "http":
        print("AVISO: el WS2910 solo habla HTTP; forzando http:// para la prueba.")
    host = u.hostname
    port = port_override or u.port or 80
    path = u.path or "/"
    body = urllib.parse.urlencode(SAMPLE)

    print(f"POST http://{host}:{port}{path}  ({len(body)} bytes, sin seguir redirects)\n")
    try:
        conn = http.client.HTTPConnection(host, port, timeout=15)
        conn.request("POST", path, body, {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Ecowitt-Probe/1.0",
            "Connection": "close",
        })
        r = conn.getresponse()
        print(f"<- HTTP {r.status} {r.reason}")
        for k, v in r.getheaders():
            print(f"   {k}: {v}")
        data = r.read(400).decode(errors="replace")
        if data.strip():
            print("   --- cuerpo ---")
            print("   " + data.replace("\n", "\n   "))
        print()
        if r.status == 200:
            print("RESULTADO: [OK] 200 -- el destino recibio el POST. La ingesta es viable aqui.")
            return 0
        if r.status in (301, 302, 307, 308):
            loc = r.getheader("Location") or ""
            print(f"RESULTADO: [FALLA] redireccion {r.status} -> {loc}")
            print("           El WS2910 NO sigue redirects: hay que evitar el redirect en esta ruta.")
            return 2
        print(f"RESULTADO: [AVISO] status {r.status} -- revisar.")
        return 3
    except ConnectionRefusedError:
        print(f"RESULTADO: [FALLA] conexion rechazada en el puerto {port} (proxy/puerto no soportado?).")
        return 4
    except Exception as e:
        print(f"RESULTADO: [FALLA] error: {e}")
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
