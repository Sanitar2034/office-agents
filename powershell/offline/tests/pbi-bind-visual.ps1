# bind-visual.ps1 - bind the lineChart in test.pbix to oa_test_data
# (Month -> Category, Value -> Y), per PBIR queryState format.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$pbix = 'C:\Users\kira\Documents\test.pbix'
$zip = [System.IO.Compression.ZipFile]::Open($pbix, 'Update')
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -match 'visual\.json$' } | Select-Object -First 1
    if (-not $entry) { throw 'visual.json not found' }
    $sr = New-Object IO.StreamReader($entry.Open())
    $json = $sr.ReadToEnd(); $sr.Close()
    $vis = $json | ConvertFrom-Json

    $vis.visual | Add-Member -NotePropertyName 'query' -NotePropertyValue (
        @{
            queryState = @{
                Category = @{ projections = @(
                    @{ queryRef = 'oa_test_data.Month'
                       field = @{ Column = @{ Expression = @{ SourceRef = @{ Entity = 'oa_test_data' } } ; Property = 'Month' } } }
                ) }
                Y = @{ projections = @(
                    @{ queryRef = 'oa_test_data.Value'
                       field = @{ Column = @{ Expression = @{ SourceRef = @{ Entity = 'oa_test_data' } } ; Property = 'Value' } } }
                ) }
            }
        } | ConvertTo-Json -Depth 12 | ConvertFrom-Json
    ) -Force

    $newJson = $vis | ConvertTo-Json -Depth 20 -Compress
    $entry.Delete()
    $newEntry = $zip.CreateEntry($entry.FullName)
    $sw = New-Object IO.StreamWriter($newEntry.Open(), (New-Object Text.UTF8Encoding($false)))
    $sw.Write($newJson); $sw.Close()
    Write-Host 'visual bound to oa_test_data (Month/Value)'
}
finally { $zip.Dispose() }
