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

### 7. Configurar Network Security Group (NSG)

**IMPORTANTE**: Oracle Cloud requiere abrir puertos en Security List Y en NSG.

1. Ir a la página de tu instancia
2. Cintillo **Networking** → Click en **Primary VNIC**
3. Buscar **Network Security Groups** → Click en el NSG asignado
4. **Add Ingress Rules**:

```
Source CIDR:           0.0.0.0/0
IP Protocol:           TCP
Destination Port Range: 8080
Description:           Ecowitt
```

### 8. Configurar Firewall Interno (iptables)

Conectarse por SSH:

```bash
ssh -i oracle.key ubuntu@163.192.147.208
```

Abrir puertos:

```bash
sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
```

## Instalación de WeatherNode

### 1. Actualizar sistema e instalar dependencias

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y software-properties-common
sudo add-apt-repository ppa:ondrej/php -y
sudo apt update
sudo apt install -y apache2 php8.2 php8.2-sqlite3 php8.2-curl php8.2-xml php8.2-mbstring php8.2-intl php8.2-cli libapache2-mod-php8.2 composer git unzip
```

### 2. Configurar Apache en puerto 8080

```bash
sudo sed -i 's/Listen 80/Listen 8080/' /etc/apache2/ports.conf
sudo sed -i 's/:80/:8080/' /etc/apache2/sites-available/000-default.conf
sudo a2enmod rewrite
```

### 3. Clonar WeatherNode

```bash
cd /var/www/html
sudo git clone https://github.com/centauri/WeatherNode.git weathernode
sudo chown -R www-data:www-data /var/www/html/weathernode
```

### 4. Instalar dependencias PHP

```bash
cd /var/www/html/weathernode
sudo COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader
```

### 5. Configurar WeatherNode

```bash
sudo cp .env.example .env
sudo php artisan key:generate
sudo touch database/database.sqlite
sudo chown -R www-data:www-data /var/www/html/weathernode
sudo php artisan migrate --force
```

### 6. Configurar Virtual Host de Apache

```bash
sudo nano /etc/apache2/sites-available/000-default.conf
```

Contenido:

```apache
<VirtualHost *:8080>
    ServerAdmin webmaster@localhost
    DocumentRoot /var/www/html/weathernode/public

    <Directory /var/www/html/weathernode/public>
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/error.log
    CustomLog ${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
```

### 7. Reiniciar Apache

```bash
sudo systemctl restart apache2
```

### 8. Verificar instalación

```bash
curl -s localhost:8080 | head -5
```

Acceder desde navegador: http://163.192.147.208:8080

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
- En Windows, arreglar permisos:
  ```powershell
  icacls "oracle.key" /inheritance:r
  icacls "oracle.key" /grant:r "%USERNAME%:R"
  ```
- En Linux/Mac: `chmod 400 oracle.key`
- Verificar que el puerto 22 esté abierto en Security List y NSG

### No carga la página web (pero SSH funciona)
1. Verificar puerto 8080 en **Security List** ✓
2. Verificar puerto 8080 en **Network Security Group (NSG)** ← Común olvidar
3. Verificar iptables: `sudo iptables -L INPUT -n | grep 8080`
4. Verificar Apache escucha: `sudo ss -tlnp | grep 8080`

### El Ecowitt no envía datos
1. Verificar IP pública correcta en configuración del gateway
2. Verificar puerto 8080 abierto en Security List Y NSG
3. Verificar iptables permite el puerto
4. Verificar que WeatherNode esté corriendo
5. Recordar: Ecowitt NO soporta HTTPS, solo HTTP

### IP pública no disponible
- Verificar que la subnet sea pública
- Verificar límite de IPs en Always Free tier (máximo 2)

### Error de permisos en composer/artisan
- Usar `sudo` con variable de entorno:
  ```bash
  sudo COMPOSER_ALLOW_SUPERUSER=1 composer install
  ```
- Después arreglar permisos:
  ```bash
  sudo chown -R www-data:www-data /var/www/html/weathernode
  ```
