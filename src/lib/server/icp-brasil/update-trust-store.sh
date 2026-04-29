#!/usr/bin/env bash
#
# Popula roots.pem e intermediates.pem com a cadeia oficial da ICP-Brasil.
#
# Uso:
#   cd src/lib/server/icp-brasil
#   ./update-trust-store.sh
#
# Requisitos: curl, openssl, unzip. Roda em Linux, macOS ou WSL.
# Idempotente: pode ser executado novamente para atualizar a cadeia.
#
# Após executar, revise as alterações com `git diff` e commite:
#   git add roots.pem intermediates.pem
#   git commit -m "chore(icp-brasil): atualiza trust store ($(date +%F))"

set -euo pipefail

cd "$(dirname "$0")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log()  { printf '\033[1;34m[trust-store]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2; exit 1; }

for cmd in curl openssl unzip; do
	command -v "$cmd" >/dev/null || err "Comando '$cmd' não encontrado no PATH."
done

ROOTS_URL_BASE="https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ"
ZIP_URL="https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip"
# Versões da AC Raiz cujos certificados emitidos ainda podem aparecer em assinaturas:
#   - v5: emitida em 2016, validade até 2028; ainda há e-CPFs ativos sob ela
#   - v10: emitida em 2020, validade até 2030 (atual)
ROOT_VERSIONS=(v5 v10)

# 1. Raízes -----------------------------------------------------------------

log "Baixando AC Raízes..."
ROOTS_TMP="$WORK/roots.pem"
{
	printf '# AC Raízes ICP-Brasil — gerado por update-trust-store.sh\n'
	printf '# Atualizado em %s\n\n' "$(date -u +%FT%TZ)"
} > "$ROOTS_TMP"

for v in "${ROOT_VERSIONS[@]}"; do
	src="$ROOTS_URL_BASE/ICP-Brasil${v}.crt"
	dst="$WORK/ICP-Brasil${v}.crt"
	log "  → $src"
	curl -fsSL --max-time 30 -o "$dst" "$src" \
		|| err "Falha ao baixar $src"

	# A ITI publica em DER; alguns mirrors entregam em PEM. Detecta automaticamente.
	if openssl x509 -inform DER -in "$dst" -noout >/dev/null 2>&1; then
		fmt=DER
	elif openssl x509 -inform PEM -in "$dst" -noout >/dev/null 2>&1; then
		fmt=PEM
	else
		err "Conteúdo de $src não é um certificado X.509 reconhecível."
	fi

	subject="$(openssl x509 -inform "$fmt" -in "$dst" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')"
	notbefore="$(openssl x509 -inform "$fmt" -in "$dst" -noout -startdate | sed 's/^notBefore=//')"
	notafter="$(openssl x509 -inform "$fmt" -in "$dst" -noout -enddate   | sed 's/^notAfter=//')"
	sha256="$(openssl x509 -inform "$fmt" -in "$dst" -outform DER | openssl dgst -sha256 -hex | awk '{print $NF}')"

	{
		printf '# AC Raiz ICP-Brasil %s\n' "$v"
		printf '# Subject:  %s\n' "$subject"
		printf '# Validade: %s até %s\n' "$notbefore" "$notafter"
		printf '# SHA-256:  %s\n' "$sha256"
		openssl x509 -inform "$fmt" -in "$dst" -outform PEM
		printf '\n'
	} >> "$ROOTS_TMP"
done

# 2. Intermediárias ---------------------------------------------------------

log "Baixando ACs intermediárias (zip oficial)..."
ZIP_PATH="$WORK/ACcompactado.zip"
curl -fsSL --max-time 120 -o "$ZIP_PATH" "$ZIP_URL" \
	|| err "Falha ao baixar $ZIP_URL"

UNZIP_DIR="$WORK/intermediates"
mkdir -p "$UNZIP_DIR"
unzip -q -j -o "$ZIP_PATH" -d "$UNZIP_DIR"

INT_TMP="$WORK/intermediates.pem"
{
	printf '# ACs intermediárias da ICP-Brasil — gerado por update-trust-store.sh\n'
	printf '# Origem:    %s\n' "$ZIP_URL"
	printf '# Atualizado em %s\n\n' "$(date -u +%FT%TZ)"
} > "$INT_TMP"

count=0
for f in "$UNZIP_DIR"/*; do
	[ -f "$f" ] || continue
	# Detectar formato (DER/PEM)
	if openssl x509 -inform DER -in "$f" -noout >/dev/null 2>&1; then
		fmt=DER
	elif openssl x509 -inform PEM -in "$f" -noout >/dev/null 2>&1; then
		fmt=PEM
	else
		log "  ⚠ ignorando $(basename "$f"): não é um X.509"
		continue
	fi
	subject="$(openssl x509 -inform "$fmt" -in "$f" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')"
	sha256="$(openssl x509 -inform "$fmt" -in "$f" -outform DER | openssl dgst -sha256 -hex | awk '{print $NF}')"
	{
		printf '# %s\n' "$(basename "$f")"
		printf '# Subject: %s\n' "$subject"
		printf '# SHA-256: %s\n' "$sha256"
		openssl x509 -inform "$fmt" -in "$f" -outform PEM
		printf '\n'
	} >> "$INT_TMP"
	count=$((count + 1))
done
log "  → $count ACs intermediárias processadas"

# 3. Substituir os PEMs versionados ----------------------------------------

mv "$ROOTS_TMP" roots.pem
mv "$INT_TMP" intermediates.pem

ROOTS_COUNT=$(grep -c -- '-----BEGIN CERTIFICATE-----' roots.pem || true)
INT_COUNT=$(grep -c -- '-----BEGIN CERTIFICATE-----' intermediates.pem || true)

log "Pronto! roots.pem ($ROOTS_COUNT certificados), intermediates.pem ($INT_COUNT certificados)"
log "Revise com: git diff roots.pem intermediates.pem"
log "Commite com: git add roots.pem intermediates.pem && git commit -m 'chore(icp-brasil): atualiza trust store ($(date +%F))'"
