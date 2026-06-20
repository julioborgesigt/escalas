#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
# set-staging-secrets.sh — popula os secrets do Worker `escalas-staging`.
#
# Migração Pages → Workers, Fase 1/2 (docs/MIGRACAO-WORKERS.md §4.4). Alvo: o
# Worker de STAGING (`wrangler deploy --env staging --config wrangler.workers.toml`).
# NÃO toca o Worker/projeto de produção.
#
# O script GERA valores aleatórios de TESTE para os segredos internos (tokens,
# salts, selo institucional autoassinado) — não há nada secreto neste arquivo,
# por isso ele é versionável. Os segredos EXTERNOS (Resend, Cloudflare, Sentry…)
# precisam de valores reais e só são enviados se você os passar pelo ambiente.
#
# Pré-requisitos no SEU ambiente:
#   - wrangler autenticado (CLOUDFLARE_API_TOKEN/conta com acesso ao Worker), e
#   - o Worker de staging já criado (um `wrangler deploy --env staging
#     --config wrangler.workers.toml` cria na primeira vez).
#
# Uso:
#   ./scripts/set-staging-secrets.sh                 # só os auto-gerados
#   RESEND_API_KEY=re_xxx SENTRY_DSN=https://... \   # + externos reais
#     ./scripts/set-staging-secrets.sh
#
# Os valores gerados (inclusive a senha do super admin) são gravados em
# `staging-secrets.generated.txt` (gitignored) para você consultar/guardar.
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

CFG="wrangler.workers.toml"
ENVNAME="staging"
REF="staging-secrets.generated.txt"

# Localiza a raiz do projeto (diretório-pai deste script).
cd "$(dirname "$0")/.."

command -v openssl >/dev/null || { echo "openssl não encontrado"; exit 1; }
command -v npx >/dev/null || { echo "npx (Node) não encontrado"; exit 1; }

: >"$REF"
echo "# Secrets gerados para escalas-$ENVNAME em $(date -u +%FT%TZ)" >>"$REF"
echo "# NÃO comitar. Guarde a senha do super admin." >>"$REF"
echo "" >>"$REF"

# put NOME VALOR — envia um secret via stdin (sem newline no fim).
put() {
	local nome="$1" valor="$2"
	printf '%s' "$valor" | npx wrangler secret put "$nome" --env "$ENVNAME" --config "$CFG" >/dev/null
	echo "  ✓ $nome"
}

# put_ext NOME — envia um secret EXTERNO só se a env var de mesmo nome existir.
put_ext() {
	local nome="$1" valor="${!1:-}"
	if [ -n "$valor" ]; then
		put "$nome" "$valor"
		echo "$nome=<definido a partir do ambiente>" >>"$REF"
	else
		echo "  – $nome (pulado: defina a env var p/ enviar)"
		echo "# $nome= (NÃO enviado — preencha e rode de novo)" >>"$REF"
	fi
}

echo "→ Secrets internos (gerados aleatoriamente para teste):"

# Tokens/salts internos — sem contraparte externa para um smoke test básico.
# PASSWORD_PEPPER (A3): em STAGING um valor aleatório é ok; em PRODUÇÃO o pepper
# deve ser gerado UMA vez e guardado em cofre (trocá-lo invalida hashes v3).
for nome in SYNC_TOKEN RESET_TOKEN RATE_LIMIT_IP_SALT HEALTH_DETAIL_TOKEN GISE_BASE_EQUIPE_SECRET PASSWORD_PEPPER; do
	v="$(openssl rand -hex 32)"
	put "$nome" "$v"
	echo "$nome=$v" >>"$REF"
done

# Super Admin (break-glass para logar no staging). Login fixo, senha forte
# aleatória. ATENÇÃO: NÃO defina SUPER_ADMIN_EMAIL no staging — sem ele o login
# é direto (sem 2FA por e-mail), permitindo testar mesmo sem provedor de e-mail.
SA_LOGIN="superadmin-staging"
SA_SENHA="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
put "SUPER_ADMIN_LOGIN" "$SA_LOGIN"
put "SUPER_ADMIN_SENHA" "$SA_SENHA"
{
	echo "SUPER_ADMIN_LOGIN=$SA_LOGIN"
	echo "SUPER_ADMIN_SENHA=$SA_SENHA   # <-- use para logar no staging"
} >>"$REF"

# Selo institucional autoassinado de TESTE (assinatura avançada em tela).
# Rodado num diretório TEMPORÁRIO: o gerador grava selo-institucional.*.pem no
# CWD, e o repo já versiona um selo-institucional.cert.pem (público) que NÃO
# pode ser sobrescrito/apagado aqui.
echo "→ Gerando selo institucional de teste…"
ROOT="$(pwd)"
SELO_TMP="$(mktemp -d)"
# O bundle base64 é a única linha longa só com [A-Za-z0-9+/=] na saída do script.
SELO_B64="$(cd "$SELO_TMP" && node "$ROOT/scripts/gerar-selo-institucional.mjs" 'Escalas STAGING' 'PCCE Staging' 2>/dev/null \
	| grep -aE '^[A-Za-z0-9+/=]{200,}$' | tail -1)"
rm -rf "$SELO_TMP"
if [ -n "$SELO_B64" ]; then
	put "SELO_INSTITUCIONAL_PEM" "$SELO_B64"
	echo "SELO_INSTITUCIONAL_PEM=<bundle base64 de teste gerado>" >>"$REF"
else
	echo "  – SELO_INSTITUCIONAL_PEM (falha ao gerar — opcional, segue sem selo)"
fi

echo "→ Secrets externos (enviados só se a env var estiver definida):"
# E-mail: para login com 2FA real no staging, defina o EMAIL binding no
# Dashboard (Cloudflare Email Sending) OU RESEND_API_KEY abaixo. Sem e-mail,
# use o login break-glass do super admin acima (sem 2FA).
put_ext RESEND_API_KEY
put_ext RESEND_FROM_EMAIL
put_ext CLOUDFLARE_API_TOKEN
put_ext CLOUDFLARE_ACCOUNT_ID
# Observabilidade (opcional — sem, o Sentry fica em no-op).
put_ext SENTRY_DSN
put_ext PUBLIC_SENTRY_DSN
# Integração GISE (opcional).
put_ext GISE_BASE_EQUIPE_WEBHOOK_URL
# TSA com auth (opcional — o default DigiCert em [vars] não exige).
put_ext TSA_USERNAME
put_ext TSA_PASSWORD
# Web PKI (Token A1/A3 no browser): licença é por domínio e NÃO cobre
# *.workers.dev — em staging o fluxo Lacuna falha por design; use SERPRO.
put_ext WEBPKI_LICENSE

echo ""
echo "✓ Concluído. Valores gerados registrados em: $REF"
echo "  Login de teste:  $SA_LOGIN  /  (senha em $REF)"
echo ""
echo "Não esquecer (não são secrets de Worker):"
echo "  • EMAIL binding (Cloudflare Email Sending) no Dashboard do escalas-staging,"
echo "    OU RESEND_API_KEY acima, para 2FA por e-mail."
echo "  • Migrations no D1 de staging:  npm run db:migrate:staging"
