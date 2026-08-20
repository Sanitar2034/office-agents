# test-pbi-live.ps1 - LIVE test of the PBI bridge against a RUNNING Power BI
# Desktop (a .pbix must be open). Read-only: executes DAX queries only.
# Usage: powershell -ExecutionPolicy Bypass -File tests\test-pbi-live.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Add-Type @"
using System.Net;
public class TrustAll3 {
    public static void Enable() {
        ServicePointManager.ServerCertificateValidationCallback = (a,b,c,d) => true;
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
    }
}
"@
[TrustAll3]::Enable()

$pass = 0; $fail = 0
function Assert($name, $cond) {
    if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
    else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
function Http($method, $url, $body = $null) {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = $method; $req.Timeout = 90000; $req.Proxy = $null
    $req.Headers['Origin'] = 'https://localhost:3000'
    if ($body) {
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $req.ContentType = 'application/json'; $req.ContentLength = $bytes.Length
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

Write-Host "== PBI bridge LIVE test (needs open .pbix) ==" -ForegroundColor Cyan
if ((Http 'GET' 'https://127.0.0.1:3000/taskpane.html').Code -ne 200) {
    Write-Host "Offline server is not running (start.ps1)." -ForegroundColor Red; exit 1
}

$before = (Http 'GET' 'https://127.0.0.1:3000/oa-config/com-bridge').Text
$wasEnabled = $before -match '"enabled":true'
$null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":true}'

try {
    $st = Http 'POST' 'https://127.0.0.1:3000/oa-pbi/status'
    Assert 'status 200' ($st.Code -eq 200)
    if ($st.Text -notmatch '"pbiRunning":true') {
        Write-Host "SKIPPED: Power BI Desktop is not running (open a .pbix and rerun)." -ForegroundColor Yellow
        exit 0
    }
    Write-Host "  local engine port: $($st.Text -replace '.*\"port\":([0-9]+).*','$1')"

    $q1 = Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dax' '{"query":"EVALUATE ROW(\"probe\", 1+1)"}'
    Assert 'dax scalar query ok:true' ($q1.Code -eq 200 -and $q1.Text -match '"ok":true')
    Assert 'dax result contains 2' ($q1.Text -match '\b2\b')

    $q2 = Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dax' '{"query":"EVALUATE {1,2,3}"}'
    Assert 'dax table query rowCount 3' ($q2.Code -eq 200 -and $q2.Text -match '"rowCount":3')

    $q3 = Http 'POST' 'https://127.0.0.1:3000/oa-pbi/dax' '{"query":"EVALUATE DefinitelyNotATable"}'
    Assert 'bad dax -> ok:false with error text' ($q3.Code -eq 200 -and $q3.Text -match '"ok":false')
}
finally {
    if (-not $wasEnabled) {
        $null = Http 'POST' 'https://127.0.0.1:3000/oa-config/com-bridge' '{"enabled":false}'
    }
}

Write-Host ""
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
