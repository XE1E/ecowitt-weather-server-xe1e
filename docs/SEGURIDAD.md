# Auditoría de seguridad — Estación meteorológica XE1E

> Revisión de postura de seguridad del sistema completo (código + infraestructura).
> Fecha: **2026-07-22** · Alcance: receiver (FastAPI), dashboard (React/Nginx),
> InfluxDB, renderer, Caddy, Cloudflare y el VPS Oracle.
>
> **Método:** revisión del código (auth/admin, red/endpoints, secretos/datos/deps)
> + escaneo real del VPS (firewall, puertos, SSH, fail2ban, parches).

---

## Veredicto general

El **núcleo está bien diseñado**: aislamiento de red entre contenedores, auth admin
con `secrets`/`hmac.compare_digest`, secretos enmascarados, parsing defensivo del
protocolo Ecowitt y escritura parametrizada a InfluxDB. **El `.env` real nunca se
commiteó** (verificado en todo el historial) y **SSH es solo por llave**.

El problema principal es de **infraestructura** y amplifica varios fallos menores de
código: **el puerto `:8080` está abierto a todo internet en HTTP plano**, saltándose
Cloudflare (WAF, ocultamiento de IP) y el TLS de Caddy.

Confirmado en el firewall del VPS:

```
-A INPUT -p tcp --dport 8080 -j ACCEPT     # abierto al mundo entero
```

Esto hace que `http://<IP>:8080/api/admin/login`, `/api/current`, `/data/report/`,
`/api/stations/...` — **todo** — sea alcanzable en texto claro, sin WAF ni cifrado.
Cada hallazgo de abajo es más grave por esto.

---

## 🔴 Lo urgente (top 5, por impacto real)

### 1. `:8080` abierto a todo internet — bypass total de Cloudflare/TLS — **CRÍTICO**
Es la llave maestra. Un atacante que conozca la IP origen (trivial vía Certificate
Transparency, historial DNS o headers) ataca directo, en claro, sin las protecciones
de Cloudflare. Toda la superficie (login admin incluido) queda expuesta sin cifrar.

**Arreglo (5 min, máximo impacto):** en la *Security List* de Oracle Cloud + `ufw`,
permitir `:8080` **solo desde la IP pública del datalogger WS2910**; el resto entra
por `:443` vía Caddy/Cloudflare. Ideal: mover el push de la estación a HTTPS por el
dominio y **cerrar `:8080` por completo**.

### 2. Login admin sin rate-limit, lockout ni logging de fallos — **ALTO**
`receiver/app/services/admin.py:21` · `receiver/app/main.py:506`

`/api/admin/login` no tiene límite de intentos, ni bloqueo, ni registro de fallos.
Combinado con el #1, permite fuerza bruta sobre HTTP plano **sin dejar rastro**. Si
el password admin es débil o reutilizado, se comprometen todos los tokens
(Telegram, SMTP, WU/Windy/PWS/OWM, MQTT), todos editables y reenviables.

**Arreglo:** añadir rate-limiting al login (p. ej. `slowapi`, `5/minute` por IP) y/o
lockout tras N fallos; registrar cada fallo con IP + timestamp (alimenta el visor de
logs del panel); exigir password fuerte.

### 3. `/api/current` filtra el PASSKEY de la estación — **ALTO**
`receiver/app/main.py:424-441` · `receiver/app/services/parser.py:16`

El endpoint público devuelve el dict completo, incluido `passkey`, sin auth. Como la
seguridad de `/data/report` está **desactivada por defecto** (`ecowitt_secure_enabled=False`),
cualquiera lee el passkey y luego hace `POST /data/report` para **inyectar lecturas
falsas** (contamina InfluxDB, dispara alertas y las publica a WU/CWOP como reales).

**Arreglo:** filtrar los metadatos antes de exponer, p. ej.
`parsed_data.pop("passkey", None)` justo después de `resolve_station()`, o excluir
`METADATA_FIELDS` en la respuesta de `/api/current`. Además activar token+allowlist
en producción.

### 4. `PUT /api/stations/{name}` sin autenticación — **ALTO**
`receiver/app/main.py:1198-1221`

A diferencia del resto de mutaciones, este PUT **no llama `_require_admin`** y
persiste en `settings.json`. Un anónimo puede alterar `calibration` (corromper los
datos guardados), `watchdog_enabled`/`watchdog_minutes` (silenciar alertas de
estación caída) o `sensor_labels` (defacement). El GET detallado también expone
`config` y `current_data` sin auth.

**Arreglo:** añadir `_require_admin(authorization)` al PUT (y evaluar el GET);
validar el contenido de `calibration`/`alert_thresholds`.

### 5. VPS: sin fail2ban y `.env` legible por todos — **MEDIO**
El VPS recibe **fuerza bruta SSH activa** (bots probando `debian`, `will`, `amit`…).
Mitigado porque **SSH es solo por llave** (`PasswordAuthentication no`), pero no hay
fail2ban. Y el `.env` (con todos los secretos) está en `0664` — legible por cualquier
usuario/proceso del host.

**Arreglo:** `chmod 600 ~/ecowitt-weather-server-xe1e/.env`; instalar y activar
fail2ban (jail de sshd); aplicar los parches de seguridad pendientes del SO.

---

## Detalle completo por severidad

### Red e infraestructura
| Sev | Hallazgo | Ubicación |
|-----|----------|-----------|
| 🔴 CRÍT | `:8080` abierto a internet, HTTP plano, bypass CF/TLS | firewall VPS + `docker-compose.yml:95` |
| 🟠 ALTA | `PUT /api/stations/{name}` sin `_require_admin` | `main.py:1198` |
| 🟡 MEDIA | Sin CSP/HSTS/X-Frame-Options → clickjacking de `/pro/admin` | `caddy/Caddyfile`, `dashboard/nginx.conf` |
| 🟡 MEDIA | Sin rate-limit ni límite de tamaño en `/data/report` → flood/DoS | `main.py:323` |
| 🟡 MEDIA | Token de push como `?token=` en URL sobre HTTP → sniffable, va a logs | `main.py:316` |
| 🟡 MEDIA | Inyección Flux vía `?station=`/`?measurement=`/`?start=` (f-strings sin validar) | `storage.py:29,159` |
| 🟢 BAJA | rpcbind (`:111`) escuchando (el firewall lo bloquea; innecesario) | VPS |
| ⚪ COND | Grafana `admin/admin` en `:3000` — solo con `--profile grafana` (ahora **no** corre) | `docker-compose.yml:73` |

### Autenticación y panel de administración
| Sev | Hallazgo | Ubicación |
|-----|----------|-----------|
| 🟠 ALTA | Login sin rate-limit/lockout/logging de fallos | `admin.py:21`, `main.py:506` |
| 🟡 MEDIA | CORS `allow_origins=["*"]` + `allow_credentials=True` | `main.py:97` |
| 🟡 MEDIA | Token de sesión en `sessionStorage` (accesible a JS; riesgo si hay XSS) | `dashboard/src/admin-auth.tsx:20` |
| 🟡 MEDIA | Password admin en texto plano (env/memoria), sin hash | `config.py:147` |
| 🟢 BAJA | `logout` no revoca el token en el servidor (sigue válido 12 h) | `admin-auth.tsx:43` |
| 🟢 BAJA | `POST /settings` acepta dict sin validar tipos → auto-DoS de config | `main.py:520` |
| 🟢 BAJA | Sesiones solo en memoria (se pierden al reiniciar; no escala a réplicas) | `admin.py:13` |

### Secretos, datos y dependencias
| Sev | Hallazgo | Ubicación |
|-----|----------|-----------|
| 🟠 ALTA | PASSKEY filtrado por `/api/current` público | `main.py:424` |
| 🟡 MEDIA | `.env` en `0664` (legible por todos) + InfluxDB `admin/adminpassword` commiteado | VPS + `docker-compose.yml:59` |
| 🟡 MEDIA | `settings.json` guarda todos los secretos en claro sin `chmod 600` | `settings_store.py:114` |
| 🟡 MEDIA | Coordenadas exactas de la casa (6 decimales, ~0.1 m) en repo **y en el bundle JS público** | `dashboard/src/config.ts:9`, `config.py:134` |
| 🟡 MEDIA | `python-multipart 0.0.6` y `fastapi 0.109` con CVEs (ReDoS/DoS en `/data/report`) | `receiver/requirements.txt` |
| 🟢 BAJA | 12 actualizaciones de seguridad del SO pendientes | VPS |
| 🟢 BAJA | Errores 500 devuelven `str(e)` al cliente (fuga de rutas/detalles) | `main.py:414` y otros |
| 🟢 BAJA | Passkey en `logger.debug` del raw_data (solo con `DEBUG=true`) | `main.py:326` |
| 🟢 BAJA | npm: 2 vulns (esbuild/vite) — **solo dev**, 0 en producción | `dashboard/package.json` |

#### Detalle de CVEs (dependencias Python)
- **`python-multipart==0.0.6`** → CVE-2024-24762 (ReDoS al parsear `Content-Type`,
  fix en 0.0.7) y CVE-2024-53981 (DoS por logging, fix en 0.0.18). `/data/report`
  usa `request.form()`, directamente afectado. **Subir a `>=0.0.18`.**
- **`fastapi==0.109.0`** (Starlette ~0.35) → CVE-2024-47874 (DoS multipart sin
  límite, fix en Starlette 0.40 / FastAPI 0.115+). **Subir a `fastapi>=0.115`.**
- Resto (`uvicorn`, `httpx`, `influxdb-client`, `paho-mqtt`, `pydantic`) sin CVEs
  críticas pero atrasadas ~2 años. Correr `pip-audit`.

---

## ✅ Lo que ya está bien hecho

- **SSH solo por llave** (`PasswordAuthentication no`) — la fuerza bruta de bots no entra.
- **Aislamiento de red correcto:** `receiver`, `influxdb` y `renderer` **no** publican
  puertos al host (solo `expose` interno); InfluxDB se accede por túnel SSH.
- **Auth admin robusta:** tokens `secrets.token_urlsafe(32)`, `hmac.compare_digest`
  (constante en tiempo), panel auto-deshabilitado sin credenciales, y **casi todos**
  los `/api/admin/*` verifican sesión con `_require_admin`.
- **Whitelist de guardado de settings** (no se pueden sobrescribir claves arbitrarias)
  y **"en blanco = conservar"** para secretos; enmascarado real (`••••xxxx`).
- **El `.env` real nunca se commiteó** (verificado en todo el historial git).
- **Sin SSRF** en los proxies externos (NASA GIBS, METAR, air quality): hosts fijos,
  parámetros tipados/validados (capas y fechas con allowlist/regex).
- **Renderer a prueba de abuso:** whitelist de páginas (`1`–`5`) + URL interna fija;
  Chromium `--no-sandbox` es aceptable porque la URL nunca es controlable por el usuario.
- **Escritura a InfluxDB parametrizada** vía `Point().tag()/.field()` — la ingesta no
  es inyectable.
- **Allowlist de IP no spoofeable:** nginx fija `X-Real-IP` con `$remote_addr`.
- **CSRF no explotable:** auth por header `Bearer`, no por cookie.
- `unattended-upgrades` habilitado.

---

## Plan de remediación (por tandas)

### Tanda 1 — hoy, sin tocar código (bloquea ~80 % del riesgo)
- [~] **Restringir `:8080` por firewall** — *decisión 2026-07-22: **diferido**.* Se
      compensará en la Tanda 2 a nivel app (token secreto + allowlist + rate-limit)
      por la IP residencial dinámica del datalogger. NB: `ufw` **no** filtra puertos
      publicados por Docker; si se retoma, usar Oracle Security List o `DOCKER-USER`.
- [x] `chmod 600 ~/ecowitt-weather-server-xe1e/.env` — hecho 2026-07-22 (era 0664).
- [x] Instalar y activar **fail2ban** (jail sshd) — hecho 2026-07-22 (v0.11.2, activo;
      ya baneó IPs de fuerza bruta SSH).
- [x] Aplicar los **parches de seguridad** del SO — hecho 2026-07-22 vía
      `unattended-upgrade`; reinicio realizado para activar el kernel nuevo
      (6.8.0-1058-oracle). Docker/contenedores no afectados.
- [ ] Verificar que el password admin es fuerte y único. *(A cargo del operador.)*

> **Nota sobre `:8080` (decisión pendiente):** el datalogger WS2910 empuja desde
> una IP residencial (`187.190.230.x`, probablemente **dinámica**). nginx sí ve la
> IP real, así que un filtro por IP funcionaría, pero se rompería al cambiar la IP.
> Opciones: (a) allowlist del bloque `/24` en la Oracle Security List (equilibrio);
> (b) mover el push a HTTPS por `clima.xe1e.net` y **cerrar `:8080`** (lo más limpio,
> requiere que la consola soporte HTTPS); (c) dejarlo y compensar con token+allowlist
> a nivel app (Tanda 2). Elegir antes de tocar el firewall.

### Tanda 2 — código (una sesión) + deploy — hecho 2026-07-22
- [x] `_require_admin` en `PUT /api/stations/{name}` (el frontend ya enviaba el
      Bearer vía `fetchWithAuth`, así que no rompe el panel).
- [x] Filtrar el `passkey`: se elimina en `/data/report` justo tras resolver la
      estación, así que ya no entra a memoria ni se filtra por `/api/current`,
      `/api/stations`, etc. (arreglo en el origen).
- [x] Rate-limit (5/min por IP) + logging de fallos y éxitos en `/api/admin/login`.
- [~] `/data/report`: **rate-limit** (60/min por IP) + `client_max_body_size 32k`.
      La activación por defecto de token/allowlist queda **diferida**: exige
      configurar la consola física para enviar el `?token=` (acción del operador),
      si no, cortaría la ingesta en vivo.
- [x] Validar parámetros que entran a Flux (`station`, `measurement`, `start`,
      `stop`) — en el chokepoint `_station_filter` + en los endpoints (400 limpio).
- [x] Headers de seguridad en Caddy (HSTS, X-Content-Type-Options, Referrer-Policy;
      `X-Frame-Options: DENY` **solo** en `/admin` y `/pro/admin` para no romper el
      widget `/embed` ni el kiosko, que deben ser incrustables).
- [x] `client_max_body_size 32k` en el `location /data/report` de nginx.
- [x] **Extra:** CORS restringido a `clima.xe1e.net` (sin `allow_credentials`);
      errores 500 genéricos (sin `str(e)`) en `/data/report` e history/stats.

### Tanda 3 — endurecimiento — hecho 2026-07-22
- [x] Actualizar dependencias Python: `fastapi 0.115.6`, `python-multipart 0.0.18`
      (cierra CVE-2024-47874 / 24762 / 53981), + uvicorn/pydantic/httpx al día.
      `paho-mqtt` se mantiene en 1.6.1 (la 2.x rompe la API de callbacks).
- [x] `os.chmod(0o600)` al escribir `settings.json` (helper `_write_json_secure`).
- [x] Hash del password admin (PBKDF2-SHA256, stdlib) → `ADMIN_PASSWORD_HASH`
      (opt-in, con fallback a `ADMIN_PASSWORD`; generador en `admin.hash_password`).
- [x] CORS restringido a `clima.xe1e.net` sin `allow_credentials` (ya en Tanda 2).
- [~] Coordenadas públicas: *decisión 2026-07-22: **dejarlas exactas*** (ya visibles
      en WU/CWOP; sin cambio).
- [x] InfluxDB y Grafana: credenciales parametrizadas a variables de `.env`
      (con fallback; nota: las de InfluxDB solo aplican al inicializar el volumen).
- [~] Errores 500 genéricos: hecho en `/data/report`, `/api/history`, `/api/stats/*`;
      resto de endpoints aún con `str(e)` (bajo riesgo, pendiente de barrido).
- [x] `POST /api/admin/logout` que revoca el token server-side (+ el frontend lo llama).
- [x] Validación/coerción de tipos del body de `POST /settings` (422 si es inválido).
- [x] Deshabilitar rpcbind (`:111`).

---

*Documento generado el 2026-07-22 a partir de una auditoría de código e infraestructura.*
*Actualizar las casillas conforme se completen las remediaciones.*
