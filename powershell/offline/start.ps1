# start.ps1 - start the offline HTTPS server (and optionally launch Office apps).
# The LLM backend address can be given three ways (priority order):
#   1. -LlmProxyTarget http://host:port   (this run only)
#   2. server-config.json next to this script (persistent)
#   3. not set - /llm-proxy/* returns 502 until configured

param(
    [ValidateSet('none', 'word', 'excel', 'powerpoint', 'all')]
    [string]$Launch = 'none',
    [string]$LlmProxyTarget = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -eq 'office-agents localhost' } |
    Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) {
    Write-Host 'Certificate not found - run install.ps1 first.' -ForegroundColor Red
    exit 1
}

# sanity check: at least one site directory is populated
$siteOk = $false
foreach ($d in 'excel', 'powerpoint', 'word') {
    if (Test-Path (Join-Path $root "site\$d\taskpane.html")) { $siteOk = $true }
}
if (-not $siteOk) {
    Write-Host 'WARNING: site/*/taskpane.html not found - the server will return 404.' -ForegroundColor Yellow
    Write-Host '         Run build-package.ps1 on a machine with Node.js, or copy a ready site/ folder.' -ForegroundColor Yellow
}

Write-Host 'Starting server in a new window...' -ForegroundColor Cyan
$serverArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'server.ps1'))
if ($LlmProxyTarget) { $serverArgs += @('-LlmProxyTarget', $LlmProxyTarget) }
Start-Process powershell.exe -WorkingDirectory $root -ArgumentList $serverArgs

Start-Sleep -Seconds 2

switch ($Launch) {
    'word'       { Start-Process winword.exe }
    'excel'      { Start-Process excel.exe }
    'powerpoint' { Start-Process powerpnt.exe }
    'all'        { Start-Process winword.exe; Start-Process excel.exe; Start-Process powerpnt.exe }
}

Write-Host ''
Write-Host 'Server:      https://localhost:3000 (Excel), 3001 (PowerPoint), 3002 (Word)' -ForegroundColor Cyan
if ($Launch -ne 'none') { Write-Host 'Office apps launched.' }
Write-Host 'Add the add-ins once per app:' -ForegroundColor Cyan
Write-Host '  Insert -> Get Add-ins -> SHARED FOLDER -> OpenExcel / OpenPPT / OpenWord -> Add'
Write-Host ''
Write-Host 'LLM settings inside the add-in (Settings -> custom endpoint):' -ForegroundColor Cyan
Write-Host '  https://localhost:3000/llm-proxy/v1   (Excel taskpane)'
Write-Host '  https://localhost:3002/llm-proxy/v1   (Word taskpane)'
Write-Host '  backend address: -LlmProxyTarget param or server-config.json (see QUICKSTART.md)'
Write-Host ''
