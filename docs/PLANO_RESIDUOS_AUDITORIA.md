# Plano — os três resíduos que sobreviveram ao arquivamento

**Status:** 3 de 3 fechados (22/ago/2026). **B-6.2** concluído, **B-5** aceito com
registro no código, **B-1** resolvido pela janela do servidor.
Nenhum é defeito ativo; são dívida que a auditoria de origem declarou e o
arquivamento tornou invisível.

## Por que este documento existe

A varredura de ago/2026 conferiu as 23 auditorias arquivadas contra o código.
Quase tudo estava fechado — inclusive coisas que o catálogo descrevia como
pendentes e não eram (`FLW-AUT-017` estava **feito** desde 06/ago; `B-6.3`
também, pela auditoria de componentização, com a caixa nunca marcada porque o
arquivo já tinha saído do working tree).

Sobraram três. Os três têm a mesma forma: a auditoria os marcou `[x]` com uma
ressalva no texto — _"segue como dívida de médio prazo"_, _"segue pendente"_,
_"fica como item próprio"_. A caixa marcada os tirou do radar, e o
arquivamento levou a ressalva junto. É a versão de resíduo do que o
`guard:achados` resolveu para siglas: **existe, e a busca por ele falha.**

O quarto resíduo daquela varredura — LGPD **A14**, sessão de 8h onde o plano
pedia 1h — foi fechado no mesmo ciclo, porque fechá-lo revelou um defeito
latente (o sliding só existia no banco, não no cookie). Os três abaixo não têm
defeito escondido: são custo conhecido.

**O A14 fechou em duas etapas, e a segunda desmentiu minha própria estimativa
de custo.** Declarei o limite "aba aberta não expira" como decisão de produto
cara — distinguir poll de atividade humana, ou medir teclado/mouse. Ao medir,
os sete `probe` do `useInvalidateOnFocus` passam **todos** por `fetchSyncEstado`
→ `/api/sync/estado`: uma rota. Isentar essa rota de renovar a sessão custou
três linhas e um teste. O que parecia exigir instrumentação de cliente era uma
lista de um item — e só dava para ver isso depois de perguntar "por onde o poll
sai?", que é pergunta diferente de "como detecto atividade humana?".

---

## Ordem sugerida

Por razão custo/benefício, não por severidade. O primeiro é mecânico; o
segundo tem um obstáculo técnico real; o terceiro é o mais barato e o único
que dá para fazer numa sentada.

| #   | Resíduo                          | Origem          | Esforço | Obstáculo                         |
| --- | -------------------------------- | --------------- | ------- | --------------------------------- |
| 1   | **B-6.2** — check-SVG inline     | Skeleton 16/jul | Baixo   | nenhum                            |
| 2   | **B-1** — agregação server-side  | Skeleton 16/jul | Médio   | payload × compatibilidade da tela |
| 3   | **B-5** — cor de chart por token | Skeleton 16/jul | Médio   | Chart.js exige cor concreta       |

---

## 1. B-6.2 — o mesmo check-SVG em 10 arquivos ✅ FECHADO 22/ago

**Medido em 22/ago:** `grep -rn "M5 13l4 4L19 7" src --include="*.svelte"` devolve
**13 ocorrências em 10 arquivos**. A auditoria contou ~20 em 12 e trocou os dois
pontos que flagrou por `lucide`; a varredura completa "ficou como item próprio,
fora do escopo de quick win" — e nunca virou item.

Arquivos: `SignaturePad`, `BadgeStatusEscala`, `SecaoAssinaturas`,
`CardGiseAtiva`, `SupervisaoDocumentoCard`, `GiseLoteAssinaturas`,
`solicitacoes/+page`, `DetailCard`, `RankingCard`, `routes/+page`.

**Passos**

1. Trocar cada ocorrência por `<Check />` de `@lucide/svelte`, que o projeto já
   usa (foi a decisão de VIS-6/VIS-7 e os dois pontos do B-6.1 já foram assim).
2. Conferir tamanho e cor caso a caso: o SVG inline traz `class` própria, e
   `lucide` recebe `size`/`class`. Não é substituição cega.
3. Rodar o `grep` de novo — **zero** é a definição de pronto.

**Por que não extrair um `IconeCheck` do projeto:** já existe uma resposta para
"ícone" neste código, e é o `lucide`. Um wrapper próprio criaria a terceira
forma de desenhar um check.

**Risco:** visual. Nenhuma regra de negócio encosta nisto. Playwright cobre as
telas de assinatura e produtividade, então regressão de layout aparece.

### Resultado

`grep` zerado. 167 linhas removidas contra 59 adicionadas. A referência foi
`SecaoGraficos.svelte`, irmão já convertido na leva do B-6.1 — copiar o padrão
existente evitou criar um sexto jeito de desenhar um check.

**A conversão achou duas coisas que valem mais que a troca de ícone:**

1. `GiseLoteAssinaturas` tinha o mesmo teste de status escrito DUAS vezes em
   paralelo — um escolhia a cor na `class` do `<svg>`, o outro o desenho no
   `<path>`, e nada obrigava os dois a concordarem. Fundir só foi possível
   porque o componente lucide carrega cor e ícone juntos.
2. `SupervisaoDocumentoCard` tinha um `d` corrompido: dois subpaths de
   prancheta concatenados, o segundo inválido.

`DetailCard`/`RankingCard` ganharam `aria-pressed`/`aria-label` de brinde — os
três cards são o MESMO toggle, e o B-6.1 só tinha passado por um deles.

---

## 2. B-1 — a agregação de `/produtividade` ainda é no cliente ✅ FECHADO 22/ago

**O que a auditoria pediu:** _"curto prazo: buscar todas as páginas; médio
prazo: agregar no servidor"_. O curto prazo foi aplicado em 17/jul e é o que
está lá: `+page.server.ts` busca a 1ª página no batch principal e **todas as
demais em paralelo**, em lotes de 500, e manda a lista inteira para a tela.

O defeito original era pior (só a 1ª página, 200 linhas, números errados em
silêncio acima disso). O que restou é custo: **o payload cresce com o
histórico**, e o cliente recomputa tudo a cada filtro.

**O que torna isto barato agora, e não era em julho:** as funções de agregação
já saíram do componente. `src/lib/produtividade/` tem `stats.ts`
(`calculateStats`, `calculateRanking`), `agrupamento.ts` (`chaveDoGrupo`,
`gruposDaVisualizacao`, `ordenarERecortar`), `metas.ts` e `questions.ts` — todos
**`.ts` puro, sem import de svelte/app/server, com `__tests__/` completo**. Mover
a chamada de lado é mudança de lugar, não reescrita.

**Passos**

1. Medir primeiro. Contar respostas por operação/mês em produção
   (`SELECT COUNT(*) FROM gise_respostas …`) e o tamanho do JSON que a rota
   devolve hoje. **Se o payload for pequeno, o item vira "aceito com registro"
   e este plano encerra aqui** — dívida de médio prazo só se paga quando o
   médio prazo chega.
2. Decidir o que sobe: `calculateStats` + `calculateRanking` no servidor,
   devolvendo os agregados, e a `lista` só quando a tela precisar do detalhe.
3. Cuidado com o filtro no cliente: hoje ano/seccional são recortados na tela
   **a partir da lista completa**. Agregar no servidor exige que esses filtros
   virem parâmetro da rota, ou os números divergem do que o usuário selecionou.
   É aqui que mora o trabalho de verdade, não na agregação.
4. Os testes de `stats`/`agrupamento` continuam valendo sem mudança — eles
   testam as funções, não o lugar de onde são chamadas.

**Risco:** médio, e é de correção, não de layout — número errado numa tela de
produtividade é indistinguível de número certo. Comparar agregado
servidor × cliente para o mesmo conjunto, antes de trocar, é o que protege.

### Desfecho: resolvido sem mover a agregação

O fato que mudou o plano: **a tela já mostrava o ano corrente por padrão**
(`filterAno` nascia em `currentYear`), enquanto o servidor carregava o histórico
inteiro. Carregava 4+ anos para exibir 1. O desperdício não era "carrega demais
para o que o usuário pode querer" — era carregar demais para o que ele **já
vê**.

Então a janela virou parâmetro do servidor, com default no ano corrente, e a
agregação ficou onde estava. `stats`/`agrupamento`/`metas` não foram tocados.

Três coisas que a implementação obrigou a resolver:

1. **`ano` não servia como parâmetro.** O filtro tem modo `personalizado`, com
   date pickers que cruzam anos; `ano` recortaria e o usuário veria menos do que
   pediu, sem erro. O parâmetro é `inicio`/`fim`.
2. **`strftime` anulava o índice.** A query filtrava
   `strftime('%Y', data_inicio) = '2026'` — função sobre coluna. Virou
   comparação por intervalo, que é a lição que `verificarEscalaExistente` já
   carregava escrita.
3. **O filtro tinha de nascer da janela do servidor.** Um seletor que discorde
   do recorte mostra números de um período com o rótulo de outro; o `load`
   devolve `janela` e a tela parte dela.

E uma bomba-relógio evitada: os fixtures de e2e fixavam `2026-05-*`. Com o
recorte no ano corrente, eles cairiam fora da janela em 01/jan/2027 e os specs
abririam a tela vazia. Passaram a ser ano-relativos — o que também resolve o
`selectOption('2026')`, que sumiria em 2030 (o seletor oferece quatro anos).

**O custo assumido:** trocar de ano virou round-trip, e não recorte instantâneo.
Um por troca de ano, contra carregar o histórico em toda abertura.

---

## 3. B-5 — cor de chart não vem do tema ✅ ACEITO COM REGISTRO 22/ago

**O que foi feito em 17/jul:** os hex duplicados na página saíram, e
`VIRTUAL_CHARTS` (`$lib/export-charts.ts`) virou a fonte única já usada pelo
export PNG. **O que ficou:** _"derivar dos tokens do tema segue pendente
(Chart.js/export PNG exigem cor concreta)"_.

**Medido em 22/ago:** `VIRTUAL_CHARTS` tem **2 entradas**; há **27 literais
`#rrggbb`** em `produtividade/` e `lib/produtividade/` (`RankingCard`,
`SecaoIndicadores`, `+page.svelte`, `questions.ts`, `apresentacao.ts`). A
centralização cobriu os destaques, não a paleta.

**O obstáculo é real e não some:** Chart.js desenha em `<canvas>` e o export PNG
roda fora do documento — nenhum dos dois resolve `var(--color-…)`. Token de tema
é CSS; canvas quer `#rrggbb`.

**Passos**

1. Uma paleta única em `.ts`, com os valores concretos e o nome do token do tema
   ao lado de cada um, em comentário. É o máximo de "derivar" que canvas aceita
   sem uma etapa de build.
2. Os 27 literais passam a importar dessa paleta. Isso já entrega o ganho real —
   trocar a cor num lugar só — sem prometer derivação automática.
3. **Se alguém quiser derivação de verdade:** ler os tokens computados
   (`getComputedStyle(document.documentElement)`) no cliente e passar como
   config para o Chart.js. Funciona na tela e **não** funciona no export PNG
   server-side. Só vale se o export migrar para o cliente.
4. Registrar a decisão no cabeçalho da paleta, seja qual for. O que não pode é
   ficar como está: a ressalva de julho não está escrita em nenhum arquivo do
   código.

**Risco:** baixo na tela, **golden no export**. `pdf-goldens` cobre PDF; se o
export PNG tiver golden, rodar antes e depois — cor de gráfico é saída visual
de documento.

### Desfecho: aceito, não feito

A contagem mudou a resposta. Os literais foram medidos por valor DISTINTO, não
por ocorrência: ~29 valores, e **a maioria aparece uma vez só** (`#64748b` ×5,
`#f43f5e` ×3, `#94a3b8` ×3, o resto ×1). Isso é paleta **categórica** — uma cor
por série — mais cinzas e a paleta institucional do PDF. Não é cópia divergente,
que é o problema que a extração resolve; consolidar moveria valores de lugar sem
remover risco.

Somado ao obstáculo que não some (canvas não resolve token CSS), o item fecha
como **aceito com registro** — no JSDoc de `VIRTUAL_CHARTS`
(`$lib/export-charts.ts`), onde quem for mexer em cor de gráfico lê. Mesma
família de `DUP-MANTER` e `C-MANTER`. Reabre se o export PNG migrar para o
cliente.

---

## Definição de pronto

- **B-6.2:** o `grep` do check-SVG devolve zero.
- **B-1:** ou a agregação subiu com os filtros junto, ou a medição do passo 1
  fechou o item como aceito, **com o número medido escrito aqui**.
- **B-5:** os 27 literais importam de uma fonte só, e a decisão sobre derivação
  automática está no cabeçalho dela.

Quando os três fecharem, este arquivo sai do working tree e vira linha do
[`HISTORICO.md`](HISTORICO.md), como qualquer auditoria encerrada.
