# Auditoria de segurança — 21/ago/2026 (aberta: 7 achados)

Revisão **defensiva** da superfície de ataque do sistema de escalas/GISE
(SvelteKit + Cloudflare Workers). Sem PoC, payload ou procedimento de
exploração — só achados, evidência no código e remediação.

**Escopo:** rotas de API e form actions, hooks, auth/2FA/sessão, webhooks,
assinatura digital, uploads, SQL, XSS/CSP, secrets no repositório, autorização
(IDOR / papéis), e o complemento "banco sem tranca" (race/TOCTOU em D1, input
sem schema, clássicos). **Fora:** pentest dinâmico contra produção, engenharia
social, compromisso do token A3 físico, configuração live do Pages.

**Identificadores SEC-01…SEC-38** — não colidem com A/L/FLW/R2. **SEC-03 não
existe**: o número foi pulado na redação original, não é achado perdido.

---

## Estado — reverificação de 21/ago/2026

Cada um dos 37 achados foi reconferido **contra o código**, não contra o texto
da auditoria. Gate da reverificação: `npm test` (154 arquivos, 1705 testes),
`guard:autorizacao` (129 operações materiais, 107 recusam por permissão),
`guard:duplicacao` (55 blocos, todos na baseline), `docs:guard`.

| Situação               | Qtd   | Onde vive agora                                        |
| ---------------------- | ----- | ------------------------------------------------------ |
| Tratados e confirmados | 15    | tabela abaixo — o código é a prova                     |
| Aceitos com registro   | 15    | tabela abaixo; os de operação foram para o `DEPLOY.md` |
| **Abertos**            | **7** | **§ Abertos, com plano** — é o que mantém este arquivo |

O texto integral dos 30 fechados (prosa, evidência e remediação de cada um)
saiu deste arquivo e continua no Git:

```bash
git show 8645283:docs/auditorias/AUDITORIA_SEGURANCA_2026-08-21.md
```

### Tratados — confirmados no código em 21/ago

| ID     | Achado                                                              | Prova no código                                                                                              |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SEC-01 | Primeiro acesso travava a verificação do e-mail pessoal (deadlock)  | `server/auth/onboarding-gates.ts` `LIVRES_PRIMEIRO_ACESSO` + `__tests__/`                                    |
| SEC-02 | Form de 2FA não usava `buscarAdminAtivo` (cookie órfão)             | `routes/login/+page.server.ts:244`                                                                           |
| SEC-04 | Reenvio de 2FA do Admin Geral vinculado ia ao e-mail errado         | `server/auth/email-2fa.ts` + `api/auth/reenviar-codigo/+server.ts:82`                                        |
| SEC-05 | `/api/auth/*` inteiro livre do Termo de Uso                         | `onboarding-gates.ts` `LIVRES_TERMO` + `hooks.server.ts:178`                                                 |
| SEC-06 | FLW-RBAC-003 incompleto: editar/criar/listar escala por `u.lotacao` | `server/escalas/permissao.ts:88` (`podeMexerNaEscala` async + `lotacoesAdministradas`)                       |
| SEC-07 | `signerName`/`signerCpf` do body iam para o PDF                     | `server/assinatura/identidade-sessao.ts`, nas 4 rotas de preparar                                            |
| SEC-08 | `escapeLike` sem cláusula `ESCAPE` em nenhum call site              | `db/core.ts:35,41` (`likeContains`/`likePrefix`); `api/unidades/search` passou a usar                        |
| SEC-09 | `alternar-acesso` não invalidava o cache de sessão                  | `api/auth/alternar-acesso/+server.ts:50,101`                                                                 |
| SEC-10 | Comentário do guard dizia que Admin Geral assina GISE               | `scripts/guard-autorizacao.mjs:196-217`                                                                      |
| SEC-17 | Upload de PDF do histórico confiava no `Content-Type`               | `server/assinatura/selfie-upload.ts:63` (`ePdf`) + `policiais/[id]/+page.server.ts:160`                      |
| SEC-20 | Produtividade aceitava `seccionalId` de outra seccional da GISE     | `lib/gise/recorte-seccional.ts:37`                                                                           |
| SEC-32 | Dupla assinatura por corrida: `onConflictDoUpdate` desfazia unique  | `db/documentos.ts:269`, `db/gise/{documentos,assinaturas}.ts` + portão 409 em `server/gise/permissao.ts:165` |
| SEC-33 | Presença: reentrada e segunda saída sem CAS                         | `db/gise/presencas.ts:54` (`setWhere: saida IS NULL`)                                                        |
| SEC-36 | TOCTOU na decisão de solicitação de cadastro                        | `db/policiais/solicitacoes.ts:120-130` (`UPDATE … WHERE status='pendente'`)                                  |
| SEC-37 | Unique de plantão só no SQL, não no Drizzle (500 com SQL cru)       | `server/schema.ts:147` + `migrations/0047_escala_policial_dia_unico.sql`                                     |

### Aceitos com registro — a decisão, não a pendência

Severidade **não** é "dá para explorar amanhã". É o impacto **se** as premissas
de operação falharem. Os cinco de operação (SEC-11/12/13/23/25) deixaram de
depender deste arquivo: viraram seção do `DEPLOY.md`
("Proteções que só existem se a variável existir") e linhas do checklist de
release, que é onde o operador olha.

| ID     | Decisão registrada                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-11 | Bootstrap sem `*_EMAIL` entra só com senha. É o break-glass funcionando: ele não pode depender de e-mail. Audita e alerta. → `DEPLOY.md`                  |
| SEC-12 | Sem `PASSWORD_PEPPER`, PBKDF2@100k é o teto do workerd — pepper é a resposta, não mais iterações. → `DEPLOY.md`                                           |
| SEC-13 | Replay de webhook só obrigatório com `WEBHOOK_REPLAY_ENFORCE`; produção está em `1` desde 06/ago. `reset-policiais` exige **sempre**. → `DEPLOY.md`       |
| SEC-15 | Rate-limit de 2FA é fail-open se o D1 cair; o teto de 5 tentativas **por desafio** não depende do D1. Download de `/validar` é fail-closed (FLW-AUT-016). |
| SEC-16 | Cache de sessão (default 60 s) só em GET. Mutação nunca lê cache (FLW-AUTH-001). `SESSION_CACHE_TTL_SECONDS=0` desliga.                                   |
| SEC-18 | GPS e selfie da avançada vêm do cliente. A Lei 14.063 não transforma o browser em sensor honesto — o manifesto registra o que o aparelho **declarou**.    |
| SEC-19 | `/api/policiais/search` libera o diretório (sem e-mail) a todo admin **de propósito**: escalação cross-lotação depende disso. Policial comum é recortado. |
| SEC-21 | `style-src 'unsafe-inline'` é trade-off do Tailwind/Skeleton. `script-src 'self'`, sem `unsafe-eval`/`unsafe-inline`.                                     |
| SEC-22 | Login novo não derruba sessões anteriores. Troca e reset de senha revogam as duas identidades — que é o caso que importa.                                 |
| SEC-23 | `ADMIN_GERAL_SENHA`/`SUPER_ADMIN_SENHA` ainda aceitam texto claro; `DEPLOY.md` pede hash `pbkdf2v2:`. → checklist de release                              |
| SEC-24 | OCSP `unknown` / responder fora não impede login por certificado (fail-open documentado). `revoked` fecha.                                                |
| SEC-25 | Sem `CPF_ENCRYPTION_KEY` o CPF grava em claro, silenciosamente. Health detalha a ausência. → `DEPLOY.md`                                                  |
| SEC-27 | Código de `/validar` tem ~40 bits (8 chars, alfabeto 32), CSPRNG. Enumeração limitada por rate-limit; o download forense exige sessão privilegiada.       |
| SEC-28 | `GET /api/configuracoes/assinatura` devolve flags de política a autenticado; PUT é Super Admin. O hook já exige sessão.                                   |
| SEC-31 | `restringirSmartphone` olha User-Agent, que é spoofável. É política de UX/dispositivo, **não** autenticador — e está assim registrado desde 13/ago.       |

---

## Abertos, com plano

Sete achados. Nenhum é P0: quatro são endurecimento de superfície já defendida
por outra camada, três são corrida que exige duas requisições simultâneas com
credencial válida. O que os mantém abertos é que cada um tem uma decisão de
produto ou de operação embutida — não é refatoração mecânica.

### Ordem sugerida

A ordem é por **razão custo/risco**, não por severidade: os dois primeiros são
uma linha cada e fecham superfície sem decisão de produto; os três de corrida
pedem migração; os dois últimos precisam de resposta do dono do produto antes
de virar código.

| #   | ID     | Sev.  | Esforço  | Depende de                       |
| --- | ------ | ----- | -------- | -------------------------------- |
| 1   | SEC-30 | Baixa | ~1 linha | —                                |
| 2   | SEC-26 | Baixa | ~1 linha | confirmar que a TSA atende HTTPS |
| 3   | SEC-14 | Baixa | pequeno  | —                                |
| 4   | SEC-35 | Baixa | médio    | —                                |
| 5   | SEC-34 | Média | médio    | regra FDS × mensal               |
| 6   | SEC-38 | Baixa | pequeno  | **decisão de produto**           |
| 7   | SEC-29 | Média | médio    | **decisão de produto**           |

---

### SEC-30 — Baixa — `email.ts` loga o `accountId` do Cloudflare

`src/lib/server/email.ts:111-117` monta o log de diagnóstico com
`hasAccountId: !!accountId` **e** `accountId` — o valor inteiro. Não é
credencial (o `CLOUDFLARE_API_TOKEN` é que é), mas é identificador de conta em
log, e `hasAccountId` ao lado dele já entrega tudo que o diagnóstico precisa.

**Plano:** remover o campo `accountId` do objeto de log, mantendo
`hasAccountId`. Uma linha; sem teste novo (nenhum teste afirma o campo).

### SEC-26 — Baixa — `TSA_URL` default em HTTP

O default é `http://timestamp.digicert.com` — sem TLS. O carimbo RFC 3161 é
assinado pela TSA, então um MITM não forja carimbo válido; o que ele consegue é
**negar** o carimbo (derrubando a resposta) ou observar o hash carimbado. O
guard de SSRF continua valendo para a URL configurada.

**Plano:** trocar o default para `https://` e confirmar em `.env.example` +
`DEPLOY.md` §"Carimbo de tempo qualificado". Conferir antes que o endpoint da
TSA escolhida responde em HTTPS — algumas TSAs públicas servem RFC 3161 só em
HTTP, e nesse caso o achado vira "aceito com registro" em vez de remediado.
`avaliarConfiguracaoTsa` já tem teste que fixa `http://timestamp.digicert.com`
(`__tests__/cades-finalizer.test.ts:71,80`); ele acompanha a mudança.

### SEC-14 — Baixa — Origin **ausente** passa no POST de login

`hooks.server.ts:157` recusa `origin !== null && origin !== event.url.origin`.
Origem divergente morre; origem **ausente** passa. O login é isento de
CSRF-token de propósito (o cookie ainda não existe), então o Origin é a única
camada ali. Browsers modernos mandam `Origin` em todo POST cross-site — o
buraco é teórico para browser atual, e real para cliente não-browser.

**Plano:** exigir `Origin` presente **apenas** no POST de `/api/auth/login` e na
form action de login, não no resto (webhooks legitimamente não mandam Origin, e
já têm autenticação própria). Teste negativo: POST sem `Origin` → 403 `CSRF`.
Verificar no e2e que o fluxo normal de login não regride.

### SEC-35 — Baixa — Finalizar / transições de status GISE sem CAS

`api/gise/[id]/finalizar/+server.ts:32-48` lê o status, checa
`modoDeFinalizacao`, e só então chama `atualizarGiseEscala(db, id, {status:
'finalizada'})` — **sem** `WHERE` de estado. A mesma forma está na action
`finalizarGise` (`routes/gise/[id]/_actions/actions-escala.ts`). O estado final
é idempotente, mas os **efeitos colaterais** não: duas requisições simultâneas
geram auditoria duplicada e chamam `agendarSyncBaseEquipeAposFinalizar` duas
vezes.

**Plano:** dar a `atualizarGiseEscala` (ou a um `finalizarGiseEscala` novo em
`db/gise/escalas-crud.ts`) a forma CAS que o resto do projeto já usa —
`UPDATE … SET status=? WHERE id=? AND status IN (…) RETURNING` — e devolver
`{finalizada: boolean}`. Zero linhas afetadas → `conflict('Escala já
finalizada')`, **antes** de auditar e de agendar o sync. As duas entradas (API e
action) passam pelo mesmo helper; hoje elas duplicam a sequência, e é a
duplicação que deixou as duas sem CAS ao mesmo tempo.

⚠️ O JSDoc de `atualizarGiseEscala` (`escalas-crud.ts:89-96`) diz explicitamente
"Não valida a transição de status — quem decide é `escalas-status.ts`". Ela é o
patch genérico da linha (também grava `supervisor_id`, `assessor_id`, `seint*`),
então **não** dá para pôr o `WHERE` de status dentro dela sem quebrar os outros
usos: o CAS vai num helper novo, específico da transição.

### SEC-34 — Média — Criar escala: check-then-act sem unique no banco

`verificarEscalaExistente` + `criarEscala` (`db/escalas.ts:178-183`) são duas
operações separadas, e o índice `idx_escalas_lotacao_tipo_data`
(`server/schema.ts:116`) **não é unique**. O próprio JSDoc de `criarEscala`
admite: "Não checa duplicidade: chame `verificarEscalaExistente` antes, ou a
mesma lotação ganha duas escalas para o mesmo período". Duas criações paralelas
(duplo clique, retry) passam as duas pelo check e criam duas escalas
equivalentes. Chamadores: `routes/escalas/+page.server.ts`,
`_actions/actions-projecao.ts`.

**Plano — e por que ele não é "põe um unique":** a regra de "equivalente" difere
por tipo. Para **mensal**, `(lotacao, tipo, data_inicio)` basta. Para **fds**, o
critério é **sobreposição de intervalo** — dois fins de semana distintos podem
ter `data_inicio` diferente e ainda colidir, e um unique simples não expressa
isso (SQLite não tem exclusion constraint).

Caminho recomendado, em duas partes:

1. **Unique parcial para o caso que ele cobre:**
   `CREATE UNIQUE INDEX … ON escalas(lotacao, tipo, data_inicio) WHERE tipo='mensal'`.
   Fecha a duplicata mensal no banco, que é a maioria do tráfego.
2. **FDS continua no check**, mas o INSERT passa a ser fail-closed pelo mesmo
   padrão do SEC-32: a action captura `ehViolacaoUnique` e devolve **409**
   visível em vez de 500 com SQL cru — o mecanismo que o SEC-37 já instalou nas
   actions de plantão.

Antes de migrar: rodar a query de detecção de duplicatas mensais existentes em
produção, porque `CREATE UNIQUE INDEX` falha se já houver colisão gravada.

### SEC-38 — Baixa — Criar GISE sem unique em `(operacao_id, data_inicio)`

`criarGiseEscala` (`db/gise/escalas-crud.ts:61`) é INSERT livre; não há unique
nem check prévio. Duas GISE para a mesma operação no mesmo dia são possíveis por
corrida **ou** simplesmente por dois cliques na UI.

**Decisão de produto antes do código:** o produto permite duas escalas da mesma
operação no mesmo dia (dois turnos, duas frentes)? `criarGiseEscala` já recebe
`hora_entrada`/`hora_saida`, o que sugere que sim.

- **Se não permite:** unique em `(operacao_id, data_inicio)` + `onConflictDoNothing`
  - 409, atenção a `operacao_id` nullable (SQLite trata `NULL` como distinto, então
    GISE sem operação escapa do unique — pode exigir índice parcial `WHERE operacao_id IS NOT NULL`).
- **Se permite:** vira "aceito com registro", e o registro vai no JSDoc de
  `criarGiseEscala` — porque hoje o silêncio ali é indistinguível de esquecimento,
  que é exatamente o que o `CLAUDE.md` chama de armadilha.

Vale conferir junto: `clonarGiseParaData` chama esta função, então a resposta
precisa valer para o clone automático da próxima escala também.

### SEC-29 — Média — Reset de senha aceita `email_pessoal` não verificado

`api/auth/solicitar-redefinicao/+server.ts:131` só exige `usuario.email_pessoal`
— não `email_pessoal_verificado`. Pior: `api/auth/confirmar-redefinicao/+server.ts:136-148`
**marca** `email_pessoal_verificado = 1` quando o OTP é confirmado.

O raciocínio implícito é que o OTP prova controle da caixa. Prova — mas prova
apenas isso. Não prova que o **titular** vinculou aquele endereço de propósito:
um e-mail pessoal errado (digitado errado no cadastro, ou gravado por quem
administra a ficha) vira, no primeiro reset, um endereço **verificado** capaz de
redefinir a senha daquele policial. O caminho legítimo de verificação existe e é
outro: `/api/auth/solicitar-verificacao-email-pessoal` + `confirmar-…`, que é
justamente o que o SEC-01 desbloqueou.

**Decisão de produto antes do código** — a pergunta é o que acontece com quem
hoje tem `email_pessoal` preenchido e não verificado:

- **Opção A (fechada):** `solicitar-redefinicao` exige `email_pessoal_verificado=1`;
  `confirmar-redefinicao` **para de marcar** verificado. Quem não verificou perde o
  autoatendimento de reset até verificar — precisa da tela de verificação, que exige
  estar logado, ou de um admin. Medir quantos usuários caem nisso antes de decidir.
- **Opção B (transição):** manter o reset, mas parar de marcar `verificado=1` no
  confirmar — o flag volta a significar "o titular vinculou", e o reset deixa de
  fabricar essa prova. É a metade barata, e é reversível.

Em qualquer opção, a remoção do `UPDATE … SET email_pessoal_verificado = 1` no
`confirmar-redefinicao` é o núcleo do achado: é ele que transforma um endereço
não confirmado em confirmado sem que o titular tenha feito o ato de vincular.

---

## Superfície por ator

**Anônimo:** login (rate-limited), reset, 2FA, certificado, `/validar` (PII
mascarada), logo institucional, health binário, webhooks (sem o segredo → 401).
Não baixa o PDF forense.

**Policial comum:** própria lotação; presença só se participa; não assina
escala/GISE por POST (portão). Busca de colegas só na lotação.

**Admin de unidade/seccional:** escopo do **papel** (SEC-06). Não promove Admin
Geral. Diretório de policiais é global (SEC-19).

**Supervisor GISE:** assina a escala/relatório da operação em que foi designado.
Não assina a de outro supervisor.

**Admin Geral:** escalas ordinárias (assinatura inclusive, de propósito); GISE
lifecycle; **não** assina GISE. Pode promover outro Admin Geral (documentado).

**Super Admin:** auditoria, config de assinatura, unidades. Break-glass por env.

**Dono do `SYNC_TOKEN`:** upsert de folha (sem papel, salvo flag). **Não** apaga
o banco — isso pede `RESET_TOKEN` + data + nonce.

---

## Como esta auditoria se encerra

Quando os sete acima forem remediados ou formalmente aceitos, este arquivo sai
do working tree e ganha uma linha em [`docs/HISTORICO.md`](../HISTORICO.md) com
o commit em que pode ser lido — a convenção descrita em
[`docs/README.md`](../README.md). Enquanto houver achado aberto, ele fica aqui:
auditoria fora de `docs/auditorias/` é auditoria que ninguém releva.
