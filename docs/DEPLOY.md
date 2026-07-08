# Despliegue en el VPS (Oracle Cloud ARM64)

Guía para desplegar el **stack propio del repo** (receiver + InfluxDB + dashboard)
en el VPS Oracle (Ubuntu 22.04, ARM Ampere A1), reemplazando WeatherNode.

> Arquitectura: el WS2910 hace **push** por HTTP al VPS; el dashboard nginx es la
> **única entrada pública** (puerto 8080) y hace proxy interno de `/api` y
> `/data/report/` al receiver. InfluxDB y Grafana quedan **internos** (no se exponen).

```
WS2910 ──HTTP:8080──▶ [ nginx dashboard ] ─┬─ /            → SPA (React)
                                            ├─ /api/*       → receiver:8080
                                            └─ /data/report → receiver:8080 ──▶ InfluxDB
```

---

## 0. Requisitos

- Acceso SSH al VPS: `ssh -i "oracle.key" ubuntu@163.192.147.208`
- Puerto TCP **8080** abierto en Oracle (Security List + NSG + iptables) — ya configurado.

---

## 1. Liberar el puerto 8080 (apagar Apache/WeatherNode)

El WeatherNode actual usa Apache en el 8080. Lo detenemos para que nuestro stack
tome ese puerto (los datos de WeatherNode no se pierden; quedan en el VPS por si
quieres volver).

```bash
sudo systemctl disable --now apache2
sudo ss -ltnp | grep :8080 || echo "8080 libre"
```

## 2. Instalar Docker + Compose (ARM64)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker            # o cierra y reabre la sesión SSH
docker --version && docker compose version
```

## 3. Clonar el repo y configurar `.env`

```bash
cd ~
git clone https://github.com/XE1E/ecowitt-weather-server-xe1e.git
cd ecowitt-weather-server-xe1e
cp .env.example .env
```

Edita `.env` y define al menos:

```bash
# Token fuerte para InfluxDB (genéralo así):
#   openssl rand -hex 32
INFLUXDB_TOKEN=<pega-el-token-generado>

OUTPUT_UNIT_SYSTEM=metric
TZ=America/Mexico_City
DATA_RETENTION_DAYS=90
```

> El mismo `INFLUXDB_TOKEN` lo usan el contenedor de InfluxDB (para inicializarse)
> y el receiver (para escribir). No lo cambies después de la primera inicialización.

## 4. Levantar el stack

El `docker-compose.yml` ya deja el **dashboard como entrada pública en 8080** y
mantiene `receiver` e `influxdb` internos. Grafana es opcional (perfil `grafana`).

```bash
docker compose up -d --build
docker compose ps
```

Servicios resultantes:

| Servicio    | Puerto | Exposición | Notas |
|-------------|--------|------------|-------|
| dashboard   | 8080 (host) → 80 | **pública** | entrada única; sirve UI + proxy `/api` y `/data/report` |
| receiver    | interno (8080) | privada | recibe el push, escribe a InfluxDB |
| influxdb    | interno (8086) | privada | base de datos de series temporales |
| grafana     | (perfil `grafana`) | privada | opcional: `docker compose --profile grafana up -d` |

> El puerto público se puede cambiar con `WEB_PORT` en `.env` (por defecto 8080).
> Para acceder al admin de InfluxDB o a Grafana, usa un túnel SSH, p. ej.
> `ssh -L 8086:localhost:8086 -i oracle.key ubuntu@163.192.147.208`.

## 5. Verificar

```bash
# Salud (proxy nginx -> receiver)
curl -s http://localhost:8080/health

# Simular un push del WS2910
curl -s -X POST http://localhost:8080/data/report/ \
  -d "stationtype=EasyWeatherPro&model=WS2910&tempf=71.6&humidity=64&tempf1=&temp1f=70.2&humidity1=48&wh65batt=0&batt1=0"

# Ver el último dato
curl -s http://localhost:8080/api/current

# Abrir el dashboard: http://163.192.147.208:8080/
```

## 6. Configurar el WS2910

En la app **WS View Plus** → Weather Services → Customized:

| Campo | Valor |
|-------|-------|
| Protocol Type | Ecowitt |
| Server IP | `163.192.147.208` |
| Port | `8080` |
| Path | `/data/report/` |
| Interval | 60 s |

## 7. Operación

```bash
docker compose logs -f receiver        # ver datos entrando
docker compose --profile dashboard up -d --build   # actualizar tras git pull
docker compose down                    # detener (conserva volúmenes/datos)
```

Los datos de InfluxDB persisten en el volumen `influxdb-data`.

## 8. Backups de InfluxDB

Hay un script que genera un backup consistente (`influx backup`) y rota los
últimos 7:

```bash
chmod +x scripts/backup-influx.sh
./scripts/backup-influx.sh        # (usa sudo si tu usuario no está en el grupo docker)
```

Los backups quedan en `~/ecowitt-backups/influx-YYYYmmdd-HHMMSS.tar.gz`.

**Automatizar con cron** (diario a las 3:30 am):
```bash
( crontab -l 2>/dev/null; echo "30 3 * * * cd $HOME/ecowitt-weather-server-xe1e && ./scripts/backup-influx.sh >> $HOME/ecowitt-backups/backup.log 2>&1" ) | crontab -
```

**Restaurar** (si algún día hace falta):
```bash
tar -xzf ~/ecowitt-backups/influx-XXXX.tar.gz -C /tmp
docker compose cp /tmp/influx-XXXX influxdb:/tmp/restore
docker compose exec influxdb influx restore /tmp/restore -t "$INFLUXDB_TOKEN" --full
```

---

## Notas

- **HTTPS + dominio (`clima.xe1e.net`):** ver **[DOMINIO-HTTPS.md](DOMINIO-HTTPS.md)**.
  Resumen: DNS A record → VPS, abrir 80/443 en Oracle, y levantar con el perfil
  Caddy (`docker compose --profile caddy up -d`). El WS2910 sigue en HTTP por IP:8080.
- **Home Assistant (remoto):** lee la API REST pública, p. ej.
  `http://163.192.147.208:8080/api/current` (ver Arquitectura B en ESTUDIO_VIABILIDAD.md).
- **Volver a WeatherNode:** `sudo systemctl enable --now apache2` tras `docker compose down`.
