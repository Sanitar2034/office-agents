# install.ps1 - one-time per-user setup on the target (offline) machine.
# No admin rights required. Does three things:
#   1. Creates a self-signed "localhost" certificate in the CURRENT USER store.
#   2. Marks that certificate as trusted (CURRENT USER Root store - Windows will
#      show a one-time security confirmation dialog, click Yes).
#   3. Registers the .\manifests folder as a per-user Trusted Add-in Catalog
#      (HKCU\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs) for Office apps.

param(
    [switch]$Force,     # recreate the certificate even if one exists
    [switch]$CatalogOnly,
    [switch]$CertsOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$manifestsDir = Join-Path $root 'manifests'
$certFriendlyName = 'office-agents localhost'

# stable GUID so reinstall doesn't duplicate catalog entries
$catalogGuid = '{7d3a1c92-4b5e-4f6a-8a90-3c2d1b0e9f55}'

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host '== office-agents (PowerShell edition) setup ==' -ForegroundColor Cyan
Write-Host ("Admin rights: " + $(if (Test-IsAdmin) { 'yes (not required)' } else { 'no (fine)' }))

if (-not $CatalogOnly) {
    # --- 1. certificate -----------------------------------------------------
    $cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -eq $certFriendlyName } |
        Sort-Object NotAfter -Descending | Select-Object -First 1

    if ($cert -and -not $Force) {
        Write-Host "[1/3] Certificate already exists (thumbprint $($cert.Thumbprint), expires $($cert.NotAfter.ToString('yyyy-MM-dd')))" -ForegroundColor Green
    } else {
        Write-Host '[1/3] Creating self-signed certificate for https://localhost ...' -ForegroundColor Yellow
        $cert = New-SelfSignedCertificate `
            -DnsName 'localhost' `
            -CertStoreLocation 'Cert:\CurrentUser\My' `
            -FriendlyName $certFriendlyName `
            -Type SSLServerAuthentication `
            -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
            -NotAfter (Get-Date).AddYears(10)
        Write-Host "      created: thumbprint $($cert.Thumbprint)" -ForegroundColor Green
    }

    # --- 2. trust -------------------------------------------------------------
    $trusted = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if ($trusted) {
        Write-Host '[2/3] Certificate is already trusted for the current user' -ForegroundColor Green
    } else {
        Write-Host '[2/3] Trusting the certificate for the current user...' -ForegroundColor Yellow
        # silent path first (works without a dialog on most Windows 10/11 builds)
        try {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
            $store.Open('ReadWrite')
            $store.Add($cert)
            $store.Close()
        } catch { }
        $trusted = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
        if (-not $trusted) {
            # fallback: may show a Windows security confirmation dialog - click Yes
            Write-Host '      Windows may show a security WARNING dialog - this is expected for' -ForegroundColor Yellow
            Write-Host '      self-signed certificates. Click "Yes" to install it.' -ForegroundColor Yellow
            $tmpCer = Join-Path $env:TEMP "office-agents-$($cert.Thumbprint).cer"
            [IO.File]::WriteAllBytes($tmpCer, $cert.RawData)
            $result = Import-Certificate -FilePath $tmpCer -CertStoreLocation Cert:\CurrentUser\Root
            Remove-Item $tmpCer -ErrorAction SilentlyContinue
            if (-not $result) { throw 'failed to import certificate into CurrentUser Root' }
        }
        Write-Host '      done - certificate is trusted for the current user' -ForegroundColor Green
    }
}

if (-not $CertsOnly) {
    # --- 3. trusted add-in catalog -------------------------------------------
    if (-not (Test-Path (Join-Path $manifestsDir '*.xml'))) {
        throw "no manifest files found in $manifestsDir"
    }
    Write-Host "[3/5] Registering trusted add-in catalog: $manifestsDir" -ForegroundColor Yellow
    $regBase = 'HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs'
    $regKey = Join-Path $regBase $catalogGuid
    if (-not (Test-Path $regBase)) { New-Item -Path $regBase -Force | Out-Null }
    New-Item -Path $regKey -Force | Out-Null
    Set-ItemProperty -Path $regKey -Name 'Id' -Value $catalogGuid -Type String
    Set-ItemProperty -Path $regKey -Name 'Url' -Value $manifestsDir -Type String
    Set-ItemProperty -Path $regKey -Name 'Flags' -Value 1 -Type DWord
    Write-Host '      done (per-user, no admin)' -ForegroundColor Green

    # --- 4. dev registration (WEF\Developer — what office-addin-dev-settings uses) ---
    # In some Office builds this makes the add-in button appear on the ribbon
    # at startup; the reliable path is inserting once from the shared-folder
    # catalog - the pane then stays pinned per document (setStartupBehavior).
    Write-Host '[4/5] Dev add-in registration (WEF\Developer):' -ForegroundColor Yellow
    $devKey = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'
    if (-not (Test-Path $devKey)) { New-Item -Path $devKey -Force | Out-Null }
    $registered = 0
    foreach ($mf in (Get-ChildItem (Join-Path $manifestsDir '*.xml'))) {
        try {
            [xml]$manifest = Get-Content $mf.FullName -Raw
            $addinId = $manifest.OfficeApp.Id
            if ($addinId) {
                New-ItemProperty -Path $devKey -Name $addinId -Value $mf.FullName `
                    -PropertyType String -Force | Out-Null
                Write-Host "      $($manifest.OfficeApp.Id.Substring(0,8))... -> $($mf.Name)" -ForegroundColor Green
                $registered++
            }
        } catch {
            Write-Host "      WARNING: could not parse $($mf.Name)" -ForegroundColor Yellow
        }
    }
    # Force Office to re-read registrations on next start
    New-ItemProperty -Path $devKey -Name 'RefreshAddins' -Value 1 -PropertyType DWord -Force | Out-Null
    Write-Host "      $registered add-in(s) registered" -ForegroundColor Green

    # --- 5. Taskpane auto-open (built into the bundles) ---------------------
    # The taskpane entrypoints call Office.addin.setStartupBehavior(load)
    # after Office.onReady, so the pane re-opens automatically every time
    # the document opens - the Office host remembers this per document.
    Write-Host '[5/5] Taskpane auto-open: built-in (Office.addin.setStartupBehavior)' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Cyan
Write-Host ''
Write-Host '  1. Run start.ps1 to start the HTTPS server'
Write-Host '     (or .\autostart.ps1 -Enable to start it at every Windows logon).'
Write-Host '  2. Insert once per app: Insert -> My Add-ins -> SHARED FOLDER -> Add.'
Write-Host '     After that the pane is pinned per document and re-opens by itself'
Write-Host '     (setStartupBehavior), surviving restarts.'
Write-Host ''
Write-Host 'LLM endpoint (Settings inside the add-in):' -ForegroundColor Cyan
Write-Host '  https://localhost:1813X/llm-proxy/v1   (X = 1 Excel, 2 PPT, 3 Word)'
Write-Host ''
