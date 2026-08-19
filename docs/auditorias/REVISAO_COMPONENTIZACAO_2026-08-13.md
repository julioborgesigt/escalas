# Revisão de componentização e manutenibilidade

**Data:** 2026-08-13
**Escopo:** `src/` inteiro — 138 componentes Svelte (36.788 linhas) + 444 módulos TS (79.196 linhas)
**Método:** leitura estrutural, medição de tamanho por arquivo, rastreamento de duplicação e de
fronteiras de import. Sem execução de testes (`node_modules` ausente no ambiente de revisão).

**Status:** ABERTA — reverificada em 19/ago/2026 (ver §0). Um achado resolvido,
três parciais, seis abertos. **Não arquivar enquanto houver linha "aberto"
abaixo** — a convenção de [`docs/HISTORICO.md`](../HISTORICO.md) só admite
remover o arquivo quando os achados estão resolvidos ou formalmente aceitos.

---

## 0. Reverificação — 19/ago/2026

Conferência achado a achado contra o working tree de hoje (`main` em `68cb3fd`).
A §0 é a ÚNICA seção atualizada; as §§1–10 permanecem como o diagnóstico
original de 13/ago, para que a comparação continue possível.

| # | Achado | Status hoje | Evidência |
|---|--------|-------------|-----------|
| 1 | Tabela desktop × cards mobile em 6 telas | **Aberto** | `hidden md:block` + `md:hidden` nas seis telas; o drift citado continua literal — `recebidos/+page.svelte:431` diz "Visto" e `:605` diz "Lida"; o tooltip do manifesto tem "(… CPF, IP, GPS, selfie)" em `:525` e só "(evidências da assinatura)" em `:656` |
| 2 | `escalas/[id]/+page.server.ts` com 14 actions inline | **Resolvido** | 1.381 → **161 linhas**; `_actions/` agora tem `actions-ciclo`, `actions-composicao`, `actions-datas`, `actions-projecao`, `desfecho`, `shared` + `__tests__/` |
| 3 | Três definições de "é mobile?" | **Parcial** | `useMobile` virou a fonte única e documentada (o cabeçalho registra a decisão) e `useGiseEstado` não tem mais `MediaQuery` próprio — mas `gise/+page.svelte:113` mantém `new MediaQuery('(min-width: 768px)', true)`. Sobrevivem os DOIS defeitos: sobreposição exata em 768px (`max-width: 768px` do outro lado, não `767.98px`) e fallback de SSR invertido (`true` aqui, `false` lá). E continua decidindo fluxo, não layout: `:153`–`:173` escolhem entre `via=token` e `via=tela` |
| 4 | `+layout.svelte` com 7 responsabilidades | **Parcial** | A parte de maior retorno saiu: as regras de visibilidade viraram `routes/_components/menu-visibilidade.ts` — `.ts` puro, com `__tests__/menu-visibilidade.test.ts`, exatamente o `menu-modelo.ts` recomendado. O cabeçalho dele cita as "1146 ln" deste documento. Faltam a gaveta, a barra do topo e o provedor de Toast; o arquivo está em **1.042 linhas** |
| 5 | Array dos 5 status "escala assinada" repetido 4× | **Aberto** | As quatro cópias intactas: `gise/+page.svelte:196` e `:272`, `gise/_components/CardGiseAtiva.svelte:69`, `gise/[id]/_actions/actions-escala.ts:431` (a do servidor, que autoriza reabrir). Não existe `STATUS_ESCALA_ASSINADA` no repositório |
| 6 | 7 páginas grandes sem `_components/` | **Aberto** | Nenhuma das sete tem a pasta. Tamanhos hoje: `painel/` 819, `validar/[hash]/` 750, `recebidos/` 749, `res-gise/relatorio/[giseId]/` 520, `conf-ass/` 466, `auditoria/logs/` 370, `alterar-senha/` 354 |
| 7 | 6 imports atravessando fronteira de rota | **Parcial** | O pior sumiu: `gise/+page.svelte` não alcança mais `[id]/_components/modais/ModalRubrica.svelte` (a listagem foi para o fluxo de chave e o modal ficou só em `gise/[id]/`). Permanecem `gise/[id]/+page.svelte:70` → `../_components/ModalDownloadExtras.svelte`, `res-gise/relatorio/[giseId]/+page.svelte:45` → `../../_components/RelatorioProdutividade.svelte` e os cinco de `auditoria/logs/` → `../_components/` (`KpiCard`, `ChipNivel`, `FiltrosToggle`, `Paginacao`, `parse-json`, `consulta`) |
| 8 | ~250 linhas de texto de diálogo em `gise/+page.svelte` | **Aberto** | 13 blocos `dialogInfo = {` no arquivo (642 linhas); não existe `lib/gise/mensagens-assinatura.ts`. O diálogo de manifesto continua montado duas vezes (`handleEscalaPdf` / `handleExtraPdf`) |
| 9 | `getSavedFilters` vazando pelo barrel de composables | **Aberto** | `lib/composables/index.ts:2` intacto; os cinco call sites (`escalas`, `policiais`, `painel`, `recebidos`, `unidades`) continuam importando de `$lib/composables` |
| 10 | Zero testes de componente | **Aberto** | `*.svelte.test.ts`: **0**. `*.test.ts` em `src/`: 143 (eram 126). Specs Playwright: 38 (eram 36) |

### Como ler o resultado

O que foi remediado veio de outra frente: a rodada de encerramento da
[`AUDITORIA_COMPONENTIZACAO_2026-08-13.md`](../HISTORICO.md) (arquivada —
`git show e05a86d:docs/auditorias/AUDITORIA_COMPONENTIZACAO_2026-08-13.md`),
escrita no MESMO dia que este documento e com sobreposição parcial de escopo.
Ela entregou o corte de `escalas/[id]/_actions/` (#2) e a unificação de
`isMobile` (#3) — mas contava **duas** definições de mobile, não três: o
`MediaQuery` de `gise/+page.svelte` não estava no escopo dela e por isso
atravessou a remediação inteira. É o resíduo mais barato e o único com
consequência de comportamento desta lista.

A "Rodada 1" da §"Sequência sugerida" continua sendo a recomendação: dela
sobraram os itens 1 (mobile, **parcial**), 3 (`STATUS_ESCALA_ASSINADA`) e 4
(barrel) — o item 2 dela (subir `ModalRubrica`) foi resolvido pelo caminho.

---

## Resumo executivo

Este não é um código bagunçado. Ele tem convenções escritas (`CLAUDE.md`), guards de CI
(`guard:autorizacao`, `docs:guard`, convenção de testes), 126 testes unitários, 36 specs
Playwright, e cabeçalhos de módulo que explicam **decisão**, não sintaxe. Vários dos padrões que
uma revisão normalmente recomendaria já estão implementados — `useFiltrosPaginados`, `apiFetch`,
`ModalShell` (37 usos), `_actions/shared.ts`.

O problema não é ausência de padrão. **É aplicação desigual do padrão que já existe.** Em quase
todo achado abaixo, a solução certa já está no repositório, aplicada num lugar e não no vizinho.
Isso é boa notícia: são refatorações de baixo risco, com o alvo já desenhado.

Ordenado por retorno:

| # | Achado | Impacto | Esforço |
|---|--------|---------|---------|
| 1 | Tabela desktop × cards mobile duplicados em 6 telas (~1.380 linhas) | Alto — drift já ocorrendo | Alto |
| 2 | `escalas/[id]/+page.server.ts`: 14 actions inline (1.381 linhas) | Alto | Médio |
| 3 | Três definições conflitantes de "é mobile?" — uma delas porteira de assinatura | **Alto — bug latente** | Baixo |
| 4 | `+layout.svelte` com 7 responsabilidades (1.146 linhas) | Médio-alto | Médio |
| 5 | Array dos 5 status "escala assinada" repetido 4× | Médio | Baixo |
| 6 | 7 páginas grandes sem `_components/` | Médio | Médio |
| 7 | 6 imports atravessando fronteira de rota | Médio | Baixo |
| 8 | `gise/+page.svelte`: ~250 linhas de texto de diálogo no componente | Médio | Médio |
| 9 | `getSavedFilters` vazando pelo barrel de composables | Baixo | Baixo |
| 10 | Zero testes de componente | Estrutural | — |

---

## 1. Tabela desktop × cards mobile: a duplicação mais cara do projeto

Seis telas de listagem renderizam **o mesmo conjunto de dados duas vezes**, em dois blocos de
markup independentes, trocados por breakpoint:

| Tela | Tabela desktop | Cards mobile | Duplicado / total |
|------|----------------|--------------|-------------------|
| `recebidos/+page.svelte` | 438–611 | 612–790 | ~352 / 790 (45%) |
| `auditoria/logs/+page.svelte` | 195–283 | 284–385 | ~190 / 409 (46%) |
| `auditoria/+page.svelte` | 383–542 | 543–700 | ~317 / 779 (41%) |
| `unidades/+page.svelte` | 367–489 | 490–570 | ~203 / 583 (35%) |
| `policiais/+page.svelte` | 374–433 | 434–500 | ~126 / 502 (25%) |
| `painel/+page.svelte` | 608–732 | 733–800 | ~195 / 852 (23%) |

**~1.380 linhas**, cerca de 35% do markup dessas páginas.

### O drift não é hipotético — já aconteceu

Em `recebidos/+page.svelte`, comparando as duas cópias do mesmo dado:

- a coluna de estado de leitura chama-se **"Visto"** na tabela e **"Lida"** no card;
- o `title` do botão de exclusão é **"Excluir"** no desktop e **"Excluir Escala?"** no mobile;
- o tooltip do download com manifesto foi enriquecido só de um lado:
  - desktop: `"PDF com folha de auditoria (evidências da assinatura: CPF, IP, GPS, selfie)"`
  - mobile: `"PDF com folha de auditoria (evidências da assinatura)"`

Alguém melhorou o texto, melhorou **uma** das duas cópias, e a outra ficou para trás. É exatamente
a forma de bug catalogada no `CLAUDE.md` §"Duplicação: extrair antes de comentar" — lógica copiada,
uma cópia consertada, as outras não.

O risco real não é o rótulo divergente: é a **próxima coluna**. Quando um campo novo entrar na
tabela e não no card, usuários de celular simplesmente não verão o dado, e nada falha.

### Recomendação

Extrair um componente de listagem responsiva que receba a definição de colunas **uma vez** e
decida a forma de apresentação:

```
$lib/components/ListaResponsiva.svelte
  props: { itens, colunas: ColunaDef[], acoes?: Snippet, chave: (item) => string }
```

com `ColunaDef = { rotulo, valor: Snippet<[T]>, mobile?: 'titulo' | 'corpo' | 'oculto' }`.

O `mobile` é o que evita a armadilha clássica dessa extração: card e tabela **não** querem os
mesmos campos com o mesmo peso, e forçar equivalência produziria um card ruim. A definição fica
única; a ênfase por meio continua declarável.

**Ressalva honesta:** esta é a maior refatoração da lista e a que mais pode dar errado. As seis
telas têm ações por linha bem diferentes (menus de exportação, toggles otimistas, dropdowns).
Sugiro fazer **uma tela primeiro** — `policiais` (a menor, 126 linhas duplicadas) — validar a API do
componente no uso real, e só então propagar. Se ao final da primeira a API tiver ficado pior que a
duplicação, o `CLAUDE.md` já prevê a saída certa: registrar a decisão no código e parar.
Antes de começar, note que estas telas não têm teste de componente (achado #10) — o gate de
regressão aqui é o Playwright, então confira quais specs cobrem cada tela.

---

## 2. `escalas/[id]/+page.server.ts` — o padrão certo existe na rota irmã

Duas rotas de detalhe, mesma natureza, organizações opostas:

| | `gise/[id]/` | `escalas/[id]/` |
|---|---|---|
| `+page.server.ts` | **278 linhas** | **1.381 linhas** |
| `_actions/` | 1.939 linhas em 6 arquivos | 85 linhas em 1 arquivo (`desfecho.ts`) |
| actions | distribuídas por domínio | **14 inline** |

As 14 actions inline (`+page.server.ts:519–1581`) já se agrupam sozinhas:

- **servidores** — `adicionar`, `adicionarTodos`, `remover`, `removerTodos`, `removerSelecionados`
- **plantões** — `adicionarPlantao`, `editar`, `editarPlantaoAgrupado`, `editarDiasEscala`,
  `repetir`, `gerarProximoMes`
- **ciclo de vida** — `finalizar`, `desfinalizar`, `reenviarEmail`

Isso é o mesmo recorte que `gise/[id]/_actions/` já usa (`actions-equipe`, `actions-membros`,
`actions-seccional`, `actions-escala`, `actions-unidade`).

**Nota importante:** a rota de escalas **já tem** o preâmbulo extraído — `carregarEscalaComPermissao`
faz o que `carregarGiseEditavel` faz do lado GISE. Ou seja, o risco de segurança que a
duplicação de preâmbulo causou na GISE (FLW-GISE-004/006/007, documentado em `_actions/shared.ts`)
**não** se repete aqui. O que falta é apenas o corte em arquivos.

Isso torna a refatoração quase mecânica — mover blocos, ajustar imports — e é por isso que ela vale
a pena mesmo sendo grande: 1.381 linhas num arquivo é o tipo de coisa que faz alguém adicionar a
15ª action no lugar errado por não ter lido as 14 anteriores.

**Recomendação:** espelhar a estrutura da GISE. Manter `load` e `carregarEscalaComPermissao` no
`+page.server.ts`; mover os três grupos para `_actions/actions-servidores.ts`,
`_actions/actions-plantoes.ts`, `_actions/actions-ciclo.ts`. Existe `_actions/__tests__/` com 2
testes — eles ancoram a mudança.

---

## 3. Três definições de "é mobile?" — e uma delas decide se o usuário pode assinar

Este é o achado que eu trataria **primeiro**: é o de menor esforço e o único com bug latente.

A mesma pergunta conceitual tem três respostas diferentes no código:

| Local | Definição | Fallback SSR |
|-------|-----------|--------------|
| `$lib/composables/useMobile.svelte.ts:12` | `UA_MOBILE \|\| (max-width:768px && touch)` | `false` |
| `$lib/composables/useGiseEstado.svelte.ts:82` | `!(min-width:768px)` | `false` (→ isMobile `true`) |
| `src/routes/gise/+page.svelte:127` | `min-width:768px` | **`true`** (→ isMobile `false`) |

Dois problemas independentes:

**a) Sobreposição exata em 768px.** `max-width:768px` casa com viewport ≤ 768; `min-width:768px`
casa com ≥ 768. Numa viewport de **exatamente 768px** (iPad em retrato, entre outros), o dispositivo
é simultaneamente "mobile" por `useMobile` e "desktop" por `useGiseEstado`. O breakpoint correto
seria `max-width: 767.98px` de um lado, ou `min-width` dos dois lados.

**b) Fallbacks de SSR opostos.** `gise/+page.svelte` assume desktop na primeira renderização;
`useGiseEstado` assume mobile. As duas telas do mesmo módulo discordam sobre o que mostrar antes da
hidratação.

### Por que isso é grave: as três decidem fluxo, não só layout

Não é uma questão de largura de coluna:

- `escalas/+page.svelte:404` — `assinaturaTelaBloqueada = restringirSmartphone && !isMobile`.
  Esta é a **porteira da política de assinatura**: quando o Admin Geral liga "restringir a
  smartphone" em `/conf-ass`, é este booleano que recusa a assinatura na tela. Um tablet em 768px
  classificado como desktop por uma definição e mobile por outra é uma recusa (ou uma liberação)
  que depende de qual arquivo perguntou.
- `gise/+page.svelte:187,201` — `isDesktop` escolhe entre **assinar direto com token SERPRO** e
  **abrir o modal de rubrica**. Dois fluxos de assinatura materialmente distintos.
- `PainelAssinaturaDigital.svelte:346,380` — alterna blocos da UI de assinatura.

Considerando que o `conf-ass/+page.svelte` documenta que a política em tela "muda o valor
probatório de documento futuro", ter a classificação do dispositivo dependendo de qual dos três
predicados foi consultado é uma inconsistência que merece correção antes de qualquer
embelezamento estrutural.

### Recomendação

1. Eleger `useMobile()` como **única** fonte — é a mais completa (UA + viewport + touch).
2. Corrigir o limite para `max-width: 767.98px`, eliminando a sobreposição.
3. Substituir os dois `new MediaQuery` crus (`useGiseEstado:82`, `gise/+page.svelte:127`) por ele.
4. Fixar **um** fallback de SSR e documentar o porquê no cabeçalho do composable.
5. Considerar uma regra de lint proibindo `new MediaQuery` fora de `$lib/composables/`.

Verificar em seguida se algum teste Playwright fixa viewport em exatamente 768px — se fixa, ele
está hoje testando um estado ambíguo.

---

## 4. `+layout.svelte` (1.146 linhas): sete responsabilidades num arquivo

O cabeçalho do arquivo é excelente e explica bem as regras de visibilidade. O problema é volume e
mistura. O arquivo hoje contém:

1. barra de progresso de navegação (`onNavigate` + view transitions, 499–507)
2. banner de "nova versão disponível" (509–523)
3. overlay global de carregamento (528)
4. provedor de Toast com ~35 linhas de estilo inline (538–572)
5. barra do topo + alternância de acesso ADM↔usuário (585–626)
6. **gaveta de navegação inteira** — 2 níveis de menu, 4 snippets, regras de visibilidade
   cruzando papel × módulo (628–~1000)
7. diálogo de confirmação de logout + limpeza de `localStorage` (233–263)

Só a lógica do menu — `filhosExtra`, `showGrupo1/2`, `naRotaExtra`, `nivelMenu`, `irParaNivel`,
`CLASSE_ITEM/ACESO/APAGADO` e os 4 snippets — passa de 300 linhas.

### Recomendação

- `$lib/components/navegacao/SidebarNavegacao.svelte` — a gaveta, seus snippets e as constantes de
  classe;
- `$lib/components/navegacao/menu-modelo.ts` — as derivações de visibilidade (`showGise`,
  `showIndicadores`, `filhosExtra`, …) como **funções puras** de
  `(usuario, flags, pathname, searchParams) → ItemMenu[]`;
- `$lib/components/navegacao/BarraTopo.svelte` — topo + alternância de acesso;
- `$lib/components/ToastProvider.svelte` — o provedor estilizado.

O ganho maior é o `menu-modelo.ts`: hoje as regras de quem-vê-o-quê estão dentro de um componente e
por isso **não têm teste** (ver #10). Como funções puras, viram os testes unitários mais baratos e
mais valiosos do projeto — "admin_unidade supervisor vê Produtividade mas não Dados base" é uma
asserção de duas linhas.

O `CLAUDE.md` é enfático em que esconder item de menu **não é autorização**, e isso continua
verdadeiro. Justamente por isso essas regras são seguras de extrair e testar: são apresentação, e
o gate real fica nos `load`.

---

## 5. Constante de status repetida quatro vezes

O conjunto de status que significa "a escala GISE já foi assinada e seguiu adiante" aparece
literalmente em quatro lugares:

```
'em_andamento', 'aguardando_relatorios', 'aguardando_assinatura_relat',
'pronta_para_finalizar', 'finalizada'
```

- `src/routes/gise/+page.svelte:242` (dentro de `clicarAssEscala`)
- `src/routes/gise/+page.svelte:319` (dentro de `handleEscalaPdf`) — **duas vezes no mesmo arquivo**
- `src/routes/gise/_components/CardGiseAtiva.svelte:68`
- `src/routes/gise/[id]/_actions/actions-escala.ts:428` (validação de reabertura, no **servidor**)

Duas das quatro cópias vêm acompanhadas de comentário explicando a regra — o padrão que o
`CLAUDE.md` descreve como o pior caso ("a cópia correta vinha acompanhada de um comentário
explicando a armadilha — que não protegeu ninguém").

A quarta cópia é a mais séria: é a lista que autoriza **reabrir** uma escala no servidor. Um status
novo no ciclo de vida precisa hoje ser lembrado em quatro pontos, um deles com efeito de
autorização.

### Recomendação

`src/lib/gise/formatters.ts` já é a casa dos mapas de status (`STATUS_LABELS`, `STATUS_COLORS`,
`STATUS_STRIPS`) e já é importado por essas telas. Adicionar ali:

```ts
/** Status a partir dos quais a escala JÁ foi assinada — todos os posteriores contam. */
export const STATUS_ESCALA_ASSINADA = [
  'em_andamento', 'aguardando_relatorios', 'aguardando_assinatura_relat',
  'pronta_para_finalizar', 'finalizada'
] as const;

export function escalaJaAssinada(status: string): boolean {
  return (STATUS_ESCALA_ASSINADA as readonly string[]).includes(status);
}
```

Se o import de `$lib/gise/formatters` no servidor for indesejável, o par natural é
`src/lib/db/gise/escalas-status.ts`, que já documenta a máquina de estados inteira — e seria o lugar
mais correto conceitualmente.

---

## 6. Sete páginas grandes sem `_components/`

O `CLAUDE.md` estabelece que peça auxiliar de rota mora em `_components/`. A regra é seguida onde
foi aplicada (`escalas/[id]` tem 15, `gise/[id]` tem 14), mas sete rotas passaram do ponto sem
nenhuma extração:

| Rota | Linhas | Blocos candidatos já delimitados por comentário |
|------|--------|--------------------------------------------------|
| `painel/` | 852 | Cards de resumo (414) · Filtros (453) · Banner ignorados (517) · Tabela (564) |
| `recebidos/` | 790 | Filtros rápidos (334) · Tabela (421) |
| `validar/[hash]/` | 726 | 7 seções de veredito: integridade, cadeia, RSA, carimbo, política, revogação, selo |
| `res-gise/relatorio/[giseId]/` | 520 | banner de rascunho · navegação de etapas · rodapé |
| `conf-ass/` | 421 | Sempre ativos (147) · Obrigatórios (166) · Reforços (185) |
| `auditoria/logs/` | 409 | KPIs (88) · Filtros (96) · Tabela (193) |
| `alterar-senha/` | 301 | — |

O caso mais claro é **`validar/[hash]`**: sete seções de veredito com estrutura idêntica
(ícone + título + status + detalhe), variando só o conteúdo. Um `<CardVeredito>` reduziria as 726
linhas substancialmente e — mais importante — garantiria que um oitavo item de verificação nasça
com a mesma apresentação dos outros sete. É a tela **pública**, a que o cidadão usa para conferir
um documento assinado; consistência ali é institucional, não estética.

`conf-ass/` é o segundo mais fácil: os três grupos de requisito têm a mesma forma de linha
(rótulo + descrição + estado/toggle), e o próprio cabeçalho documenta que distinguir os três grupos
é o ponto da tela.

---

## 7. Seis imports atravessando fronteira de rota

```
src/routes/gise/+page.svelte:30          → './[id]/_components/modais/ModalRubrica.svelte'
src/routes/gise/[id]/+page.svelte:70     → '../_components/ModalDownloadExtras.svelte'
src/routes/res-gise/relatorio/[giseId]/+page.svelte:45 → '../../_components/RelatorioProdutividade.svelte'
src/routes/auditoria/logs/+page.svelte:19–21 → '../_components/{KpiCard,ChipNivel,parse-json}'
```

O `_` de `_components` mantém o arquivo fora do roteador; a pasta é o que declara "isto é peça
**desta** rota". Quando outra rota importa de lá, a pasta deixa de significar isso.

O pior é o primeiro: `gise/+page.svelte` (a listagem) alcança **três níveis para dentro** da rota
de detalhe, em `[id]/_components/modais/`. O `[id]` é privado por natureza — é a rota de um item
específico. A regra do próprio projeto é explícita: "Componente usado por DUAS rotas sobe para
`$lib/components/`."

**Recomendação, por caso:**

- `ModalRubrica` → `$lib/components/` (duas rotas, uma delas alcançando para dentro de `[id]`) —
  **prioridade**, e a mais fácil de todas as recomendações deste documento;
- `ModalDownloadExtras` → `$lib/components/` (pai e filho);
- `RelatorioProdutividade` (709 linhas) → `$lib/components/` ou `$lib/gise/`; é o componente que o
  wizard e o editor compartilham, e o cabeçalho do wizard já diz que as perguntas "continuam sendo
  do `RelatorioProdutividade`";
- `auditoria/` → `auditoria/logs/` — pai/filho direto. Defensável; se ficar, vale uma linha no
  cabeçalho de `auditoria/_components/` dizendo que a sub-rota `logs` também consome, para que
  ninguém os trate como privados ao editar.

---

## 8. `gise/+page.svelte`: ~250 linhas de texto de diálogo dentro do componente

Entre as linhas 225 e ~470, quatro funções (`clicarAssEscala`, `clicarAssExtra`, `handleEscalaPdf`,
`handleExtraPdf`) montam objetos `dialogInfo` — título, linhas de texto, botões — para cada
combinação de status e papel. É praticamente todo o conteúdo redacional da tela, embutido na
lógica.

Dentro disso há uma duplicação interna clara: o diálogo "download com/sem manifesto" é construído
**duas vezes quase idêntico**, em `handleEscalaPdf` (318–375) e `handleExtraPdf` (377–460),
diferindo só na URL e no substantivo ("Esta escala" / "Este relatório de serviço extraordinário").
Ambos repetem a mesma ramificação de `podeManifestoProvavel` e a mesma `acaoSecundaria`.

Some-se a isso que esta tela também orquestra assinatura **inline** (importa
`executarFluxoAssinaturaToken`, `conectarSerpro`, `ModalRubrica`, `PainelAssinaturaToken`
diretamente), enquanto existem `useAssinaturaEscala` e `useGiseAssinatura` fazendo exatamente esse
trabalho para outras telas.

### Recomendação

- extrair as mensagens para `src/lib/gise/mensagens-assinatura.ts` como funções puras
  `(escala, permissoes) → DialogInfo` — testáveis, e o texto deixa de estar espalhado por
  ramificações de `if`;
- unificar o diálogo de manifesto numa função só, parametrizada por
  `{ substantivo, urlBase, podeManifesto }`;
- avaliar mover a orquestração de assinatura para `useGiseAssinatura` (já usado por `gise/[id]`).
  **Ressalva:** confirmar antes se a listagem precisa mesmo de tudo que o composable oferece —
  se exigir muitos parâmetros novos só para servir à lista, o `CLAUDE.md` prevê registrar a decisão
  em vez de forçar a extração.

Vale notar que o comentário na linha 202 registra um bug já corrigido nesse trecho ("antes ligava um
flag de modal que nenhum template consumia, então o clique não fazia nada") — sintoma de que a
orquestração inline aqui já custou caro uma vez.

---

## 9. `getSavedFilters` vazando pelo barrel de composables

`src/lib/composables/index.ts:2`:

```ts
export { getSavedFilters } from '$lib/utils/localStorage';
```

Cinco telas (`escalas`, `policiais`, `painel`, `recebidos`, `unidades`) importam essa função de
`$lib/composables` — não de `$lib/utils/localStorage`, onde ela mora.

Isso reintroduz em miniatura exatamente o problema que o projeto removeu do `$lib/utils`: o
`CLAUDE.md` §"`$lib/utils/` não tem barrel" explica que o barrel foi desmontado porque o call site
deixava de dizer de qual assunto a função veio. Aqui o call site diz algo **errado** — sugere que
`getSavedFilters` é um composable de estado reativo, quando é um leitor síncrono de `localStorage`.

**Recomendação:** remover a linha 2 do barrel e apontar os 5 call sites para
`$lib/utils/localStorage`. É uma mudança de cinco linhas, sem risco.

---

## 10. Zero testes de componente (observação estrutural)

```
*.test.ts em src/          126
*.svelte.test.ts             0
e2e/*.spec.ts               36
```

A cobertura de lógica pura é boa e bem distribuída (24 testes em `server/assinatura`, 16 em `db`).
Mas nenhum componente Svelte tem teste: todo comportamento de UI é verificado só por Playwright.

Não estou sugerindo perseguir cobertura de componente — para muitas destas telas o e2e é o teste
certo, e a suíte existe e é levada a sério. O ponto é outro, e conecta com todo o resto deste
documento:

**cada extração recomendada aqui converte markup não-testável em TS testável.** As regras de
visibilidade do menu (#4), as mensagens de diálogo (#8), o predicado de status (#5) e o predicado de
mobile (#3) são todas lógica pura hoje presa dentro de componentes. Extraí-las não é só organização
— é o que as torna alcançáveis por `vitest`, que roda em segundos, contra um Playwright que exige
subir o servidor.

Sugiro tratar isso como **critério de escolha** ao priorizar: entre duas extrações de custo
parecido, prefira a que libera lógica para teste unitário.

---

## O que eu NÃO recomendaria mexer

Para calibrar as recomendações acima, vale registrar o que examinei e concluí estar certo:

- **`Paginador` × `PaginationControls`** — parece duplicação pelo nome, não é: `PaginationControls`
  compõe `Paginador` e acrescenta contador + scroll ao topo. Os dois cabeçalhos já explicam a
  divisão e dizem "não unificar os dois". Estão certos.
- **`_actions/shared.ts` da GISE** — é o melhor arquivo de arquitetura do repositório. Documenta
  três bugs de autorização reais (FLW-GISE-004/006/007) explicando *o que a duplicação escondia*.
  Deve servir de modelo para o item #2, não de alvo.
- **`$lib/utils/` sem barrel** — decisão deliberada e documentada. Manter (e é por isso que #9 é um
  achado).
- **Cabeçalhos de módulo em geral** — a qualidade está bem acima da média. Explicam decisão e
  consequência, não sintaxe. Nas extrações, **mover o cabeçalho junto com o código** que ele
  descreve; um cabeçalho que fica órfão no arquivo antigo é pior que nenhum.
- **`ConfigurarFormulario.svelte` (978 linhas)** — o maior componente do projeto, mas é um editor
  recursivo de árvore de perguntas: o snippet `renderItem` (262–890) chama a si mesmo, e quebrá-lo
  em arquivos dispersaria a recursão. Há um refinamento possível — os painéis independentes por
  tipo de pergunta (gráfico/formas em 470, indicador/meta em 552, sub-textos em 748, listas em 391)
  poderiam ser componentes próprios recebendo a pergunta por `$bindable` — mas isso é opcional e de
  retorno bem menor que os itens 1 a 9. Não priorizaria.

---

## Sequência sugerida

**Rodada 1 — barato e alto retorno** (~1 dia)
1. Unificar o predicado de mobile e corrigir o breakpoint 768px (#3) — *comece por aqui: é o único
   com bug latente, e ele toca a porteira de assinatura*
2. Subir `ModalRubrica` e `ModalDownloadExtras` para `$lib/components/` (#7)
3. Extrair `STATUS_ESCALA_ASSINADA` para os 4 call sites (#5)
4. Remover `getSavedFilters` do barrel de composables (#9)

**Rodada 2 — estrutural, sem mudar comportamento** (~3–5 dias)
5. Fatiar `escalas/[id]/+page.server.ts` em `_actions/` espelhando a GISE (#2)
6. Extrair `menu-modelo.ts` + `SidebarNavegacao.svelte` do layout, **com testes** das regras de
   visibilidade (#4)
7. `CardVeredito` em `validar/[hash]` e seções de `conf-ass/` (#6)

**Rodada 3 — a grande** (avaliar depois das duas primeiras)
8. `ListaResponsiva` — piloto em `policiais/`, decisão de propagar depois de ver a API no uso
   real (#1)
9. Mensagens de diálogo da GISE para módulo próprio (#8)

Cada rodada é independente e deixa o repositório em estado consistente. As rodadas 1 e 2 não
mudam comportamento observável — o gate é a suíte existente passando sem alteração.

---

## Método e limites desta revisão

- Revisão **estrutural e por leitura**. Li integralmente `+layout.svelte`, `Paginador`,
  `PaginationControls`, `_actions/shared.ts`, `useMobile`, os cabeçalhos de todas as páginas
  citadas, e por amostragem os trechos referenciados por linha.
- **Não executei** `npm test`, `lint`, `knip` nem `docs:inventario` — `node_modules` não está
  instalado neste ambiente. Vale rodar `npm run knip` antes da rodada 2: ele pode revelar
  componentes órfãos que mudariam a prioridade de alguns itens.
- Foco em **componentização e manutenibilidade**, conforme pedido. Não é uma revisão de segurança
  (existe `guard:autorizacao` no CI para isso) nem de performance. O item #3 aparece aqui porque a
  inconsistência de predicado é um problema de duplicação — mas a consequência dele é de
  comportamento, e é por isso que está no topo da lista.
- Todos os números de linha referem-se ao estado de `main` em 2026-08-13.
