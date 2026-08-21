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

Identificadores **SEC-01…** — não colidem com A/L/FLW/R2. O complemento
“banco sem tranca” / input / clássicos do mesmo dia usa **SEC-32…**.

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
| PDF de histórico: magic bytes `%PDF`                                             | `ePdf()` + `uploadDocumento`                    |
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

### SEC-17 — P2 — Upload de PDF no histórico confiava no `Content-Type`

O anexo da ficha do policial (`uploadDocumento`) recusava só se
`arquivo.type !== 'application/pdf'`. Bytes de imagem com tipo declarado PDF
passavam. Admin-only; chave gerada no servidor.

**Remediação:** `ePdf()` (`%PDF` nos primeiros bytes), o mesmo critério de
`detectarTipo` das selfies. Tipo declarado continua como filtro barato.

### SEC-20 — P2 — Produtividade por `seccionalId` de outra seccional da GISE

`verificarPermissaoGise` prova participação na OPERAÇÃO. O download
`?format=produtividade` aceitava o id de outra seccional da mesma GISE.
O rascunho extra já rechecava dono (FLW-AUT-008).

**Remediação:** `recorteSeccionalVisivel` — Admin Geral e quadro de supervisão
vêem todas; admin/membro só a seccional (ou DP) deles. Extra **assinado**
não apertou: é cópia de conferência do documento oficial, e quem já vê
`/gise/[id]` vê as outras seccionais. O rascunho extra segue mais estreito
de propósito.

### SEC-32 — P1 — Dupla assinatura por corrida (upsert desfazia o unique)

O unique em `escala_documentos` / `gise_documentos` /
`gise_assinaturas_relatorios` existia, mas `onConflictDoUpdate` **substituía**
o PDF vigente. Duas preparações distintas (intenções uso único) que
finalizam em paralelo: ambas passavam o check, a segunda vencia. O portão
GISE nem lia documento existente.

**Remediação:** INSERT + `onConflictDoNothing` + `{ gravado }`. Portões
`carregarGiseParaAssinatura` e `carregarRelatorioExtraParaAssinatura` 409 se
já há linha. Reassinar exige revogar (DELETE). Corrida perdida compensa o
blob órfão no R2.

### SEC-33 — P1 — Presença: reentrada e segunda saída sem CAS

`salvarEntradaGise` upsertia inclusive depois de `saida_timestamp`.
`salvarSaidaGise` não exigia `saida IS NULL`.

**Remediação:** entrada só com `setWhere: saida IS NULL`; saída só com
`entrada IS NOT NULL AND saida IS NULL`; `{ registrada }` no caller (409).
O gate recusa cedo os mesmos estados.

### SEC-36 — P1 — Solicitação de cadastro: TOCTOU na decisão

`decidirSolicitacaoCadastro` lia `pendente` e atualizava **sem**
`WHERE status='pendente'`. Dois cliques paralelos reaplicavam o patch.

**Remediação:** `UPDATE … WHERE id AND status='pendente'`; zero linhas →
`null`, sem tocar no cadastro.

### SEC-37 — P2 — Unique de plantão só no SQL, não no Drizzle

A migração `0047_escala_policiais_dia_unico.sql` (FLW-ESC-005) já trava
`(escala_id, policial_id, data_plantao)`. O schema Drizzle tinha só index
não-único; o catch das actions virava 500 com SQL cru.

**Remediação:** `uniqueIndex('uq_escala_policiais_dia')` no schema; corrida
vira 409 visível.

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
| SEC-18 | Info        | Aceito | GPS e selfie da assinatura avançada vêm do cliente. A Lei 14.063 não transforma o browser em sensor honesto; o manifesto registra o que o aparelho declarou. Foto de foto / GPS forjado são limitações do canal, não bugs de ACL. |
| SEC-19 | Baixa       | Aceito | `/api/policiais/search` libera o diretório (sem e-mail) a todo admin, de propósito, para escalação cross-lotação. Policial comum é recortado.                                                                                     |
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

## Complemento — “banco sem tranca” / superfície clássica (mesmo dia)

Varredura extra pedida no mesmo ciclo: race/TOCTOU em D1, segredos no
cliente, input sem schema, e gaps clássicos. **Sem PoC.** Identificadores
continuam **SEC-** (SEC-32…).

### O que já trava de verdade (não reabrir)

| Controle                                                    | Onde                                                                                  | Como trava                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| Intenção de assinatura uso único                            | `src/lib/server/assinatura/intencao.ts`                                               | `UPDATE … WHERE usado = 0 … RETURNING` |
| 2FA / reset / WebAuthn / reposição passkey                  | `src/lib/auth.ts`, `src/lib/db/webauthn.ts`, `passkey-reposicao.ts`                   | mesmo padrão CAS                       |
| Webhook replay (quando enforce)                             | `webhook-auth.ts` + `webhook_nonces` UNIQUE                                           | INSERT atômico                         |
| Um documento assinado por escala / GISE / relatório / termo | unique + INSERT `onConflictDoNothing` (SEC-32)                                        | segundo INSERT não grava               |
| Uma presença por (gise, policial)                           | `uq_gise_presenca_policial` + CAS `saida IS NULL` (SEC-33)                            | unique + upsert condicional            |
| Cookie sessão                                               | `auth-flow.ts` `cookieOptions`                                                        | HttpOnly + SameSite=strict             |
| Health público                                              | `api/health/+server.ts`                                                               | binário; detalhe só com token ≥16      |
| `{@html}`                                                   | só termo, via `sanitizeTermoHtml`                                                     | allowlist                              |
| Selfie upload                                               | `selfie-upload.ts`                                                                    | magic bytes + teto + UUID na chave     |
| SSRF OCSP/TSA                                               | `ocsp.ts`, `tsa.ts`                                                                   | guard de URL                           |
| SQL app                                                     | Drizzle parametrizado; `sql.raw` só com constantes (`LOGIN_WINDOW_MINUTES`, `ESCAPE`) | sem user data em `sql.raw`             |
| CORS `*` / JWT / debug endpoints                            | —                                                                                     | ausentes                               |
| Secrets de produção no Git                                  | `.gitignore`, `.env.example`                                                          | PEMs = âncoras ICP públicas            |
| `PUBLIC_*` no bundle                                        | só `PUBLIC_SENTRY_DSN` / `PUBLIC_SENTRY_ENVIRONMENT`                                  | sem sync/reset                         |

### Achados novos (race / TOCTOU)

| ID     | Sev.  | Status      | Resumo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-32 | Média | **Tratada** | Dupla assinatura: `onConflictDoUpdate` desfazia o unique. INSERT + `onConflictDoNothing` + `{ gravado }`; portão GISE/extra 409.                                                                                                                                                                                                                                                                                                                                                                                                             |
| SEC-33 | Média | **Tratada** | Presença: entrada com `setWhere: saida IS NULL`; saída com `saida IS NULL`; `{ registrada }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| SEC-34 | Média | Aberto      | **Criar escala: check-then-act sem unique.** `verificarEscalaExistente` + `criarEscala`; índice `idx_escalas_lotacao_tipo_data` **não** é unique. Comentário em `criarEscala` admite duplicata se alguém não checar. Duas criações paralelas → duas escalas equivalentes. Arquivos: `src/lib/db/escalas.ts`, `src/routes/escalas/+page.server.ts`, `actions-projecao.ts`. Remédio: unique parcial/expressão alinhada à regra FDS vs mensal, ou INSERT que falhe no conflito. Unique simples quebraria FDS (overlap de intervalos).           |
| SEC-35 | Baixa | Aberto      | **Finalizar / status GISE sem CAS.** `POST …/finalizar` e action `finalizarGise`: leem status, depois `atualizarGiseEscala({ status: 'finalizada' })` **sem** `WHERE status ≠ 'finalizada'`. Idempotente no estado final, mas side-effects (auditoria duplicada, `agendarSyncBaseEquipeAposFinalizar` duas vezes). Arquivos: `src/routes/api/gise/[id]/finalizar/+server.ts`, `src/routes/gise/[id]/_actions/actions-escala.ts`, `src/lib/db/gise/escalas-crud.ts`. Remédio: `UPDATE … SET status=? WHERE id=? AND status IN (…) RETURNING`. |
| SEC-36 | Média | **Tratada** | Solicitação: `UPDATE … WHERE status='pendente'`; zero linhas → `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SEC-37 | Baixa | **Tratada** | Unique `(escala_id, policial_id, data_plantao)` alinhado ao Drizzle (`0047`); actions devolvem 409.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SEC-38 | Baixa | Aberto      | **Criar GISE:** `criarGiseEscala` INSERT livre; sem unique em `(operacao_id, data_inicio)`. Duplicata de dia é possível por corrida/UI. Arquivo: `src/lib/db/gise/escalas-crud.ts`. Aceitável se produto permite várias no mesmo dia; senão unique.                                                                                                                                                                                                                                                                                          |

### Achados B/C/D (segredos, input, clássicos) — cruzamento

| Tema                          | Veredicto                                                                                       | ID conhecido / novo                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Bundle / `PUBLIC_*`           | Só Sentry público                                                                               | — (sólido)                                                                                  |
| `.env` commitado              | Não; PEMs = trust store                                                                         | — (sólido)                                                                                  |
| Health detalhe                | Token obrigatório                                                                               | — (sólido); ops SEC-12/25                                                                   |
| Webhook replay opcional       | Preview/local                                                                                   | **SEC-13**                                                                                  |
| SYNC_TOKEN leak em resposta   | `unauthorized()` uniforme; reason só em log                                                     | — (sólido)                                                                                  |
| PDF histórico sem magic bytes | `%PDF` nos bytes (`ePdf`)                                                                       | **SEC-17** (tratada)                                                                        |
| JSON.parse sem Zod            | Form actions de composição/datas; webhook sync (validação manual por campo); modelos GISE do DB | residual — risco baixo se origem é form autenticado / DB admin; webhook sync já autenticado |
| `Number()` sem teto           | Vários `params.id` / FormData; search de unidades **tem** clamp 1–50                            | residual baixo (NaN → 400/redirect)                                                         |
| Path traversal R2             | Chaves montadas no servidor (UUID / ids numéricos); download lê `r2_key` do DB                  | — (sólido para upload)                                                                      |
| SSRF user URL                 | Não; TSA/OCSP com guard                                                                         | **SEC-26** (HTTP default)                                                                   |
| XSS `{@html}`                 | Só termo sanitizado                                                                             | — (sólido)                                                                                  |
| Open redirect                 | `goto`/`redirect` com paths fixos ou `obterRotaBemVindo`                                        | — (sólido)                                                                                  |
| Mass assignment               | Schemas LGPD strip; comentários anti-MA                                                         | — (sólido pós-remendo)                                                                      |
| Cookie HttpOnly               | Sim                                                                                             | —; **SEC-22** sessões concorrentes aceitas                                                  |
| Origin ausente no login       | Passa                                                                                           | **SEC-14**                                                                                  |
| SQL cru em erro HTTP          | `ehViolacaoUnique` + `serverError` genérico                                                     | — (sólido)                                                                                  |
| Intenção / 2FA reuso          | Fechado (CAS); lote `markUsed:false` é contrato                                                 | — (sólido; ver JSDoc `verificarDesafio2FA`)                                                 |
| Session fixation              | Token novo em `criarSessao`; Origin check em `/api/auth/*`; login não revoga sessões antigas    | **SEC-22**                                                                                  |

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

1. Reset de senha só com `email_pessoal_verificado=1` (SEC-29) — produto
2. Recusar Origin ausente no POST de `/api/auth/login` (SEC-14)
3. TSA por HTTPS (SEC-26)
4. Parar de logar `accountId` (SEC-30)
5. Unique / expressão ao criar escala, alinhada a FDS vs mensal (SEC-34)
6. Transições de status GISE com `WHERE` de estado (SEC-35)
7. Unique GISE `(operacao_id, data_inicio)` se o produto não permitir duas no mesmo dia (SEC-38)
