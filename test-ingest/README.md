# Worker de prueba — validar la ingesta HTTP del WS2910 en Cloudflare

Objetivo único: comprobar que un **POST HTTP plano** (sin TLS, sin seguir
redirects, como el WS2910) **llega a un Worker con `200`** y no un `301`
http→https. Es el experimento que decide la viabilidad del proyecto
"Todo con Cloudflare" (ver [`../docs/PRUEBA-INGESTA-CLOUDFLARE.md`](../docs/PRUEBA-INGESTA-CLOUDFLARE.md)).

## Requisitos
- Node.js instalado.
- Cuenta de Cloudflare con tu dominio (`xe1e.net`) ya activo ahí.

## Pasos

**1) DNS.** En Cloudflare → DNS, crea el registro **`estacion-test`** como
**PROXIED** (nube naranja). Puede ser un `CNAME estacion-test → xe1e.net` o un
`A estacion-test → 192.0.2.1` (IP ficticia); da igual, la ruta la atiende el Worker.

**2) Instalar y autenticar.**
```bash
cd test-ingest
npm install
npx wrangler login
```
*(Si tu dominio no es `xe1e.net`, edita `pattern` y `zone_name` en `wrangler.toml`.)*

**3) Desplegar.**
```bash
npm run deploy        # = npx wrangler deploy
```

**4) Prueba A — reproducir el problema (redirect por defecto).**
Con "Always Use HTTPS" activo (lo normal hoy), el POST HTTP debería recibir 301:
```bash
python3 ../scripts/ws2910_probe.py http://estacion-test.xe1e.net/data/report/
# Esperado ahora: [FALLA] redireccion 301 -> https://...
```

**5) Crear la regla anti-redirect.**
En Cloudflare → **Rules → Configuration Rules** (o Page Rules), para
`estacion-test.xe1e.net/data/report*`:
- Desactiva el forzado a HTTPS / "Always Use HTTPS" **para esa ruta**
  (y "Automatic HTTPS Rewrites: Off").

**6) Prueba B — confirmar el arreglo.**
```bash
python3 ../scripts/ws2910_probe.py http://estacion-test.xe1e.net/data/report/
# Éxito: [OK] 200  — el POST llegó al Worker.
```
En otra terminal puedes ver el log en vivo:
```bash
npm run tail          # = npx wrangler tail  -> debe imprimir "INGESTA OK ..."
```
O abre en el navegador `https://estacion-test.xe1e.net/` y mira
`ultimo_post_recibido`.

**7) (Opcional) Probar el puerto 8080**, por si lo quieres usar en la consola:
```bash
python3 ../scripts/ws2910_probe.py http://estacion-test.xe1e.net/data/report/ --port 8080
```

## Interpretación
- **`[OK] 200`** → ✅ la ingesta directa a Cloudflare es viable; el proyecto sigue.
- **Siempre `301`** → revisar la regla del paso 5 (o el orden de reglas).
- **Conexión rechazada** → ese puerto no está soportado/proxied; prueba 80/8080.

## Limpieza
```bash
npx wrangler delete            # borra el Worker de prueba
```
Y borra el registro DNS `estacion-test` y la regla, si quieres dejar todo como estaba.
