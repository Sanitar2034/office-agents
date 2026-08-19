# uninstall.ps1 - remove everything install.ps1 created (per-user only).

$ErrorActionPreference = 'Stop'
$catalogGuid = '{7d3a1c92-4b5e-4f6a-8a90-3c2d1b0e9f55}'
$certFriendlyName = 'office-agents localhost'

# 1. trusted catalog entry
$regKey = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\$catalogGuid"
if (Test-Path $regKey) {
    Remove-Item $regKey -Recurse -Force
    Write-Host "removed catalog entry $catalogGuid" -ForegroundColor Green
} else {
    Write-Host 'catalog entry not found (nothing to do)'
}

# 2. certificate from Root + My
$certs = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -eq $certFriendlyName }
foreach ($c in $certs) {
    foreach ($store in 'My', 'Root') {
        $path = "Cert:\CurrentUser\$store\$($c.Thumbprint)"
        if (Test-Path $path) {
            Remove-Item $path
            Write-Host "removed certificate from CurrentUser\$store ($($c.Thumbprint))" -ForegroundColor Green
        }
    }
}
Write-Host 'done.'
