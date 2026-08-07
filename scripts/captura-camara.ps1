<#
.SYNOPSIS
    Captura una foto de la cámara Tapo y la sube al servidor.

.DESCRIPTION
    Saca un fotograma del stream RTSP con ffmpeg y lo empuja a
    POST /api/camera/upload. Pensado para correr cada 5 min desde el
    Programador de tareas de Windows.

    POR QUÉ HACE FALTA ESTO Y NO SE HACE DESDE EL SERVIDOR:
    la cámara sólo habla RTSP/ONVIF dentro de la RED LOCAL --lo dice la propia FAQ de
    TP-Link-- y el servidor vive en un VPS, al otro lado del NAT de casa. La cuenta
    Tapo tampoco resuelve esto: su API oficial es para partners y sirve para controlar
    dispositivos, no para descargar fotogramas. Así que alguien dentro de casa tiene
    que sacar la foto y EMPUJARLA hacia fuera. No hace falta hardware nuevo: vale
    cualquier equipo de la casa que esté encendido.

    Y nunca se abre un puerto hacia la cámara: es una cámara de consumo con las
    credenciales en la propia URL.

.PARAMETER Once
    Captura una vez y termina, mostrando lo que hace. Para probar la configuración.

.PARAMETER Archivo
    Sube ESE archivo en vez de capturar de la cámara. Sirve para dejar probada la
    mitad del camino --token, red, servidor-- antes de tener la cámara instalada, y
    para reenviar una foto a mano si hiciera falta.

.EXAMPLE
    .\captura-camara.ps1 -Once
    .\captura-camara.ps1 -Once -Archivo C:\ruta\foto.jpg

.NOTES
    Requiere ffmpeg en el PATH:  winget install Gyan.FFmpeg
    Configuración en camara.env (ver camara.env.example), NUNCA en este archivo.

    Este archivo se guarda en UTF-8 CON BOM a propósito: Windows PowerShell 5.1 lee
    los .ps1 sin BOM como ANSI y los acentos salen rotos en los mensajes.
#>
[CmdletBinding()]
param(
    [switch]$Once,
    [string]$Archivo,
    [string]$EnvFile = (Join-Path $PSScriptRoot 'camara.env')
)

$ErrorActionPreference = 'Stop'

# ── Configuración ────────────────────────────────────────────────────────────
# Fuera del script y fuera del repo: lleva la contraseña de la cámara y el token de
# subida. `camara.env` está en .gitignore.
if (-not (Test-Path $EnvFile)) {
    Write-Error "Falta $EnvFile. Copia scripts/camara.env.example y rellénalo."
    exit 1
}

$cfg = @{}
Get-Content $EnvFile | ForEach-Object {
    $linea = $_.Trim()
    if ($linea -and -not $linea.StartsWith('#') -and $linea.Contains('=')) {
        $k, $v = $linea -split '=', 2
        $cfg[$k.Trim()] = $v.Trim().Trim('"')
    }
}

function Requerido($clave) {
    if (-not $cfg[$clave]) { Write-Error "Falta $clave en $EnvFile"; exit 1 }
    return $cfg[$clave]
}

$camIp    = Requerido 'CAMERA_IP'
$camUser  = Requerido 'CAMERA_USER'      # la CUENTA DE CÁMARA de la app Tapo,
$camPass  = Requerido 'CAMERA_PASS'      # que NO es la cuenta TP-Link
$apiUrl   = Requerido 'API_URL'
$token    = Requerido 'UPLOAD_TOKEN'
$stream   = if ($cfg['CAMERA_STREAM']) { $cfg['CAMERA_STREAM'] } else { 'stream1' }
$ancho    = if ($cfg['MAX_WIDTH'])     { [int]$cfg['MAX_WIDTH'] } else { 1600 }
$intentos = if ($cfg['RETRIES'])       { [int]$cfg['RETRIES'] }   else { 3 }

$logDir  = Join-Path $env:LOCALAPPDATA 'ecowitt-camara'
$logFile = Join-Path $logDir 'captura.log'
$tmpJpg  = Join-Path $logDir 'captura.jpg'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Log($msg) {
    $linea = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $logFile -Value $linea -Encoding utf8
    if ($Once) { Write-Host $linea }
}

# Rotación simple: el log no debe crecer sin fin en una máquina desatendida.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
    Move-Item $logFile "$logFile.1" -Force
}

# ── 1. Sacar el fotograma ────────────────────────────────────────────────────
# -rtsp_transport tcp: por UDP la Tapo pierde paquetes y la foto sale con bandas.
# -ss 1 DESPUÉS de -i: descarta el primer segundo de stream. El primer fotograma
#   suele llegar a medio decodificar --el decodificador aún no tiene un keyframe
#   completo-- y salía media imagen gris.
# -q:v 3: calidad JPEG buena sin irse a 1 MB por foto.
$rtsp = "rtsp://${camUser}:${camPass}@${camIp}:554/$stream"
$args = @(
    '-hide_banner', '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    '-i', $rtsp,
    '-ss', '1',
    '-frames:v', '1',
    '-q:v', '3',
    '-vf', "scale='min($ancho,iw)':-2",
    '-f', 'image2', '-y', $tmpJpg
)

$capturada = $false

if ($Archivo) {
    if (-not (Test-Path $Archivo)) { Write-Error "No existe $Archivo"; exit 1 }
    Copy-Item $Archivo $tmpJpg -Force
    $capturada = $true
    Log "usando archivo $Archivo (sin capturar de la camara)"
}

for ($i = 1; (-not $capturada) -and $i -le $intentos; $i++) {
    try {
        if (Test-Path $tmpJpg) { Remove-Item $tmpJpg -Force }
        $p = Start-Process -FilePath 'ffmpeg' -ArgumentList $args -NoNewWindow -Wait -PassThru `
                           -RedirectStandardError (Join-Path $logDir 'ffmpeg.err')
        if ($p.ExitCode -eq 0 -and (Test-Path $tmpJpg) -and (Get-Item $tmpJpg).Length -gt 1024) {
            $capturada = $true
            break
        }
        $err = if (Test-Path (Join-Path $logDir 'ffmpeg.err')) {
            (Get-Content (Join-Path $logDir 'ffmpeg.err') -Raw).Trim()
        } else { "salida $($p.ExitCode)" }
        Log "intento $i/$intentos falló: $err"
    } catch {
        Log "intento $i/$intentos falló: $($_.Exception.Message)"
    }
    if ($i -lt $intentos) { Start-Sleep -Seconds (5 * $i) }
}

if (-not $capturada) {
    # NO se sube nada: más vale dejar en el servidor la foto anterior, que él ya
    # marcará como antigua pasados 20 min, que subir un fotograma roto.
    Log "SIN CAPTURA tras $intentos intentos; no se sube nada"
    exit 1
}

# ── 2. Subirla ───────────────────────────────────────────────────────────────
$bytes = (Get-Item $tmpJpg).Length
try {
    $resp = Invoke-RestMethod -Uri "$apiUrl/api/camera/upload" -Method Post `
                              -Headers @{ 'X-Camera-Token' = $token } `
                              -ContentType 'image/jpeg' `
                              -InFile $tmpJpg -TimeoutSec 60
    Log ("subida OK: {0} KB" -f [math]::Round($bytes / 1KB))
    if ($Once) { $resp | ConvertTo-Json -Compress | Write-Host }
} catch {
    # El servidor distingue los casos y vale la pena verlos en el log:
    #   401 token mal, 400 lo enviado no es un JPEG, 503 falta configurar el token.
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Log "ERROR al subir (HTTP $code): $($_.Exception.Message)"
    exit 1
}

# Explícito: el Programador de tareas muestra el código de salida como resultado de
# la última ejecución, y sin esto hereda el del comando anterior.
exit 0
