# Diretrizes para este Projeto

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
