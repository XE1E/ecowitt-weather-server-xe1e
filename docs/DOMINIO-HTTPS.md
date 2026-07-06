# Dominio y HTTPS — `clima.xe1e.net` (con Cloudflare Orange Cloud)

Publicar el dashboard en `https://clima.xe1e.net`. El DNS está en **Cloudflare
con el proxy activo (nube naranja)**, así que Cloudflare pone el certificado
público y protege el origin. En el VPS, **Caddy** cifra el tramo Cloudflare→origin
con un *Origin Certificate* de Cloudflare.

> **Regla de oro:** humanos y Home Assistant entran por `https://clima.xe1e.net`
> (a través de Cloudflare). El **WS2910** hace push por **HTTP a la IP:8080**
> directamente (Ecowitt no soporta HTTPS y se salta Cloudflare).

```
Navegador / HA ─HTTPS─▶ Cloudflare ─HTTPS(origin cert)─▶ Caddy ─▶ dashboard ─▶ receiver
WS2910         ─────────HTTP:8080 directo a la IP────────▶ dashboard(nginx) ─/data/report─▶ receiver
```

---

## Resumen: qué hacer

| # | Dónde | Qué |
|---|-------|-----|
| 1 | Cloudflare DNS | Registro **A** `clima` → `163.192.147.208`, **proxied (naranja)** ✅ (ya hecho) |
| 2 | Cloudflare SSL/TLS | Modo **Full (strict)** + crear **Origin Certificate** |
| 3 | Oracle Cloud | Abrir **80** y **443** (Security List + NSG + iptables) |
| 4 | VPS | Poner el cert en `caddy/certs/` y `docker compose --profile caddy up -d` |

---

## 1. DNS (ya hecho ✅)

Registro **A**: `clima` → `163.192.147.208`, con **proxy activo (nube naranja)**.

> Con el proxy activo, `clima.xe1e.net` resuelve a IPs de Cloudflare (oculta tu
> VPS). Eso está bien: el WS2910 usa la IP directa, no el dominio.

## 2. Cloudflare: modo SSL y Origin Certificate

**a) Modo SSL/TLS:** en el panel de Cloudflare → **SSL/TLS → Overview** → elige
**Full (strict)**. (Evita "Flexible": deja el tramo al origin sin cifrar y puede
causar bucles de redirección.)

**b) Crear el Origin Certificate:** Cloudflare → **SSL/TLS → Origin Server →
Create Certificate**:
1. Deja "Let Cloudflare generate a private key and a CSR".
2. Hostnames: `clima.xe1e.net` (o `*.xe1e.net`).
3. Validez: 15 años.
4. Copia los dos bloques que te da:
   - **Origin Certificate** → guárdalo como `origin.pem`
   - **Private Key** → guárdalo como `origin.key`

**c) (Recomendado)** Activa **Always Use HTTPS** (SSL/TLS → Edge Certificates)
para que Cloudflare redirija HTTP→HTTPS en el borde.

**d) (Recomendado)** Evita que Cloudflare cachee la API: **Rules → Cache Rules**,
crea una regla que para `URI Path` que **empiece con `/api`** ponga *Bypass cache*.
(Los assets estáticos del dashboard sí pueden cachearse, mejora la velocidad.)

## 3. Abrir puertos 80 y 443 en Oracle

En **tres** niveles:

**Security List / NSG** (Ingress): `0.0.0.0/0` TCP **80** y `0.0.0.0/0` TCP **443**.

**iptables** en el VPS:
```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

> El **8080** ya está abierto (push del WS2910). Se mantiene.
>
> **Opcional (seguridad):** con el proxy de Cloudflare, puedes restringir 80/443
> para que solo acepten las [IPs de Cloudflare](https://www.cloudflare.com/ips/)
> y así nadie llegue al origin saltándose el proxy. No es obligatorio.

## 4. Instalar el cert y levantar

En el VPS, dentro del repo (ver [DEPLOY.md](DEPLOY.md) para el despliegue base):

```bash
cd ~/ecowitt-weather-server-xe1e
git pull

# Pega los dos archivos del Origin Certificate:
nano caddy/certs/origin.pem   # pega el "Origin Certificate"
nano caddy/certs/origin.key   # pega la "Private Key"
chmod 600 caddy/certs/origin.key

docker compose --profile caddy up -d --build
docker compose logs -f caddy   # sin errores de TLS
```

Verifica:
```bash
curl -I https://clima.xe1e.net     # 200 vía Cloudflare
```
Abre **https://clima.xe1e.net** 🔒

---

## Configurar el WS2910 (sin cambios)

Push por **IP y HTTP**, no por el dominio:

| Campo | Valor |
|-------|-------|
| Protocol Type | Ecowitt |
| Server IP | `163.192.147.208` |
| Port | `8080` |
| Path | `/data/report/` |
| Interval | 60 s |

## Home Assistant (remoto)

```yaml
sensor:
  - platform: rest
    name: "Temperatura Exterior"
    resource: https://clima.xe1e.net/api/current
    value_template: "{{ value_json.temperature_outdoor }}"
    unit_of_measurement: "°C"
    scan_interval: 60
```

---

## Problemas comunes

- **Error 521/522 (Cloudflare no llega al origin):** puertos 80/443 cerrados en
  Oracle, o Caddy no está levantado. Revisa Security List/NSG/iptables y `docker compose ps`.
- **Bucle de redirección (ERR_TOO_MANY_REDIRECTS):** casi siempre por modo
  **Flexible**; cámbialo a **Full (strict)**.
- **Error de certificado / 526:** el Origin Certificate no está bien pegado o el
  modo no es Full (strict). Revisa `caddy/certs/` y `docker compose logs caddy`.
- **Datos viejos en HA/dashboard:** añade la Cache Rule de *bypass* para `/api`.

---

## Alternativa: DNS-only (grey cloud)

Si prefieres **desactivar el proxy** (nube gris), no necesitas el Origin
Certificate: Caddy saca un certificado Let's Encrypt automático. En ese caso usa
el bloque alternativo comentado en `caddy/Caddyfile`. Pierdes las ventajas del
proxy (ocultar IP, DDoS, caché), pero es más simple.
