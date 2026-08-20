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

function Set-OaServerConfig {
    # merge a single key into server-config.json (read-modify-write)
    param([string]$ConfigFile, [string]$Key, [object]$Value)
    $cfg = @{}
    try {
        if (Test-Path -LiteralPath $ConfigFile) {
            $cfg = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $cfg = @{} + $cfg
        }
    } catch { $cfg = @{} }
    $cfg[$Key] = $Value
    Set-Content -LiteralPath $ConfigFile -Value ($cfg | ConvertTo-Json -Compress) -Encoding UTF8
}

function Handle-OaConfig {
    # /oa-config/llm-target and /oa-config/com-bridge: live, persisted settings
    # changed from the add-in (same-origin only for mutations).
    param($Ssl, $Req, $Sync, [bool]$HeadOnly)
    $path = ([string]$Req.RawUrl -split '\?')[0].TrimEnd('/')

    if ($path -eq '/oa-config/com-bridge') {
        if ($Req.Method -eq 'GET' -or $Req.Method -eq 'HEAD') {
            $json = '{"enabled":' + ($Sync.ComBridge -eq $true | ConvertTo-Json).ToLower() + '}'
            # ConvertTo-Json on bool gives true/false already; build safely:
            $json = '{"enabled":' + ($(if ($Sync.ComBridge -eq $true) { 'true' } else { 'false' })) + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "GET /oa-config/com-bridge [200]"
        }
        if ($Req.Method -eq 'POST') {
            $origin = [string]$Req.Headers['origin']
            if (-not $origin -or -not $origin.StartsWith('https://localhost:')) {
                Send-OaError -Ssl $Ssl -Code 403 -Status 'Forbidden' -Message 'bad origin' -HeadOnly $HeadOnly
                return "POST /oa-config/com-bridge [403 bad origin]"
            }
            $enabled = $false
            try {
                $bodyText = ''
                if ($Req.Body) { $bodyText = [Text.Encoding]::UTF8.GetString($Req.Body) }
                $enabled = [bool](($bodyText | ConvertFrom-Json).enabled)
            } catch {
                Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'invalid JSON body' -HeadOnly $HeadOnly
                return "POST /oa-config/com-bridge [400]"
            }
            try {
                if ($Sync.ConfigFile) { Set-OaServerConfig -ConfigFile $Sync.ConfigFile -Key 'comBridge' -Value $enabled }
            } catch {
                Send-OaError -Ssl $Ssl -Code 500 -Status 'Server Error' -Message "cannot write config: $($_.Exception.Message)" -HeadOnly $HeadOnly
                return "POST /oa-config/com-bridge [500]"
            }
            $Sync.ComBridge = $enabled
            $json = '{"ok":true,"enabled":' + ($(if ($enabled) { 'true' } else { 'false' })) + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-config/com-bridge [200 enabled=$enabled]"
        }
        Send-OaError -Ssl $Ssl -Code 405 -Status 'Method Not Allowed' -Message 'GET or POST only' -HeadOnly $HeadOnly
        return "$($Req.Method) /oa-config/com-bridge [405]"
    }

    if ($path -ne '/oa-config/llm-target') {
        Send-OaError -Ssl $Ssl -Code 404 -Status 'Not Found' -Message "unknown config path: $path" -HeadOnly $HeadOnly
        return "$($Req.Method) $path [404]"
    }

    if ($Req.Method -eq 'GET' -or $Req.Method -eq 'HEAD') {
        $json = '{"llmProxyTarget":' + ([string]$Sync.LlmTarget | ConvertTo-Json) + '}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "GET /oa-config/llm-target [200]"
    }
    if ($Req.Method -eq 'POST') {
        # only same-origin taskpanes may change the backend address
        $origin = [string]$Req.Headers['origin']
        if (-not $origin -or -not $origin.StartsWith('https://localhost:')) {
            Send-OaError -Ssl $Ssl -Code 403 -Status 'Forbidden' -Message 'bad origin' -HeadOnly $HeadOnly
            return "POST /oa-config/llm-target [403 bad origin]"
        }
        $target = ''
        try {
            $bodyText = ''
            if ($Req.Body) { $bodyText = [Text.Encoding]::UTF8.GetString($Req.Body) }
            $parsed = $bodyText | ConvertFrom-Json
            $target = [string]$parsed.llmProxyTarget
        } catch {
            Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'invalid JSON body' -HeadOnly $HeadOnly
            return "POST /oa-config/llm-target [400]"
        }
        $target = $target.Trim().TrimEnd('/')
        if ($target -and $target -notmatch '^https?://[^\s]+$') {
            Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'llmProxyTarget must be an http(s):// URL' -HeadOnly $HeadOnly
            return "POST /oa-config/llm-target [400 bad url]"
        }
        if ($target.Length -ge 500) {
            Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'llmProxyTarget too long' -HeadOnly $HeadOnly
            return "POST /oa-config/llm-target [400]"
        }
        try {
            if ($Sync.ConfigFile) { Set-OaServerConfig -ConfigFile $Sync.ConfigFile -Key 'llmProxyTarget' -Value $target }
        } catch {
            Send-OaError -Ssl $Ssl -Code 500 -Status 'Server Error' -Message "cannot write config: $($_.Exception.Message)" -HeadOnly $HeadOnly
            return "POST /oa-config/llm-target [500]"
        }
        $Sync.LlmTarget = $target
        $json = '{"ok":true,"llmProxyTarget":' + ($target | ConvertTo-Json) + '}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "POST /oa-config/llm-target [200 -> $target]"
    }
    Send-OaError -Ssl $Ssl -Code 405 -Status 'Method Not Allowed' -Message 'GET or POST only' -HeadOnly $HeadOnly
    return "$($Req.Method) /oa-config/llm-target [405]"
}

function Get-OaExcelApp {
    # attach to the RUNNING Excel in the interactive session (no new instance)
    try {
        return [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
    } catch { return $null }
}

function Read-OaJsonBody {
    param($Req)
    try {
        $bodyText = ''
        if ($Req.Body) { $bodyText = [Text.Encoding]::UTF8.GetString($Req.Body) }
        return ($bodyText | ConvertFrom-Json)
    } catch { return $null }
}

function Handle-OaCom {
    # Opt-in desktop power tools via COM on the live Excel (xlwings pattern).
    # Gated by the com-bridge toggle (server-config.json / oa-config endpoint).
    param($Ssl, $Req, $Sync, [bool]$HeadOnly)
    $path = ([string]$Req.RawUrl -split '\?')[0].TrimEnd('/')
    $originOk = ([string]$Req.Headers['origin']).StartsWith('https://localhost:')

    if ($Sync.ComBridge -ne $true -and $path -ne '/oa-com/status') {
        Send-OaError -Ssl $Ssl -Code 503 -Status 'Service Disabled' -Message 'COM bridge is disabled (Settings -> Desktop power tools)' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [503 disabled]"
    }

    if ($path -eq '/oa-com/status') {
        $excel = Get-OaExcelApp
        $wb = $null
        if ($excel) { try { $wb = [string]$excel.ActiveWorkbook.Name } catch { $wb = $null } }
        $running = 'false'; $wbs = 'null'
        if ($excel) { $running = 'true'; if ($wb) { $wbs = ConvertTo-Json $wb } }
        $json = '{"enabled":' + ($(if ($Sync.ComBridge -eq $true) { 'true' } else { 'false' })) +
            ',"excelRunning":' + $running + ',"workbook":' + $wbs + '}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "GET /oa-com/status [200]"
    }

    if (-not $originOk) {
        Send-OaError -Ssl $Ssl -Code 403 -Status 'Forbidden' -Message 'bad origin' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [403 bad origin]"
    }

    $excel = Get-OaExcelApp
    if (-not $excel) {
        Send-OaError -Ssl $Ssl -Code 409 -Status 'Conflict' -Message 'Excel is not running (open the workbook first)' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [409 no excel]"
    }

    try {
        if ($path -eq '/oa-com/run-macro') {
            $body = Read-OaJsonBody $Req
            if (-not $body -or -not $body.macro) { throw 'body must be {"macro":"name"[,"args":[...]]}' }
            $result = if ($body.args) { $excel.Run([string]$body.macro, @($body.args)) } else { $excel.Run([string]$body.macro) }
            $json = '{"ok":true,"macro":' + ([string]$body.macro | ConvertTo-Json) + ',"result":' + ($(if ($null -ne $result) { $result | ConvertTo-Json -Compress } else { 'null' })) + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-com/run-macro [200 $($body.macro)]"
        }

        if ($path -eq '/oa-com/pq-list') {
            $wb = $excel.ActiveWorkbook
            $items = @()
            foreach ($q in $wb.Queries) {
                $items += @{ name = [string]$q.name; formula = ([string]$q.formula) }
            }
            $json = @{ ok = $true; count = $items.Count; queries = $items } | ConvertTo-Json -Depth 4 -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-com/pq-list [200 x$($items.Count)]"
        }

        if ($path -eq '/oa-com/pq-refresh-all') {
            $wb = $excel.ActiveWorkbook
            $excel.ScreenUpdating = $false
            $wb.RefreshAll()
            for ($i = 0; $i -lt 120; $i++) {
                Start-Sleep -Milliseconds 500
                if ($excel.Ready) { break }
            }
            $excel.ScreenUpdating = $true
            $json = '{"ok":true,"workbook":' + ([string]$wb.Name | ConvertTo-Json) + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-com/pq-refresh-all [200]"
        }

        if ($path -eq '/oa-com/pq-edit') {
            $body = Read-OaJsonBody $Req
            if (-not $body -or -not $body.name -or -not $body.formula) { throw 'body must be {"name":"q","formula":"let ..."}' }
            $wb = $excel.ActiveWorkbook
            $existing = $null
            foreach ($q in $wb.Queries) { if ($q.name -eq [string]$body.name) { $existing = $q; break } }
            if ($existing) { $existing.formula = [string]$body.formula }
            else { $null = $wb.Queries.Add([string]$body.name, [string]$body.formula) }
            $json = '{"ok":true,"name":' + ([string]$body.name | ConvertTo-Json) + ',"action":"' + ($(if ($existing) { 'updated' } else { 'created' })) + '"}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-com/pq-edit [200 $($body.name)]"
        }

        Send-OaError -Ssl $Ssl -Code 404 -Status 'Not Found' -Message "unknown com path: $path" -HeadOnly $HeadOnly
        return "$($Req.Method) $path [404]"
    }
    catch {
        # agent-friendly contract: COM failures come back as JSON ok:false
        $json = '{"ok":false,"error":' + ($_.Exception.Message | ConvertTo-Json) + '}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "$($Req.Method) $path [ok:false $($_.Exception.Message)]"
    }
}

function Handle-OaConnection {
    param($Client, [string]$SiteDir, [string]$OfficeJsDir, $Cert, $Sync)
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

            $LlmTarget = [string]$Sync.LlmTarget

            if ($rawUrl.StartsWith('/oa-config/')) {
                return (Handle-OaConfig -Ssl $ssl -Req $req -Sync $Sync -HeadOnly $headOnly)
            }

            if ($rawUrl.StartsWith('/oa-com/')) {
                return (Handle-OaCom -Ssl $ssl -Req $req -Sync $Sync -HeadOnly $headOnly)
            }

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
                if ($path -like '/assets/*' -and ($path -like '*.js' -or $path -like '*.css')) {
                    # stale bundle: the taskpane was loaded from an older build
                    # and its hashed chunk names no longer exist after a redeploy
                    Send-OaError -Ssl $ssl -Code 404 -Status 'Not Found' -Message 'asset not found: the site bundle was rebuilt. Reload the add-in - close and reopen the taskpane (or restart the Office app).' -HeadOnly $headOnly
                    return "$method $rawUrl [404 STALE ASSET - reload the add-in!]"
                }
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
