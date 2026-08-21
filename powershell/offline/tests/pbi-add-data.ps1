# add-data-and-test.ps1 - add a calculated table to the RUNNING Power BI
# Desktop workspace via TOM (same as Tabular Editor does), then verify via DAX.
$ErrorActionPreference = 'Stop'
$mod = (Get-Module -ListAvailable SqlServer | Select-Object -First 1).ModuleBase
Add-Type -Path (Join-Path $mod 'Microsoft.AnalysisServices.Tabular.dll') | Out-Null

# find the live engine port
$wsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Power BI Desktop\AnalysisServicesWorkspaces'
$portFile = Get-ChildItem -LiteralPath $wsDir -Filter 'msmdsrv.port.txt' -Recurse |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$digits = (Get-Content -LiteralPath $portFile.FullName -Raw) -replace '\D', ''
$port = [int]$digits
Write-Host "engine port: $port"

$server = New-Object Microsoft.AnalysisServices.Tabular.Server
$server.Connect("localhost:$port")
$db = $server.Databases[0]
Write-Host "workspace db: $($db.Name)"

if ($db.Model.Tables.ContainsName('oa_test_data')) {
    Write-Host 'table already exists'
} else {
    $t = New-Object Microsoft.AnalysisServices.Tabular.Table
    $t.Name = 'oa_test_data'
    $src = New-Object Microsoft.AnalysisServices.Tabular.CalculatedPartitionSource
    $src.Expression = 'DataTable("Month", STRING, "Value", DOUBLE, {{"Jan",10},{"Feb",25},{"Mar",18},{"Apr",32}})'
    $p = New-Object Microsoft.AnalysisServices.Tabular.Partition
    $p.Name = 'oa_part'
    $p.Source = $src
    $t.Partitions.Add($p)
    $db.Model.Tables.Add($t)
    $db.Model.SaveChanges()
    Write-Host 'table oa_test_data added (Jan 10, Feb 25, Mar 18, Apr 32)'
}
$server.Disconnect()
