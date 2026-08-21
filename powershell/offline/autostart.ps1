# autostart.ps1 - start the offline HTTPS server automatically at Windows
# logon (per-user HKCU Run key - no admin rights required).
# Usage:
#   .\autostart.ps1 -Enable     register autostart
#   .\autostart.ps1 -Disable    remove autostart
#   .\autostart.ps1 -Status     (default) show current state

param(
    [switch]$Enable,
    [switch]$Disable,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'OfficeAgentsServer'
$serverPath = Join-Path $root 'server.ps1'
$logPath = Join-Path $root 'server-autostart.log'

if (-not (Test-Path $serverPath)) { throw "server.ps1 not found: $serverPath" }

# hidden window; the server exits quietly if another instance already owns
# the ports, so a duplicate logon launch is harmless; *> rewrites the log
# on every autostart so it never grows unbounded
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "& ''{0}'' *> ''{1}''"' -f $serverPath, $logPath

if ($Enable) {
    if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
    New-ItemProperty -Path $runKey -Name $runName -Value $command `
        -PropertyType String -Force | Out-Null
    Write-Host "Autostart ENABLED: the server starts at Windows logon." -ForegroundColor Green
    Write-Host "  command: $command" -ForegroundColor DarkGray
    Write-Host "  log:      $logPath (rewritten on each start)" -ForegroundColor DarkGray
    exit 0
}

if ($Disable) {
    Remove-ItemProperty -Path $runKey -Name $runName -Force -ErrorAction SilentlyContinue
    Write-Host 'Autostart DISABLED (the Run key was removed).' -ForegroundColor Green
    exit 0
}

# default: status
$current = (Get-ItemProperty $runKey -Name $runName -ErrorAction SilentlyContinue).$runName
if ($current) {
    Write-Host 'Autostart: ENABLED' -ForegroundColor Green
    Write-Host "  $current" -ForegroundColor DarkGray
} else {
    Write-Host 'Autostart: disabled' -ForegroundColor Yellow
    Write-Host 'Enable:  .\autostart.ps1 -Enable'
    Write-Host 'Disable: .\autostart.ps1 -Disable'
}
