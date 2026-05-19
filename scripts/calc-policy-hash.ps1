<#
.SYNOPSIS
    Calcula o SHA-256 do PDF oficial da Politica de Assinatura ICP-Brasil
    (PA-AD-RB) para configurar `PA_AD_RB_HASH_HEX` em produção.

.DESCRIPTION
    Baixa o PDF da PA-AD-RB publicado pelo ITI, calcula SHA-256, imprime
    o hash em hex lowercase pronto para colar no Cloudflare Pages, e
    devolve instruções operacionais. Cleanup automático do PDF temporário.

    Por que isso e necessário:
    O sistema embute o atributo `signaturePolicyId` (DOC-ICP-15.03) nos
    SignedAttributes do CMS. Sem o HASH EXATO do PDF publicado pela ITI,
    o Validador ITI rejeita a referência da política como "hash inválido"
    — embora todos os outros checks (cadeia, RSA, OCSP, TSA) continuem
    válidos.

    Rodar:
      1. Antes do primeiro deploy de produção
      2. Sempre que a ITI publicar nova versão do DOC-ICP-15.03
         (típico ~1x a cada 1-2 anos)

.PARAMETER Url
    URL do PDF oficial. Default = versão 7.3 do DOC-ICP-15.03.
    Atualize quando a ITI publicar nova versão (vide
    https://www.gov.br/iti/pt-br/centrais-de-conteudo).

.PARAMETER KeepPdf
    Quando especificado, NÃO apaga o PDF baixado ao final. Útil para
    auditoria — guarde junto com o hash registrado em produção.

.EXAMPLE
    PS> .\calc-policy-hash.ps1
    [policy-hash] Baixando PDF oficial da ITI...
    [policy-hash] SHA-256: 17e0bd2ec76b5dfd7c1eaeb635ad6dc7ed187b65f4404a6e90b2c4bcb15ee078
    ...

.EXAMPLE
    PS> .\calc-policy-hash.ps1 -KeepPdf -OutFile .\auditoria\policy-2026-05.pdf

.NOTES
    Compat: PowerShell 5.1+ (Windows 10/11 default) ou PowerShell Core 7+.
#>

[CmdletBinding()]
param(
    [string]$Url = 'https://www.gov.br/iti/pt-br/centrais-de-conteudo/DOCICP1503v73.pdf',
    [string]$OutFile,
    [switch]$KeepPdf
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Compat com Windows PowerShell 5.1 (acentos no log + TLS 1.2 obrigatório
# para endpoints .gov.br modernos).
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Log {
    param([string]$Message)
    Write-Host "[policy-hash] $Message" -ForegroundColor Cyan
}
function Write-OK {
    param([string]$Message)
    Write-Host "[policy-hash] $Message" -ForegroundColor Green
}
function Write-Warn {
    param([string]$Message)
    Write-Host "[policy-hash] $Message" -ForegroundColor Yellow
}
function Write-Err {
    param([string]$Message)
    Write-Host "[ERRO] $Message" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------------------------------------
# 1. Download
# -----------------------------------------------------------------------------

$tempDir = $null
if ($OutFile) {
    $pdfPath = (Resolve-Path -LiteralPath (Split-Path -Parent $OutFile)).Path
    $pdfPath = Join-Path $pdfPath (Split-Path -Leaf $OutFile)
} else {
    $tempDir = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath()) `
        -Name "icp-policy-$(Get-Random)" -Force
    $pdfPath = Join-Path $tempDir.FullName 'policy.pdf'
}

Write-Log "Baixando PDF oficial da ITI..."
Write-Log "  URL:    $Url"
Write-Log "  Salvar: $pdfPath"

try {
    Invoke-WebRequest -Uri $Url -OutFile $pdfPath -TimeoutSec 60 -UseBasicParsing
} catch {
    Write-Err "Falha ao baixar PDF: $($_.Exception.Message)"
}

$sizeKb = [Math]::Round((Get-Item $pdfPath).Length / 1KB, 1)
Write-Log "  Tamanho: $sizeKb KB"

# Sanity check: PDFs sempre comecam com '%PDF-' (4 chars + versao).
$head = (Get-Content -Path $pdfPath -TotalCount 1 -Encoding Byte) `
        | Select-Object -First 5 `
        | ForEach-Object { [char]$_ }
$header = -join $head
if ($header -ne '%PDF-') {
    Write-Err "Arquivo baixado nao parece ser um PDF valido (header='$header'). URL pode estar quebrada — verifique em https://www.gov.br/iti/pt-br/centrais-de-conteudo"
}

# -----------------------------------------------------------------------------
# 2. Hash SHA-256
# -----------------------------------------------------------------------------

$hash = (Get-FileHash -Path $pdfPath -Algorithm SHA256).Hash.ToLower()

Write-Host ''
Write-OK "SHA-256 (hex lowercase, 64 chars):"
Write-Host ''
Write-Host "    $hash" -ForegroundColor White
Write-Host ''

# -----------------------------------------------------------------------------
# 3. Instrucoes operacionais
# -----------------------------------------------------------------------------

Write-Log "Como configurar no Cloudflare Pages:"
Write-Host ''
Write-Host "  1. https://dash.cloudflare.com -> Workers & Pages -> escalas"
Write-Host "  2. Settings -> Environment variables -> Production"
Write-Host "  3. Add variable:"
Write-Host "       Variable name:  PA_AD_RB_HASH_HEX"
Write-Host "       Value:          $hash" -ForegroundColor White
Write-Host "       Type:           Plain text"
Write-Host "  4. Save"
Write-Host "  5. Force redeploy: Deployments -> ... -> Retry deployment"
Write-Host ''

Write-Warn 'Como validar que o hash esta correto:'
Write-Host "  Apos o deploy, assine um documento qualificado em /escalas ou /gise,"
Write-Host "  baixe o PDF assinado e suba em https://validar.iti.gov.br"
Write-Host "  Se aparecer 'Politica: PA-AD-RB' nas propriedades da assinatura,"
Write-Host "  o hash esta correto. Se aparecer 'hash da politica invalido',"
Write-Host "  a URL pode estar apontando para versao errada do DOC-ICP-15.03."
Write-Host ''

# -----------------------------------------------------------------------------
# 4. Cleanup
# -----------------------------------------------------------------------------

if ($KeepPdf -or $OutFile) {
    Write-Log "PDF preservado em: $pdfPath"
} elseif ($tempDir) {
    Remove-Item -Recurse -Force $tempDir.FullName -ErrorAction SilentlyContinue
    Write-Log "PDF temporario removido."
}

# -----------------------------------------------------------------------------
# 5. Retorna o hash como objeto (uso programatico, se chamado de outro script)
# -----------------------------------------------------------------------------

return [PSCustomObject]@{
    Hash = $hash
    Url  = $Url
    SizeKb = $sizeKb
    PdfPath = if ($KeepPdf -or $OutFile) { $pdfPath } else { $null }
}
