# test-com-live.ps1 - LIVE test of the COM bridge against the RUNNING Excel.
# Uses the running offline server (https://localhost:18131) and the user's
# Excel instance. Creates a temporary workbook (never saved, closed with
# SaveChanges=false), so the user's work is untouched.
# Usage: powershell -ExecutionPolicy Bypass -File tests\test-com-live.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAll2 {
    public static void Enable() {
        ServicePointManager.ServerCertificateValidationCallback = (a,b,c,d) => true;
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
    }
}
"@
[TrustAll2]::Enable()

$pass = 0; $fail = 0; $skip = $false
function Assert($name, $cond) {
    if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
    else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
function Http($method, $url, $body = $null) {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = $method
    $req.Timeout = 60000
    $req.Proxy = $null
    $req.Headers['Origin'] = 'https://localhost:18131'
    if ($body) {
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $req.ContentType = 'application/json'
        $req.ContentLength = $bytes.Length
        $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    }
    try {
        $resp = $req.GetResponse()
        $sr = New-Object IO.StreamReader($resp.GetResponseStream())
        return @{ Code = [int]$resp.StatusCode; Text = $sr.ReadToEnd() }
    } catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($r) { $sr = New-Object IO.StreamReader($r.GetResponseStream()); return @{ Code = [int]$r.StatusCode; Text = $sr.ReadToEnd() } }
        return @{ Code = 0; Text = $_.Exception.Message }
    }
}

Write-Host "== COM bridge LIVE test (running Excel + offline server) ==" -ForegroundColor Cyan

# 0) server must be up
if ((Http 'GET' 'https://127.0.0.1:18131/taskpane.html').Code -ne 200) {
    Write-Host "Offline server is not running (start.ps1)." -ForegroundColor Red; exit 1
}

# 1) remember the toggle, enable the bridge
$before = (Http 'GET' 'https://127.0.0.1:18131/oa-config/com-bridge').Text
$wasEnabled = $before -match '"enabled":true'
$null = Http 'POST' 'https://127.0.0.1:18131/oa-config/com-bridge' '{"enabled":true}'

$excel = $null; $wb = $null
try {
    # 2) status: Excel must be running
    $st = Http 'POST' 'https://127.0.0.1:18131/oa-com/status'
    Assert 'status 200 + excelRunning' ($st.Code -eq 200 -and $st.Text -match '"excelRunning":true')
    if ($st.Text -notmatch '"excelRunning":true') {
        Write-Host "Excel is not running - start Excel with a workbook and rerun." -ForegroundColor Yellow
        $skip = $true
    } else {
        # 3) isolate: create a temporary workbook (becomes ACTIVE for the server)
        $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
        $wb = $excel.Workbooks.Add()
        $wbName = $wb.Name
        Write-Host "  temp workbook: $wbName (will be closed without saving)"

        # 4) pq-edit: create
        $mk = Http 'POST' 'https://127.0.0.1:18131/oa-com/pq-edit' '{"name":"oa_live_test_q","formula":"let x = 40 + 2 in x"}'
        Assert 'pq-edit created' ($mk.Code -eq 200 -and $mk.Text -match '"ok":true' -and $mk.Text -match 'created')

        # 5) pq-list: contains it
        $ls = Http 'POST' 'https://127.0.0.1:18131/oa-com/pq-list'
        Assert 'pq-list contains the query' ($ls.Code -eq 200 -and $ls.Text -match 'oa_live_test_q')

        # 6) pq-edit: update
        $up = Http 'POST' 'https://127.0.0.1:18131/oa-com/pq-edit' '{"name":"oa_live_test_q","formula":"let x = 43 in x"}'
        Assert 'pq-edit updated' ($up.Code -eq 200 -and $up.Text -match 'updated')

        # 7) pq-refresh-all completes
        $rf = Http 'POST' 'https://127.0.0.1:18131/oa-com/pq-refresh-all'
        Assert 'pq-refresh-all ok' ($rf.Code -eq 200 -and $rf.Text -match '"ok":true')
    }
}
finally {
    if ($wb) { $wb.Close($false) }           # discard temp workbook
    if (-not $wasEnabled) {
        $null = Http 'POST' 'https://127.0.0.1:18131/oa-config/com-bridge' '{"enabled":false}'
    }
}

Write-Host ""
if ($skip) { Write-Host "SKIPPED (no Excel)" -ForegroundColor Yellow; exit 0 }
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
