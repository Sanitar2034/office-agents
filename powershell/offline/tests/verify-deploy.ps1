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
Assert "excel bundle contains 'verify_edits'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'verify_edits' -List -Quiet)
)
Assert "excel bundle contains 'undo_edits'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'undo_edits' -List -Quiet)
)
Assert "excel bundle contains 'pbi_execute_tmsl'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'pbi_execute_tmsl' -List -Quiet)
)
Assert "excel bundle contains 'pbi_dmv'" (
    (Get-ChildItem $xlAssets -Filter '*.js' -Recurse | Select-String -Pattern 'pbi_dmv' -List -Quiet)
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

# 3b) taskpane pin: the pane must re-open by itself (setStartupBehavior)
foreach ($app in 'excel', 'powerpoint', 'word') {
    $assets = Join-Path $site "$app\assets"
    Assert "$app bundle pins the taskpane (setStartupBehavior)" (
        (Get-ChildItem $assets -Filter '*.js' -Recurse | Select-String -Pattern 'setStartupBehavior' -List -Quiet)
    )
}
$oj = Join-Path $root 'office-js'
foreach ($f in 'excel-win32-16.01.js', 'word-win32-16.01.js', 'powerpoint-win32-16.01.js') {
    Assert "vendored office-js/$f supports setStartupBehavior" (
        (Get-Content (Join-Path $oj $f) -Raw) -match 'setStartupBehavior'
    )
}

# 3c) runtime requirement guards must ship (manifest has no <Requirements> gate)
Assert "powerpoint bundle ships requirement guards (set names + message)" (
    (Get-ChildItem (Join-Path $site 'powerpoint\assets') -Filter '*.js' -Recurse |
        Select-String -Pattern 'PowerPointApi' -List -Quiet) -and
    (Get-ChildItem (Join-Path $site 'powerpoint\assets') -Filter '*.js' -Recurse |
        Select-String -Pattern 'LTSC builds cap' -List -Quiet)
)
Assert "powerpoint bundle ships the sldSz slide-size fallback hint" (
    (Get-ChildItem (Join-Path $site 'powerpoint\assets') -Filter '*.js' -Recurse |
        Select-String -Pattern 'sldSz' -List -Quiet)
)

# 3d) dev-registration rollback UI must ship in every settings panel
foreach ($app in 'excel', 'powerpoint', 'word') {
    Assert "$app bundle ships the dev-registration rollback button" (
        (Get-ChildItem (Join-Path $site "$app\assets") -Filter '*.js' -Recurse |
            Select-String -Pattern 'dev-registration' -List -Quiet)
    )
    Assert "$app bundle ships the todo_write task ledger" (
        (Get-ChildItem (Join-Path $site "$app\assets") -Filter '*.js' -Recurse |
            Select-String -Pattern 'todo_write' -List -Quiet)
    )
}
Assert "word bundle ships requirement guards (optional-feature sets)" (
    (Get-ChildItem (Join-Path $site 'word\assets') -Filter '*.js' -Recurse |
        Select-String -Pattern 'WordApiOnline' -List -Quiet) -and
    (Get-ChildItem (Join-Path $site 'word\assets') -Filter '*.js' -Recurse |
        Select-String -Pattern 'WordApiDesktop' -List -Quiet)
)

# 3e) autostart helper ships next to the server
Assert "autostart.ps1 exists next to the server" (
    Test-Path (Join-Path $root 'autostart.ps1')
)

# 4) no sourcemaps shipped
$maps = Get-ChildItem $site -Recurse -Filter '*.map'
Assert "no .map files shipped" ($maps.Count -eq 0)

# 5) manifests still point at localhost:18131-18133
foreach ($m in 'excel-manifest.xml', 'powerpoint-manifest.xml', 'word-manifest.xml') {
    $c = Get-Content (Join-Path $root "manifests\$m") -Raw
    Assert "$m points to localhost:1813x" ($c -match 'https://localhost:1813[1-3]')
    # a Requirements gate that the host doesn't support makes the add-in
    # activate silently nowhere (observed on Word/PPT); Excel ships without one
    Assert "$m has no <Requirements> activation gate" ($c -notmatch '<Requirements>')
}

# 6) every manifest icon URL must resolve to a real file in the site bundle
#    (a 404 icon makes Word/PowerPoint refuse to activate the add-in)
foreach ($m in 'excel-manifest.xml', 'powerpoint-manifest.xml', 'word-manifest.xml') {
    $c = Get-Content (Join-Path $root "manifests\$m") -Raw
    $icons = [regex]::Matches($c, 'https://localhost:1813\d(/assets/[a-z0-9\.\-]+\.png)') |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
    foreach ($i in $icons) {
        # map port -> site dir
        $app = if ($c -match '18132') { 'powerpoint' } elseif ($c -match '18133') { 'word' } else { 'excel' }
        Assert "$m icon $i exists in site/$app" (Test-Path (Join-Path $site "$app$i"))
    }
}

Write-Host ""
Write-Host "RESULT: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
