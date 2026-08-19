# build-package.ps1 - run this ON A MACHINE WITH INTERNET + Node.js to
# (re)build the offline package (site/, office-js/, manifests/).
# The offline target machine never runs this script.

param(
    [string]$PnpmCmd = 'pnpm',
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$repoRoot = Split-Path -Parent $root

if (-not $SkipInstall) {
    Write-Host '== pnpm install ==' -ForegroundColor Cyan
    & $PnpmCmd install
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
}

Write-Host '== pnpm build ==' -ForegroundColor Cyan
& $PnpmCmd -r build
if ($LASTEXITCODE -ne 0) { throw 'pnpm build failed' }

# 1. copy built sites (without sourcemaps)
foreach ($app in 'excel', 'powerpoint', 'word') {
    Write-Host "== copy $app dist =="
    $dst = Join-Path $root "site\$app"
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    Copy-Item (Join-Path $repoRoot "packages\$app\dist") $dst -Recurse
    Get-ChildItem $dst -Recurse -Filter '*.map' | Remove-Item -Force
}

# 2. vendor Office.js (replaces the appsforoffice.microsoft.com CDN)
Write-Host '== vendor Office.js =='
$ojDst = Join-Path $root 'office-js'
if (-not (Test-Path (Join-Path $ojDst 'office.js'))) {
    $tmp = Join-Path $env:TEMP "office-js-pack-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    Push-Location $tmp
    npm pack '@microsoft/office-js' | Out-Null
    $tgz = Get-ChildItem *.tgz | Select-Object -First 1
    tar -xzf $tgz.Name
    New-Item -ItemType Directory -Path $ojDst -Force | Out-Null
    Copy-Item (Join-Path $tmp 'package\dist\*') $ojDst -Recurse
    # debug builds and maps are never loaded in production
    Get-ChildItem $ojDst -Recurse -Include '*.debug.js', '*.js.map' | Remove-Item -Force
    Pop-Location
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host '  office-js/ already vendored (delete the folder to re-vendor)'
}

# 3. rewrite the CDN reference in built HTML to the local copy
Write-Host '== rewrite office.js URL in HTML =='
$cdn = 'https://appsforoffice.microsoft.com/lib/1/hosted/office.js'
foreach ($html in Get-ChildItem (Join-Path $root 'site') -Recurse -Include '*.html') {
    (Get-Content $html.FullName -Raw -Encoding UTF8).
        Replace($cdn, '/office-js/office.js') |
        Set-Content -LiteralPath $html.FullName -Encoding UTF8 -NoNewline
}

# 4. manifests (dev manifests already point to localhost:3000-3002)
Write-Host '== copy manifests =='
New-Item -ItemType Directory -Path (Join-Path $root 'manifests') -Force | Out-Null
Copy-Item (Join-Path $repoRoot 'packages\excel\manifest.xml') (Join-Path $root 'manifests\excel-manifest.xml') -Force
Copy-Item (Join-Path $repoRoot 'packages\powerpoint\manifest.xml') (Join-Path $root 'manifests\powerpoint-manifest.xml') -Force
Copy-Item (Join-Path $repoRoot 'packages\word\manifest.xml') (Join-Path $root 'manifests\word-manifest.xml') -Force

Write-Host 'Done. The powershell\ folder is now a self-contained offline package.' -ForegroundColor Green
