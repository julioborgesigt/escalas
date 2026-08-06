# Auditoria — comentários, duplicação e extração (06/ago/2026)

**Status:** diagnóstico aberto (próxima rodada após a de 03/ago, que cobriu
`src/lib/server/**` + `src/lib/db/**`).  
**Objetivo:** facilitar compreensão e enxugar o projeto — funções sem
documentação adequada, lógica duplicada e trechos de UI/servidor candidatos a
extração.  
**Método:** verificação em loop — (1) `npm run docs:inventario`, (2) agentes
paralelos em duplicação / docs / UI, (3) confirmação por leitura direta dos
achados P0–P1, (4) cruzamento com
[`ACHADOS_COMENTARIOS_DUPLICACAO_2026-08-03.md`](./ACHADOS_COMENTARIOS_DUPLICACAO_2026-08-03.md)
e com o plano
[`PLANO_REVISAO_COMPREENSIBILIDADE_2026-08-02.md`](./PLANO_REVISAO_COMPREENSIBILIDADE_2026-08-02.md).  
**Escopo desta rodada:** `src/routes/**` (prioridade), mais revalidação do que
ainda está aberto em `src/lib/**`.

## Como ler

| Código        | Significado                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| DOC-FALTA     | Sem cabeçalho de módulo e/ou export público sem contrato                    |
| DOC-DESLOCADO | Prosa existe, mas **depois** do primeiro `import` (régua do inventário)     |
| DOC-ERR       | Comentário contradiz o código                                               |
| DUP-EXTRAIR   | Lógica copiada — unificar                                                   |
| DUP-DRIFT     | Cópias já divergiram (bug ou buraco latente)                                |
| DUP-MANTER    | Parecido de propósito — não extrair às cegas                                |
| COMP-EXTRAIR  | Markup/script de UI candidato a componente ou composable                    |
| COMP-MANTER   | UI parecida, mas unificar explode props / quebra semântica                  |
| RISCO         | Autorização, data/fuso, documento jurídico, perda de dado                   |

`Sev`: **P0** (autorização/dado/jurídico ativo) · **P1** (regra de negócio /
drift perigoso) · **P2** (manutenção) · **P3** (estilo / ROI baixo).

---

## 0. Snapshot do inventário (`npm run docs:inventario`)

Medido em **333 arquivos ≥ 40 linhas** (06/ago/2026):

| Categoria       | Arquivos | Sem cabeçalho | Opacos | Exports s/ JSDoc |
| --------------- | -------: | ------------: | -----: | ---------------: |
| lib (resto)     |       69 |            15 |      0 |                3 |
| lib/db          |       34 |             4 |      0 |                1 |
| lib/server      |       60 |             7 |      0 |                1 |
| rotas: UI       |       86 |            28 |      1 |                1 |
| rotas: servidor |       84 |            21 |      0 |                0 |
| **TOTAL**       |  **333** |        **75** |  **1** |            **6** |

**Régua do projeto (CLAUDE.md):** priorizar cabeçalho de módulo → contrato de
export público → comentário de **decisão** em trecho opaco. Densidade de
comentário **não** é meta.

Estimativa manual sobre os 75 “sem cabeçalho”: ~metade tem prosa boa
**deslocada** (depois do import); o restante está bare. Mover o bloco para o
topo é o ganho mais barato.

### 0.1 — Único arquivo “opaco” (heurística)

| Arquivo | Ramos | Linhas | % coment. | Nota |
| ------- | ----: | -----: | --------: | ---- |
| `src/routes/escalas/[id]/_components/EscalaCabecalho.svelte` | 12 | 93 | 1.1% | Quase só ternários de template; precisa de **cabeçalho**, não de comentário em cada `if` |

### 0.2 — Exports públicos sem JSDoc (lista fechada do inventário)

| Arquivo | Export sem contrato |
| ------- | ------------------- |
| `src/lib/db/unidades.ts` | `atualizarUnidade` (rename em cascata + concorrência — **maior risco**) |
| `src/lib/enhance-handler.ts` | `makeEnhanceHandler` |
| `src/lib/cross-tab-invalidate.ts` | `invalidateAllShared` |
| `src/lib/sync-estado.ts` | `fetchSyncEstado` |
| `src/lib/server/escalas/sync-estado.ts` | `resumoRecebidosAdmin` |
| `src/routes/res-gise/_components/useResGise.svelte.ts` | `useResGise` |

### 0.3 — Top 10 arquivos sem cabeçalho (por tamanho)

1. `res-gise/_components/useResGise.svelte.ts` (473) — **DOC-FALTA / P1**
2. `gise/[id]/_actions/actions-unidade.ts` (203) — DOC-DESLOCADO
3. `policiais/upload/+page.svelte` (202)
4. `gise/[id]/_actions/actions-equipe.ts` (199) — DOC-DESLOCADO
5. `redefinir-senha/+page.server.ts` (186)
6. `api/escalas/[id]/preparar-assinatura/+server.ts` (178) — bare; tem decisões inline
7. `redefinir-senha/+page.svelte` (177)
8. `escalas/[id]/_components/ModalEditarPlantao.svelte` (172)
9. `gise/[id]/_actions/actions-membros.ts` (170) — DOC-DESLOCADO
10. `lib/db/core.ts` (163) — DOC-DESLOCADO (JSDocs nos exports ok; cabeçalho no meio)

Lista completa: `npm run docs:inventario -- --lista`.

---

## 1. Achados novos de risco (confirmados por leitura)

### 1.1 — `calcularDatasPlantao` ainda usa `toISOString().split('T')[0]` — RISCO/DUP-EXTRAIR/P0

**`src/routes/escalas/[id]/_components/plantao-datas.ts:49-60`**

Mesma classe de bug de calendário já documentada no CLAUDE.md (UTC-3 marca
amanhã / fuso positivo marca ontem). `$lib/rotacao.ts` já projeta dias com
`adicionarDias` + `isoData`; este helper do formulário de plantão ainda faz:

```ts
datas.push(d.toISOString().split('T')[0]);
```

**Ação:** reescrever com `isoData` / `adicionarDias` (espelhar `rotacao`);
idealmente extrair `projetarDiasRotacao(inicio, fim, primeiro, tipo)`
compartilhado. Teste cobrindo fuso negativo (America/Sao_Paulo).

Também: `ultimoDiaMes` (L14–18) reimplementa `diasNoMes` de `$lib/utils/datas`.

---

### 1.2 — `podeOIPSolicitar` triplicado e **já divergiu** — DUP-DRIFT/RISCO/P0

| Local | Comportamento |
| ----- | ------------- |
| `api/escalas/[id]/solicitar-assinatura/+server.ts:22-26` | `admin` **OU** (papel seccional/unidade **E** cargo OIP) |
| `escalas/[id]/+page.server.ts:162-166` | Idêntico ao da API |
| `escalas/+page.server.ts:135-136` | **Só** papel seccional/unidade + OIP — **Admin Geral (`tipo==='admin'`) fica de fora** |

O gate da listagem (`/escalas`) esconde a UI de solicitar para Admin Geral, enquanto
a API e a página da escala concedem. Drift clássico: “escondi o botão” ≠ mesma
regra no servidor — aqui as **cópias da regra** discordam entre si.

**Ação:** uma função em `$lib/server/escalas/permissao.ts` (o arquivo já cita
`podeOIPSolicitar` em comentário). Decidir com o operador se Admin Geral deve
solicitar; alinhar os três call sites + teste.

---

### 1.3 — `criarComBase` ≈ `gerarProximoMes` — e o insert já divergiu — DUP-DRIFT/P1

| Action | Arquivo | Loop de projeção | Persistência |
| ------ | ------- | ---------------- | ------------ |
| `criarComBase` | `escalas/+page.server.ts:505-544` | `agruparDiasPorPolicial` → `calcularProximoMesDias` → linhas | `batchNonEmpty` em lotes de 50 |
| `gerarProximoMes` | `escalas/[id]/+page.server.ts:574-605` | Mesmo miolo | `db.insert(...).values(linhas)` **único** |

O miolo de negócio (~25 linhas) é cópia; o caminho de escrita **já não é o
mesmo** (limite D1 de batch vs insert monolítico). Escala grande no
`gerarProximoMes` pode estourar o que `criarComBase` já contornou.

**Ação:** extrair `$lib/server/escalas/projetar-mes.ts` (ou similar) com
projeção + insert em lotes; as duas actions só montam contexto/auditoria.

---

### 1.4 — Pipeline `documento-assinado` (escala × GISE) — DUP-EXTRAIR/P1

- `api/escalas/[id]/documento-assinado/+server.ts` (~52–110)
- `api/gise/[id]/documento-assinado/+server.ts` (~55–109)

Mesma sequência: manifesto → conferência R2 → fallback. Divergem em permissão /
rascunho. Download forense: qualquer correção em um lado tende a falhar no outro.

**Ação:** helper `responderPdfAssinado({...})` em domínio de assinatura /
conferência.

---

## 2. Duplicação ativa (P1–P2) — extrair

| # | Sev | Achado | Onde | Extração sugerida |
| - | --- | ------ | ---- | ----------------- |
| 2.1 | P1 | Gate `isAdminGeral` + `fail(403, 'Apenas Admin Geral')` × muitas actions | `actions-equipe`, `actions-escala`, `actions-unidade`, `actions-seccional` | `exigirAdminGeral(u)` em `gise/[id]/_actions/shared.ts` |
| 2.2 | P2 | `MESES_PT` copiado byte a byte | `utils/datas.ts` (canônico) **e** `rotacao.ts:13-26` | `export { MESES_PT } from './utils/datas'` em `rotacao` |
| 2.3 | P2 | Label `FDS DD/MM–DD/MM` | `painel/+page.server.ts`, `api/admin/compliance/+server.ts`, (variante em `ModalNovaEscala`) | `labelFds(inicio, fim)` em `$lib/utils/datas` |
| 2.4 | P2 | Arrays `horas`/`minutos` 00–23 / 00–59 | `ModalNovaEscala`, `FormAdicionarServidores`, `ListaFds`, `TabelaServidores`, `+page.svelte` | constante + `SeletorHoraMinuto` (ver §4) |
| 2.5 | P2 | Lookup issuer por CN (cert ICP) | `pdf-verification`, `cades-finalizer`, `cert-login` | `encontrarCertPorCN` no helper ICP |
| 2.6 | P2 | `hojeBrasilISO` local | `policiais/[id]/+page.server.ts` | export em `$lib/utils/datas` (par server de `hojeLocalISO`) |
| 2.7 | P2 | `Content-Disposition` cru | `api/gise/[id]/presenca/termo/+server.ts` | usar `contentDisposition()` de `$lib/server/api` |
| 2.8 | P2 | Timestamp SQLite inline | `request-context.ts` | `timestampSqliteUtc()` de `db/core` |
| 2.9 | P2 | `parseJson` defensivo ×2 | `auditoria/+page.svelte`, `auditoria/logs/+page.svelte` | helper local em `auditoria/_components/` |
| 2.10 | P2 | Esqueleto preparar-assinatura | vários `preparar-assinatura/+server.ts` | só o miolo (intenção + conferência), não o gerador de PDF |

---

## 3. Documentação — prioridade de compreensão

### 3.1 — P1 (faz falta para quem abre o arquivo)

| Alvo | Tipo | Por quê |
| ---- | ---- | ------- |
| `useResGise.svelte.ts` (473 ln) | DOC-FALTA | Maior arquivo sem módulo; export único sem contrato; densidade de decisão alta |
| 4× `lib/db` (core, policial-historico, configuracoes, admin-vinculado) | DOC-DESLOCADO | Camada coberta por `docs:guard` em arquivos novos; backlog vivo |
| 7× `lib/server` (document-utils, permissao escalas/gise, manifesto, …) | DOC-DESLOCADO | Contratos de autorização / documento — mover prosa para o topo |
| Rotas de assinatura bare (`preparar` / `finalizar` / `documento-assinado` / `solicitar`) | DOC-FALTA | Fluxo material/jurídico; preparar já tem decisões inline — falta “o que é este endpoint” |
| `atualizarUnidade` | DOC-FALTA (export) | Cascata de rename + concorrência sem contrato de export |

### 3.2 — P2 (vitórias rápidas)

- JSDoc em `makeEnhanceHandler`, `fetchSyncEstado`, `invalidateAllShared`, `resumoRecebidosAdmin`
- Cabeçalho em `+layout.server.ts` (carga app-wide)
- Cabeçalhos bare em componentes compartilhados usados sempre: `ModalShell`, `CodigoTimer`, `PaginationControls`

### 3.3 — O que **não** perseguir

- Encher de `/** Busca X */` em helpers privados cuja assinatura já diz tudo
- Subir % de comentário em páginas de markup grande que já têm cabeçalho
- `EscalaCabecalho`: cabeçalho de 3 linhas > dezenas de comentários em ternário

---

## 4. Extração de componentes / composables (UI)

### 4.1 — COMP-EXTRAIR (alto retorno)

| # | Sev | O quê | Evidência | Destino sugerido |
| - | --- | ----- | --------- | ---------------- |
| 4.1 | P1 | Pares `<select>` hora/minuto idênticos | `ModalNovaEscala`, `FormAdicionarServidores`, `ListaFds`, `TabelaServidores`, `ModalEditarPlantao` | `$lib/components/SeletorHoraMinuto.svelte` + `HORAS`/`MINUTOS` |
| 4.2 | P1 | Confirms com Dialog cru (bypass `ModalShell`) | `ModalReabrir`, `ModalRemoverSeccional`, `ModalFinalizar`, `ModalExcluirGise`, confirmações em `policiais`, `painel`, `recebidos` | Migrar para `ModalShell` / `ModalConfirmar` |
| 4.3 | P2 | Badges tipo/status duplicados desktop↔mobile | `TabelaEscalas.svelte` (~L116–188 vs ~L324–387) | `BadgeTipoEscala` + `BadgeStatusEscala` (ou snippets) |
| 4.4 | P2 | `GiseSupervisao.svelte` ~978 ln, 3 jobs | Designação + rodagem + documentos | Split em `_components/GiseSupervisao*.svelte` |
| 4.5 | P2 | `produtividade/+page.svelte` ~889 ln | Cadeia `$derived` de agregação | `useProdutividade.svelte.ts` |
| 4.6 | P2 | Modal de cadastro dentro de `policiais/+page` ~815 | Espelha padrão de unidades | `policiais/_components/ModalCadastrarPolicial.svelte` |
| 4.7 | P3 | Empty states repetidos | listagens escalas/policiais/unidades/recebidos/painel | `$lib/components/EstadoVazio.svelte` (só listagens) |
| 4.8 | P3 | Paginação custom em histórico | `HistoricoServidor` | reusar `$lib/components/Paginador.svelte` |
| 4.9 | P3 | Chips severidade/nível auditoria | `auditoria/+page` e `logs/+page` | `auditoria/_components/ChipNivel.svelte` |

### 4.2 — COMP-MANTER (não unificar às cegas)

| Padrão | Motivo |
| ------ | ------ |
| Grade dos calendários (`CalendarioSelecaoDias` vs inline em Nova Escala / Criar GISE / DatasHoras) | Decisão registrada no CLAUDE.md — semânticas de seleção diferentes; props explodem |
| `Paginador` vs `PaginationControls` | Contratos diferentes (só botões vs contador+scroll) — documentados |
| Exceções de `ModalShell` (`ModalNovaEscala`, `ModalDatasHoras`, `ModalBreveRelatorio`) | Interação, não cosmética |
| Quatro fluxos de login numa página | Decisão UX + não vazar existência de matrícula |
| Painéis de assinatura (`PainelAssinatura*`) | Variantes de domínio já fatiadas |

---

## 5. O que a rodada de 03/ago já fechou (não reabrir)

Confirmado ainda limpo nesta verificação:

- `ehViolacaoUnique()` — sem `message.includes('UNIQUE')` solto
- `apiFetch` / CSRF — sem `fetch`+csrf cru em UI nova
- `mostrarErroDeResultado` / `makeEnhanceHandler` — ramo de erro de `enhance` unificado
- Timing-safe / SHA-256→hex / tokens / envelope AES — em `lib/crypto/`
- Conflitos de horário GISE unificados; paginação DB; e-mail HTML parcialmente consolidado
- `criarPolicial`/`upsertPolicial` via `colunasDoPolicial()` (ex-3.9 da auditoria anterior — **fechado no código**, lista antiga pode ainda citar como aberto)
- LGPD `cutoffISO` / `cutoffSqlite` — **corrigido** (achado 1.1 de 03/ago); as duas grafias estão documentadas e casadas por coluna

---

## 6. DUP-MANTER / intencional (registrar, não “limpar”)

- Sem `autorizar()` único — resolvers por domínio (`verificarPermissaoEscala`, `verificarPermissaoGise`, …)
- `$lib/utils/` sem barrel; `$lib/db` barrel deliberado
- `diffDias` (exclusivo, `rotacao`) ≠ `diffDiasInclusivo` (`datas`)
- ASN.1 / forge SEQUENCE — abstração pior que repetição (auditoria anterior)
- Blocos de expansão literais em `respostas.ts` — chaves fixas de propósito
- `escala-horarios` factory (reatividade Svelte 5) vs formatadores em `export/shared` — unificar só núcleo puro

---

## 7. Sequência recomendada (enxugar com segurança)

### Lote A — risco primeiro (1–2 PRs)

1. ~~**1.1** `calcularDatasPlantao` → `isoData`/`adicionarDias` + teste de fuso~~ **FEITO 06/ago**
2. **1.2** unificar `podeOIPSolicitar` (com decisão Admin Geral) + teste  
3. **1.3** extrair projeção de mês + insert em lotes nas duas actions  

### Lote B — autorização / documento

4. **1.4** helper `documento-assinado`  
5. **2.1** `exigirAdminGeral` nas actions GISE  
6. Cabeçalhos nas rotas de assinatura + JSDoc `atualizarUnidade`

### Lote C — leanness de UI (baixo risco, alto volume)

7. `SeletorHoraMinuto` + constantes  
8. Confirms → `ModalShell`  
9. Badges `TabelaEscalas`  
10. `MESES_PT` único em `rotacao`  
11. Split `GiseSupervisao` / `useProdutividade` / `ModalCadastrarPolicial`

### Lote D — docs mecanicos

12. Mover cabeçalhos DOC-DESLOCADO (`lib/db` + `lib/server` + `_actions` GISE)  
13. Cabeçalho + contrato de `useResGise`  
14. Os 5 JSDocs restantes do inventário  

Revalidar progresso: `npm run docs:inventario` (meta prática: zerar exports s/doc e
opacos; reduzir “sem cabeçalho” nos ≥150 ln primeiro).

---

## 8. Verificação em loop — o que foi feito nesta sessão

| Passo | Ferramenta / ação | Resultado |
| ----- | ----------------- | --------- |
| 1 | `npm run docs:inventario` (+ `--lista`) | 75 / 1 / 6 (cabeçalho / opaco / exports) |
| 2 | Agente duplicação (`src/lib` + `routes`) | ~20 clusters; top A1–A4 confirmados |
| 3 | Agente documentação | Misplaced vs bare; priorização por compreensão |
| 4 | Agente UI / componentes | COMP-EXTRAIR vs COMP-MANTER alinhado ao CLAUDE.md |
| 5 | Leitura direta | `plantao-datas`, `podeOIPSolicitar` ×3, loops mês, `MESES_PT`, LGPD cutoff |
| 6 | Cruzamento 03/ago | Itens fechados vs ainda abertos; próximo domínio era `routes/**` — esta rodada |

**Não executado nesta rodada (de propósito):** refatorações ou commits — só
diagnóstico, conforme pedido.

---

## 9. Métricas-alvo sugeridas (próxima medição)

| Métrica | Hoje (06/ago) | Alvo lote D |
| ------- | ------------: | ----------: |
| Sem cabeçalho (≥40 ln) | 75 | ≤40 (priorizar ≥150 ln) |
| Exports `function` s/ JSDoc | 6 | 0 |
| Opacos (heurística) | 1 | 0 (via cabeçalho) |
| Cópias `podeOIPSolicitar` | 3 (divergentes) | 1 |
| `toISOString().split('T')` em laço de calendário de negócio | ≥1 (`plantao-datas`) | 0 |

---

## 10. Referências

- [`docs/README.md`](../README.md) — mapa da documentação; auditorias novas em `docs/auditorias/`
- [`CLAUDE.md`](../../CLAUDE.md) — régua de docs, anti-duplicação, calendários, `server/`
- [`ACHADOS_COMENTARIOS_DUPLICACAO_2026-08-03.md`](./ACHADOS_COMENTARIOS_DUPLICACAO_2026-08-03.md) — rodada anterior (`lib/server` + `lib/db`)
- [`PLANO_REVISAO_COMPREENSIBILIDADE_2026-08-02.md`](./PLANO_REVISAO_COMPREENSIBILIDADE_2026-08-02.md) — taxonomia e lotes
- Comando: `npm run docs:inventario` · `npm run docs:inventario -- --lista` · `--json`
