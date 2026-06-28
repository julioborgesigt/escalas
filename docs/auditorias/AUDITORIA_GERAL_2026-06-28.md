# 🔍 Auditoria Geral — Sistema de Gestão de Escalas (PCCE)

| | |
|---|---|
| **Data** | 28 de junho de 2026 |
| **Projeto** | Plataforma de escalas da Polícia Civil do Ceará |
| **Stack** | SvelteKit 5 + Cloudflare (Pages/D1/R2) |
| **Repositório** | `github.com/julioborgesigt/escalas` |
| **Branch auditada** | `main` (commit `5b8f92f`) |
| **Escopo** | Segurança · Código · Banco · Dependências · Testes · CI/CD · LGPD |

---

## 📊 Resumo Executivo

| Dimensão | Status | Nota |
|----------|--------|------|
| **Segurança** | 🟢 Forte | Crítica apenas em gestão de segredos locais |
| **Qualidade do código** | 🟢 Excelente | 0 erros TS, 0 erros ESLint, 475/475 testes ✅ |
| **Banco de dados** | 🟢 Sólido | Schema tipado, queries parametrizadas, auditoria |
| **Dependências** | 🟢 Saudável | 0 vulnerabilidades conhecidas |
| **Testes / CI/CD** | 🟢 Maduro | CI com gates ratchet + branch protection implícita |
| **LGPD / Privacidade** | 🟢 Excepcional | CPF cifrado (AES-256-GCM), IPs anonimizados, retenção |

**Veredito geral:** Projeto de nível **sênior/maduro**. Boas práticas de segurança já incorporadas em camadas (defense-in-depth), com comentários rastreáveis a achados de auditorias anteriores (I-1, A3, M-4, etc.). A dívida técnica é baixa e bem controlada.

---

## 🔴 Achado CRÍTICO — Segredos de produção em `.dev.vars`

**Arquivo `.dev.vars` (raiz) contém segredos REAIS aparentemente de produção:**

- `PASSWORD_PEPPER`, `CPF_ENCRYPTION_KEY`, `CPF_INDEX_KEY`, `AUDIT_CHAIN_KEY`
- `CLOUDFLARE_API_TOKEN`, `RESEND_API_KEY`, `SYNC_TOKEN`, `RESET_TOKEN`
- `ADMIN_GERAL_SENHA`, `SUPER_ADMIN_SENHA` (em texto claro: `J824655j*`)
- `SELO_INSTITUCIONAL_PEM` (chave privada RSA em base64)

### O que está bem ✅
- O arquivo **está no `.gitignore`** (linha 27).
- **NÃO está no histórico do git** — confirmado via `git log -S` para cada segredo; os commits "remover credenciais do git" trataram isso no passado.

### O que é problema ❌

1. **Credenciais de produção aparentemente reutilizadas em dev local** — se estes valores também rodam em produção, qualquer acesso a esta máquina expõe tudo (pepper de senha, chave de cifra de CPF, token da Cloudflare com prefixo `cfut_`).
2. **Senhas de admin em texto claro** no arquivo (`ADMIN_GERAL_SENHA=J824655j*`), em desacordo com a orientação do próprio `.env.example` (que recomenda hash PBKDF2).
3. O `.env.example` recomenda o uso de **senhas com hash PBKDF2**, mas o `.dev.vars` usa texto plano.

### Recomendações
- 🚨 **Imediatamente:** Verifique se os valores em `.dev.vars` são reais de produção. Se forem, **rote todos os segredos** (pepper, chaves de CPF, tokens) — uma máquina dev não é cofre adequado para chaves de produção.
- Use valores **distintos** para dev (ex.: `openssl rand -hex 32`) e produção.
- Converta `ADMIN_GERAL_SENHA`/`SUPER_ADMIN_SENHA` para formato `pbkdf2v2:` (rodando `npm run users:set-default-password` localmente para gerar o hash).
- Considere um `.dev.vars.example` versionado com valores placeholder, mantendo `.dev.vars` puramente local.

---

## 🟢 Pontos Fortes Notáveis (defesa em profundidade)

A auditoria encontrou **implementação de segurança acima da média** para aplicações governamentais brasileiras.

### Criptografia
- **CPF cifrado em repouso** com AES-256-GCM (IV aleatório por registro) + índice cego HMAC-SHA256 para lookup — `src/lib/crypto/cpf-cripto.ts`.
- **Senha com PBKDF2 + pepper** (formato v3) — neutraliza brute-force offline mesmo se o D1 vazar (`src/lib/crypto/password-hash.ts`, com documentação clara sobre o teto de 100k iterações do workerd).
- **Tokens de sessão/reset hasheados** (sha256) — dump do banco não sequestra sessões.
- **Chaves separadas** para cifra vs índice (princípio de mínima confiança).

### Autenticação / Sessão
- **2FA fail-closed**: conta sem e-mail cadastrado NÃO recebe sessão (A1).
- **Rate-limit em duas dimensões**: por IP (5/15min) **e** por conta (10/15min) — fecha brute-force distribuído.
- **Sliding session** com threshold para evitar UPDATE em todo request.
- **Timing-safe comparison** em todas as comparações de segredo (CSRF, senha, tokens, 2FA).
- **Bind-extra no 2FA** (I-1): código amarrado ao e-mail destino — fecha confused-deputy.

### Headers / CSP
- CSP estrita (`script-src 'self'`, sem `unsafe-inline` em scripts).
- COOP/COEP/CORP `same-origin` (defesa contra XS-Leaks/Spectre).
- HSTS com preload, `X-Frame-Options: DENY`, `Referrer-Policy` correto.
- O trade-off `style-src 'unsafe-inline'` está **documentado conscientemente** (I-4).

### Validação e APIs
- **Zod em todos os endpoints** com caps de tamanho (anti-DoS).
- **Webhook de sync** com HMAC + **replay protection** + **safe-default de privilégio** (M-4: SYNC_TOKEN comprometido não promove ninguém a admin).
- Guard de CI que bloqueia `return json({ error })` manual — padroniza erros.

### LGPD / Auditoria
- IPs anonimizados (IPv4 zera octeto, IPv6 preserva só /64 — I-3).
- Audit log com cadeia de integridade (`AUDIT_CHAIN_KEY`).
- Sentry com **sanitização de PII** testada (cookies, auth, CPF, IDs).
- Workflow agendado de limpeza de retenção.

---

## 🟡 Achados Menores / Melhorias

### Manutenibilidade
1. **Arquivos de output no repositório** — `tsc_output.txt`, `knip_output*.txt` (3 arquivos), `fallow_deadcode.txt`, `fallow_results.json`, `eslint.json` (76KB) parecem artefatos de análise que **deveriam estar no `.gitignore`** e não versionados. Poluem o diff e o tamanho do repo. (Nota: `bundle-stats.html` e `staging-secrets.generated.txt` já estavam no `.gitignore`, mas não deveriam ser criados soltos no repo dev).
2. **25 exports de tipos não usados** (knip) — **Resolvido**. Mapeamos `src/lib/db.ts` e `src/lib/db/gise/index.ts` como entry points legítimos de API pública no `knip.json`. Isso reduziu o aviso para apenas 3 tipos restantes, os quais foram validados como falso-positivos (são interfaces que tipam parâmetros de funções exportadas ativas, mas cujos callers passam objetos inline sem importar a interface explicitamente).
3. **1 função exportada não usada**: `buscarConfiguracao` (`src/lib/db.ts:48`) — **Removida** (resolvido).

### Código
4. **7 warnings ESLint** (remediados): `prefer-const` em Svelte 5 (runes) e instâncias mutáveis de `Date`/`URLSearchParams` na view `FormInlineAdicionarOip.svelte`.
5. **1 warning de a11y** (remediado): botão sem `aria-label` em `src/routes/escalas/[id]/_components/TabelaPlantao.svelte:244`.

### Dependências
6. **Dependências desatualizadas (não críticas):**
   - `knip` está em v5, **última é v6** (major) — avaliar antes de subir.
   - `globals` em v16, última v17 (major).
   - `typescript` em v5, **última é v6** (major) — avaliar impactos em tipagem estrita.
   - Demais (SvelteKit, Sentry, Svelte, ESLint, Playwright) são **patches/minors** — atualização rotineira de baixo risco.
   - Sem vulnerabilidades conhecidas (`npm audit`: 0).

---

## 📋 Plano de Ação Prioritário (Atualizado em 28/06/2026)

| # | Prioridade | Ação | Esforço | Status |
|---|-----------|------|---------|--------|
| 1 | 🔴 **Crítica** | Verificar se `.dev.vars` contém segredos de produção; se sim, **rotacionar todos** e usar valores distintos por ambiente | 1-2h | ⏳ Pendente (Aguardando Operador) |
| 2 | 🔴 **Crítica** | Converter senhas de admin do `.dev.vars` para hash PBKDF2 (`npm run users:set-default-password`) | 15min | ✅ **Resolvido** |
| 3 | 🟡 Média | Adicionar arquivos de output analítico (`*.txt`, `eslint.json`, `fallow_results.json`, etc.) ao `.gitignore` e removê-los do Git | 15min | ✅ **Resolvido** |
| 4 | 🟡 Média | Corrigir os 7 warnings do ESLint em `FormInlineAdicionarOip.svelte` (uso de `const` e `SvelteDate`/`SvelteURLSearchParams`) | 5min | ✅ **Resolvido** |
| 5 | 🟢 Baixa | Adicionar `aria-label` ao botão em `TabelaPlantao.svelte:244` | 5min | ✅ **Resolvido** |
| 6 | 🟢 Baixa | Decidir política para os 25 exports de tipos do knip (entry vs. remoção) | 30min | ✅ **Resolvido (Configurado / Falso-Positivos)** |
| 7 | 🟢 Baixa | Atualizar dependências patch/minor (Sentry, SvelteKit, Svelte, Playwright) | 30min | ⏳ Pendente |
| 8 | 🟢 Baixa | Avaliar upgrade do `knip` v5→v6 e `typescript` v5→v6 (breaking) separadamente | 1h | ⏳ Pendente |

---

## 🔬 Metodologia

A auditoria combinou análise estática e inspeção manual:

**Ferramentas executadas:**
- `npx eslint src/` → 0 erros, 7 warnings
- `npx svelte-check --tsconfig ./tsconfig.json` → 0 erros, 1 warning (a11y)
- `npx knip` → 1 export não usado + 25 exports de tipo não usados
- `npx vitest run` → 475/475 testes aprovados
- `npm audit` → 0 vulnerabilidades
- `npm outdated` → apenas patches/minors (+ 2 majors não críticos)
- `git log -S "<segredo>"` → confirmação de que segredos não estão no histórico

**Inspeção manual de arquivos críticos:**
- `src/hooks.server.ts` (middleware: CSRF, auth, security, sentry)
- `src/lib/auth.ts` (sessões, 2FA, tokens)
- `src/lib/crypto/cpf-cripto.ts` e `password-hash.ts` (criptografia)
- `src/lib/server/auth-flow.ts` (rate-limiting, fail-closed 2FA)
- `src/lib/server/schema.ts` (30 tabelas)
- `src/routes/api/webhook/sync-policiais/+server.ts` (webhook)
- `src/routes/api/auth/login/+server.ts` + `src/lib/schemas/auth.ts` (validação)
- `svelte.config.js` e `.env.example` (CSP e configuração)
- `.github/workflows/` (CI/CD)

**Cobertura não incluída nesta auditoria:**
- Revisão linha-a-linha de todos os 275 arquivos `.ts` e 85 `.svelte`
- Testes E2E (Playwright) não executados — apenas testes unitários (Vitest)
- Análise de performance em runtime (profiling) — ver `AUDITORIA_PERFORMANCE_UX.md`
- Análise visual — ver `AUDITORIA_VISUAL.md`

---

## ✅ Conclusão

Projeto impressionante do ponto de vista de maturidade de engenharia e segurança — visivelmente já passou por auditorias anteriores com correções rastreáveis (A1-A3, I-1 a I-4, M-3/M-4). A **única questão crítica** é a gestão do `.dev.vars` local, que precisa de confirmação sobre se os segredos são reais de produção. O restante é dívida técnica de baixo risco e fácil endereçamento.
