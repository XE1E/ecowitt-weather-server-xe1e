# Configuración Oracle Cloud VPS para Ecowitt

Guía de configuración inicial de la instancia Oracle Cloud. Una vez creada,
ver **[DEPLOY.md](DEPLOY.md)** para instalar el stack (FastAPI + InfluxDB + React).

## Datos de la Instancia

| Campo | Valor |
|-------|-------|
| **IP Pública** | 163.192.147.208 |
| **Región** | mx-queretaro-1 |
| **VCN** | vcn-20260703-2226 |
| **Subnet CIDR** | 10.0.0.0/24 |
| **Tipo de Subnet** | Public Subnet (Regional) |
| **DNS** | subnet07032246.vcn07032246.oraclevcn.com |

## Puertos Abiertos (Security List)

| Puerto | Protocolo | Uso |
|--------|-----------|-----|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (Caddy → HTTPS redirect) |
| 443 | TCP | HTTPS (Caddy + Cloudflare Origin) |
| 8080 | TCP | Receptor Ecowitt (directo, sin HTTPS) |

## Pasos de Creación

### 1. Crear Compute Instance

1. Oracle Cloud Console → **Compute** → **Instances** → **Create instance**
2. Configurar:
   - **Name**: nombre de tu instancia
   - **Image**: Ubuntu 22.04 (recomendado para Docker)
   - **Shape**: VM.Standard.A1.Flex (ARM, Always Free: hasta 4 OCPU / 24 GB RAM)

> **Nota**: La cuenta debe ser **PAYG** (Pay As You Go) para evitar que Oracle
> reclame la instancia por inactividad en la capa gratuita.

### 2. Networking (Primary VNIC)

1. **Virtual cloud network**: Create new VCN
2. **Subnet**: Create new public subnet
3. **Public IPv4 address**: Assign a public IPv4 address

> **Nota**: Si la opción de IP pública está deshabilitada, la subnet seleccionada
> es privada. Crea una nueva subnet pública.

### 3. SSH Keys

1. Seleccionar **Generate a key pair for me**
2. **Importante**: Click en **Save private key** y guardar el archivo `.key`
3. Sin esta clave no podrás acceder a la instancia

### 4. Boot Volume

- Dejar valores por defecto (50 GB, Balanced performance)
- Para Always Free tier, no modificar el tamaño

### 5. Asignar IP Pública (si no se asignó durante creación)

1. Ir a la instancia → cintillo **IP Administration** → **IPv4 Addresses**
2. Click en **⋮** (tres puntos) junto a la IP privada
3. **Edit** → seleccionar **Ephemeral public IP** o **Reserved public IP**
4. Guardar

### 6. Configurar Security List

1. Menú ☰ → **Networking** → **Virtual cloud networks**
2. Click en tu VCN
3. Cintillo → **Security Lists**
4. Click en la Security List
5. **Add Ingress Rules** para cada puerto:

```
Source CIDR:           0.0.0.0/0
IP Protocol:           TCP
Destination Port Range: 22
Description:           SSH
```

```
Source CIDR:           0.0.0.0/0
IP Protocol:           TCP
Destination Port Range: 80
Description:           HTTP
```

```
Source CIDR:           0.0.0.0/0
IP Protocol:           TCP
Destination Port Range: 443
Description:           HTTPS
```

```
Source CIDR:           0.0.0.0/0
IP Protocol:           TCP
Destination Port Range: 8080
Description:           Ecowitt
```

### 7. Configurar Network Security Group (NSG)

**IMPORTANTE**: Oracle Cloud requiere abrir puertos en Security List Y en NSG.

1. Ir a la página de tu instancia
2. Cintillo **Networking** → Click en **Primary VNIC**
3. Buscar **Network Security Groups** → Click en el NSG asignado
4. **Add Ingress Rules** para los mismos puertos (22, 80, 443, 8080)

### 8. Configurar Firewall Interno (iptables)

Conectarse por SSH:

```bash
ssh -i oracle.key ubuntu@163.192.147.208
```

Abrir puertos:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
```

---

## Siguiente Paso: Instalar el Stack

Una vez la instancia esté lista y accesible por SSH, seguir la guía de
**[DEPLOY.md](DEPLOY.md)** para instalar Docker y el stack completo:

- **receiver** (FastAPI): recibe datos del gateway Ecowitt
- **influxdb**: base de series temporales
- **dashboard** (React + Nginx): sirve la web y hace proxy de `/api`
- **caddy**: TLS/HTTPS con certificado Origin de Cloudflare

---

## Troubleshooting

### No puedo conectar por SSH

- Verificar que guardaste la clave privada
- En Windows, arreglar permisos:
  ```powershell
  icacls "oracle.key" /inheritance:r
  icacls "oracle.key" /grant:r "%USERNAME%:R"
  ```
- En Linux/Mac: `chmod 400 oracle.key`
- Verificar que el puerto 22 esté abierto en Security List y NSG

### No carga la página web (pero SSH funciona)

1. Verificar puertos en **Security List** ✓
2. Verificar puertos en **Network Security Group (NSG)** ← Común olvidar
3. Verificar iptables: `sudo iptables -L INPUT -n | grep -E "80|443|8080"`
4. Verificar que Docker esté corriendo: `docker compose ps`

### El gateway Ecowitt no envía datos

1. Verificar IP/dominio correctos en configuración del gateway
2. Verificar puerto abierto en Security List Y NSG
3. Verificar iptables permite el puerto
4. Verificar logs: `docker logs ecowitt-receiver`
5. Recordar: Ecowitt NO soporta HTTPS nativo; usa puerto 8080 directo o Caddy
   con HTTP en el path `/data/report/`

### IP pública no disponible

- Verificar que la subnet sea pública
- Verificar límite de IPs en Always Free tier (máximo 2)
