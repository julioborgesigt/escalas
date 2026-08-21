# Auditoria de segurança — 21/ago/2026

Revisão **defensiva** da superfície de ataque do sistema de escalas/GISE
(SvelteKit + Cloudflare Workers). Sem PoC, payload ou procedimento de
exploração — só achados, evidência no código e remediação.

**Escopo:** rotas de API e form actions, hooks, auth/2FA/sessão, webhooks,
assinatura digital, uploads, SQL, XSS/CSP, secrets no repositório, autorização
(IDOR / papéis). **Fora:** pentest dinâmico contra produção, engenharia social,
compromisso do token A3 físico, configuração live do Pages (só o que o código
e o `DEPLOY.md` / `.env.example` declaram).

**Método:** leitura das 70 `+server.ts` e 37 `+page.server.ts`, `hooks.server.ts`,
helpers de permissão, guards de CI (`guard:autorizacao`), e conferência contra
as auditorias anteriores (A1–A8, FLW-AUT, FLW-RBAC, L-_, M-4, R2-_).

**Postura geral:** o sistema já é **maduro** em autenticação e autorização —
sessão hashed, CSRF double-submit, HMAC de webhook, portões extraídos de
assinatura, `requireAuth` ≠ autorização. Os achados abaixo são resíduos:
cópia que divergiu, allowlist que apertou demais, escopo de papel incompleto
num caminho, e identidade visual do PDF lida do cliente.

Identificadores **SEC-01…** — não colidem com A/L/FLW/R2.

---

## O que já está sólido (não reabrir)

| Controle                                                                         | Onde                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| Senha PBKDF2 + comparação timing-safe + sentinel anti-enum                       | `password-hash.ts`, `auth-flow.ts`              |
| Sessão: 32 bytes CSPRNG, `sha256:` em repouso, cookie HttpOnly + SameSite=strict | `auth.ts`, `cookieOptions`                      |
| CSRF double-submit + timing-safe; webhooks isentos com auth própria              | `hooks.server.ts`                               |
| Mutação sem sessão recusada, salvo lista `DECLARADAS`/`PUBLICAS`                 | `guard:autorizacao` + e2e negativa              |
| Assinar GISE = supervisor designado; Admin Geral 403                             | `carregarGiseParaAssinatura`                    |
| Assinar escala = Admin Geral ou DPC admin + FDS recusado                         | `carregarEscalaParaAssinatura`                  |
| IDOR de item de escala (FLW-ESC-002): `id` + `escala_id`                         | `_actions`                                      |
| Child GISE amarrado à URL                                                        | `carregarEquipeDaGise` / `carregarMembroDaGise` |
| Webhook: Bearer/HMAC timing-safe, min 32 chars; papel default-off (M-4)          | `webhook-auth.ts`                               |
| Reset destrutivo: SYNC + RESET + data + replay **sempre**                        | `reset-policiais`                               |
| SQL da app via Drizzle parametrizado; `{@html}` só no termo sanitizado           | `sanitize.ts`                                   |
| Selfie: magic bytes + teto 5 MB + UUID na chave                                  | `selfie-upload.ts`                              |
| Download forense de `/validar` exige sessão privilegiada                         | `copia-conferencia.ts`                          |
| CSP HTML `script-src 'self'` sem unsafe-eval/inline; API `default-src none`      | `svelte.config.js`, `csp.ts`                    |
| Sem secrets de produção no Git; PEMs são âncoras públicas ICP                    | `.gitignore`, `.env.example`                    |
| `/api/health` público é binário; detalhe só com token                            | `health/+server.ts`                             |

---

## Achados tratados neste PR

### SEC-01 — P0 — Primeiro acesso bloqueava a verificação de e-mail pessoal

O gate FLW-AUT-019 recusava **todo** `/api/auth/*` durante `primeiro_acesso`,
exceto logout. `/alterar-senha` **exige** `email_pessoal_verificado=1` antes de
gravar a senha, e essa prova passa por
`/api/auth/solicitar-verificacao-email-pessoal` e `…/confirmar-…`. Resultado:
deadlock. Risco de o operador marcar o e-mail como verificado à mão e esvaziar
o controle.

**Remediação:** allowlist fechada em `onboarding-gates.ts` (senha + logout + as
duas rotas de e-mail). Teste em `onboarding-gates.test.ts`.

### SEC-02 — P1 — Form de 2FA não usava `buscarAdminAtivo`

A rota JSON `/api/auth/verificar-2fa` aplica FLW-RBAC-001 (`buscarAdminAtivo`).
A action do formulário de login lia só `administradores`. A sessão seguinte
cairia no hook, mas o login **era auditado como sucesso** e um cookie órfão
era emitido.

**Remediação:** a action chama `buscarAdminAtivo`, igual à JSON.

### SEC-04 — P1 — Reenvio de 2FA do Admin Geral vinculado ia ao e-mail errado

O login envia o código para `credPol.email`. O reenvio lia
`administradores.email` (muitas vezes nulo ou outro endereço).

**Remediação:** `emailInstitucionalDoDesafio` — a mesma regra nos dois
caminhos. Policial inativo → sem reenvio.

### SEC-05 — P1 — `/api/auth/*` inteiro livre do Termo de Uso

Depois da senha, quem não aceitou o termo ainda chamava `alternar-acesso`,
`solicitar-codigo-assinatura`, `reautenticar-assinatura`. As APIs de domínio
já recusavam; as de auth não.

**Remediação:** allowlist do termo = aceite + senha + consulta do termo +
logout. Não o prefixo `/api/auth/`.

### SEC-06 — P1 — FLW-RBAC-003 incompleto nas escalas (editar / criar / listar)

`lotacoesAdministradas` já usa `papel_unidade_id`. `excluir` e `criarComBase`
também. **Edição** (`podeMexerNaEscala`), **criação** e **listagem** /
carimbo de pendentes ainda olhavam `u.lotacao`. Admin de unidade transferido
administrava a unidade nova (ninguém concedeu) e perdia a do papel.

**Remediação:** `podeMexerNaEscala` é async e consulta o escopo do papel;
criar/listar/poll usam o mesmo conjunto.

### SEC-07 — P1 — `signerName` / `signerCpf` do body iam para o PDF

Nas rotas **qualificadas** de preparar, o servidor preferia o nome/CPF do
cliente. Avançada de presença já carimbava `u.nome`/`u.cpf`. Um signatário
legítimo podia estampar outra identidade visual no documento (o CMS, quando
havia certificado, ainda atestava o token).

**Remediação:** `identidadeVisualAssinante` — sempre a sessão. O schema ainda
aceita os campos para não quebrar o cliente; o servidor ignora.

### SEC-08 — P2 — `escapeLike` sem `ESCAPE` no SQL

A função escapava `%`/`_`/`\` e documentava que o SQL precisava de
`ESCAPE '\'`. Nenhum call site punha a cláusula. SQLite tratava `%` depois da
barra como wildcard. `/api/unidades/search` nem chamava `escapeLike`.

**Remediação:** `likeContains` / `likePrefix` com `ESCAPE`. Filtro `mes`/`data`
em `/res-gise` valida `YYYY-MM` / `YYYY-MM-DD`.

### SEC-09 — P2 — `alternar-acesso` não invalidava o cache de sessão

O token antigo era apagado no D1; o cache de edge (até 60 s) podia servir GET
como se a sessão velha ainda existisse. Logout já invalidava.

**Remediação:** `invalidarSessaoCache` nos dois ramos da troca.

### SEC-10 — Info — Comentário do guard dizia que Admin Geral assina GISE

O código recusa. O comentário em `HELPERS_OBRIGATORIOS` convidava a
"consertar" na direção errada (a lição do `CLAUDE.md` sobre comentário de
gate). Texto alinhado ao portão.

---

## Achados abertos ou aceitos

Severidade **não** é "dá para explorar amanhã". É o impacto **se** as
premissas de operação falharem (segredo ausente, flag de rollout, e-mail de
bootstrap).

| ID     | Sev.        | Status | Resumo                                                                                                                                                                                                                            |
| ------ | ----------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-11 | Alta (ops)  | Aceito | Bootstrap Super Admin / Admin Geral **sem** `*_EMAIL` entra só com senha. Break-glass documentado; audita e alerta. **Produção: definir os e-mails.**                                                                             |
| SEC-12 | Alta (ops)  | Aceito | Sem `PASSWORD_PEPPER`, hashes são PBKDF2@100k (teto do workerd). Dump do D1 permite brute-force offline. Health já sinaliza ausência.                                                                                             |
| SEC-13 | Média (ops) | Aceito | Replay de webhook só é obrigatório com `WEBHOOK_REPLAY_ENFORCE`. `DEPLOY.md` diz que produção já está em `1` (06/ago). Preview/local pode reproduzir payload capturado. `reset-policiais` **sempre** exige.                       |
| SEC-14 | Baixa       | Aberto | Login isento de CSRF-token; Origin divergente é recusado, Origin **ausente** passa. Browsers modernos mandam Origin em POST cross-site.                                                                                           |
| SEC-15 | Média       | Aceito | Rate-limit de 2FA/reenvio **fail-open** se o D1 falhar. O teto de 5 tentativas **por desafio** continua. Download de `/validar` é fail-closed (FLW-AUT-016).                                                                      |
| SEC-16 | Baixa       | Aceito | Cache de sessão (default 60 s) em GET. Mutação não usa cache (FLW-AUTH-001).                                                                                                                                                      |
| SEC-17 | Média       | Aberto | Upload de PDF no histórico do policial confia no `Content-Type`, sem magic bytes `%PDF`. Admin-only; chave gerada no servidor. Alinhar a `detectarTipo`.                                                                          |
| SEC-18 | Info        | Aceito | GPS e selfie da assinatura avançada vêm do cliente. A Lei 14.063 não transforma o browser em sensor honesto; o manifesto registra o que o aparelho declarou. Foto de foto / GPS forjado são limitações do canal, não bugs de ACL. |
| SEC-19 | Baixa       | Aceito | `/api/policiais/search` libera o diretório (sem e-mail) a todo admin, de propósito, para escalação cross-lotação. Policial comum é recortado.                                                                                     |
| SEC-20 | Baixa       | Aberto | `?format=produtividade` na GISE, depois de `verificarPermissaoGise`, aceita `seccionalId` de outra seccional da mesma operação. Rascunho extra já recheca dono (FLW-AUT-008).                                                     |
| SEC-21 | Residual    | Aceito | `style-src 'unsafe-inline'` na CSP HTML (trade-off do Tailwind/Skeleton). `script-src` está fechado.                                                                                                                              |
| SEC-22 | Baixa       | Aceito | Login novo não derruba sessões anteriores. Troca/reset de senha revoga as duas identidades.                                                                                                                                       |
| SEC-23 | Ops         | Aceito | `ADMIN_GERAL_SENHA` / `SUPER_ADMIN_SENHA` ainda aceitam texto claro. `DEPLOY.md` pede hash PBKDF2 v2.                                                                                                                             |
| SEC-24 | Aceito      | Aceito | OCSP `unknown` / responder fora não impede login por certificado (fail-open documentado). `revoked` fecha.                                                                                                                        |
| SEC-25 | Ops         | Aceito | Sem `CPF_ENCRYPTION_KEY` o CPF grava em claro. Health detalha ausência.                                                                                                                                                           |
| SEC-26 | Baixa       | Aberto | `TSA_URL` default é `http://timestamp.digicert.com` (sem TLS). Guard de SSRF continua.                                                                                                                                            |
| SEC-27 | Aceito      | Aceito | Código de `/validar` tem ~40 bits (8 chars de alfabeto 32), CSPRNG. Enumeração limitada por rate-limit; download forense exige sessão.                                                                                            |
| SEC-28 | Info        | Aceito | `GET /api/configuracoes/assinatura` (autenticado) devolve flags de política. PUT é Super Admin. O hook já exige sessão.                                                                                                           |
| SEC-29 | Média       | Aberto | Reset de senha aceita `email_pessoal` **não** verificado e, no confirmar, pode marcar como verificado. OTP prova controle da caixa, não que o titular a vinculou de propósito.                                                    |
| SEC-30 | Baixa       | Aberto | `email.ts` loga `accountId` do Cloudflare (não é senha; ajuda targeting).                                                                                                                                                         |
| SEC-31 | Aceito      | Aceito | `restringirSmartphone` olha User-Agent no servidor — UA é spoofável. É política de UX/dispositivo, não autenticador.                                                                                                              |

---

## Superfície por ator

**Anônimo:** login (rate-limited), reset, 2FA, certificado, `/validar` (PII
mascarada), logo institucional, health binário, webhooks (sem o segredo →
401). Não baixa o PDF forense.

**Policial comum:** própria lotação; presença só se participa; não assina
escala/GISE por POST (portão). Busca de colegas só na lotação.

**Admin de unidade/seccional:** escopo do **papel** (depois deste PR). Não
promove Admin Geral. Diretório de policiais é global (SEC-19).

**Supervisor GISE:** assina a escala/relatório da operação em que foi
designado. Não assina a de outro supervisor.

**Admin Geral:** escalas ordinárias (assinatura inclusive, de propósito);
GISE lifecycle; **não** assina GISE. Pode promover outro Admin Geral
(documentado).

**Super Admin:** auditoria, config de assinatura, unidades. Break-glass por
env.

**Dono do `SYNC_TOKEN`:** upsert de folha (sem papel, salvo flag). Sem
replay enforce, replay do payload. **Não** apaga o banco — isso pede
`RESET_TOKEN` + data + nonce.

---

## Checklist de produção (não é código)

Confira no Pages (Production), não só no `.env.example`:

1. `PASSWORD_PEPPER`, `CPF_ENCRYPTION_KEY`, `CPF_INDEX_KEY`, `AUDIT_CHAIN_KEY`, `AUDIT_IP_ENCRYPTION_KEY`, `RATE_LIMIT_IP_SALT`
2. `ADMIN_GERAL_EMAIL` e `SUPER_ADMIN_EMAIL` (2FA no bootstrap)
3. Senhas de bootstrap em hash `pbkdf2v2:`, não texto claro
4. `WEBHOOK_REPLAY_ENFORCE=1` e `WEBHOOK_ALLOW_PAPEL_CHANGES` **vazio**
5. `APP_ORIGIN` no domínio canônico (WebAuthn RP ID)
6. `ICP_BRASIL_TRUST_STORE_REQUIRED=1` se a política for fail-closed
7. R2 `escalas_docs` **sem** acesso público

O `GET /api/health?detail=<HEALTH_DETAIL_TOKEN>` lista proteções ausentes
sem derrubar liveness.

---

## Próximos remendos (não neste PR)

1. Magic bytes no PDF de histórico (SEC-17)
2. Recortar produtividade por seccional como o extra (SEC-20)
3. Reset de senha só com `email_pessoal_verificado=1` (SEC-29) — produto
4. Recusar Origin ausente no POST de `/api/auth/login` (SEC-14)
5. TSA por HTTPS (SEC-26)
6. Parar de logar `accountId` (SEC-30)
