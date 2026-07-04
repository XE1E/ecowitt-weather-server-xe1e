# Configuración Oracle Cloud VPS para Ecowitt

Guía de configuración del servidor Oracle Cloud para recibir datos del gateway Ecowitt.

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
| 8080 | TCP | Receptor Ecowitt |

## Pasos de Creación

### 1. Crear Compute Instance

1. Oracle Cloud Console → **Compute** → **Instances** → **Create instance**
2. Configurar:
   - **Name**: nombre de tu instancia
   - **Image**: Oracle Linux o Ubuntu
   - **Shape**: VM.Standard.E2.1.Micro (Always Free)

### 2. Networking (Primary VNIC)

1. **Virtual cloud network**: Create new VCN
2. **Subnet**: Create new public subnet
3. **Public IPv4 address**: Assign a public IPv4 address

> **Nota**: Si la opción de IP pública está deshabilitada, la subnet seleccionada es privada. Crea una nueva subnet pública.

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
5. **Add Ingress Rules**:

```
Source CIDR:           0.0.0.0/0
IP Protocol:           TCP
Destination Port Range: 8080
Description:           Ecowitt
```

### 7. Configurar Firewall Interno (iptables)

Conectarse por SSH:

```bash
ssh -i tu_clave_privada.key ubuntu@163.192.147.208
```

Abrir puertos:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

## Configuración del Gateway Ecowitt

Una vez el servidor esté funcionando, configurar el gateway GW3000:

1. Abrir app **WSView** o **WS Tool**
2. Ir a **Customized** → **Weather Services**
3. Configurar:
   - **Server IP/Hostname**: 163.192.147.208
   - **Path**: /data/report/
   - **Port**: 8080
   - **Protocol**: HTTP
4. Guardar y verificar que envíe datos

## Verificar Funcionamiento

```bash
# Verificar que el puerto esté escuchando
sudo netstat -tlnp | grep 8080

# Probar el endpoint
curl http://163.192.147.208:8080/health

# Ver datos actuales
curl http://163.192.147.208:8080/api/current
```

## Troubleshooting

### No puedo conectar por SSH
- Verificar que guardaste la clave privada
- Verificar permisos: `chmod 400 tu_clave_privada.key`
- Verificar que el puerto 22 esté abierto en Security List

### El Ecowitt no envía datos
1. Verificar IP pública correcta en configuración del gateway
2. Verificar puerto 8080 abierto en Security List
3. Verificar iptables permite el puerto
4. Verificar que el servicio receptor esté corriendo

### IP pública no disponible
- Verificar que la subnet sea pública
- Verificar límite de IPs en Always Free tier (máximo 2)
