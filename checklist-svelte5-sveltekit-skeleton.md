# CHECKLIST — Verificação de Projeto SvelteKit + Svelte 5 + Skeleton + Cloudflare D1

> **Como usar**: percorra cada item na ordem. Marque `[x]` se ok, `[ ]` se pendente.
> Antes de iniciar, execute os passos preparatórios.

---

## PASSO 0 — PREPARAÇÃO

- [ ] Listar árvore de arquivos do projeto (excluindo `node_modules`, `.svelte-kit`, `build`)
- [ ] Ler `package.json` e anotar versões exatas:
  - Svelte: ___
  - SvelteKit: ___
  - Skeleton: ___ (v2 ou v3?)
  - Adapter: ___
- [ ] Ler `wrangler.toml` e confirmar bindings declarados
- [ ] Identificar se o projeto usa TypeScript ou JavaScript

---

## ETAPA 1 — SVELTE 5: RUNES E SINTAXE MODERNA

### 1.1 Busca por padrões legados (grep em todos os `.svelte` e `.svelte.js/.ts`)

- [ ] Nenhum `export let` encontrado (deve ser `$props()`)
- [ ] Nenhum `$:` no início de linha (deve ser `$derived()` ou `$effect()`)
- [ ] Nenhum `on:click`, `on:submit`, `on:input`, `on:change`, `on:keydown` (deve ser `onclick`, `oninput`, etc.)
- [ ] Nenhum `<slot>` ou `<slot name="...">` (deve ser `{#snippet}` + `{@render}`)
- [ ] Nenhum `createEventDispatcher` (eventos agora são props/callbacks)
- [ ] Nenhum `$$props` ou `$$restProps` (deve ser spread via `$props()`)

### 1.2 Adoção de runes

- [ ] Estado reativo local usa `$state()` (não `let` simples para dados reativos)
- [ ] Usos de `let` simples existem APENAS para variáveis não reativas (temporárias, contadores de loop, valores que não refletem na UI) — `let` não morreu, mas deixou de ser reativo
- [ ] Valores computados usam `$derived()` (não lógica manual ou variável auxiliar)
- [ ] Efeitos colaterais usam `$effect()` onde apropriado (não `onMount` para sincronização reativa)
- [ ] Props bidirecionais usam `$bindable()`

---

## ETAPA 2 — SVELTEKIT: CARREGAMENTO DE DADOS

- [ ] Dados essenciais de cada página são carregados em `+page.server` (não via `fetch` dentro de `$effect`/`onMount` no cliente)
- [ ] Dados compartilhados entre rotas são carregados em `+layout.server` (sem duplicação entre páginas)
- [ ] Onde há invalidação, usa `depends('app:tag')` + `invalidate('app:tag')` (não `invalidateAll()` genérico)
- [ ] A prop `data` é recebida e usada corretamente nas páginas
- [ ] Dados lentos retornam Promises no `load` e usam `{#await}` no template (streaming)

---

## ETAPA 3 — SVELTEKIT: FORMULÁRIOS E ACTIONS

- [ ] Todo `<form method="POST">` usa `use:enhance` (importado de `$app/forms`)
- [ ] A prop `form` é usada para exibir erros/retornos das actions
- [ ] Botões de submit são desabilitados durante envio (via callback do `enhance`)
- [ ] Operações de formulário usam actions em `+page.server` (não endpoints `/api/` manuais)
- [ ] Nenhum `e.preventDefault()` + `fetch` manual onde `use:enhance` resolveria
- [ ] Nenhum formulário sem `method="POST"` que deveria ser uma action

---

## ETAPA 4 — SVELTEKIT: NAVEGAÇÃO E ESTADO

- [ ] Navegação programática usa `goto` (de `$app/navigation`), não `window.location.href`
- [ ] `page` e `navigating` são importados de `$app/state` (Svelte 5), não de `$app/stores`
- [ ] Links críticos usam `data-sveltekit-preload-data`
- [ ] Nenhum `window.location` ou `document.location` onde link SPA ou `goto` seria melhor

---

## ETAPA 5 — LAYOUTS, ERROS E ESTRUTURA DE ROTAS

- [ ] `+layout.svelte` e `+layout.server` compartilham dados/UI comuns (sem duplicação entre páginas)
- [ ] Existe `+error.svelte` customizado para erros amigáveis ao usuário
- [ ] Grupos de rotas `(grupo)` organizam layouts diferentes (ex: autenticado vs público)
- [ ] Rotas com parâmetros usam `params` matcher para validação

---

## ETAPA 6 — AMBIENTE, HOOKS E SEGURANÇA

### 6.1 Variáveis de ambiente

- [ ] Secrets usam `$env/static/private` ou `$env/dynamic/private` (nenhum `process.env` ou `import.meta.env`)
- [ ] Variáveis públicas usam `$env/static/public` com prefixo `PUBLIC_`

### 6.2 Hooks e autenticação

- [ ] `hooks.server` existe e faz verificação global de autenticação via `event.locals`
- [ ] Verificação de auth NÃO se repete manualmente em cada `load` individual

### 6.3 Segurança

- [ ] Endpoints `/api/` (se existirem) possuem proteção CSRF ou validação de origem
- [ ] Inputs do usuário são validados no servidor (dentro das actions/load)
- [ ] Nenhum dado sensível é exposto ao cliente (verificar retorno dos `load` e actions)

---

## ETAPA 7 — TIPAGEM (somente se o projeto usa TypeScript)

> Pule se o projeto usa JavaScript puro.

- [ ] `App.Locals` está tipado em `app.d.ts` (dados do hooks → load)
- [ ] `App.PageData` está tipado em `app.d.ts`
- [ ] `App.Platform` está tipado com os bindings Cloudflare (ex: `env: { DB: D1Database }`)
- [ ] O arquivo `worker-configuration.d.ts` (gerado por `wrangler types`) está sendo referenciado no `app.d.ts` para tipagem automática dos bindings (evita tipar `App.Platform` manualmente)
- [ ] Nenhum uso de `any` em `event.locals`, `platform.env` ou dados de sessão

---

## ETAPA 8 — SKELETON UI & TAILWIND

### 8.1 Componentes

> **Nota**: Se o projeto usa Skeleton **v3**, ele não oferece mais componentes Svelte pré-empacotados para inputs/formulários. O v3 foca em classes Tailwind aplicadas a elementos HTML nativos (potencializados por Zag.js). Nesse caso, o item de "inputs com componentes Skeleton" não se aplica — valide apenas se as classes utilitárias do Skeleton v3 estão sendo usadas corretamente.

- [ ] Modals, Toasts, Tables, Avatars etc. usam componentes/padrões nativos do Skeleton (não implementações manuais)
- [ ] **(Apenas Skeleton v2)** Inputs de formulário usam componentes Skeleton onde disponível (não `<input>` cru)

### 8.2 Estilos

- [ ] Nenhum CSS inline (`style="..."`) onde classes Tailwind resolveriam
- [ ] Nenhuma cor hardcoded (`#ff0000`, `rgb(...)`) — usa tokens de tema do Skeleton
- [ ] Dark mode funciona corretamente (usa classes de tema, não cores fixas)

---

## ETAPA 9 — CLOUDFLARE PAGES + D1

### 9.1 Configuração

- [ ] Adapter em `svelte.config.js` é `@sveltejs/adapter-cloudflare`
- [ ] `wrangler.toml` declara o binding D1 com `database_name` e `database_id`
- [ ] Existe pasta de migrations D1 organizada

### 9.2 Secrets e variáveis de produção

- [ ] Variáveis sensíveis de produção/preview estão configuradas via painel Cloudflare ou `wrangler secret` (não commitadas em `.env` no repositório)

### 9.3 Acesso ao banco

- [ ] `platform.env.DB` é acessado SOMENTE em código server-side (`+page.server`, `+server`, `hooks.server`)
- [ ] Nenhum import de `platform` vaza para código cliente

### 9.4 Queries

- [ ] Todas as queries D1 usam prepared statements com `.bind()` (nenhuma concatenação/interpolação de string)
- [ ] Múltiplas queries sequenciais usam `db.batch([...])` para reduzir roundtrips
- [ ] Operações D1 possuem tratamento de erros (try/catch com feedback ao usuário)

---

## ETAPA 10 — SEO E ACESSIBILIDADE (a11y)

### 10.1 SEO e Meta Tags

- [ ] Páginas públicas possuem `<svelte:head>` com `<title>` dinâmico
- [ ] Páginas públicas possuem meta tags essenciais (`description`, `og:title`, `og:description`)
- [ ] O `<title>` NÃO está hardcoded estaticamente no `app.html` (deve ser dinâmico por página)

### 10.2 Acessibilidade

- [ ] Imagens (`<img>`) possuem atributos `alt` descritivos
- [ ] Botões e links com ícones (sem texto) possuem `aria-label`
- [ ] Nenhum abuso de `<!-- svelte-ignore -->` mascarando problemas reais de acessibilidade que poderiam ser resolvidos facilmente (ex: `a11y-click-events-have-key-events`)

---

## RESUMO

Após percorrer todas as etapas, preencha um resumo detalhado do projeto, destacando os pontos fortes e fracos, e sugerindo melhorias.
