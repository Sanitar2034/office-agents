# server-lib.ps1 - HTTP functions shared by server.ps1 and tests.
# Pure Windows PowerShell 5.1. All functions are self-contained.

function Get-OaMime {
    param([string]$Path)
    switch ([IO.Path]::GetExtension($Path).ToLower()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.htm'  { return 'text/html; charset=utf-8' }
        '.js'   { return 'text/javascript; charset=utf-8' }
        '.mjs'  { return 'text/javascript; charset=utf-8' }
        '.css'  { return 'text/css; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.map'  { return 'application/json; charset=utf-8' }
        '.png'  { return 'image/png' }
        '.jpg'  { return 'image/jpeg' }
        '.jpeg' { return 'image/jpeg' }
        '.gif'  { return 'image/gif' }
        '.svg'  { return 'image/svg+xml' }
        '.ico'  { return 'image/x-icon' }
        '.webp' { return 'image/webp' }
        '.woff' { return 'font/woff' }
        '.woff2' { return 'font/woff2' }
        '.ttf'  { return 'font/ttf' }
        '.otf'  { return 'font/otf' }
        '.txt'  { return 'text/plain; charset=utf-8' }
        '.xml'  { return 'application/xml; charset=utf-8' }
        '.wasm' { return 'application/wasm' }
        default { return 'application/octet-stream' }
    }
}

function Write-OaResponse {
    param($Ssl, [int]$Code, [string]$Status, [string]$ContentType, [byte[]]$Bytes, [bool]$HeadOnly)
    $len = 0
    if ($Bytes) { $len = $Bytes.Length }
    $head = "HTTP/1.1 $Code $Status`r`nContent-Type: $ContentType`r`nContent-Length: $len`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($head)
    $Ssl.Write($hb, 0, $hb.Length)
    $Ssl.Flush()
    if (-not $HeadOnly -and $Bytes -and $Bytes.Length -gt 0) {
        $Ssl.Write($Bytes, 0, $Bytes.Length)
        $Ssl.Flush()
    }
}

function Send-OaError {
    param($Ssl, [int]$Code, [string]$Status, [string]$Message, [bool]$HeadOnly)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Message)
    Write-OaResponse -Ssl $Ssl -Code $Code -Status $Status -ContentType 'text/plain; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
}

# Read the full request (start line + headers + optional body) at byte level.
function Read-OaRequest {
    param($Ssl)
    $headerBytes = New-Object System.Collections.Generic.List[byte]
    $b1 = 0; $b2 = 0; $b3 = 0; $b4 = 0
    while ($true) {
        $b = $Ssl.ReadByte()
        if ($b -lt 0) { return $null }
        $headerBytes.Add([byte]$b)
        if ($headerBytes.Count -gt 32768) { throw 'header too large' }
        $b1 = $b2; $b2 = $b3; $b3 = $b4; $b4 = $b
        if ($b1 -eq 13 -and $b2 -eq 10 -and $b3 -eq 13 -and $b4 -eq 10) { break }
    }
    $headerText = [Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
    $lines = $headerText -split "`r`n"
    $requestLine = $lines[0]
    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $idx = $lines[$i].IndexOf(':')
        if ($idx -gt 0) {
            $headers[$lines[$i].Substring(0, $idx).Trim().ToLowerInvariant()] = $lines[$i].Substring($idx + 1).Trim()
        }
    }
    $body = $null
    $len = 0
    if ($headers.ContainsKey('content-length') -and [int]::TryParse($headers['content-length'], [ref]$len) -and $len -gt 0) {
        if ($len -gt 52428800) { throw 'body too large' }
        $body = New-Object byte[] $len
        $got = 0
        while ($got -lt $len) {
            $n = $Ssl.Read($body, $got, $len - $got)
            if ($n -le 0) { break }
            $got += $n
        }
    }
    $parts = $requestLine -split ' '
    return @{ Method = $parts[0]; RawUrl = $parts[1]; Headers = $headers; Body = $body }
}

function Invoke-OaProxy {
    param($Ssl, $Req, [string]$Target, [bool]$HeadOnly)
    $prefix = '/llm-proxy'
    $rel = $Req.RawUrl.Substring($prefix.Length)
    $url = $Target.TrimEnd('/') + $rel
    try {
        $wr = [Net.HttpWebRequest]::Create($url)
        $wr.Method = $Req.Method
        $wr.Timeout = 600000
        $wr.ReadWriteTimeout = 600000
        $wr.AllowReadStreamBuffering = $false
        $wr.AllowAutoRedirect = $false
        $wr.Proxy = $null
        $wr.KeepAlive = $false
        foreach ($h in @('content-type', 'authorization', 'accept')) {
            if ($Req.Headers.ContainsKey($h)) {
                if ($h -eq 'content-type') { $wr.ContentType = $Req.Headers[$h] }
                elseif ($h -eq 'accept') { $wr.Accept = $Req.Headers[$h] }
                else { $wr.Headers[$h] = $Req.Headers[$h] }
            }
        }
        if ($Req.Body) {
            $wr.ContentLength = $Req.Body.Length
            $ws = $wr.GetRequestStream()
            $ws.Write($Req.Body, 0, $Req.Body.Length)
            $ws.Close()
        }
        $resp = $null
        try { $resp = $wr.GetResponse() } catch [Net.WebException] { $resp = $_.Exception.Response }
        if ($null -eq $resp) { throw 'no response' }
        $rs = $resp.GetResponseStream()
        $code = [int]$resp.StatusCode
        $status = $resp.StatusCode.ToString()
        $ct = $resp.ContentType
        if (-not $ct) { $ct = 'application/octet-stream' }
        $head = "HTTP/1.1 $code $status`r`nContent-Type: $ct`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
        $hb = [Text.Encoding]::ASCII.GetBytes($head)
        $Ssl.Write($hb, 0, $hb.Length)
        $Ssl.Flush()
        if (-not $HeadOnly) {
            $buf = New-Object byte[] 65536
            while (($n = $rs.Read($buf, 0, $buf.Length)) -gt 0) {
                $Ssl.Write($buf, 0, $n)
                $Ssl.Flush()
            }
        }
        $rs.Close()
        $resp.Close()
        return "$($Req.Method) llm-proxy -> $url [$code]"
    } catch {
        Send-OaError -Ssl $Ssl -Code 502 -Status 'Bad Gateway' -Message "llm-proxy error: $($_.Exception.Message)" -HeadOnly $HeadOnly
        return "$($Req.Method) llm-proxy -> $url [502 $($_.Exception.Message)]"
    }
}

function Handle-OaConnection {
    param($Client, [string]$SiteDir, [string]$OfficeJsDir, $Cert, [string]$LlmTarget)
    try {
        $Client.NoDelay = $true
        $Client.ReceiveTimeout = 30000
        $Client.SendTimeout = 600000
        $ssl = New-Object Net.Security.SslStream($Client.GetStream(), $false)
        try {
            $ssl.AuthenticateAsServer($Cert, $false, [System.Security.Authentication.SslProtocols]::None, $false)
        } catch {
            return "tls handshake failed: $($_.Exception.Message)"
        }
        try {
            $req = Read-OaRequest -Ssl $ssl
            if ($null -eq $req) { return $null }

            $method = [string]$req.Method
            $rawUrl = [string]$req.RawUrl
            $headOnly = ($method -eq 'HEAD')
            if ($method -ne 'GET' -and $method -ne 'HEAD' -and $method -ne 'POST') {
                Send-OaError -Ssl $ssl -Code 405 -Status 'Method Not Allowed' -Message 'only GET/HEAD/POST' -HeadOnly $headOnly
                return "$method $rawUrl [405]"
            }

            # normalize both sides: GetFullPath canonicalizes ".." segments,
            # so the base must be canonical too or the prefix check fails
            $siteRootN = [IO.Path]::GetFullPath($SiteDir.TrimEnd('\') + '\')
            $ojRootN = [IO.Path]::GetFullPath($OfficeJsDir.TrimEnd('\') + '\')

            if ($rawUrl.StartsWith('/llm-proxy') -and $LlmTarget) {
                return (Invoke-OaProxy -Ssl $ssl -Req $req -Target $LlmTarget -HeadOnly $headOnly)
            }

            $path = [Uri]::UnescapeDataString(($rawUrl -split '\?')[0])
            if ($path.Contains('..')) {
                Send-OaError -Ssl $ssl -Code 403 -Status 'Forbidden' -Message 'path traversal' -HeadOnly $headOnly
                return "$method $rawUrl [403]"
            }

            $baseDir = $siteRootN
            if ($path.StartsWith('/office-js/') -or $path -eq '/office-js') {
                $baseDir = $ojRootN
                $path = $path.Substring('/office-js'.Length)
                if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '/') { $path = '/office.js' }
            }

            $rel = $path.TrimStart('/').Replace('/', '\')
            $full = [IO.Path]::GetFullPath((Join-Path $baseDir $rel))
            if (-not $full.StartsWith($baseDir, [StringComparison]::OrdinalIgnoreCase)) {
                Send-OaError -Ssl $ssl -Code 403 -Status 'Forbidden' -Message 'outside of root' -HeadOnly $headOnly
                return "$method $rawUrl [403]"
            }
            if (Test-Path -LiteralPath $full -PathType Container) {
                $full = Join-Path $full 'index.html'
            }
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                Send-OaError -Ssl $ssl -Code 404 -Status 'Not Found' -Message "not found: $path" -HeadOnly $headOnly
                return "$method $rawUrl [404]"
            }
            $bytes = [IO.File]::ReadAllBytes($full)
            $mime = Get-OaMime -Path $full
            Write-OaResponse -Ssl $ssl -Code 200 -Status 'OK' -ContentType $mime -Bytes $bytes -HeadOnly $headOnly
            return "$method $rawUrl [200 $([Math]::Round($bytes.Length / 1KB, 1)) KB]"
        } finally {
            try { $ssl.Dispose() } catch { }
        }
    } catch {
        return "error: $($_.Exception.Message)"
    } finally {
        try { $Client.Close() } catch { }
    }
}
