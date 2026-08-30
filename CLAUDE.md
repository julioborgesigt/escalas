# Diretrizes para este Projeto

## Mapa da documentação

O índice completo está em [`docs/README.md`](docs/README.md). Referências rápidas:

- [`README.md`](README.md) — setup, arquitetura, módulos, padrões de código
- [`DEPLOY.md`](DEPLOY.md) — runbook de produção (envs/secrets, papéis de admin, backup/rollback, go-live)
- [`.env.example`](.env.example) — fonte autoritativa de variáveis de ambiente
- [`TESTING.md`](TESTING.md) — roteiro manual de exceção (o gate de regressão é a suíte Vitest + Playwright)
- [`docs/HISTORICO.md`](docs/HISTORICO.md) — catálogo dos **registros históricos** (auditorias/decisões arquivadas, removidas do working tree mas preservadas no Git; achados A1–A8, I-1…I-4, M-3/M-4, R2-1…R2-4, B-1…B-6 citados em comentários do código vêm daí)

Documentos vivos (README/DEPLOY/TESTING) devem ser atualizados **no mesmo PR** que mudar o comportamento correspondente.

## Sigla de achado precisa ter onde ser lida

Auditoria encerrada sai do working tree e vira linha do
[`docs/HISTORICO.md`](docs/HISTORICO.md), com o `git show` que a recupera. Isso
só funciona enquanto o catálogo souber de TODAS as siglas que o código cita —
senão `// FLW-RBAC-003` vira ponteiro que promete rastreabilidade e não entrega:
quem procura no catálogo não acha e conclui que a regra ao lado é folclore.

Foi o que a varredura de ago/2026 encontrou. O catálogo descrevia a auditoria de
fluxos como "achados FLW-AUT-001…020"; o documento define **doze** famílias, e
130 referências apontavam para as onze não nomeadas. Verificado no CI por
`npm run guard:achados`.

Duas saídas quando ele reprova, e a escolha é sobre o que é VERDADE:

1. a auditoria de origem existe → **nomeie a família** na linha dela no catálogo;
2. o relatório nunca foi commitado → **declare em `SEM_DOCUMENTO`**, com o
   arquivo onde a sigla vive. É o caso de `M-6`, `M-8`, `M-10` e `I-6`: `git log -S`
   não acha commit que as tenha introduzido, então o comentário ao lado delas é
   o registro inteiro. Declarar é o ponto — a diferença entre "órfã e ninguém
   sabe" e "órfã, sabemos, e está escrito" não está no código.

O guard tem um limite conhecido: famílias de UMA letra (`M-1`, `B-2`, `I-3`)
ficam de fora, porque `includes('M')` casa com qualquer parágrafo do catálogo.
Elas foram conferidas à mão uma vez; o script diz isso no cabeçalho.

## Svelte 5 e SvelteKit — Documentação Oficial

Antes de implementar qualquer solução envolvendo Svelte ou SvelteKit, **consulte a documentação oficial mais recente**:

- Svelte 5: https://svelte.dev/docs/svelte/overview
- SvelteKit: https://svelte.dev/docs/kit/introduction

## Padrões Obrigatórios

Padrões visuais (cores, tipografia, modais, botões, z-index, tabelas) vivem no
[`README.md`](README.md) §10 — não reinventar tokens nem classes à mão.
Verificado no CI por `npm run guard:visual`.

## Cor de botão é decisão de TEMA, não de call site

O preset preenchido do Skeleton é duas linhas: `background-color:
var(--color-X-500)` e `color: var(--color-X-contrast-500)`. Nenhum componente
escolhe a cor do texto — ela sai inteira do token. Foi por isso que a varredura
de ago/2026 achou 185 botões com texto escuro contra 53 com branco **sem um
único call site culpado**: o `theme.css` apontava quatro canais para
`contrast-dark` e três para `contrast-light`, e os dois grupos se encostavam na
mesma célula de tabela.

Hoje os sete canais usam branco, com o próprio `--color-X-500` descido ao tom
acessível (a tabela medida está no README §10). **As duas metades são
inseparáveis** — trocar o token de texto sem descer a cor devolve 2,63:1 no
botão mais usado do app.

**E a descida vai no TOKEN, não no preset.** A primeira tentativa escureceu só o
fundo de `preset-filled-*` no `app.css`, para "não mexer em quem usa a cor sem
ser botão". O resultado foi o oposto: os 109 `bg-primary-500` de chip, aba e
paginação ficaram claros ao lado de botões escuros, e a tela passou a ter dois
azuis — quem viu foi o dono do produto, não o guard. A lição tem forma própria:
**escurecer no preset esconde a decisão de todo mundo que usa a cor sem ser
botão.** Se o tom da cor mudou, ele mudou para todos os usos dela, e o lugar
disso é a rampa. A exceção é `surface`, e ela está registrada no `app.css` com o
motivo — lá o `-500` é a borda de 74 outlined e o cinza de 51 textos.

Daí as três regras que o `guard:visual` mantém em ZERO, e o motivo de cada uma
ser sobre não recopiar a decisão:

1. **Cor de texto no botão** — 33 call sites tinham `text-white`, de quando o
   token dava preto. Quem "conserta" um botão no call site não conserta os
   outros 105. A regra cobre QUALQUER tom: a primeira versão dela listava só
   branco e preto, e por isso deixou passar o
   `preset-filled-warning-500 text-warning-950` do botão "Ass. Extra" — que
   seguiu com texto escuro por uma versão inteira depois de o token já ser
   branco. Um guard que só conhece o remendo que você já viu não é guard.
2. **Preset preenchido que não é `-500`** — `preset-filled-surface-100` não
   existe no Skeleton. Doze call sites o usavam e renderizavam com fundo
   transparente, sem erro, sem aviso; pareciam outlined de propósito por causa
   da `border` ao lado. É a mesma forma de bug dos "shades Tailwind
   inexistentes" da tabela de duplicação abaixo: classe que não gera CSS nenhum.
3. **`hover:preset-filled-*`** — gera uma classe PRÓPRIA, que escapa do
   escurecimento e volta ao `-500` claro.

A **altura** do botão tem a mesma forma e a mesma correção. Eram nove alturas em
uso, de 17 px a 56 px, sete delas na mesma tela — porque `.btn` do Skeleton só
embute `--spacing(1)` e cada call site completava com o `py-*` que quisesse. Hoje
são três degraus (`btn btn-sm` 32 px · `btn` 40 px · `btn btn-destaque` 48 px)
definidos por `min-height` no `app.css`, e `py-*`/`h-*`/`min-h-*` sobre `.btn`
reprova no CI.

Duas coisas se aprenderam medindo, e as duas contrariavam o palpite:
**`padding` não uniformiza altura** (com padding igual sobravam 29, 31 e 38 px,
vindos de `text-3xs`, de `border` e de um ícone mais alto que a linha — só
`min-height` é piso); e a regra tinha de ir em **`@layer utilities`**, não
`components`, porque o CSS do Skeleton mora em `utilities` e camada posterior
vence — em `components` ela não faria nada.

A lição é a mesma da seção de duplicação: **comentário protege quem lê aquele
arquivo; o token protege quem não sabe que o arquivo existe.** O guard existe
porque a régua central morre quando alguém a recopia à mão e a tela continua
certa — nesse dia a divergência não tem sintoma, só volta.

Uma verificação vale por três leituras aqui: `filter: brightness()` do hover
multiplica texto E fundo. Com texto escuro, clarear o fundo AUMENTA o contraste;
com texto branco ele desaba, porque o branco satura em 1.0 e o fundo continua
subindo. Medir o estado de repouso e parar ali teria deixado todos os botões em
~3,2:1 no hover — inclusive os três que já eram brancos antes.

Este projeto usa **Svelte 5** com runes. Sempre priorize:

- `$state()` — estado reativo (nunca `writable()` de stores)
- `$derived()` — valores derivados (nunca `$: valor = ...`)
- `$effect()` — efeitos colaterais (nunca `onMount` para lógica reativa)
- `$props()` — props de componente (nunca `export let`)
- Snippets (`{#snippet}` / `{@render}`) — em vez de slots
- `$bindable()` — para props com two-way binding

Para SvelteKit, prefira:

- Server Actions (`+page.server.ts` com `actions`) para mutações de formulário
- `load()` functions no servidor para carregamento de dados inicial
- `$page.data` para acessar dados carregados pelo servidor
- `invalidate()` / `invalidateAll()` para revalidar dados sem reload completo

## Erros de API — padrão obrigatório

**Sempre use `$lib/server/api` para respostas de erro.** Nunca escreva
`return json({ error: '...' }, { status })` à mão em rotas novas.

```ts
import {
	apiError,
	ErrorCode,
	badRequest,
	unauthorized,
	forbidden,
	notFound,
	conflict,
	rateLimited,
	serverError,
	requireAuth,
	requireAdmin,
	validateBody
} from '$lib/server/api';
```

Convenção de status × `ErrorCode`:

| Cenário                               | Helper / call                              | ErrorCode       |
| ------------------------------------- | ------------------------------------------ | --------------- |
| Body inválido / Zod                   | `badRequest('msg')` (auto)                 | `VALIDATION`    |
| Sem sessão / token expirado           | `unauthorized()`                           | `AUTH_REQUIRED` |
| Autenticado mas sem permissão         | `forbidden('msg')`                         | `FORBIDDEN`     |
| Token CSRF inválido                   | `apiError('...', 403, ErrorCode.CSRF)`     | `CSRF`          |
| Recurso inexistente                   | `notFound('Escala')`                       | `NOT_FOUND`     |
| Conflito de estado (ex.: já assinado) | `conflict('msg')`                          | `CONFLICT`      |
| Rate-limit ultrapassado               | `rateLimited()`                            | `RATE_LIMIT`    |
| Falha externa (e-mail/OCSP)           | `apiError('msg', 502, ErrorCode.UPSTREAM)` | `UPSTREAM`      |
| 5xx inesperado                        | `serverError('contexto', err)`             | `INTERNAL`      |

`serverError` automaticamente gera um `errorId` rastreável (8 hex chars)
e o devolve no body — o usuário pode reportar para o operador correlacionar
com Sentry/logs.

Nunca passe string livre como `errorType`. Se precisa de uma categoria
nova, adicione ao enum `ErrorCode` em `src/lib/server/api.ts`.

## Operação material precisa recusar alguém

Handler de mutação de API (`POST`/`PUT`/`PATCH`/`DELETE`) e form action são
**operações materiais**: mudam estado. Toda operação material precisa recusar
alguém no SERVIDOR — esconder o botão na tela não é autorização, o POST direto
tem de morrer no servidor. Verificado no CI por
`npm run guard:autorizacao`.

Não existe um `autorizar()` único, e isso é decisão registrada: a regra difere
por domínio de verdade (escala vai por lotação + solicitação; GISE por
participação, quadro ou vínculo de equipe; policial por escopo administrado).
Use o resolvedor do domínio — `verificarPermissaoEscala`,
`verificarPermissaoGise`, `resolverParticipacaoGisePolicial`,
`lotacoesAdministradas` — ou os helpers de `$lib/server/api`
(`requireAdmin`, `requireSuperAdmin`).

`requireAuth` sozinho **não** é autorização: prova que há sessão, não que
aquela sessão pode agir sobre aquele recurso. Se a operação lê um id de fora da
URL (corpo, `FormData`), confira que o recurso pertence ao escopo de quem
chamou — foi assim que membro de outra escala virava editável por ID
(FLW-ESC-002).

Operação que legitimamente não recusa ninguém (login, troca da própria senha,
webhook por segredo) vai declarada **com o motivo** em
`scripts/guard-autorizacao.mjs`. Declarar é o ponto: a diferença entre "público
de propósito" e "esqueceram o guard" não está no código.

## Onde colocar código novo em `src/lib/server/`

**Raiz = infra transversal. Subpasta = domínio.** A raiz de `server/` só
aceita o que é usado por vários domínios sem pertencer a nenhum: `api.ts`,
`schema.ts`, `logger.ts`, `sentry.ts`, `request-context.ts`, `csp.ts`,
`app-origin.ts`, `db-errors.ts`, `email.ts`, `r2-cleanup.ts`,
`policial-permissao.ts`, `edge-cache.ts`.

Todo o resto vai para o domínio correspondente — `assinatura/`, `auth/`,
`escalas/`, `gise/`, `export/`, `sync/`, `termo/` — junto com seu `__tests__/`.

Arquivo novo cujo nome só faz sentido com prefixo de domínio (`gise-*`,
`escala-*`, `pdf-*`) é sinal de que ele pertence a uma subpasta, não à raiz.
Até jul/2026 essa pasta era plana com 58 arquivos e cinco domínios
misturados; não a deixe voltar a ser.

## Arquivo auxiliar de rota vai em `_components/`

Componente, composable ou action que só serve a UMA rota mora em
`_components/` (ou `_actions/`) dentro dela — o `_` é o que mantém o
arquivo fora do roteador do SvelteKit, e a pasta é o que separa "a rota"
de "as peças da rota". Componente usado por DUAS rotas sobe para
`$lib/components/`; composable reutilizável sobe para `$lib/composables/`.

Composable de uma rota só fica junto dela, em `_components/` — é o caso de
`escalas/[id]/_components/useEdicaoInlineServidor.svelte.ts` e de
`res-gise/_components/useResGise.svelte.ts`.

**"Duas rotas" quer dizer duas rotas IRMÃS.** Quando as duas consumidoras são
uma rota e a sub-rota dela, o `_components/` do diretório que contém as duas já
é a pasta da FAMÍLIA, e a peça fica lá — subir para `$lib/components/` alegaria
alcance de app inteiro para algo que só aquele par usa. É o caso de
`auditoria/_components/`, consumido por `/auditoria` e por `/auditoria/logs`:
seis arquivos, 156 linhas, todos com o cabeçalho nomeando as DUAS telas — e
entre eles `consulta.ts`, que é config de query lida pelos dois
`+page.server.ts` e não caberia em `$lib/components/` de jeito nenhum. Mover
essa família fragmentaria 156 linhas coerentes em dois destinos para satisfazer
a contagem de rotas.

O que a família precisa é dizer isso no cabeçalho de cada arquivo, e é o que
protege: quem abre `KpiCard.svelte` lê "console de auditoria / logs técnicos" e
sabe que editar ali mexe em duas telas. Pasta de família SEM essa declaração é
armadilha — parece privada e não é.

Alcance de rota é outra coisa: peça de `res-gise/_components/` usada só por
`res-gise/relatorio/[giseId]/` estava alta demais, não baixa — ela DESCE para o
`_components/` da filha (foi o caso de `RelatorioProdutividade`, 709 linhas
moradas no pai e consumidas só pela sub-rota).

`src/routes/_components/` (na RAIZ das rotas) é a exceção deliberada: regra de
navegação que várias rotas consultam, em `.ts` puro e com teste. Hoje são
`menu-visibilidade.ts` (o que a sidebar mostra) e `bem-vindo-cards.ts` (os
quadros das telas de boas-vindas). **As duas respondem à mesma pergunta** — "o
que este usuário alcança daqui?" — e por isso saem do MESMO par de flags, com
`__tests__/bem-vindo-cards.test.ts` reprovando destino de menu sem quadro.
Quando eram listas independentes elas divergiram em silêncio: admin de unidade
e de seccional tinham Produtividade no menu e nenhum quadro, e o Admin Geral com
os dois módulos ligados via 7 destinos contra 4 quadros. Item novo na navegação
entra nos dois arquivos.

## `$lib/utils/` não tem barrel

Importe o MÓDULO, não a pasta: `$lib/utils/datas` (datas e calendário),
`$lib/utils/formato` (máscaras de entrada), `$lib/utils/pii` (mascaramento
para exibição), `$lib/utils/download`, `$lib/utils/localStorage`.

Não existe `$lib/utils` — até jul/2026 era um `utils.ts` de 24 exports ao
lado da pasta `utils/`, então `$lib/utils` e `$lib/utils/download` pareciam
o mesmo módulo e não eram. Não recrie o barrel: o ganho aqui é o call site
dizer de qual assunto a função veio.

`$lib/db` é a exceção deliberada, e está documentada no próprio `lib/db.ts`.

## Onde colocar teste novo

**Todo `*.test.ts` mora numa pasta `__tests__/` junto do código testado** —
`src/lib/gise/x.ts` é testado por `src/lib/gise/__tests__/x.test.ts`. Nunca
colocado ao lado do fonte. Verificado no CI (`deploy.yml`, guard "convenção
de testes").

Fixture lida por caminho (`import.meta.url`) fica em `__tests__/fixtures/` e
acompanha o teste que a consome quando ele se mover.

Teste de ponta a ponta é outra história: vai em `e2e/`, com Playwright.

**Componente `.svelte` não tem teste unitário, e é decisão.** O vitest roda em
`environment: 'node'`, sem DOM; quem exercita componente é o Playwright, com
browser de verdade — que é o único lugar onde `inert`, foco, view transition e
media query se comportam como em produção. Ligar render em jsdom custaria um
segundo projeto vitest mais testing-library para cobrir o que o E2E já cobre.

A consequência prática é a regra: **se uma regra precisa de teste, ela sai do
`.svelte` para um `.ts` puro** — foi o que aconteceu com `menu-visibilidade.ts`
(quem vê cada item do menu), `bem-vindo-cards.ts`, `status-escala.ts` (a escala
GISE já foi assinada?) e `mensagens-download.ts` (o texto dos diálogos de
download). Precisar montar componente para testar algo é o sinal de que esse
algo está no arquivo errado.

## Fetch no cliente — padrão obrigatório

**Sempre use `$lib/api-fetch` para chamar a API interna do cliente.**
Nunca escreva `fetch()` cru com `csrfHeaders()` + parse de erro à mão em
componentes novos.

- `apiFetch<T>(url, init?)` — APIs JSON: injeta CSRF, faz parse e lança
  `Error` com a mensagem do servidor (incluindo o `errorId` rastreável).
  Preserva `AbortError`, então funciona com `AbortSignal` de buscas.
- `apiFetchResponse(url, init?)` — downloads/blob: mesmo tratamento de
  erro, mas devolve a `Response` crua no sucesso.
- Download de blob no navegador: use `baixarBlob(blob, nome)` e
  `nomeArquivoContentDisposition(header, fallback)` de
  `$lib/utils/download` — nunca monte âncora + `createObjectURL` à mão
  (os call sites antigos esqueciam o `revokeObjectURL`).
- Fluxo preparar → assinar → finalizar de assinatura com certificado:
  use `executarFluxoAssinaturaToken` de `$lib/assinatura-token`.
- Busca de UI com debounce + cancelamento: use `useBuscaDebounce` de
  `$lib/composables` (é o motor do `SearchableSelect`).

`fetch` cru só se justifica em: POST de form action do SvelteKit (body
`FormData`).

## Duplicação: extrair antes de comentar

**Achou a mesma lógica em dois lugares? Extraia — não comente as duas.**

Os bugs corrigidos em jul/2026 têm todos a mesma forma: lógica copiada, uma
cópia consertada, as outras não. E na maioria a cópia CORRETA vinha acompanhada
de um comentário explicando a armadilha — que não protegeu ninguém:

| bug                                    | o que a duplicação escondia                                  |
| -------------------------------------- | ------------------------------------------------------------ |
| `message.includes('UNIQUE')` (4 sites) | violação de unique virava 500 com SQL cru, não 409           |
| `getField('serialNumber')`             | CPF vazio no `/validar` para e-CPF sem `:CPF` no CN          |
| shades Tailwind inexistentes           | classes que não geravam CSS nenhum                           |
| slot removido sem as equipes           | membros invisíveis na tela e ativos no gate de presença      |
| `toISO` com duas convenções de mês     | data de um mês errado, sem erro nenhum                       |
| `hoje()` com `toISOString()` (2 sites) | calendário marcava AMANHÃ das 21h à meia-noite, em UTC-3     |
| laço "dias do intervalo" (3 sites)     | a mesma troca local↔UTC, latente em fuso positivo            |
| "restrito ao Admin Geral" (5 arquivos) | o gate era Super Admin; o comentário convidava a afrouxar    |
| portão de assinar escala (5 rotas)     | uma das cinco não recusava escala FDS                        |
| fallback de hora do plantão (3 sites)  | `'08:00'` numa tela, `'08'` (o default da coluna) nas outras |
| portão de assinar GISE (5 rotas)       | uma não checava status; quatro admitiam admin sem UI         |

As três primeiras linhas depois de `toISO` saíram da varredura de documentação —
foram achadas por LEITURA, não por teste, e duas delas quebravam em produção.

As duas últimas são de ago/2026 e repetem a forma: o portão de assinatura rodava
copiado em cinco `+server.ts`, e `finalizar-assinatura-avancada` era o único sem
o gate de FDS (FLW-AUT-012). Não havia buraco explorável — a preparação já
barrava pela intenção —, mas era a quinta cópia esperando que alguém removesse a
recusa do lugar que ainda a tinha. Hoje as cinco entram por
`carregarEscalaParaAssinatura`, e `HELPERS_OBRIGATORIOS` exige o nome do PORTÃO,
não o de `podeAssinarEscala`: é isso que impede a rota de remontar o gate à mão.

O portão GISE, extraído na mesma leva, mostrou por que a varredura mecânica não
substitui a leitura: as cinco rotas divergiam em DOIS eixos independentes, cada
um numa cópia diferente. `finalizar-assinatura` era a única sem a checagem de
status — fechado ao entrar no portão, sem custo, porque o `preparar` não mexe no
status e o próprio `finalizar` grava `em_andamento`, que está no conjunto
permitido. E **`preparar-assinatura` era a única que não admitia Admin Geral**,
o que contradizia o `finalizar-assinatura`, que admitia: como o `preparar`
emite a intenção que o `finalizar` consome, a permissão de admin no
`finalizar` era **inalcançável** — sintoma de que ela nunca deveria ter
existido. A extração não decidiu isso na hora: virou o parâmetro nomeado
`admitirAdmin: false`, com a contradição escrita no JSDoc, em vez de ser
"resolvida" por quem estava refatorando.

A decisão veio depois, e não do código — veio da UI. `SupervisaoDocEscala`
libera "Conferência" (baixar sem assinar) para `isSupervisor || isAdminGeral`,
mas os botões que assinam de verdade — "Token" (A3) e "Tela" (avançada) — só
aparecem para `isSupervisor`, e `mostrarPainelAssinaturaEscala` exige
`gise.supervisor_id === usuarioAtual.id`. Não existe caminho na interface para
um Admin Geral assinar a escala GISE. As quatro rotas que aceitavam
`u.tipo === 'admin'` liberavam por POST direto exatamente o que a tela nunca
ofereceu — o mesmo erro que "esconder o botão não é autorização" descreve
acima. As cinco rotas agora exigem o supervisor designado; o parâmetro
`admitirAdmin` saiu do portão.

A lição não é "extraia e resolva na hora". É que a extração torna a pergunta
FORMULÁVEL — enquanto eram cinco cópias, não havia o que comparar para notar a
contradição.

Comentário protege quem lê **aquele** arquivo. Extração protege quem não sabe
que o arquivo existe — que é justamente quem quebra o sistema. E comentário
errado sobre gate de permissão é pior que comentário nenhum: alguém "conserta a
inconsistência" na direção da frase.

Corolário prático: se a extração exigir tantos props que o componente comum
fique pior que a duplicação, **registre a decisão no código** em vez de
extrair (ver a grade dos três calendários e o barrel `lib/db.ts`).

Desde ago/2026 isso é verificado no CI por `npm run guard:duplicacao`: bloco de
10 linhas repetido entre arquivos reprova, a menos que já esteja em
`scripts/duplicacao-baseline.json`. A baseline existe porque **não há meta de
"0% duplicado"** — o corolário acima continua valendo, e as decisões de MANTER
moram lá, cada uma com o motivo no campo `nota`. Só duplicação NOVA reprova.

`--atualizar` regrava a baseline, e não é o jeito de fazer o guard passar:
regravar sem extrair troca um achado por uma linha de JSON, que é a versão
automatizada de "comentar em vez de extrair". O guard tem um limite conhecido —
bloco menor que 10 linhas relevantes é invisível para ele, e o portão de
assinatura GISE está nessa faixa. Ele reduz a classe do problema, não a elimina.

## Artefato com valor jurídico: golden antes de refatorar

PDF assinado, e-mail transacional e termo de presença são **documentos**, não
saída de função. Antes de tocar em qualquer um:

1. rode o harness (`pdf-goldens`, `email-templates`) e confirme verde;
2. refatore;
3. confirme que **não mudou um byte**.

`UPDATE_PDF_GOLDENS=1` / `UPDATE_EMAIL_GOLDENS=1` regravam os goldens — use
só quando a mudança visual for INTENCIONAL, e confira o arquivo gerado antes
de commitar. Regravar para "fazer o teste passar" altera silenciosamente um
documento que alguém já assinou.

## Documentação de código

A régua é `npm run docs:inventario`. Três alvos, nesta ordem de retorno:
**cabeçalho de módulo** → **contrato de export público** → comentário de ponto
em trecho opaco.

O cabeçalho vai no TOPO do arquivo, antes dos imports — cabeçalho no meio do
arquivo não é encontrado por quem o abre. Comentário explica DECISÃO
(regra da corporação, ordem obrigatória, armadilha de biblioteca,
consequência legal), nunca o que o código já diz.

**Densidade de comentário não é meta.** A régua serve para PRIORIZAR, não é
gate: um componente com 800 linhas de markup e 2% de comentário pode estar
correto — o que falta nele é o cabeçalho. Perseguir porcentagem produz ruído,
e `/** Busca a escala por id. */` é dívida: ocupa espaço, envelhece e não diz
nada que a assinatura já não diga.

Arquivo NOVO em `src/lib/db/` é verificado no CI (`npm run docs:guard`):
precisa de cabeçalho e de JSDoc nos exports.
