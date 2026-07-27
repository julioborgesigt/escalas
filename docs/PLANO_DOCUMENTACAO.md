# Plano de documentação e limpeza do código

Plano em fases para encerrar a dívida de documentação e as duplicações
remanescentes, com régua objetiva de progresso.

**Régua:** `node scripts/inventario-docs.mjs` (use `--lista` para o backlog
completo, `--json` para comparar fases). Todo critério de aceite abaixo é
verificável por esse comando.

---

## Princípios (o que comentar e o que não)

Vale registrar antes das fases, porque metade do trabalho é decidir **onde não
escrever**:

1. **Comentário explica DECISÃO, não código.** `/** Busca a escala por id. */`
   é dívida: ocupa espaço, envelhece e não informa nada que a assinatura já não
   diga. O que merece registro é o _porquê_ — regra da corporação, ordem
   obrigatória de operações, armadilha de biblioteca, consequência legal.
2. **Densidade de comentário não é meta.** Um componente com 800 linhas de
   markup e 2% de comentário pode estar correto. O que ele precisa é do
   cabeçalho de módulo. Perseguir porcentagem produz ruído.
3. **Para lógica duplicada, extrair vale mais que comentar.** Os quatro bugs
   corrigidos em jul/2026 (ver `git log --grep=fix`) tinham, todos, a cópia
   correta **acompanhada de um comentário explicando a armadilha** — e o bug
   aconteceu porque o dev seguinte editou outra cópia. Comentário protege quem lê
   aquele arquivo; extração protege quem não sabe que o arquivo existe.
4. **Refactor de artefato com valor jurídico exige golden antes.** PDF e e-mail
   já têm harness (`export-pdf-goldens`, `email-templates`). Grave o golden,
   refatore, confirme que não mudou um byte.
5. **Três alvos, nesta ordem de retorno:** cabeçalho de módulo → contrato de
   export público → comentário de ponto em trecho opaco.

## Baseline (2026-07-27)

| Categoria       | Arquivos | Sem cabeçalho | Opacos¹ | Exports sem doc |
| --------------- | -------- | ------------- | ------- | --------------- |
| `lib/server`    | 50       | **0**         | 2       | 28              |
| `lib/db`        | 33       | 5             | 1       | **62**          |
| `lib` (resto)   | 56       | 5             | 2       | 29              |
| rotas: servidor | 78       | 14            | **10**  | 1               |
| rotas: UI       | 85       | **41**        | 3       | 1               |
| **Total**       | **302**  | **65**        | **18**  | **121**         |

¹ _Opaco_ = ≥ 12 pontos de decisão por 100 linhas **e** < 6% de comentário.

---

## Fase 0 — Instrumentação ✅ (concluída)

Sem régua, "resolver tudo" não tem fim verificável.

- [x] `scripts/inventario-docs.mjs` — mede cabeçalho, opacidade e exports sem doc
- [x] Baseline registrado na tabela acima
- [x] Este plano versionado e indexado em [`docs/README.md`](README.md)

---

## Fase 1 — Servidor de rotas opaco (prioridade máxima)

**Por que primeiro:** é onde mora regra de negócio irrecuperável e é a categoria
com mais arquivos opacos (10). Os quatro bugs de jul/2026 saíram todos de `.ts`
de servidor, nenhum de componente.

**Escopo** (ordem sugerida):

- [x] `routes/res-gise/+page.server.ts` — 108 ramos, **20 ramos/100: a maior
      densidade de decisão do projeto**, sem cabeçalho. Presença + 2FA +
      relatório; os ramos de código expirado/tentativas esgotadas/usuário
      divergente são política de segurança
- [ ] `routes/policiais/[id]/+page.server.ts` — 118 ramos; histórico do servidor,
      vínculo de admin, afastamentos
- [ ] `routes/escalas/+page.server.ts` — 117 ramos; filtros, escopo por papel e
      `skipLoad`
- [x] `routes/login/+page.server.ts` — 52 ramos; orquestra 2FA/bootstrap
      (`auth-flow.ts` já documentado, a rota não)
- [x] `routes/api/webhook/sync-unidades` (falta `sync-policiais`) — contrato com
      sistema externo: formato do payload, idempotência, anti-replay
- [x] `routes/gise/+page.server.ts` — 44 ramos
- [x] `routes/policiais/upload/+page.server.ts` — importação em massa:
      deduplicação e erro parcial
- [x] `routes/api/escalas/[id]/download` e `routes/api/admin/compliance`
- [x] `routes/api/auth/login` e `routes/api/auth/confirmar-redefinicao` (fora do
      escopo inicial; entraram por estarem na lista de opacos)

**Aceite:** nenhum arquivo de _rotas: servidor_ classificado como opaco; todos com
cabeçalho; cada action/handler com uma linha dizendo o que decide.

**Esforço:** 3 levas (≈3 commits). **Risco:** nulo (só comentário).

**Progresso:** levas 1 e 2 concluídas (2026-07-27) — opacos em _rotas: servidor_
caíram de **10 para 1**; total do projeto, de **18 para 9**. Restam da fase:
`policiais/[id]/+page.server.ts` e `escalas/+page.server.ts` (alta contagem de
ramos, mas já acima do corte de 6%, portanto não sinalizados) e
`api/webhook/sync-policiais`.

---

## Fase 2 — Contratos da camada de dados ✅ (concluída)

**Por que:** 62 exports sem JSDoc em `lib/db` — são contratos consumidos por
rotas, endpoints e testes. É a maior concentração numérica do backlog.

**Escopo:**

- [x] `db/policiais.ts` (8 exports) — cadastro, o núcleo do RBAC
- [x] `db/gise/respostas.ts` (5 exports, 80 ramos, **também opaco**) — formulário
      de produtividade com schema dinâmico
- [x] `db/gise/escalas-crud.ts` (6) e `db/gise/seccionais.ts` (6)
- [x] `db/escalas.ts` (6 restantes) e `db/documentos.ts` (4)
- [x] `lib/auth.ts` (4) e `lib/utils.ts` (4)
- [x] Resto de `lib/db` (27 exports em 15 arquivos) — **fecha o aceite da fase**
- [x] `lib/gise/gise-page-helpers.ts` (6) — helpers puros usados pela UI
- [x] Restantes de `lib/server` (28) e `lib` (23), por ordem de uso

**Aceite:** zero exports sem doc em `lib/db`; cada JSDoc diz o **contrato** — o
que devolve, o que assume do chamador e que efeito colateral tem (cache
invalidado, auditoria gravada, arquivo no R2).

**Esforço:** 3 levas. **Risco:** nulo.

**✅ CONCLUÍDA** em 6 levas (2026-07-27), acima do aceite: em vez de zerar só
`lib/db`, o projeto INTEIRO ficou sem export público sem contrato.

| métrica              | antes | depois |
| -------------------- | ----: | -----: |
| exports sem doc      |   121 |  **0** |
| `lib/db` sem cabeçalho |     5 |  **0** |
| opacos               |     9 |      7 |

Duas correções na régua (`scripts/inventario-docs.mjs`) vieram desta fase, e são
o motivo de a contagem cair mais do que os JSDoc escritos: assinatura de
SOBRECARGA não é export separado (o JSDoc fica na primeira do encadeamento) e o
export ÚNICO de um módulo com cabeçalho já está documentado por ele — cobrar um
JSDoc a mais ali só produziria `/** Ver acima. */`.

Achados de código que saíram das leituras, além do bug da leva 2:

- `mapQuestions` recebia `filterTipo` e o usava em `filterTipo === 'seint' ? modelo : modelo`
  — ternário de ramos idênticos. Parâmetro e ternário removidos; o chamador já
  escolhia o modelo;
- os dois remetentes de e-mail que não passavam por `enviarERegistrar`
  (anexo e texto puro) foram unificados nele, com o helper ganhando `extras`.

A leva 2 achou o **quinto bug do mesmo padrão** (lógica duplicada em três
lugares, um deles errado): `removerGiseSeccionalUnidade` apagava só a linha do
slot, deixando equipes e membros órfãos — invisíveis na tela, mas ainda contados
pelo gate de presença. Corrigido com o delete das equipes, regressão travada em
`db/__tests__/slot-remocao-equipes.test.ts` e a criação de slot unificada em
`criarSlotComEquipesPadrao`.

---

## Fase 3 — Cabeçalhos de UI

**Por que:** 41 componentes sem cabeçalho, 14 deles com mais de 500 linhas. É o
comentário de maior retorno por linha escrita: orienta quem abre a tela pela
primeira vez.

**Escopo:** todo arquivo de UI com ≥ 200 linhas, começando pelos maiores
(`GiseSupervisao` 950, `produtividade` 864, `escalas/+page` 807,
`policiais/+page` 804, `login/+page` 797, `painel` 772, `recebidos` 760,
`gise/[id]` 759, `gise/+page` 710, `ListaFds` 704, `ModalNovaEscala` 698,
`TabelaServidores` 673, `GiseSeccional` 604, `FormularioServico` 599).

**Formato:** 5–10 linhas respondendo (a) que tela/bloco é, (b) quem usa e com que
papel, (c) qual decisão não é óbvia. **Não** comentar markup.

**Exceções que já pedem comentário de ponto:** `gise/[id]/+page.svelte` (95
ramos) e `res-gise/RelatorioProdutividade.svelte` (74 ramos, 1,7%) são opacos de
verdade — tratar como Fase 1, não como cabeçalho.

**Aceite:** zero arquivo de UI ≥ 200 linhas sem cabeçalho. Densidade **não** é
critério aqui.

**Esforço:** 2 levas. **Risco:** nulo.

**Progresso:** leva 1 concluída (2026-07-27) — as 7 maiores telas (`GiseSupervisao`,
`produtividade`, `escalas/+page`, `policiais/+page`, `login/+page`, `painel`,
`recebidos`) ganharam cabeçalho. UI sem cabeçalho 41 → 34; projeto 57 → 50.

---

## Fase 4 — Geração de documento com valor jurídico

**Por que:** `export-pdf.ts` tem 165 ramos e 4,5% de comentário — é o arquivo
mais opaco do projeto e produz os PDFs que o policial assina. Cada bloco de
layout existe por um motivo (campo obrigatório, norma, praxe da corporação) que
hoje só está na cabeça de quem escreveu.

**Escopo:**

- [ ] `lib/server/export-pdf.ts` — por seção: o que cada bloco imprime e por quê;
      apontar que a saída é congelada por `export-pdf-goldens`
- [ ] `lib/server/gise-xlsx-workbook-append.ts` (32 ramos, 4 exports sem doc)
- [ ] `lib/server/pdf-signing-visual.ts` — já em 14%, revisar apenas lacunas

**Aceite:** cada função de layout com uma linha de propósito; toda constante de
posicionamento/medida com o motivo do valor quando não for arbitrária.

**Esforço:** 2 levas (mais lento: exige entender o layout). **Risco:** nulo em
comentário; se algo for refatorado, os goldens são o guarda.

---

## Fase 5 — Duplicações remanescentes (código, não comentário)

**Por que:** é a dívida que já produziu bug. Cada item aqui é uma classe de
defeito fechada, não apenas explicada.

- [ ] **Blocos de paginação inline** — `TabelaServidores.svelte:646`,
      `SecaoHistorico.svelte:642` e `gise/+page.svelte:662` repetem o bloco que
      `PaginationControls.svelte` encapsula. Precisa de prop/snippet para o texto
      do contador, que difere em cada tela. _Verificação: validação visual das 3
      telas._
- [ ] **`ItemCompliance` declarado duas vezes** — idêntica em
      `routes/painel/+page.server.ts` e `routes/api/admin/compliance/+server.ts`;
      a `.svelte` importa a da API. Manter uma e importar.
- [ ] **Calendários** — `ModalNovaEscala` × `ModalCriarGise` compartilham blocos
      idênticos de 22, 20 e 15 linhas (navegação de mês e grade);
      `CalendarioSelecaoDias` repete 15. Extrair o cabeçalho de navegação e a
      grade. _Risco médio: markup compartilhado por 3 telas → validar visualmente
      cada uma, incluindo mobile._
- [ ] **`SerproSignerClient.listCertificates` e `.signFile`** — API pública sem
      nenhum chamador (~120 linhas). Decidir: remover ou marcar explicitamente
      como material de diagnóstico do protocolo SERPRO. Registrar a decisão no
      próprio arquivo.
- [ ] **Re-exports não usados em `lib/db.ts`** — 20 tipos reexportados que
      ninguém importa do barrel (os consumidores importam do módulo de origem).
      Decidir se o barrel é API pública ou conveniência interna.

**Aceite:** cada item resolvido ou com decisão registrada no código. Nada aqui
entra sem gates verdes + validação visual quando toca markup.

**Esforço:** 2 levas. **Risco:** médio na parte de markup.

---

## Fase 6 — Guardrails (para não voltar)

- [ ] Registrar em [`CLAUDE.md`](../CLAUDE.md) as duas regras que produziram os
      achados: **duplicação → extrair antes de comentar** e **golden antes de
      refatorar artefato jurídico**
- [ ] Documentar `npm run docs:inventario` no [`README.md`](../README.md) como
      passo de revisão de PR grande
- [ ] Avaliar gate leve no CI: falhar quando um arquivo **novo** em `lib/db`
      exportar função sem JSDoc (só arquivos novos — travar o legado inteiro
      irritaria sem ganho)
- [ ] Reavaliar o baseline deste plano e arquivá-lo em
      [`HISTORICO.md`](HISTORICO.md) quando as fases 1–5 fecharem

---

## Como executar cada leva

Ciclo que já se provou nas três primeiras rodadas (jul/2026):

1. `node scripts/inventario-docs.mjs --lista` → escolher 4–8 arquivos da fase
   corrente;
2. **ler o arquivo inteiro** — comentar sem ler produz descrição, não explicação.
   Foi a leitura que revelou os quatro bugs;
3. anotar decisão/regra, não código; se aparecer duplicação, extrair no mesmo
   commit (o comentário sozinho não impede o próximo erro);
4. gates completos: `npm run check && npm run lint:ci && npx knip &&
npm run format:check && npm test && npm run build`;
5. se mexeu em UI, validar na tela; se mexeu em PDF/e-mail, conferir os goldens;
6. um commit por leva, com o **achado** no corpo da mensagem (não só "adiciona
   comentários").

## Definição de pronto (global)

- `inventario-docs.mjs` mostra **0 opacos**, **0 arquivos ≥200 linhas sem
  cabeçalho** e **0 exports sem doc em `lib/db` e `lib/server`**;
- Fase 5 encerrada com decisão registrada em cada item;
- gates verdes e suíte de testes ≥ a atual (580) — refactors da Fase 5 devem
  chegar com teste ou golden próprio.

## Fora de escopo (decisão explícita)

- Perseguir porcentagem de comentário em componentes de UI;
- JSDoc em wrappers triviais de uma linha;
- Reescrever `ocsp.ts`, `pdf-verification.ts`, `serpro.ts` e `auth-flow.ts`, que
  já têm 15–27% de comentário e cabeçalhos completos — acrescentar ali é ruído;
- Traduzir comentários existentes ou padronizar estilo de redação: custo alto,
  ganho nenhum.
