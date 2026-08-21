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
