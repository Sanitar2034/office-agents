# server.ps1 - offline HTTPS static server for office-agents add-ins.
# Pure Windows PowerShell 5.1, no admin rights, no http.sys (uses TcpListener + SslStream).
# Serves:
#   https://localhost:3000  -> site/excel        (Excel add-in)
#   https://localhost:3001  -> site/powerpoint   (PowerPoint add-in)
#   https://localhost:3002  -> site/word         (Word add-in)
#   /office-js/*            -> office-js/        (vendored Office.js, replaces the CDN)
#   /llm-proxy/*            -> forwarded to $LlmProxyTarget (OpenAI-compatible LLM server)
#                               same-origin proxy avoids CORS and HTTPS->HTTP mixed content.

param(
    [string]$CertThumbprint = '',
    [string]$LlmProxyTarget = '',
    [string]$BindAddress = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$siteRoot = Join-Path $root 'site'
$officeJsRoot = Join-Path $root 'office-js'
$libPath = Join-Path $root 'server-lib.ps1'

# optional persisted settings: server-config.json { "llmProxyTarget": "http://..." }
$configFile = Join-Path $root 'server-config.json'
if (-not $LlmProxyTarget -and (Test-Path $configFile)) {
    try {
        $cfg = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.llmProxyTarget) { $LlmProxyTarget = [string]$cfg.llmProxyTarget }
    } catch { }
}

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

. $libPath

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

# certificate
$cert = $null
if ($CertThumbprint) {
    $cert = Get-Item "Cert:\CurrentUser\My\$CertThumbprint" -ErrorAction SilentlyContinue
    if (-not $cert) { $cert = Get-Item "Cert:\LocalMachine\My\$CertThumbprint" -ErrorAction SilentlyContinue }
} else {
    $cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -eq 'office-agents localhost' } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
}
if (-not $cert -or -not $cert.HasPrivateKey) {
    Write-Host ''
    Write-Host '  Certificate not found. Run install.ps1 first (creates a per-user' -ForegroundColor Red
    Write-Host '  self-signed localhost certificate, no admin required).' -ForegroundColor Red
    Write-Host ''
    exit 1
}
Write-Host "Using certificate: $($cert.Subject) (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))"

# listeners: port -> site dir (string keys: ordered-dictionary int keys resolve by position)
$portMap = [ordered]@{
    '3000' = (Join-Path $siteRoot 'excel')
    '3001' = (Join-Path $siteRoot 'powerpoint')
    '3002' = (Join-Path $siteRoot 'word')
}

# duplicate-launch guard: if an instance already owns one of our ports,
# exit quietly (keeps autostart and double-clicking start.ps1 harmless)
foreach ($p in $portMap.Keys) {
    if (Get-NetTCPConnection -LocalPort ([int]$p) -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "Port $p is already in use - another server instance is running. Exiting."
        exit 0
    }
}
foreach ($p in $portMap.Keys) {
    if (-not (Test-Path -LiteralPath $portMap[$p])) {
        Write-Host "  WARNING: site dir not found: $($portMap[$p])" -ForegroundColor Yellow
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $officeJsRoot 'office.js'))) {
    Write-Host '  WARNING: office-js/office.js not found - Office.js will not be served' -ForegroundColor Yellow
}

$ip = [Net.IPAddress]::Parse($BindAddress)
$listeners = @()
$contexts = @()
foreach ($p in $portMap.Keys) {
    $portNum = [int]$p
    $l = New-Object Net.Sockets.TcpListener($ip, $portNum)
    $l.Start(64)
    $listeners += $l
    $contexts += @{
        SiteDir    = $portMap[$p]
        OfficeJs   = $officeJsRoot
        Cert       = $cert
        Port       = $portNum
    }
    Write-Host "Listening on https://$BindAddress`:$portNum/  ->  $($portMap[$p])"
}
if ($LlmProxyTarget) {
    Write-Host "LLM proxy:  https://$BindAddress`:3000..3002/llm-proxy/*  ->  $LlmProxyTarget" -ForegroundColor Cyan
} else {
    Write-Host 'LLM proxy disabled (set -LlmProxyTarget http://host:port or server-config.json)' -ForegroundColor DarkGray
}
Write-Host 'Press Ctrl+C to stop.'

# runspace pool for concurrent connections
$pool = [RunspaceFactory]::CreateRunspacePool(1, 8)
$pool.Open()

# shared live state, visible to all runspaces (updated by /oa-config/llm-target)
$comBridge = $false
if (Test-Path $configFile) {
    try {
        $savedCfg = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($savedCfg.comBridge -eq $true) { $comBridge = $true }
    } catch { }
}
$sync = [hashtable]::Synchronized(@{
    LlmTarget = $LlmProxyTarget
    ComBridge = $comBridge
    ConfigFile = $configFile
})

$handlerScript = ". '$libPath'; Handle-OaConnection @args"

$jobs = New-Object System.Collections.ArrayList
try {
    while ($true) {
        # dispatch pending connections
        for ($i = 0; $i -lt $listeners.Count; $i++) {
            if ($listeners[$i].Pending()) {
                $client = $listeners[$i].AcceptTcpClient()
                $ctx = $contexts[$i]
                $ps = [PowerShell]::Create()
                $ps.RunspacePool = $pool
                $null = $ps.AddScript($handlerScript).
                    AddArgument($client).AddArgument($ctx.SiteDir).AddArgument($ctx.OfficeJs).
                    AddArgument($ctx.Cert).AddArgument($sync)
                $handle = $ps.BeginInvoke()
                [void]$jobs.Add(@{ PS = $ps; Handle = $handle })
            }
        }
        # reap finished jobs, print their log lines
        for ($j = $jobs.Count - 1; $j -ge 0; $j--) {
            if ($jobs[$j].Handle.IsCompleted) {
                $ps = $jobs[$j].PS
                try {
                    $out = $ps.EndInvoke($jobs[$j].Handle)
                    foreach ($line in $out) {
                        if ($line) { $ts = (Get-Date).ToString('HH:mm:ss'); Write-Host "[$ts] $line" -ForegroundColor DarkGray }
                    }
                } catch {
                    Write-Host "job error: $($_.Exception.Message)" -ForegroundColor Red
                } finally {
                    $ps.Dispose()
                }
                $jobs.RemoveAt($j)
            }
        }
        Start-Sleep -Milliseconds 20
    }
} finally {
    foreach ($l in $listeners) { try { $l.Stop() } catch { } }
    try { $pool.Close(); $pool.Dispose() } catch { }
    Write-Host 'Server stopped.'
}
