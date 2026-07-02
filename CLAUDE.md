# Diretrizes para este Projeto

## Mapa da documentação

O índice completo está em [`docs/README.md`](docs/README.md). Referências rápidas:

- [`README.md`](README.md) — setup, arquitetura, módulos, padrões de código
- [`DEPLOY.md`](DEPLOY.md) — runbook de produção (envs/secrets, papéis de admin, backup/rollback, go-live)
- [`.env.example`](.env.example) — fonte autoritativa de variáveis de ambiente
- [`TESTING.md`](TESTING.md) — roteiro de regressão manual
- `docs/auditorias/` — **registros históricos** (não refletem o estado atual; achados A1–A8, I-1…I-4, M-3/M-4 citados em comentários do código vêm daí)

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
	badRequest, unauthorized, forbidden, notFound, conflict, rateLimited,
	serverError,
	requireAuth, requireAdmin, validateBody
} from '$lib/server/api';
```

Convenção de status × `ErrorCode`:

| Cenário                                | Helper / call                                         | ErrorCode        |
| -------------------------------------- | ----------------------------------------------------- | ---------------- |
| Body inválido / Zod                    | `badRequest('msg')` (auto)                            | `VALIDATION`     |
| Sem sessão / token expirado            | `unauthorized()`                                      | `AUTH_REQUIRED`  |
| Autenticado mas sem permissão          | `forbidden('msg')`                                    | `FORBIDDEN`      |
| Token CSRF inválido                    | `apiError('...', 403, ErrorCode.CSRF)`                | `CSRF`           |
| Recurso inexistente                    | `notFound('Escala')`                                  | `NOT_FOUND`      |
| Conflito de estado (ex.: já assinado)  | `conflict('msg')`                                     | `CONFLICT`       |
| Rate-limit ultrapassado                | `rateLimited()`                                       | `RATE_LIMIT`     |
| Falha externa (e-mail/OCSP)            | `apiError('msg', 502, ErrorCode.UPSTREAM)`            | `UPSTREAM`       |
| 5xx inesperado                         | `serverError('contexto', err)`                       | `INTERNAL`       |

`serverError` automaticamente gera um `errorId` rastreável (8 hex chars)
e o devolve no body — o usuário pode reportar para o operador correlacionar
com Sentry/logs.

Nunca passe string livre como `errorType`. Se precisa de uma categoria
nova, adicione ao enum `ErrorCode` em `src/lib/server/api.ts`.
