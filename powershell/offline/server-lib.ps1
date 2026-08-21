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

function Get-OaDevAddinEntries {
    # our add-in ids + manifest paths (manifests/ next to the server root)
    param([string]$Root)
    $entries = @()
    if (-not $Root) { return $entries }
    $manifestsDir = Join-Path $Root 'manifests'
    foreach ($mf in (Get-ChildItem (Join-Path $manifestsDir '*.xml') -ErrorAction SilentlyContinue)) {
        try {
            [xml]$manifest = Get-Content -LiteralPath $mf.FullName -Raw
            $addinId = [string]$manifest.OfficeApp.Id
            if ($addinId) { $entries += @{ Id = $addinId; Path = $mf.FullName } }
        } catch { }
    }
    return $entries
}

function Handle-OaConfig {
    # /oa-config/llm-target, /oa-config/com-bridge and
    # /oa-config/dev-registration: live, persisted settings
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

    if ($path -eq '/oa-config/dev-registration') {
        # WEF\Developer rollback: register (npm-start style) or fully remove
        # OUR entries only - other dev add-ins are never touched. Removing
        # restores the pre-install state (empty key is deleted entirely).
        $devKey = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'
        $root = $null
        if ($Sync.ConfigFile) { $root = Split-Path -Parent ([string]$Sync.ConfigFile) }
        $entries = @(Get-OaDevAddinEntries -Root $root)
        if ($entries.Count -eq 0) {
            Send-OaError -Ssl $Ssl -Code 500 -Status 'Server Error' -Message 'no manifests found next to the server' -HeadOnly $HeadOnly
            return "$($Req.Method) $path [500 no manifests]"
        }
        $getRegistered = {
            $n = 0
            foreach ($e in $entries) {
                if (Get-ItemProperty -Path $devKey -Name $e.Id -ErrorAction SilentlyContinue) { $n++ }
            }
            return $n
        }
        if ($Req.Method -eq 'GET' -or $Req.Method -eq 'HEAD') {
            $registered = & $getRegistered
            $enabled = ($registered -eq $entries.Count)
            $json = '{"enabled":' + ($(if ($enabled) { 'true' } else { 'false' })) +
                ',"registered":' + $registered + ',"total":' + $entries.Count + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "GET $path [200 registered=$registered/$($entries.Count)]"
        }
        if ($Req.Method -eq 'POST') {
            $origin = [string]$Req.Headers['origin']
            if (-not $origin -or -not $origin.StartsWith('https://localhost:')) {
                Send-OaError -Ssl $Ssl -Code 403 -Status 'Forbidden' -Message 'bad origin' -HeadOnly $HeadOnly
                return "POST $path [403 bad origin]"
            }
            $enable = $false
            try {
                $bodyText = ''
                if ($Req.Body) { $bodyText = [Text.Encoding]::UTF8.GetString($Req.Body) }
                $enable = [bool](($bodyText | ConvertFrom-Json).enabled)
            } catch {
                Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'invalid JSON body' -HeadOnly $HeadOnly
                return "POST $path [400]"
            }
            try {
                if ($enable) {
                    if (-not (Test-Path $devKey)) { New-Item -Path $devKey -Force | Out-Null }
                    foreach ($e in $entries) {
                        New-ItemProperty -Path $devKey -Name $e.Id -Value $e.Path `
                            -PropertyType String -Force | Out-Null
                    }
                    New-ItemProperty -Path $devKey -Name 'RefreshAddins' -Value 1 -PropertyType DWord -Force | Out-Null
                } else {
                    foreach ($e in $entries) {
                        Remove-ItemProperty -Path $devKey -Name $e.Id -Force -ErrorAction SilentlyContinue
                    }
                    Remove-ItemProperty -Path $devKey -Name 'RefreshAddins' -Force -ErrorAction SilentlyContinue
                    # restore the pre-install state: drop the key only when it
                    # holds nothing of ours or anyone else (values AND subkeys)
                    if (Test-Path $devKey) {
                        $key = Get-Item $devKey
                        $left = @($key.GetValueNames())
                        $subs = @($key.GetSubKeyNames())
                        if ($left.Count -eq 0 -and $subs.Count -eq 0) {
                            Remove-Item $devKey -Force -ErrorAction SilentlyContinue
                        }
                    }
                }
            } catch {
                Send-OaError -Ssl $Ssl -Code 500 -Status 'Server Error' -Message "registry update failed: $($_.Exception.Message)" -HeadOnly $HeadOnly
                return "POST $path [500]"
            }
            $registered = & $getRegistered
            $enabled = ($registered -eq $entries.Count)
            $json = '{"ok":true,"enabled":' + ($(if ($enabled) { 'true' } else { 'false' })) +
                ',"registered":' + $registered + ',"total":' + $entries.Count + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST $path [200 enabled=$enabled]"
        }
        Send-OaError -Ssl $Ssl -Code 405 -Status 'Method Not Allowed' -Message 'GET or POST only' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [405]"
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

function Find-OaPbiPort {
    # newest Power BI Desktop workspace port (msmdsrv.port.txt), or $null
    $wsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Power BI Desktop\AnalysisServicesWorkspaces'
    try {
        $ports = Get-ChildItem -LiteralPath $wsDir -Filter 'msmdsrv.port.txt' -Recurse -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
        if ($ports.Count -gt 0) {
            # msmdsrv.port.txt is UTF-16 (digits interleaved with NULs when read
            # as text) - strip everything that is not a digit, then parse
            $txt = Get-Content -LiteralPath $ports[0].FullName -Raw
            $digits = ($txt -replace '\D', '')
            $p = 0
            if ($digits -and [int]::TryParse($digits, [ref]$p)) { return $p }
        }
    } catch { }
    return $null
}

function ConvertFrom-OaXmlaColumn {
    # decode XMLA-encoded column names: _x005B_Value_x005D_ -> [Value]
    param([string]$Name)
    $out = ''
    for ($i = 0; $i -lt $Name.Length; $i++) {
        if ($Name[$i] -eq '_' -and $i + 7 -le $Name.Length -and $Name.Substring($i, 3) -eq '_x0') {
            $hex = $Name.Substring($i + 3, 4)
            $code = 0
            if ([int]::TryParse($hex, [System.Globalization.NumberStyles]::HexNumber, $null, [ref]$code)) {
                $out += [char]$code
                $i += 7
                continue
            }
        }
        $out += $Name[$i]
    }
    return $out
}

function Invoke-OaPbiDaxAsCmd {
    # Fallback path: ADOMD via the (user-scope) SqlServer module - works even
    # when the MSOLAP OleDb provider is not registered (no admin needed).
    param([int]$Port, [string]$Query)
    if (-not (Get-Command Invoke-ASCmd -ErrorAction SilentlyContinue)) {
        Import-Module SqlServer -ErrorAction Stop
    }
    $result = Invoke-ASCmd -Server "localhost:$Port" -Query $Query
    $xmlText = if ($result -is [array]) { $result -join '' } else { [string]$result }
    $doc = New-Object System.Xml.XmlDocument
    $doc.LoadXml($xmlText)
    $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
    $ns.AddNamespace('xsd', 'http://www.w3.org/2001/XMLSchema')
    $ns.AddNamespace('sql', 'urn:schemas-microsoft-com:xml-sql')
    $ns.AddNamespace('rs', 'urn:schemas-microsoft-com:xml-analysis:rowset')
    $cols = @()
    foreach ($el in $doc.SelectNodes('//xsd:element[@sql:field]', $ns)) {
        $cols += ConvertFrom-OaXmlaColumn $el.GetAttribute('field', 'urn:schemas-microsoft-com:xml-sql')
    }
    $rows = @()
    foreach ($row in $doc.SelectNodes('//rs:row', $ns)) {
        $r = @()
        foreach ($c in $row.ChildNodes) { $r += $c.InnerText }
        $rows += ,$r
    }
    return @{ ok = $true; columns = $cols; rows = $rows; rowCount = $rows.Count }
}

function Invoke-OaPbiDax {
    # DAX against the local AS engine of a running PBI Desktop:
    # 1) MSOLAP OleDb (fast, zero deps) when the provider is registered
    # 2) ADOMD via the user-scope SqlServer module as fallback
    # The fallback is OUTSIDE the try/finally: an exception inside finally
    # (e.g. Dispose on a null connection in MA runspaces) must not mask it.
    param([int]$Port, [string]$Query)
    $olResult = $null
    $conn = $null
    try {
        $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=MSOLAP;Data Source=localhost:$Port")
        $conn.Open()
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $Query
        $cmd.CommandTimeout = 60
        $reader = $cmd.ExecuteReader()
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        $rows = @()
        while ($reader.Read()) {
            $row = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $v = $reader.GetValue($i)
                if ($v -is [DBNull]) { $row += $null } else { $row += $v }
            }
            $rows += ,$row
        }
        $reader.Close()
        $olResult = @{ ok = $true; columns = $cols; rows = $rows; rowCount = $rows.Count }
    }
    catch {
        $olResult = $null   # MSOLAP not registered / connection refused -> fallback
    }
    finally {
        if ($conn) { try { $conn.Dispose() } catch { } }
    }
    if ($olResult) { return $olResult }
    return Invoke-OaPbiDaxAsCmd -Port $Port -Query $Query
}

function Invoke-OaPbiBridgeRpc {
    # One JSON-RPC 2.0 call over the Desktop Bridge named pipe
    # (Content-Length framing, like LSP). Returns parsed result object.
    param([string]$Method, [hashtable]$Params = @{})
    $proc = Get-Process PBIDesktop -ErrorAction Stop | Select-Object -First 1
    $pipeName = "pbi-desktop-bridge-$($proc.Id)"
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $pipe.Connect(5000)
        $pipe.ReadMode = [System.IO.Pipes.PipeTransmissionMode]::Byte
        $body = @{ jsonrpc = '2.0'; id = 1; method = $Method; params = $Params } |
            ConvertTo-Json -Depth 6 -Compress
        $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
        $header = [Text.Encoding]::ASCII.GetBytes("Content-Length: $($bodyBytes.Length)`r`n`r`n")
        $pipe.Write($header, 0, $header.Length)
        $pipe.Write($bodyBytes, 0, $bodyBytes.Length)
        $pipe.Flush()

        # read framed response: headers until CRLFCRLF, then exactly N bytes
        $headerBytes = New-Object System.Collections.Generic.List[byte]
        $buf = New-Object byte[] 1
        while ($true) {
            $n = $pipe.Read($buf, 0, 1)
            if ($n -le 0) { throw 'pipe closed while reading headers' }
            $headerBytes.Add($buf[0])
            $cnt = $headerBytes.Count
            if ($cnt -ge 4) {
                $last4 = $headerBytes.GetRange($cnt - 4, 4)
                if (($last4[0] -eq 13) -and ($last4[1] -eq 10) -and ($last4[2] -eq 13) -and ($last4[3] -eq 10)) { break }
            }
            if ($cnt -gt 16384) { throw 'bridge response header too large' }
        }
        $headerText = [Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
        $len = 0
        if ($headerText -match 'Content-Length:\s*(\d+)') { $len = [int]$Matches[1] }
        if ($len -le 0) { throw "no Content-Length in bridge response: $($headerText.Substring(0, [Math]::Min(80, $headerText.Length)))" }
        $resp = New-Object byte[] $len
        $got = 0
        while ($got -lt $len) {
            $n = $pipe.Read($resp, $got, $len - $got)
            if ($n -le 0) { break }
            $got += $n
        }
        $json = [Text.Encoding]::UTF8.GetString($resp, 0, $got) | ConvertFrom-Json
        if ($json.error) { throw "bridge rpc error: $($json.error | ConvertTo-Json -Compress)" }
        return $json.result
    }
    finally {
        $pipe.Dispose()
    }
}

function Find-OaPbiPageId {
    # Discover a page id from the OPEN file: .pbix stores Report/Layout as
    # UTF-16 JSON inside an OPC zip; .pbip/PBIR projects have per-page json.
    param([string]$FilePath)
    if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath)) { return $null }
    try {
        if ($FilePath -like '*.pbix') {
            # modern pbix stores PBIR pages inside the zip:
            # Report/definition/pages/<pageId>/page.json
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
            $zip = [System.IO.Compression.ZipFile]::OpenRead($FilePath)
            try {
                foreach ($e in $zip.Entries) {
                    if ($e.FullName -match '^Report/definition/pages/([^/]+)/page\.json$') {
                        return $Matches[1]
                    }
                }
                # legacy pbix: Report/Layout as UTF-16 JSON with sections
                $entry = $zip.Entries | Where-Object { $_.FullName -eq 'Report/Layout' } | Select-Object -First 1
                if ($entry) {
                    $sr = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::Unicode)
                    $layout = $sr.ReadToEnd(); $sr.Close()
                    $m = [regex]::Match($layout, '"sections"\s*:\s*\[\s*\{[\s\S]{0,400}?"name"\s*:\s*"([^"]+)"')
                    if ($m.Success) { return $m.Groups[1].Value }
                }
                return $null
            }
            finally { $zip.Dispose() }
        }
        if ($FilePath -like '*.pbip') {
            $dir = Split-Path -Parent $FilePath
            $pages = Get-ChildItem -LiteralPath (Join-Path $dir 'report\definition\pages') -Filter '*.json' -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -notmatch 'pages\.json$' } | Select-Object -First 1
            if ($pages) { return $pages.BaseName }
            return $null
        }
    } catch { return $null }
    return $null
}

function Invoke-OaPbiTmsl {
    # Execute a TMSL/XMLA command (CREATE/ALTER/DELETE/REFRESH etc) against
    # the local AS engine via ADOMD (SqlServer module fallback).
    param([int]$Port, [string]$Command)
    if (-not (Get-Command Invoke-ASCmd -ErrorAction SilentlyContinue)) {
        Import-Module SqlServer -ErrorAction Stop
    }
    $result = Invoke-ASCmd -Server "localhost:$Port" -Query $Command
    $xmlText = if ($result -is [array]) { $result -join '' } else { [string]$result }
    if ($xmlText -match '<return') { return @{ ok = $true; response = $xmlText } }
    if ($xmlText -match '<Exception') {
        $msg = [regex]::Match($xmlText, 'msg="([^"]*)"').Groups[1].Value
        throw "TMSL error: $msg"
    }
    return @{ ok = $true; response = $xmlText }
}

function Handle-OaPbi {
    # Power BI Desktop bridge: DAX queries against the local msmdsrv engine.
    # Gated by the same desktop-power toggle as the COM bridge.
    param($Ssl, $Req, $Sync, [bool]$HeadOnly)
    $path = ([string]$Req.RawUrl -split '\?')[0].TrimEnd('/')

    $port = Find-OaPbiPort
    $running = 'false'; $portJson = 'null'
    if ($port) { $running = 'true'; $portJson = "$port" }

    if ($path -eq '/oa-pbi/status') {
        $json = '{"pbiRunning":' + $running + ',"port":' + $portJson + '}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "GET /oa-pbi/status [200 running=$running]"
    }

    if ($Sync.ComBridge -ne $true) {
        Send-OaError -Ssl $Ssl -Code 503 -Status 'Service Disabled' -Message 'Desktop power tools are disabled (Settings)' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [503 disabled]"
    }

    $origin = [string]$Req.Headers['origin']
    if (-not $origin -or -not $origin.StartsWith('https://localhost:')) {
        Send-OaError -Ssl $Ssl -Code 403 -Status 'Forbidden' -Message 'bad origin' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [403 bad origin]"
    }

    if ($path -eq '/oa-pbi/tmsl') {
        $body = Read-OaJsonBody $Req
        if (-not $body -or -not $body.command) {
            Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'body must be {"command":"{...TMSL JSON...}"}' -HeadOnly $HeadOnly
            return "POST /oa-pbi/tmsl [400]"
        }
        if (-not $port) {
            $json = '{"ok":false,"error":"Power BI Desktop is not running"}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/tmsl [ok:false no pbi]"
        }
        try {
            $r = Invoke-OaPbiTmsl -Port $port -Command ([string]$body.command)
            $json = $r | ConvertTo-Json -Depth 3 -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/tmsl [200]"
        }
        catch {
            $json = '{"ok":false,"error":' + ($_.Exception.Message | ConvertTo-Json) + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/tmsl [ok:false $($_.Exception.Message)]"
        }
    }

    if ($path -eq '/oa-pbi/dmv') {
        $body = Read-OaJsonBody $Req
        if (-not $body -or -not $body.query) {
            Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'body must be {"query":"SELECT * FROM $SYSTEM.TMSCHEMA_..."}' -HeadOnly $HeadOnly
            return "POST /oa-pbi/dmv [400]"
        }
        if (-not $port) {
            $json = '{"ok":false,"error":"Power BI Desktop is not running"}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/dmv [ok:false no pbi]"
        }
        try {
            $r = Invoke-OaPbiDaxAsCmd -Port $port -Query ([string]$body.query)
            $json = $r | ConvertTo-Json -Depth 5 -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/dmv [200 rows=$($r.rowCount)]"
        }
        catch {
            $json = '{"ok":false,"error":' + ($_.Exception.Message | ConvertTo-Json) + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/dmv [ok:false $($_.Exception.Message)]"
        }
    }

    if ($path -eq '/oa-pbi/bridge') {
        $body = Read-OaJsonBody $Req
        $action = [string]$body.action
        $methodMap = @{
            manifest   = 'bridge.manifest'
            state      = 'application.state.get/v1'
            screenshot = 'report.snapshot.capture/v1'
            reload     = 'file.reload/v1'
        }
        if (-not $methodMap.ContainsKey($action)) {
            Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message "action must be one of: $($methodMap.Keys -join ', ')" -HeadOnly $HeadOnly
            return "POST /oa-pbi/bridge [400 unknown action]"
        }
        $params = @{}
        if ($action -eq 'screenshot') {
            $pageId = [string]$body.pageId
            if (-not $pageId) {
                # pageId is REQUIRED by the bridge - discover it from the open file
                try {
                    $st = Invoke-OaPbiBridgeRpc -Method 'application.state.get/v1' -Params @{}
                    $pageId = Find-OaPbiPageId ([string]$st.currentFilePath)
                } catch { }
            }
            if (-not $pageId) {
                $json = '{"ok":false,"error":"pageId required and could not be discovered from the open file (open a saved .pbix/.pbip)"}'
                $bytes = [Text.Encoding]::UTF8.GetBytes($json)
                Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
                return "POST /oa-pbi/bridge [ok:false no pageId]"
            }
            $params['pageId'] = $pageId
            $params['scale'] = if ($body.scale) { [double]$body.scale } else { 1.0 }
        }
        try {
            $result = Invoke-OaPbiBridgeRpc -Method $methodMap[$action] -Params $params
            $json = @{ ok = $true; action = $action; result = $result } | ConvertTo-Json -Depth 8 -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/bridge [200 $action]"
        }
        catch {
            $json = '{"ok":false,"error":' + ($_.Exception.Message | ConvertTo-Json) + '}'
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
            return "POST /oa-pbi/bridge [ok:false $($_.Exception.Message)]"
        }
    }

    $body = Read-OaJsonBody $Req
    if (-not $body -or -not $body.query) {
        Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message 'body must be {"query":"EVALUATE ..."}' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [400]"
    }

    if (-not $port) {
        $json = '{"ok":false,"error":"Power BI Desktop is not running (open a .pbix first)"}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "POST /oa-pbi/dax [ok:false no pbi]"
    }

    try {
        $result = Invoke-OaPbiDax -Port $port -Query ([string]$body.query)
        $json = $result | ConvertTo-Json -Depth 5 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "POST /oa-pbi/dax [200 rows=$($result.rowCount)]"
    }
    catch {
        $detail = $_.Exception.Message
        if ($_.InvocationInfo -and $_.InvocationInfo.ScriptLineNumber) {
            $detail = $detail + ' @line ' + $_.InvocationInfo.ScriptLineNumber + ': ' + $_.InvocationInfo.Line.Trim()
        }
        $json = '{"ok":false,"error":' + ($detail | ConvertTo-Json) + '}'
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes $bytes -HeadOnly $HeadOnly
        return "POST /oa-pbi/dax [ok:false $detail]"
    }
}

# word-ppt-com-handlers.ps1 - Word and PowerPoint COM handlers
# (inserted into server-lib.ps1)

function Get-OaComApp {
    param([string]$ProgId)
    try { return [Runtime.InteropServices.Marshal]::GetActiveObject($ProgId) } catch { return $null }
}

function Handle-OaComWord {
    param($Ssl, $Req, $Sync, [bool]$HeadOnly)
    $path = ([string]$Req.RawUrl -split '\?')[0].TrimEnd('/')

    if ($Sync.ComBridge -ne $true) {
        Send-OaError -Ssl $Ssl -Code 503 -Status 'Service Disabled' -Message 'COM bridge is disabled' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [503 disabled]"
    }
    $origin = [string]$Req.Headers['origin']
    if (-not $origin -or -not $origin.StartsWith('https://localhost:')) {
        Send-OaError -Ssl $Ssl -Code 403 -Status 'Forbidden' -Message 'bad origin' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [403 bad origin]"
    }

    $body = Read-OaJsonBody $Req
    $action = [string]$body.action

    $known = @('get_text','get_stats','find_replace','insert_text','set_style','get_paragraphs','add_table','save','get_properties')
    if ($known -notcontains $action) {
        Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message "action must be one of: $($known -join ', ')" -HeadOnly $HeadOnly
        return "POST $path [400 unknown action]"
    }

    $word = Get-OaComApp 'Word.Application'
    if (-not $word) {
        $json = '{"ok":false,"error":"Word is not running (open a document first)"}'
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes ([Text.Encoding]::UTF8.GetBytes($json)) -HeadOnly $HeadOnly
        return "POST $path [ok:false no word]"
    }

    try {
        $doc = $word.ActiveDocument
        $result = $null

        switch ($action) {
            'get_text' {
                $txt = $doc.Content.Text -replace "`r", "`n"
                if ($txt.Length -gt 50000) { $txt = $txt.Substring(0, 50000) + '...[truncated]' }
                $result = @{ ok = $true; text = $txt; length = $doc.Content.Text.Length }
            }
            'get_stats' {
                $result = @{ ok = $true
                    paragraphs = $doc.Paragraphs.Count
                    words = $doc.Words.Count
                    sentences = $doc.Sentences.Count
                    characters = $doc.Characters.Count
                    pages = $doc.ComputeStatistics(2)
                    name = $doc.Name; fullName = $doc.FullName
                }
            }
            'find_replace' {
                $findText = [string]$body.find
                $replaceText = [string]$body.replace
                if (-not $findText) { throw 'find is required' }
                $range = $doc.Content
                $find = $range.Find
                $find.ClearFormatting()
                $find.Replacement.ClearFormatting()
                $count = 0
                while ($find.Execute($findText, $false, $false, $false, $false, $false, $true, 1, $false, $replaceText, 2)) { $count++ }
                $result = @{ ok = $true; replaced = $count; find = $findText }
            }
            'insert_text' {
                $text = [string]$body.text
                $where = [string]$body.where; if (-not $where) { $where = 'end' }
                $range = $doc.Content
                switch ($where) {
                    'end' { $range.Collapse(0); $range.InsertAfter($text + "`r") }
                    'start' { $range.Collapse(1); $range.InsertBefore($text + "`r") }
                    'cursor' { $word.Selection.TypeText($text) }
                }
                $result = @{ ok = $true; inserted = $text.Length; where = $where }
            }
            'set_style' {
                $styleName = [string]$body.style
                $paraIndex = [int]$body.paragraph
                if ($paraIndex -gt 0 -and $paraIndex -le $doc.Paragraphs.Count) {
                    $doc.Paragraphs.Item($paraIndex).set_Style($doc.Styles.Item($styleName))
                    $result = @{ ok = $true; paragraph = $paraIndex; style = $styleName }
                } else { throw "paragraph index out of range: $paraIndex" }
            }
            'get_paragraphs' {
                $paras = @()
                $maxP = [Math]::Min($doc.Paragraphs.Count, 200)
                for ($i = 1; $i -le $maxP; $i++) {
                    $p = $doc.Paragraphs.Item($i)
                    $txt = $p.Range.Text -replace "`r", ""
                    if ($txt.Length -gt 200) { $txt = $txt.Substring(0, 200) + '...' }
                    $paras += @{ index = $i; text = $txt; style = [string]$p.Style.NameLocal }
                }
                $result = @{ ok = $true; count = $doc.Paragraphs.Count; paragraphs = $paras }
            }
            'add_table' {
                $rows = [int]$body.rows; if ($rows -lt 1) { $rows = 2 }
                $cols = [int]$body.cols; if ($cols -lt 1) { $cols = 2 }
                $range = $doc.Content; $range.Collapse(0)
                $tbl = $doc.Tables.Add($range, $rows, $cols)
                $result = @{ ok = $true; rows = $rows; cols = $cols; tableIndex = $doc.Tables.Count }
            }
            'save' {
                $savePath = [string]$body.path
                if ($savePath) { $doc.SaveAs([ref]$savePath) } else { $doc.Save() }
                $result = @{ ok = $true; path = $doc.FullName }
            }
            'get_properties' {
                $props = @{}
                foreach ($pn in @('Title','Author','Subject','Keywords','Comments','Company','Category')) {
                    try { $props[$pn] = [string]$doc.BuiltInDocumentProperties.Item($pn).Value } catch { $props[$pn] = '' }
                }
                $result = @{ ok = $true; properties = $props; name = $doc.Name }
            }
        }

        $json = $result | ConvertTo-Json -Depth 5 -Compress
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes ([Text.Encoding]::UTF8.GetBytes($json)) -HeadOnly $HeadOnly
        return "POST $path [200 $action]"
    }
    catch {
        $json = '{"ok":false,"error":' + ($_.Exception.Message | ConvertTo-Json) + '}'
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes ([Text.Encoding]::UTF8.GetBytes($json)) -HeadOnly $HeadOnly
        return "POST $path [ok:false $($_.Exception.Message)]"
    }
}

function Handle-OaComPpt {
    param($Ssl, $Req, $Sync, [bool]$HeadOnly)
    $path = ([string]$Req.RawUrl -split '\?')[0].TrimEnd('/')

    if ($Sync.ComBridge -ne $true) {
        Send-OaError -Ssl $Ssl -Code 503 -Status 'Service Disabled' -Message 'COM bridge is disabled' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [503 disabled]"
    }
    $origin = [string]$Req.Headers['origin']
    if (-not $origin -or -not $origin.StartsWith('https://localhost:')) {
        Send-OaError -Ssl $Ssl -Code 403 -Status 'Forbidden' -Message 'bad origin' -HeadOnly $HeadOnly
        return "$($Req.Method) $path [403 bad origin]"
    }

    $body = Read-OaJsonBody $Req
    $action = [string]$body.action

    $known = @('list_slides','get_slide_text','add_slide','set_text','delete_slide','get_shapes','save','get_properties','reorder_slide')
    if ($known -notcontains $action) {
        Send-OaError -Ssl $Ssl -Code 400 -Status 'Bad Request' -Message "action must be one of: $($known -join ', ')" -HeadOnly $HeadOnly
        return "POST $path [400 unknown action]"
    }

    $ppt = Get-OaComApp 'PowerPoint.Application'
    if (-not $ppt) {
        $json = '{"ok":false,"error":"PowerPoint is not running (open a presentation first)"}'
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes ([Text.Encoding]::UTF8.GetBytes($json)) -HeadOnly $HeadOnly
        return "POST $path [ok:false no ppt]"
    }

    try {
        $pres = $ppt.ActivePresentation
        $result = $null

        switch ($action) {
            'list_slides' {
                $slides = @()
                for ($i = 1; $i -le $pres.Slides.Count; $i++) {
                    $sl = $pres.Slides.Item($i)
                    $title = ''
                    try { $title = $sl.Shapes.Title.TextFrame.TextRange.Text } catch { }
                    $slides += @{ index = $i; title = $title }
                }
                $result = @{ ok = $true; count = $pres.Slides.Count; name = $pres.Name; slides = $slides }
            }
            'get_slide_text' {
                $idx = [int]$body.slide; if ($idx -lt 1) { $idx = 1 }
                if ($idx -gt $pres.Slides.Count) { throw "slide $idx out of range (1-$($pres.Slides.Count))" }
                $sl = $pres.Slides.Item($idx)
                $texts = @()
                foreach ($shape in $sl.Shapes) {
                    if ($shape.HasTextFrame -eq -1) {
                        $texts += @{ name = [string]$shape.Name; text = $shape.TextFrame.TextRange.Text }
                    }
                }
                $result = @{ ok = $true; slide = $idx; texts = $texts }
            }
            'add_slide' {
                $layout = [int]$body.layout; if ($layout -lt 1) { $layout = 2 }
                $title = [string]$body.title
                $newSlide = $pres.Slides.Add($pres.Slides.Count + 1, $layout)
                if ($title -and $newSlide.Shapes.Title) {
                    $newSlide.Shapes.Title.TextFrame.TextRange.Text = $title
                }
                $result = @{ ok = $true; index = $pres.Slides.Count; layout = $layout; title = $title }
            }
            'set_text' {
                $slideIdx = [int]$body.slide
                $shapeName = [string]$body.shape
                $text = [string]$body.text
                if ($slideIdx -lt 1 -or $slideIdx -gt $pres.Slides.Count) { throw "slide $slideIdx out of range" }
                $sl = $pres.Slides.Item($slideIdx)
                $shape = $null
                try { $shape = $sl.Shapes.Item($shapeName) } catch { }
                if (-not $shape -and $shapeName -eq 'Title') { $shape = $sl.Shapes.Title }
                if (-not $shape) { throw "shape '$shapeName' not found" }
                $shape.TextFrame.TextRange.Text = $text
                $result = @{ ok = $true; slide = $slideIdx; shape = [string]$shape.Name }
            }
            'delete_slide' {
                $idx = [int]$body.slide
                if ($idx -lt 1 -or $idx -gt $pres.Slides.Count) { throw "slide $idx out of range" }
                $pres.Slides.Item($idx).Delete()
                $result = @{ ok = $true; deleted = $idx; remaining = $pres.Slides.Count }
            }
            'get_shapes' {
                $idx = [int]$body.slide; if ($idx -lt 1) { $idx = 1 }
                $sl = $pres.Slides.Item($idx)
                $shapes = @()
                foreach ($sh in $sl.Shapes) {
                    $shapes += @{
                        name = [string]$sh.Name; type = [string]$sh.Type
                        left = $sh.Left; top = $sh.Top; width = $sh.Width; height = $sh.Height
                        hasText = ($sh.HasTextFrame -eq -1)
                    }
                }
                $result = @{ ok = $true; slide = $idx; count = $shapes.Count; shapes = $shapes }
            }
            'save' {
                $savePath = [string]$body.path
                if ($savePath) { $pres.SaveAs($savePath) } else { $pres.Save() }
                $result = @{ ok = $true; path = $pres.FullName }
            }
            'get_properties' {
                $result = @{ ok = $true; name = $pres.Name; fullName = $pres.FullName
                    slideWidth = $pres.PageSetup.SlideWidth; slideHeight = $pres.PageSetup.SlideHeight
                    slides = $pres.Slides.Count }
            }
            'reorder_slide' {
                $from = [int]$body.from; $to = [int]$body.to
                if ($from -lt 1 -or $from -gt $pres.Slides.Count) { throw "from $from out of range" }
                if ($to -lt 1 -or $to -gt $pres.Slides.Count) { throw "to $to out of range" }
                $pres.Slides.Item($from).MoveTo($to)
                $result = @{ ok = $true; from = $from; to = $to }
            }
        }

        $json = $result | ConvertTo-Json -Depth 6 -Compress
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes ([Text.Encoding]::UTF8.GetBytes($json)) -HeadOnly $HeadOnly
        return "POST $path [200 $action]"
    }
    catch {
        $json = '{"ok":false,"error":' + ($_.Exception.Message | ConvertTo-Json) + '}'
        Write-OaResponse -Ssl $Ssl -Code 200 -Status 'OK' -ContentType 'application/json; charset=utf-8' -Bytes ([Text.Encoding]::UTF8.GetBytes($json)) -HeadOnly $HeadOnly
        return "POST $path [ok:false $($_.Exception.Message)]"
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
            # explicit Tls12 instead of SslProtocols::None (system default):
            # deterministic regardless of machine-wide TLS registry settings;
            # WebView2 and modern clients always speak TLS 1.2
            $ssl.AuthenticateAsServer($Cert, $false, [System.Security.Authentication.SslProtocols]::Tls12, $false)
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

            if ($rawUrl.StartsWith('/oa-com/word')) {
                return (Handle-OaComWord -Ssl $ssl -Req $req -Sync $Sync -HeadOnly $headOnly)
            }
            if ($rawUrl.StartsWith('/oa-com/ppt')) {
                return (Handle-OaComPpt -Ssl $ssl -Req $req -Sync $Sync -HeadOnly $headOnly)
            }
            if ($rawUrl.StartsWith('/oa-com/')) {
                return (Handle-OaCom -Ssl $ssl -Req $req -Sync $Sync -HeadOnly $headOnly)
            }

            if ($rawUrl.StartsWith('/oa-pbi/')) {
                return (Handle-OaPbi -Ssl $ssl -Req $req -Sync $Sync -HeadOnly $headOnly)
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
