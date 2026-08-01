<#
.SYNOPSIS
    Popula roots.pem e intermediates.pem com a cadeia oficial da ICP-Brasil.

.DESCRIPTION
    Versão PowerShell do update-trust-store.sh. Equivalente funcional,
    sem dependência de bash/curl/openssl/unzip — usa apenas cmdlets
    nativos do PowerShell 5+ e classes .NET.

    Idempotente: pode ser executado novamente para atualizar a cadeia.
    Após executar, revise com `git diff` e commite:
        git add roots.pem intermediates.pem
        git commit -m "chore(icp-brasil): atualiza trust store (yyyy-MM-dd)"

.EXAMPLE
    PS> cd src/lib/server/icp-brasil
    PS> .\update-trust-store.ps1

.NOTES
    Versão equivalente em bash: update-trust-store.sh
    Requisitos: PowerShell 5.1+ (Windows 10+) ou PowerShell Core 7+
    Acesso de rede a https://acraiz.icpbrasil.gov.br
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Esconde a barra de download (acelera).

# Compat com Windows PowerShell 5.1 (default no Windows):
#  - Forca UTF-8 na saida pra acentos do log nao virarem mojibake.
#  - Forca TLS 1.2: PS 5.1 default usa TLS 1.0/1.1, que muitos endpoints
#    .gov.br ja rejeitam (inclusive acraiz.icpbrasil.gov.br).
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# -----------------------------------------------------------------------------
# Setup
# -----------------------------------------------------------------------------

Set-Location -Path $PSScriptRoot
$workDir = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath()) `
    -Name "icp-trust-$(Get-Random)" -Force

# Helper compat 5.1+: ISO 8601 UTC sem dependencia do parametro -AsUTC (PS 7+).
function Get-IsoUtcNow {
    return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

# Cleanup automático ao sair (sucesso ou erro).
$cleanup = {
    if (Test-Path $workDir.FullName) {
        Remove-Item -Recurse -Force $workDir.FullName -ErrorAction SilentlyContinue
    }
}
trap { & $cleanup; break }

function Write-Log    { param([string]$Message) Write-Host "[trust-store] $Message" -ForegroundColor Cyan }
function Write-Err    { param([string]$Message) Write-Host "[ERRO] $Message" -ForegroundColor Red; exit 1 }
function Write-WarnLn { param([string]$Message) Write-Host "  ⚠ $Message" -ForegroundColor Yellow }

$rootsUrlBase = 'https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ'
$zipUrl       = 'https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip'

# Versões da AC Raiz cujos certificados emitidos ainda podem aparecer em assinaturas:
#   v5  emitida em 2016, validade até 2028
#   v10 emitida em 2020, validade até 2030 (atual)
$rootVersions = @('v5', 'v10')

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

<#
Carrega um certificado X.509 a partir de arquivo (DER ou PEM, auto-detectado).
Retorna o objeto X509Certificate2 ou $null se o conteúdo não for um cert válido.
#>
function Read-X509Cert {
    param([string]$Path)

    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
    } catch {
        return $null
    }

    # PEM: começa com "-----BEGIN" (ASCII 0x2D 0x2D 0x2D 0x2D 0x2D 0x42 ...).
    if ($bytes.Length -gt 10 -and [Text.Encoding]::ASCII.GetString($bytes[0..9]) -eq '-----BEGIN') {
        try {
            $pemText = [Text.Encoding]::ASCII.GetString($bytes)
            $base64  = ($pemText -replace '-----BEGIN CERTIFICATE-----', '' `
                                -replace '-----END CERTIFICATE-----', '' `
                                -replace '\s', '')
            $derBytes = [Convert]::FromBase64String($base64)
            return New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(, $derBytes)
        } catch {
            return $null
        }
    }

    # DER: tenta direto.
    try {
        return New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(, $bytes)
    } catch {
        return $null
    }
}

<#
Converte X509Certificate2 para PEM (base64 quebrado em 64 chars) com header
BEGIN/END CERTIFICATE — formato esperado pelo node-forge e openssl.
#>
function ConvertTo-PemString {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert)

    $base64 = [Convert]::ToBase64String($Cert.RawData)
    $lines  = for ($i = 0; $i -lt $base64.Length; $i += 64) {
        $base64.Substring($i, [Math]::Min(64, $base64.Length - $i))
    }
    return "-----BEGIN CERTIFICATE-----`n" + ($lines -join "`n") + "`n-----END CERTIFICATE-----`n"
}

<#
Calcula SHA-256 dos bytes DER (RawData) do cert e devolve em hex lowercase.
Equivalente ao `openssl dgst -sha256` do script bash.
#>
function Get-CertSha256 {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha.ComputeHash($Cert.RawData)
    } finally {
        $sha.Dispose()
    }
    return -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
}

# -----------------------------------------------------------------------------
# 1. Raízes
# -----------------------------------------------------------------------------

Write-Log 'Baixando AC Raízes...'

$rootsTmp = Join-Path $workDir.FullName 'roots.pem'
$header = @"
# AC Raízes ICP-Brasil — gerado por update-trust-store.ps1
# Atualizado em $(Get-IsoUtcNow)

"@
[System.IO.File]::WriteAllText($rootsTmp, $header, [Text.UTF8Encoding]::new($false))

foreach ($v in $rootVersions) {
    $src = "$rootsUrlBase/ICP-Brasil$v.crt"
    $dst = Join-Path $workDir.FullName "ICP-Brasil$v.crt"

    Write-Log "  → $src"
    try {
        Invoke-WebRequest -Uri $src -OutFile $dst -TimeoutSec 30 -UseBasicParsing
    } catch {
        Write-Err "Falha ao baixar ${src}: $($_.Exception.Message)"
    }

    $cert = Read-X509Cert -Path $dst
    if ($null -eq $cert) {
        Write-Err "Conteúdo de $src não é um certificado X.509 reconhecível."
    }

    try {
        $subject   = $cert.Subject
        $notBefore = $cert.NotBefore.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $notAfter  = $cert.NotAfter.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $sha256    = Get-CertSha256 -Cert $cert
        $pem       = ConvertTo-PemString -Cert $cert

        $block = @"
# AC Raiz ICP-Brasil $v
# Subject:  $subject
# Validade: $notBefore até $notAfter
# SHA-256:  $sha256
$pem

"@
        [System.IO.File]::AppendAllText($rootsTmp, $block, [Text.UTF8Encoding]::new($false))
    } finally {
        $cert.Dispose()
    }
}

# -----------------------------------------------------------------------------
# 2. Intermediárias
# -----------------------------------------------------------------------------

Write-Log 'Baixando ACs intermediárias (zip oficial)...'

$zipPath = Join-Path $workDir.FullName 'ACcompactado.zip'
try {
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -TimeoutSec 120 -UseBasicParsing
} catch {
    Write-Err "Falha ao baixar ${zipUrl}: $($_.Exception.Message)"
}

$unzipDir = New-Item -ItemType Directory -Path (Join-Path $workDir.FullName 'intermediates')
Expand-Archive -Path $zipPath -DestinationPath $unzipDir.FullName -Force

$intTmp = Join-Path $workDir.FullName 'intermediates.pem'
$header = @"
# ACs intermediárias da ICP-Brasil — gerado por update-trust-store.ps1
# Origem:    $zipUrl
# Atualizado em $(Get-IsoUtcNow)

"@
[System.IO.File]::WriteAllText($intTmp, $header, [Text.UTF8Encoding]::new($false))

$count = 0
Get-ChildItem -Path $unzipDir.FullName -Recurse -File | ForEach-Object {
    $file = $_
    $cert = Read-X509Cert -Path $file.FullName
    if ($null -eq $cert) {
        Write-WarnLn "ignorando $($file.Name): não é um X.509"
        return
    }

    try {
        $subject = $cert.Subject
        $sha256  = Get-CertSha256 -Cert $cert
        $pem     = ConvertTo-PemString -Cert $cert

        $block = @"
# $($file.Name)
# Subject: $subject
# SHA-256: $sha256
$pem

"@
        [System.IO.File]::AppendAllText($intTmp, $block, [Text.UTF8Encoding]::new($false))
        $script:count++
    } finally {
        $cert.Dispose()
    }
}

Write-Log "  → $script:count ACs intermediárias processadas"

# -----------------------------------------------------------------------------
# 3. Substituir os PEMs versionados
# -----------------------------------------------------------------------------

Move-Item -Path $rootsTmp -Destination (Join-Path $PSScriptRoot 'roots.pem') -Force
Move-Item -Path $intTmp   -Destination (Join-Path $PSScriptRoot 'intermediates.pem') -Force

$rootsCount = (Select-String -Path 'roots.pem' -Pattern '-----BEGIN CERTIFICATE-----' -SimpleMatch).Count
$intCount   = (Select-String -Path 'intermediates.pem' -Pattern '-----BEGIN CERTIFICATE-----' -SimpleMatch).Count

Write-Log "Pronto! roots.pem ($rootsCount certificados), intermediates.pem ($intCount certificados)"
Write-Log "Revise com:  git diff roots.pem intermediates.pem"
Write-Log "Commite com: git add roots.pem intermediates.pem ; git commit -m 'chore(icp-brasil): atualiza trust store ($(Get-Date -Format yyyy-MM-dd))'"

& $cleanup
