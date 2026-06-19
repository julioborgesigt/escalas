<#
.SYNOPSIS
  Popula os secrets do Worker `escalas-staging` (migração Pages → Workers).
  Versão PowerShell nativa do scripts/set-staging-secrets.sh (para Windows).

.DESCRIPTION
  Gera valores ALEATÓRIOS de teste para os segredos internos (tokens, salts,
  selo institucional autoassinado) + super admin break-glass, e envia tudo de
  uma vez via `wrangler secret bulk` (JSON temporário — mais robusto no Windows
  que pipe por stdin). Os segredos EXTERNOS (Resend, Cloudflare, Sentry…) só são
  enviados se você passá-los por parâmetro. NÃO toca produção.

  Pré-requisitos: Node/npx no PATH, wrangler autenticado (mesma conta do deploy),
  e o Worker `escalas-staging` já criado (o deploy do GitHub Actions já criou no
  merge). Plano: docs/MIGRACAO-WORKERS.md §4.4.

.EXAMPLE
  ./scripts/set-staging-secrets.ps1

.EXAMPLE
  ./scripts/set-staging-secrets.ps1 -ResendApiKey "re_xxx" -SentryDsn "https://..."
#>
[CmdletBinding()]
param(
	[string]$EnvName = "staging",
	[string]$Config  = "wrangler.workers.toml",
	# Externos — enviados só quando informados (ou via env var de mesmo nome).
	[string]$ResendApiKey            = $env:RESEND_API_KEY,
	[string]$ResendFromEmail         = $env:RESEND_FROM_EMAIL,
	[string]$CloudflareApiToken      = $env:CLOUDFLARE_API_TOKEN,
	[string]$CloudflareAccountId     = $env:CLOUDFLARE_ACCOUNT_ID,
	[string]$SentryDsn               = $env:SENTRY_DSN,
	[string]$PublicSentryDsn         = $env:PUBLIC_SENTRY_DSN,
	[string]$GiseBaseEquipeWebhookUrl= $env:GISE_BASE_EQUIPE_WEBHOOK_URL,
	[string]$TsaUsername             = $env:TSA_USERNAME,
	[string]$TsaPassword             = $env:TSA_PASSWORD,
	[string]$WebpkiLicense           = $env:WEBPKI_LICENSE
)

$ErrorActionPreference = "Stop"

# Raiz do projeto = pasta-pai deste script. `--config` é relativo ao CWD.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

foreach ($cmd in @("node", "npx")) {
	if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
		throw "$cmd não encontrado no PATH."
	}
}

# ---- Geradores aleatórios (RNG criptográfico do .NET) ----
function New-HexToken([int]$bytes = 32) {
	$b = New-Object byte[] $bytes
	$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
	try { $rng.GetBytes($b) } finally { $rng.Dispose() }
	-join ($b | ForEach-Object { $_.ToString("x2") })
}

function New-Password {
	$b = New-Object byte[] 24
	$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
	try { $rng.GetBytes($b) } finally { $rng.Dispose() }
	([Convert]::ToBase64String($b) -replace '[/+=]', '').Substring(0, 20)
}

# Mantém a ORDEM de inserção (vira o JSON do secret bulk).
$secrets = [ordered]@{}
$ref = New-Object System.Collections.Generic.List[string]
$ref.Add("# Secrets gerados para escalas-$EnvName em $((Get-Date).ToUniversalTime().ToString('s'))Z")
$ref.Add("# NAO comitar. Guarde a senha do super admin.")
$ref.Add("")

Write-Host "-> Secrets internos (gerados aleatoriamente para teste):"
foreach ($nome in @("SYNC_TOKEN", "RESET_TOKEN", "RATE_LIMIT_IP_SALT", "HEALTH_DETAIL_TOKEN", "GISE_BASE_EQUIPE_SECRET")) {
	$v = New-HexToken 32
	$secrets[$nome] = $v
	$ref.Add("$nome=$v")
	Write-Host "  + $nome"
}

# Super Admin break-glass. NAO defina SUPER_ADMIN_EMAIL no staging — sem ele o
# login é direto (sem 2FA por e-mail), permitindo testar sem provedor de e-mail.
$saLogin = "superadmin-staging"
$saSenha = New-Password
$secrets["SUPER_ADMIN_LOGIN"] = $saLogin
$secrets["SUPER_ADMIN_SENHA"] = $saSenha
$ref.Add("SUPER_ADMIN_LOGIN=$saLogin")
$ref.Add("SUPER_ADMIN_SENHA=$saSenha   # <-- use para logar no staging")
Write-Host "  + SUPER_ADMIN_LOGIN / SUPER_ADMIN_SENHA"

# Selo institucional autoassinado de TESTE, gerado num diretório TEMPORÁRIO
# (o gerador grava selo-institucional.*.pem no CWD; o repo versiona o .cert.pem
# público, que não pode ser tocado aqui).
Write-Host "-> Gerando selo institucional de teste..."
$seloTmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $seloTmp | Out-Null
try {
	Push-Location $seloTmp
	$seloOut = & node (Join-Path $PSScriptRoot "gerar-selo-institucional.mjs") "Escalas STAGING" "PCCE Staging" 2>$null
} finally {
	Pop-Location
	Remove-Item -Recurse -Force $seloTmp -ErrorAction SilentlyContinue
}
# O bundle base64 é a única linha longa só com [A-Za-z0-9+/=].
$seloB64 = $seloOut | Where-Object { $_ -match '^[A-Za-z0-9+/=]{200,}$' } | Select-Object -Last 1
if ($seloB64) {
	$secrets["SELO_INSTITUCIONAL_PEM"] = $seloB64
	$ref.Add("SELO_INSTITUCIONAL_PEM=<bundle base64 de teste gerado>")
	Write-Host "  + SELO_INSTITUCIONAL_PEM"
} else {
	Write-Host "  - SELO_INSTITUCIONAL_PEM (falha ao gerar — opcional, segue sem selo)"
}

# ---- Externos: só entram se informados ----
Write-Host "-> Secrets externos (enviados só se informados):"
$externos = [ordered]@{
	RESEND_API_KEY               = $ResendApiKey
	RESEND_FROM_EMAIL            = $ResendFromEmail
	CLOUDFLARE_API_TOKEN         = $CloudflareApiToken
	CLOUDFLARE_ACCOUNT_ID        = $CloudflareAccountId
	SENTRY_DSN                   = $SentryDsn
	PUBLIC_SENTRY_DSN            = $PublicSentryDsn
	GISE_BASE_EQUIPE_WEBHOOK_URL = $GiseBaseEquipeWebhookUrl
	TSA_USERNAME                 = $TsaUsername
	TSA_PASSWORD                 = $TsaPassword
	WEBPKI_LICENSE               = $WebpkiLicense
}
foreach ($nome in $externos.Keys) {
	$valor = $externos[$nome]
	if ([string]::IsNullOrWhiteSpace($valor)) {
		Write-Host "  - $nome (pulado: passe -$nome ou a env var p/ enviar)"
		$ref.Add("# $nome= (NAO enviado — informe e rode de novo)")
	} else {
		$secrets[$nome] = $valor
		Write-Host "  + $nome"
		$ref.Add("$nome=<informado por parâmetro/env>")
	}
}

# ---- Envia tudo via `wrangler secret bulk` (JSON temporário, sem BOM) ----
$tmpJson = Join-Path ([System.IO.Path]::GetTempPath()) ("staging-secrets-" + [System.Guid]::NewGuid().ToString() + ".json")
try {
	$json = ($secrets | ConvertTo-Json -Depth 3)
	[System.IO.File]::WriteAllText($tmpJson, $json, (New-Object System.Text.UTF8Encoding $false))
	Write-Host ""
	Write-Host "-> Enviando $($secrets.Count) secrets para o Worker escalas-$EnvName via 'wrangler secret bulk'..."
	& npx wrangler secret bulk $tmpJson --env $EnvName --config $Config
	if ($LASTEXITCODE -ne 0) { throw "wrangler secret bulk falhou (exit $LASTEXITCODE)." }
} finally {
	Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue
}

# ---- Arquivo de referência (gitignored) ----
$refFile = Join-Path $root "staging-secrets.generated.txt"
[System.IO.File]::WriteAllLines($refFile, $ref, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "OK. Valores gerados registrados em: $refFile"
Write-Host "  Login de teste:  $saLogin  /  (senha em staging-secrets.generated.txt)"
Write-Host ""
Write-Host "Nao esquecer (nao sao secrets de Worker):"
Write-Host "  - EMAIL binding (Cloudflare Email Sending) no Dashboard do escalas-staging,"
Write-Host "    OU -ResendApiKey acima, para 2FA por e-mail."
Write-Host "  - Migrations no D1 de staging:  npm run db:migrate:staging"
