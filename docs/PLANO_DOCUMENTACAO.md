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

> **Correção do baseline (2026-07-28).** A coluna "sem cabeçalho" acima foi
> medida com a régua antiga, que aceitava um comentário em qualquer lugar dos
> primeiros 1200 caracteres — inclusive o JSDoc de uma função interna. Pela
> definição correta (_comentário antes da primeira linha de código_) o baseline
> real era **129**, não 65, e os arquivos com ≥ 200 linhas eram **73**, não 27.
> A régua foi corrigida na Fase 6; as contagens das fases abaixo estão marcadas
> como "antiga" ou "real" conforme o caso.

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
- [x] `routes/policiais/[id]/+page.server.ts` — 118 ramos; histórico do servidor,
      vínculo de admin, afastamentos (fechado na Fase A)
- [x] `routes/escalas/+page.server.ts` — 117 ramos; filtros, escopo por papel e
      `skipLoad` — que se revelou código MORTO (fechado na Fase A)
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

| métrica                | antes | depois |
| ---------------------- | ----: | -----: |
| exports sem doc        |   121 |  **0** |
| `lib/db` sem cabeçalho |     5 |  **0** |
| opacos                 |     9 |      7 |

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

## Fase 3 — Cabeçalhos de UI ⚠️ (reaberta na Fase 6)

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

**⚠️ CONCLUÍDA PARCIALMENTE** em 3 levas (2026-07-27) — e o número que este
plano registrava estava ERRADO.

À época a régua marcava "0 arquivos ≥ 200 linhas sem cabeçalho". Na Fase 6
descobriu-se que ela procurava um comentário em qualquer lugar dos primeiros
1200 caracteres: arquivo cujo primeiro comentário era o JSDoc de uma função
interna passava como documentado. Pela definição que o próprio script
declarava — _comentário antes da primeira linha de código_ — o número real
era **46**, não 0.

A régua foi corrigida (2026-07-28) e o backlog reaberto com a contagem
honesta. As 34 telas e componentes efetivamente documentados nas 3 levas
continuam valendo; o que muda é saber quanto ainda falta.

| métrica                        | baseline | fim da fase 3 (real) |
| ------------------------------ | -------: | -------------------: |
| arquivos ≥200 ln sem cabeçalho |       73 |               **46** |
| opacos                         |        9 |                    6 |

`gise/[id]/+page.svelte` e `gise-xlsx-workbook-append.ts` saíram da lista de
opacos pelo próprio cabeçalho. O de `res-gise/+page.server.ts`, escrito na Fase
1, estava DEPOIS dos imports e foi movido para o topo — convenção do projeto e
o único lugar onde a régua (e quem abre o arquivo) o encontra.

Correções de rota feitas na leitura: o mapa tipo → componente estava trocado em
dois cabeçalhos (plantão usa `TabelaPlantao`, expediente usa
`TabelaServidores`), e `skipLoad` não suprime skeleton — é o estado "Admin Geral
ainda não escolheu lotação", em que o servidor nem consulta.

---

## Fase 4 — Geração de documento com valor jurídico ✅ (concluída)

**Por que:** `export-pdf.ts` tem 165 ramos e 4,5% de comentário — é o arquivo
mais opaco do projeto e produz os PDFs que o policial assina. Cada bloco de
layout existe por um motivo (campo obrigatório, norma, praxe da corporação) que
hoje só está na cabeça de quem escreveu.

**Escopo:**

- [x] `lib/server/export-pdf.ts` — por seção: o que cada bloco imprime e por quê;
      apontar que a saída é congelada por `export-pdf-goldens`
- [x] `lib/server/gise-xlsx-workbook-append.ts` (32 ramos, 4 exports sem doc)
- [x] `lib/server/pdf-signing-visual.ts` — já em 14%, revisar apenas lacunas
- [x] Os quatro opacos restantes fora do escopo original
      (`RelatorioProdutividade`, `api/gise/historico/export`, `useCharts`,
      `escalas/bem-vindo`, `SearchableSelect`)

**Aceite:** cada função de layout com uma linha de propósito; toda constante de
posicionamento/medida com o motivo do valor quando não for arbitrária.

**Esforço:** 2 levas (mais lento: exige entender o layout). **Risco:** nulo em
comentário; se algo for refatorado, os goldens são o guarda.

**✅ CONCLUÍDA** em 1 leva (2026-07-27). **O projeto ficou com ZERO arquivos
opacos** (18 no baseline): além do escopo da fase, os cinco opacos restantes de
UI e endpoint foram fechados junto, porque todos eram o mesmo problema — muita
decisão, nenhum registro do porquê.

Goldens de PDF conferidos após a passada: byte-idênticos (só comentário
entrou). O cabeçalho de `export-pdf.ts` registra o que faltava: unidade em
milímetro e A4 paisagem, `finalY` como âncora do carimbo de assinatura, a
checagem de "o bloco ainda cabe na página" antes de desenhar, e o aviso de
nunca regravar golden para "fazer o teste passar" — são documentos que alguém
já assinou.

---

## Fase 5 — Duplicações remanescentes (código, não comentário)

**Por que:** é a dívida que já produziu bug. Cada item aqui é uma classe de
defeito fechada, não apenas explicada.

- [x] **Blocos de paginação inline** — extraído `Paginador.svelte` com só os
      BOTÕES; cada tela mantém o seu contador e espaçamento, e
      `PaginationControls` passou a usá-lo. Forçar o contador a prop deixaria a
      API pior que a duplicação. _Validado nas 3 telas com clique real de
      troca de página._
- [x] **`ItemCompliance` declarado duas vezes** — movido para `$lib/types`; as
      duas rotas e a `.svelte` importam de lá. Junto saíram `toISO`/`diasNoMes`,
      que tinham CINCO cópias entre calendários e compliance.
- [x] **Calendários** — unificado o helper de data (`isoData`), que era a parte
      com risco real: havia duas convenções de mês (base 0 e base 1) no mesmo
      sistema. A grade e a navegação NÃO foram extraídas: os três calendários
      têm interações diferentes (dias avulsos, ciclo de 3 estados com feriado,
      data única) e um componente comum precisaria de tantos props que viraria
      pior. _Os três validados: clique de dia, virada de mês e ISO resultante._
- [x] **`SerproSignerClient.listCertificates` e `.signFile`** — REMOVIDOS
      (−249 linhas com os helpers que só eles usavam). Decisão registrada no
      cabeçalho de `serpro.ts`, com o porquê e o ponteiro para o histórico.
- [x] **Re-exports não usados em `lib/db.ts`** — o barrel é a API pública das
      FUNÇÕES; tipo vem do módulo de origem. 16 dos 21 tipos não tinham
      consumidor pelo barrel e saíram, com a regra escrita no cabeçalho.

**Aceite:** cada item resolvido ou com decisão registrada no código. Nada aqui
entra sem gates verdes + validação visual quando toca markup.

**Esforço:** 2 levas. **Risco:** médio na parte de markup.

**✅ CONCLUÍDA** em 1 leva (2026-07-28): −469 linhas, +131. Dois itens fechados
com decisão em vez de refactor (grade dos calendários e barrel), registrada no
código como o aceite exige.

Ao tirar os re-exports do barrel, o `knip` passou a enxergar 4 tipos que ele
mascarava (`AppLogLevel`, `AuditCategoria`, `AuditSeveridade`, `TipoHistorico`):
exportados, usados só dentro do próprio módulo. Viraram locais. O barrel estava
escondendo dead code da ferramenta que existe para achá-lo.

---

## Fase 6 — Guardrails (para não voltar)

- [x] Registrar em [`CLAUDE.md`](../CLAUDE.md) as duas regras que produziram os
      achados: **duplicação → extrair antes de comentar** e **golden antes de
      refatorar artefato jurídico** — com a tabela dos cinco bugs e o corolário
      de quando NÃO extrair
- [x] Documentar `npm run docs:inventario` no [`README.md`](../README.md) como
      passo de revisão de PR grande
- [x] Gate leve no CI: `scripts/guard-docs-novos.mjs` (`npm run docs:guard`)
      falha quando um arquivo **novo** em `lib/db` vem sem cabeçalho ou com
      export sem JSDoc. Só arquivos ADICIONADOS no diff; base inacessível
      (clone raso) desliga o guard com aviso em vez de reprovar
- [x] **Corrigir a régua** (item que não estava previsto e virou o principal):
      `temCabecalho` aceitava comentário em qualquer lugar dos primeiros 1200
      caracteres. Passou a exigir comentário antes da primeira linha de código
- [ ] Fechar os 46 arquivos ≥ 200 linhas que a régua corrigida reabriu
- [ ] Reavaliar o baseline deste plano e arquivá-lo em
      [`HISTORICO.md`](HISTORICO.md) quando as fases 1–5 fecharem

**O que a correção da régua revelou.** O guardrail que este plano criou na
Fase 0 estava medindo a coisa errada — e foi só ao escrever o gate de CI, que
precisa de um critério exato, que a frouxidão apareceu. Números honestos hoje
(2026-07-28):

| métrica                      | baseline real |  hoje |
| ---------------------------- | ------------: | ----: |
| exports sem doc              |           121 | **0** |
| opacos                       |            18 | **0** |
| sem cabeçalho (≥ 200 linhas) |            73 |    46 |
| sem cabeçalho (qualquer)     |           129 |   126 |

As fases 2, 4 e 5 não são afetadas: seus critérios (exports, opacidade,
duplicação) não dependiam do cabeçalho. A fase 3 foi reaberta.

---

# Parte II — o que a auditoria de 2026-07-28 reabriu

A correção da régua (Fase 6) devolveu 46 arquivos ≥ 200 linhas ao backlog, e a
varredura pelas cinco classes de defeito achou mais duas instâncias. As fases
abaixo fecham o que sobrou, **na ordem do risco**, não do tamanho.

## Fase A — as duas rotas de servidor mais densas ✅ (concluída)

`policiais/[id]/+page.server.ts` (524 ln, **118 ramos**) e
`escalas/+page.server.ts` (517 ln, **117 ramos**) são os dois arquivos com maior
densidade de decisão do projeto sem cabeçalho. Estavam no escopo da Fase 1 e
nunca foram fechados porque a régua antiga não os sinalizava.

**Por que primeiro:** é onde mora regra de negócio irrecuperável — histórico do
servidor, vínculo de admin, afastamentos, escopo por papel. Os seis bugs da
sessão saíram todos de `.ts` de servidor.

**Aceite:** cabeçalho + uma linha por action dizendo o que ela decide.

**✅ CONCLUÍDA** (2026-07-28). E a leitura de `escalas/+page.server.ts` achou
código morto que a régua não pega: `const isAdmin = false` — hardcoded porque o
Admin Geral passou a ser redirecionado no guarda do `load`. Isso tornava
inalcançáveis quatro ramos, incluindo uma query inteira e o `skipLoad`, que
viajava até `TabelaEscalas` e mantinha lá um estado vazio ("Escolha uma
unidade") que nunca renderizava. −40 linhas. O cabeçalho que escrevi na Fase 3
descrevia esse estado morto como se fosse real — corrigido junto.

## Fase B — os 46 cabeçalhos reabertos

Em três levas, por categoria, do maior risco ao menor:

| leva | categoria                    | arquivos | linhas |     |
| ---- | ---------------------------- | -------: | -----: | --- |
| B1   | servidor (rotas e endpoints) |       12 |  4 391 | ✅  |
| B2   | `lib/` e `lib/server/`       |       16 |  7 826 | ✅  |
| B3   | UI                           |       18 |  7 839 | ✅  |

**Aceite:** `docs:inventario` com 0 arquivos ≥ 200 linhas sem cabeçalho — agora
medido pela régua correta. **Cumprido em 2026-07-28.**

**B1 ✅ concluída** (2026-07-28): _rotas: servidor_ zerada. Dos 10 arquivos,
**7 já tinham cabeçalho — escrito e depois enterrado sob os imports**. Foi o
padrão dominante da leva, e a razão de a Fase 1 parecer completa quando não
estava: a régua antiga achava o comentário em qualquer lugar, e quem abre o
arquivo não acha. Mover custou nada; o que faltava era medir direito.

Escritos do zero: `escalas/[id]/+page.server.ts` (154 ramos, o mais denso do
projeto), `api/validar/[hash]/download`, `api/webhook/sync-policiais` e
`painel/+page.server.ts`.

**B2 ✅ concluída** (2026-07-28): _lib (resto)_, _lib/db_ e _lib/server_ zeradas
— nenhum arquivo de biblioteca com ≥ 200 linhas está sem cabeçalho. O padrão de
B1 se repetiu, em menor escala: **5 dos 16 só precisavam do cabeçalho movido**
para cima dos imports (`useFaceLiveness`, `export-docx`, `gise/assinaturas`,
`ModalCadastrarRubrica`, `DialogSolicitarAssinatura`).

Onze escritos do zero. Os quatro que mais faltavam:

- `pdf-signing-prepare.ts` (1 186 ln) — o fluxo é em DOIS TEMPOS porque a chave
  privada não está no servidor, e há três embutimentos de CMS que diferem só na
  origem dos bytes. Documentado o motivo de o CMS do SERPRO não ser
  re-serializado (invalidaria a assinatura RSA — e é por isso que a qualificada
  não leva TST server-side).
- `schema.ts` (971 ln) — **editar aqui não cria tabela.** O tipo muda, o banco
  não, e a divergência só aparece em runtime. Registrado também por que as
  migrações são escritas à mão (o journal do `drizzle-kit` está parado em 2
  entradas para 39 arquivos; quem manda é `_migrations_aplicadas`) e por que a
  maioria das colunas `*_id` não tem FK — CASCADE apagaria prova assinada.
- `pdf-signing-visual.ts` (857 ln) — nada ali assina; são desenhos que
  TESTEMUNHAM a assinatura. Ordem obrigatória (tudo antes do preparar, ou os
  bytes caem fora do `/ByteRange`) e a regra de que a avançada não pode exibir
  "ICP-Brasil" nem MP 2.200-2.
- `auth.ts` (548 ln) — os dois eixos de papel (`tipo` da sessão × `papel` do
  RBAC, cumulativos) e o motivo de o arquivo estar em `lib/` e não `lib/server/`:
  só o TIPO `UsuarioLogado` é importado no cliente, e qualquer import de valor
  arrastaria `node:crypto` para o bundle.

Goldens de PDF e e-mail conferidos antes e depois: nenhum byte alterado.

Métrica: **34 → 18** arquivos ≥ 200 linhas sem cabeçalho. Os 18 restantes são
todos de UI (B3).

**B3 ✅ concluída** (2026-07-28): _rotas: UI_ zerada. **O aceite da Fase B está
cumprido: 0 arquivos ≥ 200 linhas sem cabeçalho, em todas as categorias.**

Aqui o padrão das levas anteriores se inverteu — só 3 dos 18 tinham cabeçalho
enterrado (`GiseEquipeCard`, `GiseSlotUnidade`, `SeccionalRelatoriosDownloads`).
Os outros 15 nunca tiveram. Faz sentido: os arquivos de UI foram os que menos
receberam auditoria, justamente por não parecerem perigosos.

Dois achados que não eram de documentação:

**1. Cinco arquivos diziam "Admin Geral" e exigiam SUPER ADMIN.** Todos os
consoles de administração do sistema: `/auditoria`, `/auditoria/logs`,
`/auditoria/export`, `/api/admin/audit` e `/config-geral`. O README (linha 498)
sempre esteve certo — "consoles de auditoria são do Super Admin"; os cabeçalhos
do código é que descreviam um público mais largo do que o gate permite.

Não é um typo. `isAdminGeral` e `isSuperAdmin` são poderes diferentes e o
próprio `auth.ts` documenta a separação. Quem lesse o cabeçalho e "consertasse
a inconsistência" na direção do comentário abriria a trilha forense inteira para
qualquer Admin Geral. Comentário errado sobre gate de permissão é um convite a
afrouxá-lo.

Confirmado no app rodando, nos cinco: com sessão de `superadm` → 200 nas quatro
páginas e no export; com sessão de `admgeral` → 302 nas páginas e **403** no
export.

**2. `hoje()` do `ModalDatasHoras` marcava AMANHÃ como hoje.** Era
`new Date().toISOString().slice(0,10)` — data em UTC. Das 21h à meia-noite no
horário de Brasília, o anel de "hoje" no calendário caía na célula do dia
seguinte. Corrigido com o `isoData` extraído na Fase 5 e verificado simulando
28/07 às 21:30 em `America/Fortaleza`: antes `2026-07-29`, agora `2026-07-28`.

Um detalhe útil para a Fase C: **não existe uma troca mecânica**. Este ponto
roda no NAVEGADOR, e ali os getters locais são a resposta certa (respeitam o
fuso do aparelho). Mas `hojeBrasilISO()` em `policiais/[id]/+page.server.ts`
roda no WORKER, que está sempre em UTC, e por isso precisa fixar o −3 na mão.
Mesma pergunta, duas respostas opostas conforme onde o código executa.

Métrica: **18 → 0**.

## Fase C — fragilidade de fuso em datas

12 pontos constroem `Date` em horário local e chamam `toISOString()`. Hoje é
seguro (Workers em UTC, navegador brasileiro em UTC-3) e quebraria só em fuso
positivo. Decidir caso a caso: trocar por `isoData` onde for barato, registrar
a premissa onde não for.

**1 dos 12 já saiu** (o `hoje()` do `ModalDatasHoras`, em B3) — e não era
hipotético: quebrava três horas por dia no fuso atual. Ao varrer os 11
restantes, classificar cada um por ONDE RODA antes de decidir a correção:
navegador → getters locais; Worker → offset explícito de Brasília. Trocar tudo
por `isoData` sem essa distinção troca um bug por outro.

## Fase D — exclusão de unidade (precisa de decisão de PRODUTO)

`excluirUnidade` valida só `escalas.lotacao`. Não valida `policiais.lotacao`,
`policiais.papel_unidade_id` nem as unidades-filhas. Excluir uma seccional deixa
delegacias e policiais apontando para um nome inexistente.

O RBAC falha FECHADO (escopo vazio, admin perde acesso), então não é urgente. A
pergunta é de produto: bloquear a exclusão, avisar, ou migrar os vínculos? **Não
implementar sem a resposta.**

## Fase E — arquivamento

Quando A–C fecharem: reavaliar o baseline, arquivar este plano em
[`HISTORICO.md`](HISTORICO.md) e deixar no lugar só a régua + os guardrails.

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
