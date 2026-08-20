# verify-deploy.ps1 - post-deploy sanity: check the built site actually
# contains the fork's features and no CDN office.js reference leaked back.
# Run after build-package.ps1:  powershell -File tests\verify-deploy.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$site = Join-Path $root 'site'

$pass = 0; $fail = 0
function Assert($name, $cond) {
    if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
    else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}

Write-Host "== deploy verification ==" -ForegroundColor Cyan

# 1) every app has a taskpane and it references the LOCAL office.js
foreach ($app in 'excel', 'powerpoint', 'word') {
    $html = Join-Path $site "$app\taskpane.html"
    Assert "$app taskpane.html exists" (Test-Path $html)
    if (Test-Path $html) {
        $c = Get-Content $html -Raw
        Assert "$app uses local /office-js/office.js" ($c -match '/office-js/office\.js')
        Assert "$app has no CDN office.js" ($c -notmatch 'appsforoffice\.microsoft\.com')
    }
}

# 2) feature strings present in the built bundles (all three apps)
$features = @(
    'Auto-compact Context',
    'Enable Web Tools',
    'Model supports images',
    'openwebui',
    'Load models'
)
foreach ($app in 'excel', 'powerpoint', 'word') {
    $assets = Join-Path $site "$app\assets"
    foreach ($f in $features) {
        $found = Get-ChildItem $assets -Filter '*.js' -Recurse |
            Select-String -Pattern ([regex]::Escape($f)) -List -Quiet
        Assert "$app bundle contains '$f'" $found
    }
}

# 3) excel-specific: undo tool + COM bridge + value normalization
$xlAssets = Join-Path $site 'excel\assets'
Assert "excel bundle contains 'undo_edits'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'undo_edits' -List -Quiet)
)
Assert "excel bundle contains 'pbi_bridge'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'pbi_bridge' -List -Quiet)
)
Assert "excel bundle contains 'pbi_query'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'pbi_query' -List -Quiet)
)
Assert "excel bundle contains 'com_bridge'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'com_bridge' -List -Quiet)
)
Assert "excel bundle contains 'Desktop Power Tools'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern ([regex]::Escape('Desktop Power Tools')) -List -Quiet)
)

# 4) no sourcemaps shipped
$maps = Get-ChildItem $site -Recurse -Filter '*.map'
Assert "no .map files shipped" ($maps.Count -eq 0)

# 5) manifests still point at localhost:3000-3002
foreach ($m in 'excel-manifest.xml', 'powerpoint-manifest.xml', 'word-manifest.xml') {
    $c = Get-Content (Join-Path $root "manifests\$m") -Raw
    Assert "$m points to localhost:300x" ($c -match 'https://localhost:300[0-2]')
}

Write-Host ""
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
