#!/usr/bin/env bash
# Purga `dump.sql` (1.4 MB de PII real: nomes, CPFs, e-mails, hashes PBKDF2)
# de TODO o histórico Git — não apenas do HEAD.
#
# DESTRUTIVO: reescreve hashes de TODOS os commits que vieram após o commit
# `e6d1f57 melhora escala mensal`. Exige force-push e que todos os clones do
# repositório sejam re-clonados.
#
# REFERÊNCIAS:
#   https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
#   https://github.com/newren/git-filter-repo
#
# CHECKLIST OBRIGATÓRIO ANTES DE EXECUTAR:
#   1. Comunique a equipe — todo clone existente vai precisar ser re-clonado
#      após o force-push.
#   2. Faça backup do repositório local (cópia completa do diretório, não só git clone).
#   3. Faça backup do dump.sql em local SEGURO (offline, criptografado) caso
#      precise para auditoria futura.
#   4. Confirme que git-filter-repo está instalado:
#        pip install git-filter-repo   # ou: brew install git-filter-repo
#   5. APÓS o force-push:
#        - Rote senhas de TODOS os policiais (não-admin):
#            npm run users:clear-passwords-non-admins:prod
#        - Abra incidente formal de LGPD em /api/admin/lgpd/incidentes
#          descrevendo o vazamento de e-mails, CPFs e hashes PBKDF2.
#        - Comunique policiais cujos dados podem ter sido expostos
#          (e-mail funcional listado no dump).
#
# Uso:
#   bash scripts/purgar-dump-historico.sh

set -euo pipefail

if [[ ! -d .git ]]; then
	echo "ERRO: rode na raiz do repositório (deve conter .git/)" >&2
	exit 1
fi

if ! command -v git-filter-repo >/dev/null 2>&1; then
	echo "ERRO: git-filter-repo não está instalado." >&2
	echo "Instale com: pip install git-filter-repo" >&2
	exit 1
fi

echo "==> Confirmando remote 'origin'…"
git remote -v

echo
echo "==> dump.sql aparece em $(git log --all --oneline -- dump.sql | wc -l) commit(s):"
git log --all --oneline -- dump.sql || true
echo

read -rp "Continuar com a purga? Esta operação é DESTRUTIVA. [yes/NÃO]: " resp
if [[ "$resp" != "yes" ]]; then
	echo "Cancelado."
	exit 0
fi

echo
echo "==> Salvando cópia do dump.sql em /tmp/dump.sql.bkp (para você arquivar offline)…"
if [[ -f dump.sql ]]; then
	cp dump.sql /tmp/dump.sql.bkp
	echo "    /tmp/dump.sql.bkp criado. Mova para local seguro (offline)."
fi

echo
echo "==> Rodando git-filter-repo --path dump.sql --invert-paths --force…"
git filter-repo --path dump.sql --invert-paths --force

echo
echo "==> Reconfigurando remote 'origin' (filter-repo remove por segurança)…"
echo "    Verifique e ajuste a URL abaixo se necessário:"
echo "    git remote add origin <SSH_OR_HTTPS_URL>"

cat <<'EOF'

================================================================================
PRÓXIMOS PASSOS MANUAIS — NÃO PULE NENHUM:

1. Verifique localmente que o dump sumiu de TODO o histórico:
     git log --all --oneline -- dump.sql        # deve sair vazio
     git log --all --stat | grep -c "dump.sql"  # deve ser 0

2. Re-adicione o remote (substitua pela URL real):
     git remote add origin git@github.com:julioborgesigt/escalas.git

3. FORCE-PUSH para todas as branches (DESTRUTIVO — comunique a equipe antes):
     git push origin --force --all
     git push origin --force --tags

4. No GitHub:
     - Settings → "Push protection" e "Secret scanning" → habilite
     - Settings → "Branches" → adicione regra para main:
         require status checks, require PR review, dismiss stale reviews
     - Se houver forks ou clones em CI/CD/desenvolvedores, peça que
       re-clonem do zero (rebase de branches antigas vai trazer o arquivo
       de volta).

5. Rote todas as senhas que podem ter vazado (hashes PBKDF2 expostos):
     npm run users:clear-passwords-non-admins:prod

6. Abra incidente LGPD via /api/admin/lgpd/incidentes documentando:
     - data de criação do commit comprometedor (e6d1f57)
     - escopo (CPFs, e-mails @pc.ce.gov.br, telefones, hashes PBKDF2)
     - ações tomadas (purga, rotação de senhas, comunicação)
     - titulares afetados (policiais listados no dump)

7. (Opcional, recomendado) Solicite ao GitHub o expurgo do cache de PRs e
   forks que possam ter copiado o blob:
     https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
================================================================================
EOF
