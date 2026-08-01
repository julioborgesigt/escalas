# Diretrizes para este Projeto

## Mapa da documentação

O índice completo está em [`docs/README.md`](docs/README.md). Referências rápidas:

- [`README.md`](README.md) — setup, arquitetura, módulos, padrões de código
- [`DEPLOY.md`](DEPLOY.md) — runbook de produção (envs/secrets, papéis de admin, backup/rollback, go-live)
- [`.env.example`](.env.example) — fonte autoritativa de variáveis de ambiente
- [`TESTING.md`](TESTING.md) — roteiro manual de exceção (o gate de regressão é a suíte Vitest + Playwright)
- [`docs/HISTORICO.md`](docs/HISTORICO.md) — catálogo dos **registros históricos** (auditorias/decisões arquivadas, removidas do working tree mas preservadas no Git; achados A1–A8, I-1…I-4, M-3/M-4, R2-1…R2-4, B-1…B-6 citados em comentários do código vêm daí)

Documentos vivos (README/DEPLOY/TESTING) devem ser atualizados **no mesmo PR** que mudar o comportamento correspondente.

## Svelte 5 e SvelteKit — Documentação Oficial

Antes de implementar qualquer solução envolvendo Svelte ou SvelteKit, **consulte a documentação oficial mais recente**:

- Svelte 5: https://svelte.dev/docs/svelte/overview
- SvelteKit: https://svelte.dev/docs/kit/introduction

## Padrões Obrigatórios

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

## Onde colocar código novo em `src/lib/server/`

**Raiz = infra transversal. Subpasta = domínio.** A raiz de `server/` só
aceita o que é usado por vários domínios sem pertencer a nenhum: `api.ts`,
`schema.ts`, `logger.ts`, `sentry.ts`, `request-context.ts`, `csp.ts`,
`app-origin.ts`, `db-errors.ts`, `email.ts`, `r2-cleanup.ts`,
`policial-permissao.ts`.

Todo o resto vai para o domínio correspondente — `assinatura/`, `auth/`,
`escalas/`, `gise/`, `export/`, `termo/` — junto com seu `__tests__/`.

Arquivo novo cujo nome só faz sentido com prefixo de domínio (`gise-*`,
`escala-*`, `pdf-*`) é sinal de que ele pertence a uma subpasta, não à raiz.
Até jul/2026 essa pasta era plana com 58 arquivos e cinco domínios
misturados; não a deixe voltar a ser.

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

| bug                                    | o que a duplicação escondia                               |
| -------------------------------------- | --------------------------------------------------------- |
| `message.includes('UNIQUE')` (4 sites) | violação de unique virava 500 com SQL cru, não 409        |
| `getField('serialNumber')`             | CPF vazio no `/validar` para e-CPF sem `:CPF` no CN       |
| shades Tailwind inexistentes           | classes que não geravam CSS nenhum                        |
| slot removido sem as equipes           | membros invisíveis na tela e ativos no gate de presença   |
| `toISO` com duas convenções de mês     | data de um mês errado, sem erro nenhum                    |
| `hoje()` com `toISOString()` (2 sites) | calendário marcava AMANHÃ das 21h à meia-noite, em UTC-3  |
| laço "dias do intervalo" (3 sites)     | a mesma troca local↔UTC, latente em fuso positivo         |
| "restrito ao Admin Geral" (5 arquivos) | o gate era Super Admin; o comentário convidava a afrouxar |

As três últimas linhas saíram da varredura de documentação — foram achadas por
LEITURA, não por teste, e duas delas quebravam em produção.

Comentário protege quem lê **aquele** arquivo. Extração protege quem não sabe
que o arquivo existe — que é justamente quem quebra o sistema. E comentário
errado sobre gate de permissão é pior que comentário nenhum: alguém "conserta a
inconsistência" na direção da frase.

Corolário prático: se a extração exigir tantos props que o componente comum
fique pior que a duplicação, **registre a decisão no código** em vez de
extrair (ver a grade dos três calendários e o barrel `lib/db.ts`).

## Artefato com valor jurídico: golden antes de refatorar

PDF assinado, e-mail transacional e termo de presença são **documentos**, não
saída de função. Antes de tocar em qualquer um:

1. rode o harness (`export-pdf-goldens`, `email-templates`) e confirme verde;
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
