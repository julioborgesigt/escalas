# Auditoria profunda — fluxos, autorização e integridade (06/ago/2026)

**Status:** diagnóstico concluído — achados abertos, sem remediação nesta sessão.  
**Tipo:** autorização ponta a ponta (IDOR), operações materiais, máquinas de
estado, webhooks/RBAC/documentos — execução do plano
[`PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md`](./PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md).  
**Método:** (1) revalidação de todos os FLW-\* históricos no código atual;
(2) três varreduras paralelas (Escalas · GISE · Auth/RBAC/Webhooks/Docs);
(3) confirmação por leitura direta de todo achado P0/P1; (4) cruzamento UI ×
servidor × e2e.  
**Escopo:** 59 `+server.ts` de API, 33 `+page.server.ts`, 6 módulos `_actions`
GISE + actions de escalas — mutações e downloads sensíveis.

> Esconder botão na UI **não** é autorização. Todo achado abaixo exige
> evidência no **servidor**. Nomes como “finalizada” ou “pode assinar” só
> valem quando UI, action/API e (quando houver) constraint concordam.

---

## 0. Veredito executivo

A rodada de remediação de ago/2026 **fechou a maior parte** dos FLW-\* do plano
(composição de escala, IDs cruzados de membros, intenção de assinatura,
auditoria com pendência, sessões/tokens atômicos, exclusão física de policial,
rename de unidade). O `guard:autorizacao` e o e2e negativo cobrem “há um 403”,
não “é o 403 certo”.

**O padrão que ainda quebra produção jurídica é o mesmo de sempre:** a tela
calcula a regra estrita; o servidor usa a regra larga (leitura ≠ assinatura ≠
edição) — ou o preâmbulo de imutabilidade existe em **algumas** actions e falta
nas outras.

| Severidade | Novos | Históricos reabertos / parciais |
| ---------- | ----: | ------------------------------: |
| P0         |     3 |                               2 |
| P1         |     8 |                               3 |
| P2         |     7 |                               2 |
| P3         |     3 |                               — |

**Não implantar go-live de assinatura de escala mensal** sem fechar
**FLW-AUT-001** (assinar com ACL de leitura). **Não tratar GISE `finalizada`
como terminal** sem fechar **FLW-AUT-010**.

---

## 1. Achados novos (confirmados por leitura)

Numeração `FLW-AUT-*` = desta rodada (06/ago). Não confundir com FLW-AUTH-\*
(autenticação, plano 02/ago).

### FLW-AUT-001 — P0 — Assinar/preparar/finalizar/revogar escala usa ACL de **leitura**

**Regra da UI** (`PainelAssinaturaDigital.svelte`): Admin Geral **ou**
`(admin_seccional|admin_unidade) && cargo === 'DPC'`.

**Regra do servidor** (`verificarPermissaoEscala`): Admin Geral, **qualquer
usuário da mesma lotação**, ou admin cujo escopo cobre a lotação — **sem
exigir DPC nem papel**.

| Handler | Gate | Evidência |
| ------- | ---- | --------- |
| `POST .../assinar-simples` | `verificarPermissaoEscala` | `assinar-simples/+server.ts:87-89` |
| `POST .../preparar-assinatura` | idem | `preparar-assinatura/+server.ts:47-49` |
| `POST .../finalizar-assinatura` | idem | `finalizar-assinatura/+server.ts:63-65` |
| `DELETE .../documento-assinado` | idem | `documento-assinado/+server.ts:126-127` |

**Ataque:** policial **sem papel**, lotação = lotação da escala, envia
`POST /api/escalas/{id}/assinar-simples` com rubrica → PDF juridicamente
circulável. OIP admin (UI: “solicita, não assina”) assina ou revoga igual.

**Por que o e2e não pegou:** `e2e/escala-papel.spec.ts` cobre só **form
actions** de edição (`podeMexerNaEscala`). Não bate nas rotas de assinatura.

**Ação:** extrair `podeAssinarEscala(u, …)` espelhando a UI; usar nos quatro
handlers; estender `escala-papel.spec.ts` (e negativo anônimo já existente) para
assinar-simples / preparar / finalizar / DELETE documento.

---

### FLW-AUT-002 — P0 — `criarComBase` aceita `lotacao` arbitrária (escrita cross-tenant)

`criar` força `lotacao: u.tipo === 'policial' ? u.lotacao : lotacao`
(`escalas/+page.server.ts:305`).  
`criarComBase` lê `lotacao` do FormData **sem** `lotacoesAdministradas` /
`lotacaoNoEscopo` (`426-474`). Só exige papel admin.

`excluir` no mesmo arquivo **já** escopa seccional via `lotacoesDaSeccional`
(`393-400`) — a cópia correta existe ao lado.

**Ataque:** `admin_unidade` da DP-A posta `?/criarComBase` com
`lotacao=<DP-B>` → clona o quadro de B para uma escala nova de B.

**Ação:** `lotacaoNoEscopo(await lotacoesAdministradas(db, u), lotacao)` antes
de ler a escala anterior; alinhar com `excluir`/`criar`.

---

### FLW-AUT-010 — P0 — GISE `finalizada` ainda mutável por várias actions (FLW-GISE-006 incompleto)

`carregarGiseEditavel` em `_actions/shared.ts:81-91` recusa `finalizada` com
409 — mas **só** é usado pelos preâmbulos de equipe/membro/seccional que o
chamam. Actions de escala e várias de seccional **não** passam por ele.

| Action | Evidência | Efeito em `finalizada` |
| ------ | --------- | ---------------------- |
| `solicitarAssinatura` | `actions-escala.ts:293-302` | Status → `aguardando_assinatura` **sem** checar status atual |
| `salvarDatasHorarios` | `actions-escala.ts:236-288` | Apaga `gise_documentos` + R2; status → `em_preenchimento` (`saiuDaFaseDeEdicao('finalizada')` é true) |
| `salvarBreveRelatorio` / `salvarSupervisores` | `actions-escala.ts` | Mutam textos/quadro no estado terminal |
| `adicionarSeccional` / `removerSeccional` | `actions-seccional.ts` | Alteram árvore; podem forçar status de rascunho |
| `adicionarMembro` | `actions-membros.ts:62-104` | **Não** chama `carregarGiseEditavel`; insere membro; invalidação pode quebrar artefatos com status ainda `finalizada` |
| `salvarHorariosSec` / `finalizarSeccional` | `actions-seccional.ts` | Mesmo padrão |

O e2e `gise-imutabilidade.spec.ts` cobre sobretudo **slots de equipe** — o
único caminho que já usa o preâmbulo certo.

**Ação:** toda mutação material exceto `reabrirEscala` / `excluirGise` /
reenvio de planilha deve passar por `carregarGiseEditavel` (ou 409
equivalente). Estender e2e para `solicitarAssinatura`, `salvarDatasHorarios`,
`adicionarMembro`, CRUD de seccional.

---

### FLW-AUT-003 — P1 — Exclusão de escala assinada sem revogar antes

`excluir` em `escalas/+page.server.ts:371-406` e `painel`/`recebidos` chamam
`excluirEscalaCompleta` **sem** checar `escala_documentos` /
`finalizada_em`. O helper **apaga** blobs R2 de propósito
(`exclusao.ts`). Comentário no painel admite restrição só na UI.

**Ataque:** admin da unidade `POST ?/excluir` numa escala já assinada → PDF,
hash e selfie forenses somem sem trilha de `revogar_assinatura`.

**Ação:** 409 se existir documento assinado, salvo fluxo explícito de
revogação (ou Super Admin / caixa `/recebidos` documentada como exceção).

---

### FLW-AUT-004 — P1 — Reassinatura sobrescreve sem revogar

`assinar-simples` carrega `docAntigo` e sobrescreve (`:190+`) sem `conflict`
se já houver documento. Mesmo padrão em `finalizar-assinatura`.

Combinado com FLW-AUT-001: quem não deveria assinar também pode **substituir**
o PDF já assinado.

**Ação:** exigir revogação explícita (ou Super Admin) antes de novo ciclo
preparar→finalizar / assinar-simples.

---

### FLW-AUT-005 — P1 — Sync de policiais reativa `ativo=0` (esvazia FLW-RBAC-001)

`sync-policiais/+server.ts:130-131`:

```ts
// Ignorando a coluna H (status) a pedido do usuário: todos ficam ativos = 1
const statusMap = 1;
```

`upsertPolicial` grava `ativo: 1` no ON CONFLICT. Papel já é preservado (M-4);
**ativo não**. Desativação disciplinar no UI dura até o próximo sync da folha.

**Ataque:** Admin Geral desativa (sessões revogadas). Apps Script sincroniza a
matrícula ainda na planilha → `ativo=1` → login volta. Com
`WEBHOOK_REPLAY_ENFORCE` off (FLW-WEBHOOK-004), um body antigo também reativa.

**Ação:** preservar `ativo` no upsert (como papel), **ou** honrar coluna de
status da planilha com política explícita + evento de auditoria em
reativação.

---

### FLW-AUT-006 — P1 — Presença em `/res-gise` sem janela de horário

Canal A3 usa `gateDePresenca` (horário).  
`salvarEntrada` / `salvarSaida` em `res-gise/+page.server.ts` checam
participação (e saída exige entrada), **não** `horarioGiseLiberado`.

**Ataque:** participante posta entrada/saída antes do horário programado.

---

### FLW-AUT-007 — P1 — Presença / termo após GISE `finalizada`

Nem `res-gise` nem o gate A3 recusam `status === 'finalizada'`. UI pode
esconder; POST direto grava presença/termo em escala fechada.

**Ação:** recusar no gate compartilhado (ambos os canais).

---

### FLW-AUT-008 — P1 — Download de rascunho GISE cross-seccional

`api/gise/[id]/download/+server.ts`: após `verificarPermissaoGise`, rascunho
`extraordinario` libera para `isAdminGeral || isAdminSeccional || isSupervisor`
**sem** amarrar à seccional do ator.

**Ataque:** admin seccional A (participa da GISE) baixa rascunho da seccional B
ainda sem assinatura (PII/presença de B).

---

### FLW-AUT-009 — P1 — `excluir` escala: `admin_unidade` ainda usa `u.lotacao`

Residual de FLW-RBAC-003. Seccional usa `lotacoesDaSeccional(papel_unidade_id)`;
unidade cai em `escala.lotacao !== u.lotacao` (`+page.server.ts:398-400`).

**Ataque / efeito:** admin_unidade transferido (lotação nova ≠ unidade do
papel) deixa de excluir a unidade que administra, **ou** exclui a da lotação
atual que ninguém concedeu.

**Ação:** `lotacaoNoEscopo(await lotacoesAdministradas(db, u), escala.lotacao)`.

---

### FLW-AUT-011 — P1 — `reenviarEmail` FDS sem exigir `finalizada_em`

`escalas/[id]/+page.server.ts` (~1232+): só exige ciclo/`podeMexerNaEscala`.
Envia DOCX com escala ainda aberta.

---

### FLW-AUT-012 — P2 — FDS assinável digitalmente via API

`solicitar-assinatura` rejeita FDS; `assinar-simples` / `preparar` não.
Modelo de produto: FDS = e-mail, não assinatura digital.

---

### FLW-AUT-013 — P2 — `podeOIPSolicitar` triplicado e divergente

| Superfície | Regra |
| ---------- | ----- |
| Listagem `/escalas` | só OIP + papel (sem Admin Geral) |
| Detalhe `/escalas/[id]` | Admin Geral **ou** OIP + papel |
| API `solicitar-assinatura` | igual ao detalhe + escopo |

Já registrado na auditoria de compreensibilidade 06/ago; aqui como **risco de
autorização** (drift). Unificar em `permissao.ts`.

---

### FLW-AUT-014 — P2 — Painel apaga escala assinada (UI mente)

`painel/+page.server.ts` comenta restrição só na UI. Mesma família de
FLW-AUT-003; privilégio Admin Geral já existe em `/recebidos`, mas o painel de
*compliance* não deveria ser caminho silencioso de destruição forense.

---

### FLW-AUT-015 — P2 — FLW-ACL-002 residual (aceito historicamente)

`validar/[hash]/download`: cópia de conferência para **qualquer** autenticado
com o hash; forense só Super Admin. Sem `verificarPermissaoEscala`/GISE.

**Decisão de produto** ainda necessária: manter aceito ou reaportar ACL.

---

### FLW-AUT-016 — P2 — Rate-limit de download fail-open

Se D1 do rate-limit falha, o download segue (`validar/.../download`).
Defense-in-depth.

---

### FLW-AUT-017 — P2 — FLW-WEBHOOK-004 ainda aberto

`WEBHOOK_REPLAY_ENFORCE` opt-in; `.env.example` default vazio. Quatro webhooks
aceitam ausência de timestamp/nonce quando enforce off. Produção: passo 3 do
`DEPLOY.md` ainda não é fail-closed no código.

---

### FLW-AUT-018 — P3 — Upload CSV: ramo morto de lotação

`policiais/upload/+page.server.ts`: gate é Admin Geral; ramo “policial só a
própria lotação” é dead code — armadilha se alguém afrouxar o gate.

---

### FLW-AUT-019 — P3 — `primeiro_acesso` isenta todo `/api/auth/*`

`hooks.server.ts`: usuário em primeiro acesso ainda chama
`solicitar-codigo-assinatura`, `alternar-acesso`, etc. Finalizar assinatura de
documento em outras rotas continua bloqueado. Isenção mais larga que o
necessário.

---

### FLW-AUT-020 — P3 — `alternar-acesso` devolve `primeiro_acesso: false` no JSON

Cliente pode redirecionar errado; próximo request deriva do DB corretamente.

---

## 2. Status dos FLW-\* históricos (revalidação 06/ago)

### 2.1 Auth / sessão / tokens

| ID | Status | Nota |
| -- | ------ | ---- |
| FLW-AUTH-001 | **FIXED** | TTL 0 em mutações; GET pode servir sessão revogada ≤ TTL (aceito) |
| FLW-AUTH-002 | **FIXED** | `resolverCredencial` + revogação dual |
| FLW-AUTH-003 | **FIXED** | `primeiro_acesso` derivado do policial |
| FLW-AUTH-004 | **FIXED** | consumo atômico `WHERE usado=0` |

### 2.2 Escalas / documentos

| ID | Status | Nota |
| -- | ------ | ---- |
| FLW-ESC-001 | **PARTIAL** | Edição OK (`podeMexerNaEscala`); **assinar/revogar abertos** → FLW-AUT-001 |
| FLW-ESC-002 | **FIXED** | Queries amarram `escala_id` + id do item |
| FLW-ESC-003 | **PARTIAL** | Conteúdo bloqueado; **exclusão e reassinatura** abertas → AUT-003/004 |
| FLW-ESC-005 | **FIXED** | Datas fora do período + unique |
| FLW-ESC-006 | **FIXED** | E-mail antes de `finalizarEscalaFDS`; 502 se falha |
| FLW-ESC-007 | **FIXED** | Trilha nas 14 actions de `[id]` |
| FLW-DOC-001 | **FIXED** | Intenção amarra ator/alvo/hash; consumo atômico |
| FLW-ACL-002 | **ACCEPTED P2** | Conferência por hash; forense Super Admin — AUT-015 |

### 2.3 GISE

| ID | Status | Nota |
| -- | ------ | ---- |
| FLW-GISE-003 | **FIXED** (estreito) | Composição via `concluirMudancaGise`; residual em algumas actions-escala |
| FLW-GISE-004 | **FIXED** | `podePreencherSeccional` |
| FLW-GISE-005 | **FIXED** | Finalização antecipada explícita + audit |
| FLW-GISE-006 | **PARTIAL** | Equipes OK; escala/seccional/membro → **FLW-AUT-010** |
| FLW-GISE-007 | **FIXED** | Preâmbulos amarram filho à GISE da URL |
| FLW-GISE-008 | **PARTIAL** | Saída sem entrada OK; janela só no A3 → AUT-006 |
| FLW-GISE-009 | **FIXED** | INSERT atômico + unique |
| FLW-GISE-010 | **ACEITO** | Sem constraint “uma ativa”; documentado |
| FLW-GISE-011 | **FIXED** | Revogação resolve unidade da participação |

### 2.4 RBAC / cadastro / webhooks / R2 / LGPD

| ID | Status | Nota |
| -- | ------ | ---- |
| FLW-RBAC-001 | **FIXED*** | Sessão/2FA respeitam `ativo`; *esvaziado por AUT-005 (sync) |
| FLW-RBAC-003 | **FIXED*** | `lotacoesAdministradas` OK; *residual em `excluir` → AUT-009 |
| FLW-RBAC-005 | **FIXED** | Histórico + audit outbox |
| FLW-POLICIAL-002 | **FIXED** | Impedimento por autoria/menção |
| FLW-UNIDADE-004 | **FIXED** | Rename condicional |
| FLW-WEBHOOK-001 | **FIXED** | Reset atômico |
| FLW-WEBHOOK-002/003 | **FIXED** (server) | Apps Script destino fora do repo |
| FLW-WEBHOOK-004 | **OPEN** | = AUT-017 |
| FLW-AUDIT-001/005 | **FIXED** | Pendência + checkpoint |
| FLW-LGPD-002 | **FIXED** | Logs sem PII de e-mail |
| FLW-R2-003/004 | **FIXED** | Bucket antes de consumir; pendências de delete |
| FLW-DOC-003 | **FIXED** | Cleanup R2 na invalidação |

---

## 3. Matrizes RBAC (regras efetivas × o que o servidor faz hoje)

### 3.1 Escala mensal (plantão/expediente) — mutação / assinatura

| Papel efetivo | Editar composição | Solicitar assinatura | Assinar / revogar (servidor hoje) | Esperado (UI) |
| ------------- | ----------------- | -------------------- | --------------------------------- | ------------- |
| Admin Geral | sim | sim (detalhe/API) | sim | sim |
| admin_* + DPC, escopo OK | sim (`podeMexerNaEscala`) | não (não é OIP) | **sim (ACL leitura)** | sim assinar |
| admin_* + OIP, escopo OK | sim | sim | **sim (ACL leitura)** | **não** assinar |
| Policial mesma lotação, sem papel | **não** (ESC-001) | não | **sim — BUG AUT-001** | não |
| Policial outra lotação | não | não | não | não |

### 3.2 GISE — estado `finalizada`

| Ação | Deveria | Servidor hoje |
| ---- | ------- | ------------- |
| `salvarSlotsEquipe` / excluir equipe | 409 → reabrir | 409 (`carregarGiseEditavel`) |
| `solicitarAssinatura` | 409 | **muta status** |
| `salvarDatasHorarios` | 409 | **apaga PDF + reabre** |
| `adicionarMembro` | 409 | **insere** |
| Presença entrada/saída | 409 | **aceita** |
| `reabrirEscala` | permitido + audit | OK (caminho oficial) |

### 3.3 Superfícies admin / público (spot-check limpo)

| Superfície | Gate | Veredito |
| ---------- | ---- | -------- |
| `alternar-acesso` | auth + vínculo | OK |
| `alternar-modulo` | `requireAdmin` | OK |
| Upload policiais | Admin Geral | OK auth |
| `api/admin/*` | Admin / Super Admin conforme rota | OK |
| CSRF `/api/*` | double-submit + Origin em auth | Forte |
| Form actions | sessão `SameSite=strict` | OK |
| Webhooks | Bearer/HMAC; replay opcional | AUT-017 |

---

## 4. Cobertura de teste — gaps que permitem os bugs

| Gap | Achado que escapa |
| --- | ----------------- |
| `escala-papel.spec.ts` não POSTa APIs de assinatura | AUT-001 |
| Sem e2e de `criarComBase` com lotação fora do escopo | AUT-002 |
| `gise-imutabilidade` só slots/equipe | AUT-010 |
| Sem teste de sync preservando `ativo=0` | AUT-005 |
| Sem negativo de presença antes do horário em `/res-gise` | AUT-006 |
| Sem 409 em `excluir` com `escala_documentos` | AUT-003 |
| `guard:autorizacao` conta “tem 403”, não “403 certo” | todos os ACL largos |

### Nota operacional — Windows

`npm run guard:autorizacao` chama `find` Unix (`guard-autorizacao.mjs:139`) e
**falha no Windows** (`FIND: formato de parâmetro incorreto`). O CI Linux
continua válido; o gate local em Windows está cego. Remediação sugerida:
`fast-glob` / `fs.walk` em Node, sem shell `find`.

---

## 5. O que está sólido (não reabrir)

- Intenção de assinatura (preparar→finalizar) amarra ator/alvo/hash — DOC-001  
- IDs de `escala_policiais` amarrados à escala da URL — ESC-002  
- Policial sem papel **não** edita composição via form action — ESC-001 parcial OK  
- Child IDs GISE (equipe/sec/membro) amarrados à GISE da URL — GISE-007  
- `podePreencherSeccional` — GISE-004  
- Consumo atômico de reset/2FA — AUTH-004  
- Pendência durável de auditoria — AUDIT-001  
- Manifesto forense de escala: Admin Geral (e ramo DPC no helper; call site
  atual é admin-only)  
- Termo de presença: só o próprio `u.id`  

---

## 6. Sequência de remediação (ordem de contenção)

### Sprint A — conter documento e tenant (antes de qualquer outra refatoração)

1. **FLW-AUT-001** — `podeAssinarEscala` nos 4 handlers + e2e  
2. **FLW-AUT-010** — `carregarGiseEditavel` em **todas** as mutações materiais GISE + e2e  
3. **FLW-AUT-002** — escopo de lotação em `criarComBase`  
4. **FLW-AUT-003 / 004** — 409 em excluir/reassinar documento existente  

### Sprint B — estado e identidade

5. **FLW-AUT-005** — sync não reativa `ativo` sem política  
6. **FLW-AUT-006 / 007** — gate de presença unificado (horário + finalizada)  
7. **FLW-AUT-009** — `excluir` via `lotacoesAdministradas`  
8. **FLW-AUT-008** — rascunho download escopado à seccional  

### Sprint C — higiene e operação

9. **FLW-AUT-011 / 012 / 013** — FDS e `podeOIPSolicitar` único  
10. **FLW-WEBHOOK-004 / AUT-017** — enforce replay em produção  
11. **AUT-014…020** — painel, ACL-002 (decisão), fail-open RL, Windows guard  
12. Estender `guard:autorizacao` (ou teste estrutural) para **padrão de helper**
    (`podeAssinarEscala`, `carregarGiseEditavel`) — não só presença de `403`

Cada fix: teste negativo **antes** ou no mesmo PR; artefato jurídico (PDF)
exige golden verde se o fluxo de assinatura mudar.

---

## 7. Inventário de método desta sessão

| Passo | Resultado |
| ----- | --------- |
| Leitura do plano 02/ago + `guard-autorizacao.mjs` | Escopo FLX-01…08; 113 ops (doc); DECLARADAS/PUBLICAS |
| Agente Escalas | N1–N7 → AUT-001…004, 011–013 |
| Agente GISE | N1–N5 → AUT-010, 006–008; tabela FLW-GISE |
| Agente Auth/RBAC/Webhook/Docs | AUT-005, 014–020; tabela histórica |
| Confirmação manual | `assinar-simples:87-89`, `criarComBase:426-474`, `solicitarAssinatura:293-302`, `salvarDatasHorarios:270-288`, `adicionarMembro` sem preâmbulo, `sync-policiais:130-131`, `excluir:398-400` |
| Cruzamento e2e | `escala-papel` não cobre APIs de assinatura |

**Não feito nesta sessão (de propósito):** remediação de código, commits,
atualização de goldens. Diagnóstico apenas.

---

## 8. Referências

- Plano: [`PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md`](./PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md)  
- Compreensibilidade/duplicação (mesmo dia): [`AUDITORIA_COMENTARIOS_DUPLICACAO_EXTRACAO_2026-08-06.md`](./AUDITORIA_COMENTARIOS_DUPLICACAO_EXTRACAO_2026-08-06.md)  
- Diretrizes: [`CLAUDE.md`](../../CLAUDE.md) § operação material / autorização  
- Guard: `scripts/guard-autorizacao.mjs` · e2e: `e2e/autorizacao-negativa.spec.ts`, `e2e/escala-papel.spec.ts`, `e2e/gise-imutabilidade.spec.ts`  
- Helpers: `$lib/server/escalas/permissao.ts`, `$lib/server/gise/permissao.ts`, `gise/[id]/_actions/shared.ts`
