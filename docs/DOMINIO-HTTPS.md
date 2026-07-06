# Dominio y HTTPS — `clima.xe1e.net`

Cómo publicar el dashboard en `https://clima.xe1e.net` con certificado válido,
usando **Caddy** (HTTPS automático con Let's Encrypt) delante del stack.

> **Regla de oro:** los **humanos y Home Assistant** entran por `https://clima.xe1e.net`.
> El **WS2910** hace push por **HTTP a la IP:8080** (los dispositivos Ecowitt no
> soportan HTTPS). Ambos llegan al mismo VPS.

```
Navegador / HA ──HTTPS 443──▶ Caddy ──▶ dashboard:80 ──▶ receiver ──▶ InfluxDB
WS2910         ──HTTP 8080──▶ dashboard:80 (nginx) ──/data/report──▶ receiver
```

---

## Resumen: 3 cosas que hacer

| # | Dónde | Qué |
|---|-------|-----|
| 1 | Tu proveedor DNS de `xe1e.net` | Registro **A**: `clima` → `163.192.147.208` |
| 2 | Consola Oracle Cloud | Abrir **80** y **443** (Security List + NSG) y en `iptables` del VPS |
| 3 | VPS (por SSH) | Levantar el stack con el perfil `caddy` |

---

## 1. DNS

En el panel DNS de `xe1e.net`, crea:

```
Tipo: A
Nombre: clima            (queda clima.xe1e.net)
Valor: 163.192.147.208   (IP pública del VPS)
TTL: 300
```

Verifica la propagación:

```bash
nslookup clima.xe1e.net
# o
dig +short clima.xe1e.net
```

Debe responder `163.192.147.208` antes de continuar (si no, Let's Encrypt fallará).

## 2. Abrir puertos 80 y 443 en Oracle

Oracle exige abrir en **tres** niveles:

**a) Security List** (VCN → Subnet → Security List → Ingress Rules): añade
- `0.0.0.0/0` TCP **80**
- `0.0.0.0/0` TCP **443**

**b) Network Security Group** (si la instancia usa NSG): las mismas dos reglas.

**c) iptables** en el VPS:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save   # persistir tras reinicio
```

> El puerto **8080** ya está abierto (lo usa el push del WS2910). Se mantiene.

## 3. Levantar el stack con Caddy

En el VPS, dentro del repo (ver [DEPLOY.md](DEPLOY.md) para el despliegue base):

```bash
cd ~/ecowitt-weather-server-xe1e
git pull
docker compose --profile caddy up -d --build
docker compose ps
```

Caddy pedirá el certificado a Let's Encrypt automáticamente (necesita DNS ya
apuntando y puertos 80/443 abiertos). Verifica:

```bash
docker compose logs -f caddy      # ver la emisión del certificado
curl -I https://clima.xe1e.net    # debe responder 200 con HTTPS
```

Abre en el navegador: **https://clima.xe1e.net** 🔒

---

## Configurar el WS2910 (sin cambios respecto al plan)

El push sigue yendo por **IP y HTTP**, no por el dominio:

| Campo | Valor |
|-------|-------|
| Protocol Type | Ecowitt |
| Server IP | `163.192.147.208` |
| Port | `8080` |
| Path | `/data/report/` |
| Interval | 60 s |

## Home Assistant (remoto)

Apunta el sensor REST al dominio con HTTPS:

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

## Notas y problemas comunes

- **El certificado no se emite:** casi siempre es DNS aún no propagado o el puerto
  80 cerrado (Let's Encrypt valida por HTTP-01 en el 80). Revisa `docker compose logs caddy`.
- **Cambiar de dominio:** edita `caddy/Caddyfile` (línea del dominio) y
  `docker compose --profile caddy up -d` de nuevo.
- **Certificados persistentes:** se guardan en el volumen `caddy-data`, así que
  sobreviven a reinicios y no se re-emiten cada vez (evita el rate limit de Let's Encrypt).
- **Redirección HTTP→HTTPS:** Caddy la hace automática para el dominio. El push
  del WS2910 no se ve afectado porque usa la IP:8080, no el dominio.
- **HTTPS opcional para el push:** si algún día quieres que el WS2910 también use
  el dominio, habría que exponer `/data/report` por HTTP sin redirigir; por ahora
  IP:8080 es lo más simple y robusto.
