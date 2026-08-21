# test-server.ps1 - e2e test of the offline HTTPS server (pure PS 5.1, self-contained).
# Usage:  powershell -ExecutionPolicy Bypass -File tests\test-server.ps1
# Needs: node (for the mock LLM), install.ps1 run at least once (certificate).
# Starts the server + mock on free test ports, runs assertions, cleans up.

param(
    [int]$TestPort = 13000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot        # offline/
Set-Location $root

# trust our self-signed cert for HTTPS calls in this process
Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAll {
    public static void Enable() {
        ServicePointManager.ServerCertificateValidationCallback =
            (a, b, c, d) => true;
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
    }
}
"@
[TrustAll]::Enable()

$pass = 0; $fail = 0
function Assert($name, $cond) {
    if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
    else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
function Http($method, $url, $body = $null, $headers = @{}) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Method = $method
        $req.Timeout = 15000
        $req.Proxy = $null
        foreach ($k in $headers.Keys) { $req.Headers[$k] = $headers[$k] }
        if ($body) {
            $bytes = [Text.Encoding]::UTF8.GetBytes($body)
            $req.ContentLength = $bytes.Length
            $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
        }
        $resp = $req.GetResponse()
        $sr = New-Object IO.StreamReader($resp.GetResponseStream())
        $text = $sr.ReadToEnd()
        return @{ Code = [int]$resp.StatusCode; Text = $text }
    } catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($r) {
            $sr = New-Object IO.StreamReader($r.GetResponseStream())
            return @{ Code = [int]$r.StatusCode; Text = $sr.ReadToEnd() }
        }
        return @{ Code = 0; Text = $_.Exception.Message }
    }
}

Write-Host "== office-agents offline server e2e ==" -ForegroundColor Cyan

# preflight: certificate exists
$cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -eq 'office-agents localhost' } | Select-Object -First 1
if (-not $cert) { Write-Host "No certificate: run install.ps1 first" -ForegroundColor Red; exit 1 }

# we cannot easily override server ports (fixed 3000-3002), so use them:
# fail fast if something already listens (test requires exclusive use)
$busy = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($busy) { Write-Host "Port 3000 busy - stop other server instances first" -ForegroundColor Red; exit 1 }

# backup server-config.json and REMOVE it for the run: the server must
# start from the clean default state (bridge disabled) regardless of what
# live testing left in the config
$cfgFile = Join-Path $root 'server-config.json'
$cfgBackup = $null
if (Test-Path $cfgFile) {
    $cfgBackup = Get-Content $cfgFile -Raw
    Remove-Item $cfgFile -Force
}

# 1) mock LLM on 8899
$mock = Start-Process node -ArgumentList "`"$PSScriptRoot\mock-llm.js`"" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

# 2) server under test
$srvLog = Join-Path $env:TEMP 'oa-test-server.log'
$srv = Start-Process powershell.exe -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    ('"{0}"' -f (Join-Path $root 'server.ps1')), '-LlmProxyTarget', 'http://127.0.0.1:8899'
) -PassThru -WindowStyle Hidden -RedirectStandardOutput $srvLog -RedirectStandardError "$srvLog.err"

try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if ((Http 'GET' "https://127.0.0.1:3000/taskpane.html").Code -eq 200) { $ready = $true; break }
    }
    Assert 'server started (taskpane 3000 = 200)' $ready
    if (-not $ready) { throw 'server did not start' }

    # statics on all three ports
    Assert 'taskpane 3001 = 200' ((Http 'GET' 'https://127.0.0.1:3001/taskpane.html').Code -eq 200)
    Assert 'taskpane 3002 = 200' ((Http 'GET' 'https://127.0.0.1:3002/taskpane.html').Code -eq 200)
    Assert 'vendored office.js = 200' ((Http 'GET' 'https://127.0.0.1:3000/office-js/office.js').Code -eq 200)

    # oa-config API
    $cfg = Http 'GET' 'https://127.0.0.1:3000/oa-config/llm-target'
    Assert 'oa-config GET = 200 json' ($cfg.Code -eq 200 -and $cfg.Text -match 'llmProxyTarget')
    Assert 'oa-config POST bad origin = 403' ((Http 'POST' 'https://127.0.0.1:3000/oa-config/llm-target' '{"llmProxyTarget":"http://1.2.3.4:1"}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    Assert 'oa-config POST bad url = 400' ((Http 'POST' 'https://127.0.0.1:3000/oa-config/llm-target' '{"llmProxyTarget":"ftp://nope"}' @{ Origin = 'https://localhost:3000' }).Code -eq 400)

    # llm proxy chain to the mock
    $models = Http 'GET' 'https://127.0.0.1:3000/llm-proxy/v1/models'
    Assert 'llm-proxy /v1/models = 200 from mock' ($models.Code -eq 200 -and $models.Text -match 'mock-model')
    $chat = Http 'POST' 'https://127.0.0.1:3000/llm-proxy/v1/chat/completions' '{"messages":[{"role":"user","content":"hi"}],"stream":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'llm-proxy chat SSE streams' ($chat.Code -eq 200 -and $chat.Text -match 'data:')

    # stale asset hint
    $stale = Http 'GET' 'https://127.0.0.1:3000/assets/definitely-stale-XYZ.js'
    Assert 'stale chunk 404 with reload hint' ($stale.Code -eq 404 -and $stale.Text -match 'bundle was rebuilt')

    # path traversal
    $trav = Http 'GET' 'https://127.0.0.1:3000/..%2f..%2f..%2fwindows/win.ini'
    Assert 'path traversal = 403' ($trav.Code -eq 403)

    # --- COM bridge (opt-in desktop power tools) ---
    $st = Http 'GET' 'https://127.0.0.1:3000/oa-com/status'
    Assert 'com status: disabled by default' ($st.Code -eq 200 -and $st.Text -match '"enabled":false' -and $st.Text -match 'excelRunning')
    Assert 'com run-macro: 503 when disabled' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/run-macro' '{"macro":"x"}' @{ Origin = 'https://localhost:3000' }).Code -eq 503)

    $en = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'com-bridge enable: 200 + persisted' ($en.Code -eq 200 -and (Get-Content $cfgFile -Raw) -match '"comBridge":\s*true')

    $st2 = Http 'GET' 'https://127.0.0.1:3000/oa-com/status'
    Assert 'com status: enabled after toggle' ($st2.Code -eq 200 -and $st2.Text -match '"enabled":true')

    Assert 'com run-macro: 403 bad origin' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/run-macro' '{"macro":"x"}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    $rm = Http 'POST' 'https://127.0.0.1:3000/oa-com/run-macro' '{"macro":"No.Such.Macro"}' @{ Origin = 'https://localhost:3000' }
    Assert 'com run-macro: COM contract (200 ok, or 409 when Excel is closed)' (($rm.Code -eq 200 -and ($rm.Text -match '"ok":true' -or $rm.Text -match '"ok":false')) -or $rm.Code -eq 409)

    $dis = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":false}' @{ Origin = 'https://localhost:3000' }
    Assert 'com-bridge disable: 200' ($dis.Code -eq 200)

    # --- dev add-in registration (WEF\Developer rollback button) ---
    $devGet = Http 'GET' 'https://127.0.0.1:3000/oa-config/dev-registration'
    Assert 'dev-registration GET = 200 json' ($devGet.Code -eq 200 -and $devGet.Text -match 'enabled' -and $devGet.Text -match 'registered')
    Assert 'dev-registration POST bad origin = 403' ((Http 'POST' 'https://127.0.0.1:3000/oa-config/dev-registration' '{"enabled":false}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    Assert 'dev-registration POST bad body = 400' ((Http 'POST' 'https://127.0.0.1:3000/oa-config/dev-registration' 'not-json' @{ Origin = 'https://localhost:3000' }).Code -eq 400)
    $devOff = Http 'POST' 'https://127.0.0.1:3000/oa-config/dev-registration' '{"enabled":false}' @{ Origin = 'https://localhost:3000' }
    Assert 'dev-registration unregister = 200 + state false' ($devOff.Code -eq 200 -and $devOff.Text -match '"enabled":false')
    Assert 'dev-registration GET after unregister = false' ((Http 'GET' 'https://127.0.0.1:3000/oa-config/dev-registration').Text -match '"enabled":false')
    $devOn = Http 'POST' 'https://127.0.0.1:3000/oa-config/dev-registration' '{"enabled":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'dev-registration restore = 200 + state true' ($devOn.Code -eq 200 -and $devOn.Text -match '"enabled":true')
    Assert 'dev-registration GET after restore = true' ((Http 'GET' 'https://127.0.0.1:3000/oa-config/dev-registration').Text -match '"enabled":true')

    # --- autostart (HKCU Run key, no admin) ---
    & (Join-Path $root 'autostart.ps1') -Enable | Out-Null
    $runVal = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'OfficeAgentsServer' -ErrorAction SilentlyContinue).OfficeAgentsServer
    Assert 'autostart enable: Run key exists and points at server.ps1' ($runVal -match 'server\.ps1')
    Assert 'autostart command launches hidden with log redirect' ($runVal -match 'Hidden' -and $runVal -match '\.log')
    & (Join-Path $root 'autostart.ps1') -Disable | Out-Null
    $runVal2 = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'OfficeAgentsServer' -ErrorAction SilentlyContinue).OfficeAgentsServer
    Assert 'autostart disable: Run key removed' ($null -eq $runVal2)

    # --- duplicate launch guard: a second server instance must exit quietly ---
    $dupLog = Join-Path $env:TEMP 'oa-test-dup.log'
    $dup = Start-Process powershell.exe -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $root 'server.ps1'))
    ) -PassThru -WindowStyle Hidden -RedirectStandardOutput $dupLog -RedirectStandardError "$dupLog.err"
    $dupExited = $dup.WaitForExit(15000)
    Assert 'duplicate server instance exits instead of failing to bind' $dupExited
    Assert 'original server still owns port 3000' ((Http 'GET' 'https://127.0.0.1:3000/taskpane.html').Code -eq 200)

    # --- PBI bridge (gated by the same desktop power toggle) ---
    $pst = Http 'POST' 'https://127.0.0.1:3000/oa-pbi/status'
    Assert 'pbi status: 200 + pbiRunning field' ($pst.Code -eq 200 -and $pst.Text -match 'pbiRunning')
    Assert 'pbi dax: 503 when disabled' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dax' '{"query":"EVALUATE 1"}' @{ Origin = 'https://localhost:3000' }).Code -eq 503)

    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'pbi dax: 403 bad origin' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dax' '{"query":"x"}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    Assert 'pbi dax: 400 without query' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dax' '{}' @{ Origin = 'https://localhost:3000' }).Code -eq 400)
    $pq2 = Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dax' '{"query":"EVALUATE ROW(\"x\", 1+1)"}' @{ Origin = 'https://localhost:3000' }
    Assert 'pbi dax: agent contract (ok:true with rows, or ok:false PBI not running)' ($pq2.Code -eq 200 -and ($pq2.Text -match '"ok":false' -or $pq2.Text -match '"ok":true'))
    # --- PBI Desktop Bridge (named pipe JSON-RPC) ---
    # --- PBI model management (TMSL/DMV) ---
    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":false}' @{ Origin = 'https://localhost:3000' }
    Assert 'pbi tmsl: 503 when disabled' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/tmsl' '{"command":"{ }"}' @{ Origin = 'https://localhost:3000' }).Code -eq 503)
    Assert 'pbi dmv: 503 when disabled' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dmv' '{"query":"SELECT * FROM $SYSTEM.TMSCHEMA_TABLES"}' @{ Origin = 'https://localhost:3000' }).Code -eq 503)

    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'pbi tmsl: 403 bad origin' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/tmsl' '{"command":"{}"}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    Assert 'pbi tmsl: 400 empty command' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/tmsl' '{}' @{ Origin = 'https://localhost:3000' }).Code -eq 400)
    $tmsl = Http 'POST' 'https://127.0.0.1:3000/oa-pbi/tmsl' '{"command":"{}"}' @{ Origin = 'https://localhost:3000' }
    Assert 'pbi tmsl: agent contract (200 json even without PBI)' ($tmsl.Code -eq 200 -and $tmsl.Text -match 'ok')

    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":false}' @{ Origin = 'https://localhost:3000' }
    Assert 'pbi bridge: 503 when disabled' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/bridge' '{"action":"manifest"}' @{ Origin = 'https://localhost:3000' }).Code -eq 503)
    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'pbi bridge: 403 bad origin' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/bridge' '{"action":"manifest"}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    Assert 'pbi bridge: 400 unknown action' ((Http 'POST' 'https://127.0.0.1:3000/oa-pbi/bridge' '{"action":"nope"}' @{ Origin = 'https://localhost:3000' }).Code -eq 400)

    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":false}' @{ Origin = 'https://localhost:3000' }

    # === WORD COM (inside try - server still running) ===
    Assert 'word com: 503 when disabled' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/word' '{"action":"get_text"}' @{ Origin = 'https://localhost:3000' }).Code -eq 503)
    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'word com: 403 bad origin' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/word' '{"action":"get_text"}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    Assert 'word com: 400 unknown action' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/word' '{"action":"nope"}' @{ Origin = 'https://localhost:3000' }).Code -eq 400)
    Assert 'word com: agent contract (200 json)' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/word' '{"action":"get_text"}' @{ Origin = 'https://localhost:3000' }).Code -eq 200)
    Assert 'word com: get_stats contract' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/word' '{"action":"get_stats"}' @{ Origin = 'https://localhost:3000' }).Code -eq 200)
    Assert 'word com: find_replace contract' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/word' '{"action":"find_replace","find":"x","replace":"y"}' @{ Origin = 'https://localhost:3000' }).Code -eq 200)

    # === PPT COM ===
    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":false}' @{ Origin = 'https://localhost:3000' }
    Assert 'ppt com: 503 when disabled' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/ppt' '{"action":"list_slides"}' @{ Origin = 'https://localhost:3000' }).Code -eq 503)
    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":true}' @{ Origin = 'https://localhost:3000' }
    Assert 'ppt com: 403 bad origin' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/ppt' '{"action":"list_slides"}' @{ Origin = 'https://evil.example' }).Code -eq 403)
    Assert 'ppt com: 400 unknown action' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/ppt' '{"action":"nope"}' @{ Origin = 'https://localhost:3000' }).Code -eq 400)
    Assert 'ppt com: agent contract (200 json)' ((Http 'POST' 'https://127.0.0.1:3000/oa-com/ppt' '{"action":"list_slides"}' @{ Origin = 'https://localhost:3000' }).Code -eq 200)
    $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":false}' @{ Origin = 'https://localhost:3000' }
}
finally {
    if ($null -ne $cfgBackup) { Set-Content -LiteralPath $cfgFile -Value $cfgBackup -NoNewline -Encoding UTF8 }
    elseif (Test-Path $cfgFile) { Remove-Item $cfgFile -Force }
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
    # server spawns in a child powershell - kill anything still holding our ports
    Get-NetTCPConnection -LocalPort 3000,3001,3002,8899 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
