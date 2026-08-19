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
    Write-Host "[3/3] Registering trusted add-in catalog: $manifestsDir" -ForegroundColor Yellow
    $regBase = 'HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs'
    $regKey = Join-Path $regBase $catalogGuid
    if (-not (Test-Path $regBase)) { New-Item -Path $regBase -Force | Out-Null }
    New-Item -Path $regKey -Force | Out-Null
    Set-ItemProperty -Path $regKey -Name 'Id' -Value $catalogGuid -Type String
    Set-ItemProperty -Path $regKey -Name 'Url' -Value $manifestsDir -Type String
    Set-ItemProperty -Path $regKey -Name 'Flags' -Value 1 -Type DWord
    Write-Host '      done (per-user, no admin)' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Setup complete. Next steps:' -ForegroundColor Cyan
Write-Host '  1. Run start.ps1 - it starts the PowerShell HTTPS server.'
Write-Host '  2. Open Word/Excel/PowerPoint:'
Write-Host '     Insert (or Add-ins) -> Get Add-ins / My Add-ins -> SHARED FOLDER'
Write-Host '     -> pick "OpenWord" / "OpenExcel" / "OpenPPT" -> Add.'
Write-Host '  3. In the add-in Settings choose a custom OpenAI-compatible endpoint.'
Write-Host '     To reach an HTTP LLM server use the built-in same-origin proxy:'
Write-Host '       https://localhost:3000/llm-proxy/v1   (maps to server-config.json target)'
Write-Host ''
