# debug-word-test.ps1
Add-Type @'
using System.Net;
public class DbgTrust {
    public static void Enable() {
        System.Net.ServicePointManager.ServerCertificateValidationCallback = (a,b,c,d) => true;
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;
    }
}
'@
[DbgTrust]::Enable()

function Http($method, $url, $body = $null) {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = $method; $req.Timeout = 10000; $req.Proxy = $null
    $req.Headers['Origin'] = 'https://localhost:18131'
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
        if ($r) {
            $sr = New-Object IO.StreamReader($r.GetResponseStream())
            return @{ Code = [int]$r.StatusCode; Text = $sr.ReadToEnd() }
        }
        return @{ Code = -1; Text = $_.Exception.Message }
    }
}

Write-Host "word (disabled):" -ForegroundColor Yellow
$r1 = Http 'POST' 'https://127.0.0.1:18131/oa-com/word' '{"action":"get_text"}'
Write-Host "  code=$($r1.Code) body=$($r1.Text.Substring(0, [Math]::Min(150, $r1.Text.Length)))"

$null = Http 'POST' 'https://127.0.0.1:18131/oa-config/com-bridge' '{"enabled":true}'
Write-Host "word (enabled, valid):" -ForegroundColor Yellow
$r2 = Http 'POST' 'https://127.0.0.1:18131/oa-com/word' '{"action":"get_text"}'
Write-Host "  code=$($r2.Code) body=$($r2.Text.Substring(0, [Math]::Min(150, $r2.Text.Length)))"

Write-Host "word (bad origin):" -ForegroundColor Yellow
$req3 = [System.Net.HttpWebRequest]::Create('https://127.0.0.1:18131/oa-com/word')
$req3.Method = 'POST'; $req3.Timeout = 10000; $req3.Proxy = $null
$req3.Headers['Origin'] = 'https://evil.example'
$b3 = [Text.Encoding]::UTF8.GetBytes('{"action":"get_text"}')
$req3.ContentType = 'application/json'; $req3.ContentLength = $b3.Length
$s3 = $req3.GetRequestStream(); $s3.Write($b3, 0, $b3.Length); $s3.Close()
try { $resp3 = $req3.GetResponse(); Write-Host "  code=$([int]$resp3.StatusCode)" } catch { Write-Host "  code=$([int]$_.Exception.Response.StatusCode)" }

$null = Http 'POST' 'https://127.0.0.1:18131/oa-config/com-bridge' '{"enabled":false}'
