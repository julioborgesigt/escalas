# CHECKLIST DE BOAS PRÁTICAS — SvelteKit + Svelte 5 + Skeleton v3 + Zod 4 + Cloudflare D1

> **Objetivo**: Guia completo para revisão de projeto. Foco em **percepção de velocidade instantânea** pelo usuário (Zero-Latency UI), desempenho visual, fluidez de navegação e práticas mais atualizadas (abril 2026).
>
> **Como usar**: O revisor (IA ou humano) deve percorrer cada item na ordem. Marcar `[x]` se ok, `[ ]` se pendente, `[~]` se parcial. Antes de iniciar, execute o **PASSO 0**.

---

## PASSO 0 — PREPARAÇÃO E INVENTÁRIO

- [ ] Listar árvore de arquivos do projeto (excluindo `node_modules`, `.svelte-kit`, `build`)
- [ ] Ler `package.json` e anotar versões exatas:
  - Svelte: ___ (deve ser 5.x)
  - SvelteKit: ___ (deve ser 2.x)
  - Skeleton: ___ (deve ser v3.x)
  - Tailwind CSS: ___ (deve ser v4.x)
  - Zod: ___ (deve ser ≥4.0.0 ou ≥3.25.0 com imports de `zod/v4`)
  - sveltekit-superforms: ___
  - Adapter: ___ (deve ser `@sveltejs/adapter-cloudflare`)
- [ ] Ler `wrangler.toml` e confirmar bindings declarados (D1, KV, R2, etc.)
- [ ] Identificar se o projeto usa TypeScript ou JavaScript (TS preferencialmente com `strict: true`)
- [ ] Verificar se `.env` **não** está commitado no repositório (conferir `.gitignore`)
- [ ] Executar `npx svelte-check --tsconfig ./tsconfig.json` — deve retornar **0 errors**

---

## ETAPA 1 — SVELTE 5: RUNES E MICRO-OTIMIZAÇÕES DE ESTADO

### 1.1 Eliminação de padrões legados (grep em todos os `.svelte` e `.svelte.js/.ts`)

- [ ] Nenhum `export let` encontrado (deve ser `$props()`)
- [ ] Nenhum `$:` reativo no início de linha (deve ser `$derived()` ou `$effect()`)
- [ ] Nenhum `on:click`, `on:submit`, `on:input`, `on:change`, `on:keydown` (deve ser `onclick`, `oninput`, `onsubmit`, etc.)
- [ ] Nenhum `<slot>` ou `<slot name="...">` (deve ser `{#snippet}` + `{@render}`)
- [ ] Nenhum `createEventDispatcher` (eventos agora são props/callbacks via `$props()`)
- [ ] Nenhum `$$props` ou `$$restProps` (deve ser spread via `$props()`)
- [ ] Nenhum import de `$app/stores` (deve ser `$app/state` para `page`, `navigating`, etc.)
- [ ] Nenhum `writable`, `readable` ou `derived` de `svelte/store` (substituir por runes ou classes reativas)

### 1.2 Adoção correta de Runes para Performance

- [ ] Estado reativo local usa `$state()`
- [ ] **[CRÍTICO PARA PERFORMANCE]** Listas grandes e dados imutáveis vindos do servidor/D1 (que só serão lidos/renderizados) usam `$state.raw()` — o Svelte 5 não cria proxies profundos com `.raw()`, economizando CPU e memória em tabelas e listagens
- [ ] `let` simples existe APENAS para variáveis não reativas (temporárias, contadores de loop, constantes locais)
- [ ] Valores computados usam `$derived()` (não lógica manual ou variável auxiliar)
- [ ] Efeitos colaterais usam `$effect()` — **nunca** para derivar dados ou sincronizar estados (causa re-render duplo)
- [ ] `$effect` **não** é usado para buscar dados iniciais (isso é papel do `load`)
- [ ] Props bidirecionais usam `$bindable()`
- [ ] `$inspect()` removido de código de produção (apenas debug)

### 1.3 Classes reativas (padrão 2026)

- [ ] Lógica de negócio compartilhada encapsulada em classes com `$state` nas propriedades (substituindo stores Svelte)
- [ ] Classes reativas são importáveis tanto por componentes quanto por lógica server-side (quando aplicável)

---

## ETAPA 2 — SVELTEKIT: CARREGAMENTO DE DADOS (SSR, STREAMING E EDGE CACHING)

### 2.1 Server Load Functions — SSR Rápido

- [ ] **Toda página** tem dados essenciais carregados em `+page.server.ts` (zero chamadas de rede no cliente para First Contentful Paint)
- [ ] Dados compartilhados entre rotas são carregados em `+layout.server.ts` (sem duplicação)
- [ ] A prop `data` é recebida via `let { data } = $props()` nas páginas
- [ ] Nenhum spinner/loading no carregamento inicial de página — dados já vêm do servidor via SSR
- [ ] Uso de `Promise.all()` no `load` para buscar múltiplas tabelas do D1 em paralelo (evitar waterfalls)

### 2.2 Streaming e Placeholders (Percepção de Velocidade)

- [ ] Dados lentos (agregações, relatórios) retornam **Promises não resolvidas** no objeto raiz do `load`
- [ ] A UI consome essas promises com bloco `{#await}`
- [ ] Skeleton Screens (placeholders visuais) são renderizados *imediatamente* no bloco de espera do `{#await}`
- [ ] O conteúdo principal da página renderiza instantaneamente; seções lentas aparecem conforme ficam prontas

### 2.3 Edge Caching (Respostas instantâneas do Cloudflare)

- [ ] Para dados públicos ou de leitura frequente, a `load function` usa `setHeaders({ 'Cache-Control': 'public, max-age=60, s-maxage=3600' })`
- [ ] Uso da Cache API do Cloudflare (`platform.caches.default`) dentro de APIs pesadas para evitar bater no D1 em requisições idênticas consecutivas

### 2.4 Invalidação inteligente

- [ ] Usa `depends('app:tag')` + `invalidate('app:tag')` ao invés de `invalidateAll()` genérico onde possível
- [ ] `invalidateAll()` só é usado quando realmente todas as load functions precisam recarregar
- [ ] Após actions que modificam dados listados, invalidação é chamada para atualizar a UI

---

## ETAPA 3 — SVELTEKIT: FORMULÁRIOS, ACTIONS E UX INSTANTÂNEA

### 3.1 Padrão Form Actions e Superforms

- [ ] Todo `<form method="POST">` usa `use:enhance` (do Superforms ou de `$app/forms`)
- [ ] Operações de escrita usam actions em `+page.server.ts` (não endpoints `/api/` manuais)
- [ ] Nenhum `e.preventDefault()` + `fetch` manual onde `use:enhance` resolveria
- [ ] CSRF tratado nativamente pelo SvelteKit (nenhum `csrfHeaders()` manual)

### 3.2 Superforms + Zod 4

- [ ] Pacote correto: `sveltekit-superforms` (sem hífen extra)
- [ ] Adapter Zod 4 servidor: `import { zod4 } from 'sveltekit-superforms/adapters'`
- [ ] Adapter Zod 4 cliente: `import { zod4Client } from 'sveltekit-superforms/adapters'`
- [ ] Schemas definidos no **nível superior do módulo** (fora da load — memoização do adapter)
- [ ] `validators: zod4Client(schema)` configurado no `superForm()` do cliente
- [ ] Mensagens do servidor usam `return message(form, '...')` (não `return { form, message: '...' }`)
- [ ] `setError()` usado para erros de negócio (já retorna `fail()` internamente — não encapsular)
- [ ] Erros tratados como arrays: `$errors.campo[0]`
- [ ] `{ form }` retornado em **todos** os caminhos de código do servidor (inclusive no `fail()`)
- [ ] Formulários com dados aninhados/arrays dinâmicos usam `dataType: 'json'`

### 3.3 Optimistic UI (Atualizações Otimistas — Percepção de 0ms)

- [ ] Ações rápidas (favoritar, deletar, toggle de status) atualizam o `$state` local **antes** da resposta do servidor
- [ ] Implementação via callbacks do Superforms ou `use:enhance`:
  - `onSubmit`: Modifica a UI localmente (estado otimista)
  - `onResult` / `onError`: Reverte o estado local se a action falhar (compensação)
- [ ] Exemplo de padrão:

```svelte
<!-- Optimistic delete -->
<script>
  let items = $state(data.items);

  function handleDeleteEnhance(itemId) {
    return ({ cancel }) => {
      // Otimista: remove da UI imediatamente
      const backup = [...items];
      items = items.filter(i => i.id !== itemId);

      return async ({ result }) => {
        if (result.type === 'failure' || result.type === 'error') {
          items = backup; // Reverte
          // toast.error('Falha ao excluir');
        }
      };
    };
  }
</script>
```

### 3.4 Feedback visual progressivo

- [ ] Botões de submit desabilitados com `disabled={$submitting}` (evita duplo clique)
- [ ] Spinner aparece **somente após 500ms** de espera (usar `$delayed` do Superforms — evita "piscar" em conexões rápidas)
- [ ] Erros de validação aparecem inline ao lado do campo (não apenas alert genérico)
- [ ] `aria-invalid` aplicado nos campos com erro
- [ ] `{...$constraints}` aplicado nos inputs (gera atributos HTML5: required, minlength, etc.)
- [ ] Toast de sucesso/erro após conclusão da action (integração com `onUpdated` / `onError` do Superforms)
- [ ] Formulário reseta após sucesso (`resetForm: true`)

---

## ETAPA 4 — SVELTEKIT: NAVEGAÇÃO, TRANSIÇÕES E SHALLOW ROUTING

### 4.1 Preload e Speculation Rules

- [ ] `data-sveltekit-preload-data="hover"` configurado no `<body>` do `app.html` (padrão SvelteKit)
- [ ] Links críticos (menus principais) usam `data-sveltekit-preload-data="hover"` ou `"tap"`
- [ ] Navegação programática usa `goto()` de `$app/navigation` (não `window.location.href`)
- [ ] **[AVANÇADO]** O projeto injeta `<script type="speculationrules">` para pré-renderizar as próximas páginas mais prováveis em background, fazendo a navegação parecer local

### 4.2 View Transitions API (Aparência de App Nativo)

- [ ] O projeto usa a View Transitions API para navegações de página
- [ ] Implementado no `+layout.svelte` usando `onNavigate` + `document.startViewTransition`
- [ ] Não há "piscar branco" entre páginas
- [ ] Elementos compartilhados (ex: imagens de capa, cards) possuem `view-transition-name` para animar fluidamente entre páginas
- [ ] Snippet de referência:

```svelte
<!-- +layout.svelte -->
<script>
  import { onNavigate } from '$app/navigation';
  let { children } = $props();

  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
</script>
{@render children()}
```

### 4.3 Shallow Routing (Modais e Painéis sem Desmontar Página)

- [ ] Modais de edição, detalhes e painéis laterais usam **Shallow Routing** (`pushState` / `replaceState` de `$app/navigation`)
- [ ] A URL muda e o histórico é mantido, sem desmontar a página por trás
- [ ] Permite retorno imediato (botão voltar fecha o modal) e layouts altamente responsivos

### 4.4 Indicadores de navegação

- [ ] Barra de progresso ou indicador visual durante navegações entre páginas (usando `navigating` de `$app/state`)
- [ ] Transições suaves entre páginas (sem "flash" branco)

### 4.5 Prerendering

- [ ] Páginas estáticas (login, sobre, termos) usam `export const prerender = true`
- [ ] Páginas pre-renderizadas carregam instantaneamente (sem roundtrip)

---

## ETAPA 5 — ZOD 4: VALIDAÇÃO MODERNA

### 5.1 Imports e configuração

- [ ] Zod importado corretamente (`import { z } from "zod/v4"` ou `import { z } from "zod"` na v4+)
- [ ] Nenhum uso de APIs removidas do Zod 3 (verificar migration guide)

### 5.2 Boas práticas Zod 4

- [ ] Parâmetro `error` unificado para customizar mensagens (não `message`, `required_error`, `invalid_type_error` separados)
- [ ] Format helpers top-level: `z.email()`, `z.uuid()`, `z.url()` (melhor tree-shaking que `z.string().email()`)
- [ ] `z.stringbool()` para converter strings de FormData em booleanos
- [ ] `z.interface()` para schemas com campos opcionais que precisam distinguir `optional` de `undefined`
- [ ] Schemas recursivos usam `z.interface(() => ({...}))` ao invés de `z.lazy()`
- [ ] `.meta()` para metadados de schema quando necessário (labels de formulário, documentação)
- [ ] `.toJSONSchema()` se precisar gerar JSON Schema
- [ ] `.pick()` e `.omit()` **não** usados em schemas com `.refine()` (Zod 4.3+ lança erro)
- [ ] Schemas centralizados em `src/lib/schemas/` — única fonte de verdade para BD, API e cliente

### 5.3 Validação no servidor

- [ ] **Todo** input de usuário é validado no servidor com Zod (dentro de actions/load)
- [ ] Nenhuma validação manual com `if (typeof x === 'string')` — tudo passa pelo schema
- [ ] Erros de validação retornados com `fail()` e exibidos na UI
- [ ] Nenhuma operação de banco sem validação prévia

### 5.4 Performance no cliente

- [ ] Se Zod é usado no cliente para validação, considerar `@zod/mini` (~1.9KB gzipped) para bundle menor

---

## ETAPA 6 — SKELETON v3 + TAILWIND v4: VISUAL E TEMAS

### 6.1 Skeleton v3

- [ ] Imports usam `@skeletonlabs/skeleton-svelte` (não path antigo do v2)
- [ ] Componentes atualizados para API do v3 (Runes, Snippets, event handlers modernos, Zag.js)
- [ ] Nenhum componente do Skeleton v2 misturado com v3
- [ ] Modais, Toasts e componentes complexos aproveitam os state machines do Zag.js (garantia de acessibilidade e zero delay em interações)

### 6.2 Tailwind v4

- [ ] Configuração migrada para Tailwind v4: `@import "tailwindcss"` no CSS (sem `tailwind.config.js` legado)
- [ ] Nenhuma classe Tailwind depreciada no v4

### 6.3 Design Tokens e Temas

- [ ] Nenhum CSS inline (`style="..."`) onde classes Tailwind resolveriam
- [ ] Nenhuma cor hardcoded (`#ff0000`, `rgb(...)`) — usa tokens de tema do Skeleton (ex: `bg-surface-100-900`, `text-primary-500`)
- [ ] Dark mode funciona corretamente (usa classes de tema, não cores fixas)
- [ ] Tema registrado e aplicado via sistema de temas do Skeleton v3

### 6.4 Componentes e UI

- [ ] Skeleton v3 não oferece inputs pré-empacotados — inputs usam classes Tailwind em elementos HTML nativos
- [ ] Componentes de feedback (toast, snackbar) integrados com as actions do SvelteKit para retorno instantâneo

### 6.5 Skeleton Screens e Transições Visuais

- [ ] Áreas de conteúdo dinâmico exibem placeholders visuais (skeleton screens) durante carregamento
- [ ] Transições de entrada suaves (`transition:fade`, `transition:fly`) em conteúdo que aparece após carregamento
- [ ] Animações CSS preferidas sobre animações JS (não bloqueiam main thread)

---

## ETAPA 7 — CLOUDFLARE PAGES + D1: PERFORMANCE NO BACKEND

### 7.1 Configuração

- [ ] Adapter em `svelte.config.js` é `@sveltejs/adapter-cloudflare`
- [ ] `wrangler.toml` declara binding D1 com `database_name` e `database_id`
- [ ] Migrations D1 organizadas em pasta dedicada
- [ ] Tipos gerados com `wrangler types` (não tipagem manual de `App.Platform`)
- [ ] `compatibility_date` atualizado no `wrangler.toml` (pelo menos `2025-01-01` ou mais recente)

### 7.2 Secrets e variáveis

- [ ] Variáveis sensíveis via painel Cloudflare ou `wrangler secret` (não commitadas em `.env`)
- [ ] Secrets usam `$env/static/private` ou `$env/dynamic/private` (nenhum `process.env` ou `import.meta.env`)
- [ ] Variáveis públicas usam `$env/static/public` com prefixo `PUBLIC_`

### 7.3 Acesso ao banco D1

- [ ] `platform.env.DB` acessado **somente** em código server-side (`+page.server`, `+server`, `hooks.server`)
- [ ] Nenhum import de `platform` vaza para código cliente
- [ ] Bindings usados diretamente (acesso in-process, sem network hop)

### 7.4 Queries D1 — Performance

- [ ] **Todas** as queries usam prepared statements com `.bind()` (nenhuma concatenação/interpolação)
- [ ] Múltiplas queries sequenciais usam `db.batch([...])` para 1 roundtrip só
- [ ] Operações D1 possuem tratamento de erros (try/catch com feedback ao usuário)
- [ ] Índices (`CREATE INDEX`) cobrindo todas as cláusulas `WHERE` e `ORDER BY` frequentes
- [ ] Queries de listagem usam paginação (não carregam todos os registros)
- [ ] `SELECT` especifica colunas necessárias (não `SELECT *` em tabelas com muitas colunas)

### 7.5 Non-blocking Background Tasks (waitUntil)

- [ ] Tarefas que não precisam travar a UI (envio de email, log de auditoria, webhooks) usam `platform.context.waitUntil(promise)`
- [ ] A action retorna `{ form }` / sucesso instantaneamente ao usuário enquanto Cloudflare termina a tarefa em background
- [ ] Exemplo de padrão:

```ts
// +page.server.ts
export const actions = {
  default: async ({ request, platform }) => {
    const form = await superValidate(request, zod4(schema));
    if (!form.valid) return fail(400, { form });

    // Operação core (D1)
    await platform.env.DB.prepare('INSERT INTO ...').bind(...).run();

    // Tarefa secundária — não trava a resposta
    platform?.context.waitUntil(
      fetch('https://api.log/sistema', { method: 'POST', body: '...' })
    );

    return message(form, 'Salvo com sucesso!'); // UI responde imediatamente
  }
};
```

### 7.6 Read Replication (se aplicável)

- [ ] Para leituras frequentes, D1 Sessions API configurada para read replication
- [ ] Sessions usam bookmarks para consistência sequencial
- [ ] Location hint configurado para região mais próxima dos usuários

### 7.7 Workers Best Practices (Cloudflare 2026)

- [ ] Nenhum estado mutável global (Workers reutilizam isolates entre requests — causa data leaks)
- [ ] Todas as Promises são awaited ou usam `waitUntil` (nenhuma floating promise)
- [ ] Operações de segurança usam `crypto.subtle` / Web Crypto (não `Math.random()`)

---

## ETAPA 8 — LAYOUTS, ERROS E ESTRUTURA DE ROTAS

- [ ] `+layout.svelte` e `+layout.server.ts` compartilham dados/UI comuns (sem duplicação)
- [ ] Existe `+error.svelte` customizado para erros amigáveis ao usuário
- [ ] Grupos de rotas `(grupo)` organizam layouts diferentes (ex: autenticado vs público)
- [ ] Rotas com parâmetros usam matchers de `params` para validação

---

## ETAPA 9 — HOOKS, AUTENTICAÇÃO E SEGURANÇA

### 9.1 Hooks

- [ ] `hooks.server.ts` existe e faz verificação global de autenticação via `event.locals`
- [ ] Verificação de auth **não** se repete manualmente em cada `load` individual
- [ ] Middleware de segurança (rate limiting, headers) aplicado nos hooks

### 9.2 Segurança

- [ ] Proteção CSRF nativa do SvelteKit ativada
- [ ] Endpoints `/api/` (se existirem) possuem proteção CSRF ou validação de origem
- [ ] Inputs do usuário validados no servidor com Zod (dentro de actions/load)
- [ ] Nenhum dado sensível exposto ao cliente (verificar retorno dos `load` e actions)
- [ ] Nenhuma exposição acidental do binding do D1 no código cliente
- [ ] `{@html}` usado com extrema cautela — todo conteúdo sanitizado (risco de XSS)
- [ ] Nenhum `eval()` ou construção dinâmica de código

---

## ETAPA 10 — TIPAGEM TypeScript

> Pule se o projeto usa JavaScript puro.

- [ ] `App.Locals` tipado em `app.d.ts`
- [ ] `App.PageData` tipado em `app.d.ts`
- [ ] `App.Platform` tipado via `worker-configuration.d.ts` gerado por `wrangler types`
- [ ] Nenhum uso de `any` em `event.locals`, `platform.env` ou dados de sessão
- [ ] Tipos gerados do Superforms (`$types`) usados corretamente em `PageServerLoad` e `Actions`

---

## ETAPA 11 — SEO E ACESSIBILIDADE (a11y)

### 11.1 SEO

- [ ] Páginas públicas possuem `<svelte:head>` com `<title>` dinâmico
- [ ] Meta tags essenciais presentes (`description`, `og:title`, `og:description`)
- [ ] `<title>` **não** hardcoded no `app.html`

### 11.2 Acessibilidade

- [ ] Imagens possuem `alt` descritivos
- [ ] Botões/links com ícone (sem texto) possuem `aria-label`
- [ ] Nenhum `<!-- svelte-ignore -->` mascarando problemas reais de a11y
- [ ] Formulários usam `<label>` associados aos inputs (via `for`/`id` ou wrapping)
- [ ] Modais/Drawers gerenciam Focus Trap (padrão Skeleton v3 via Zag.js)

---

## ETAPA 12 — PERFORMANCE AVANÇADA (PERCEPÇÃO DE INSTANTÂNEO)

### 12.1 Bundle Size

- [ ] Verificar tamanho do bundle com `rollup-plugin-visualizer` ou ferramenta equivalente
- [ ] Nenhuma dependência pesada desnecessária no bundle cliente
- [ ] Páginas ou bibliotecas pesadas (gráficos, editores rich text) usam Dynamic Imports (`{#await import(...)}`)
- [ ] Tree shaking funcionando — imports nomeados (não `import *`)

### 12.2 Imagens

- [ ] Imagens otimizadas (WebP/AVIF, tamanho adequado)
- [ ] Imagens grandes usam `loading="lazy"`
- [ ] Elementos LCP (Largest Contentful Paint) possuem `fetchpriority="high"` e `decoding="sync"`

### 12.3 Fontes

- [ ] Fontes pré-carregadas no `handle` hook com `preload` filter (ou `<link rel="preload">`)
- [ ] Fontes subset para incluir apenas caracteres necessários
- [ ] `font-display: swap` ativo para prevenir FOIT (Flash of Invisible Text)

### 12.4 Animações CSS

- [ ] Animações usam `transform` e `opacity` (propriedades compositable aceleradas por GPU)
- [ ] **Nenhuma** animação em `width`, `height`, `top`, `left`, `margin`, `padding` (causam reflow)
- [ ] `will-change` usado com moderação em elementos que realmente serão animados
- [ ] Transições Svelte (`transition:fade`, `transition:fly`) usadas para feedback visual suave

### 12.5 Cache e CDN

- [ ] Assets estáticos servidos com headers de cache adequados
- [ ] SvelteKit code splitting funcionando (HTTP/2 necessário)
- [ ] Cloudflare CDN servindo assets estáticos automaticamente

---

## RESUMO DA REVISÃO

Após percorrer todas as etapas, preencha:

| Métrica | Valor |
|---|---|
| Total de itens verificados | /~140 |
| Itens OK (✅) | |
| Itens pendentes (⚠️/❌) | |
| TOP 3 arquivos/rotas com pior UX de velocidade | 1. ___ 2. ___ 3. ___ |
| Quick-win #1 (Correção mais fácil para melhorar LCP/Percepção) | |
| Quick-win #2 (Optimistic UI ou View Transitions) | |
| Principal query D1 sem index ou causando waterfall | |
| Risco de segurança mais importante | |

---

## PADRÕES E SNIPPETS DE REFERÊNCIA

### View Transitions (`+layout.svelte`)

```svelte
<script>
  import { onNavigate } from '$app/navigation';
  let { children } = $props();

  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
</script>
{@render children()}
```

### Superforms — Servidor (`+page.server.ts`)

```ts
import { superValidate, message, setError } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { fail } from '@sveltejs/kit';
import { meuSchema } from '$lib/schemas/meuSchema';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
  const form = await superValidate(zod4(meuSchema));
  const [dados, config] = await Promise.all([
    platform.env.DB.prepare('SELECT ...').bind(...).all(),
    platform.env.DB.prepare('SELECT ...').all(),
  ]);
  return { form, dados: dados.results, config: config.results };
};

export const actions: Actions = {
  criar: async ({ request, locals, platform }) => {
    const form = await superValidate(request, zod4(meuSchema));
    if (!form.valid) return fail(400, { form });

    await platform.env.DB.prepare('INSERT INTO ...').bind(...).run();

    // Background task — não trava a resposta
    platform?.context.waitUntil(
      fetch('https://api.log/audit', { method: 'POST', body: '...' })
    );

    return message(form, 'Registro criado!');
  }
};
```

### Superforms — Cliente (`+page.svelte`)

```svelte
<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { meuSchema } from '$lib/schemas/meuSchema';
  import { invalidate } from '$app/navigation';

  let { data } = $props();

  // Dados de leitura: $state.raw() para evitar proxies profundos
  let items = $state.raw(data.dados);

  const {
    form, errors, constraints, message,
    enhance, submitting, delayed,
  } = superForm(data.form, {
    validators: zod4Client(meuSchema),
    resetForm: true,
    onUpdated({ form }) {
      if (form.valid && form.message) {
        // toast.success(form.message);
        invalidate('app:minha-tag');
      }
    },
    onError({ result }) {
      // toast.error(result.error.message ?? 'Erro inesperado.');
    },
  });
</script>

<form method="POST" action="?/criar" use:enhance>
  <!-- Campos com $constraints, $errors, bind:value={$form.campo} -->
  <button type="submit" disabled={$submitting}>
    {#if $delayed}Salvando...{:else}Salvar{/if}
  </button>
</form>
```

### Non-Blocking Action (waitUntil)

```ts
export const actions = {
  default: async ({ request, platform }) => {
    // 1. Validação (Zod)
    // 2. Operação core (D1)

    // 3. Tarefa secundária — roda após a resposta
    platform?.context.waitUntil(
      fetch('https://api.log/sistema', { method: 'POST', body: '...' })
    );

    return { success: true }; // UI responde imediatamente
  }
};
```

### Optimistic UI (Exclusão)

```svelte
<script>
  let items = $state(data.items);

  function handleDeleteEnhance(itemId) {
    return ({ cancel }) => {
      const backup = [...items];
      items = items.filter(i => i.id !== itemId);

      return async ({ result }) => {
        if (result.type === 'failure' || result.type === 'error') {
          items = backup;
          // toast.error('Falha ao excluir');
        }
      };
    };
  }
</script>
```

---

## REFERÊNCIAS

- [SvelteKit Performance Docs](https://svelte.dev/docs/kit/performance)
- [SvelteKit View Transitions](https://svelte.dev/docs/kit/page-options#view-transitions)
- [SvelteKit Shallow Routing](https://svelte.dev/docs/kit/shallow-routing)
- [Skeleton v3 Migration Guide](https://www.skeleton.dev/docs/get-started/migrate-from-v2)
- [Zod 4 Release Notes](https://zod.dev/v4)
- [Zod 4 Migration Guide](https://zod.dev/v4/changelog)
- [Superforms Docs](https://superforms.rocks)
- [Cloudflare D1 Best Practices](https://developers.cloudflare.com/d1/best-practices/)
- [Cloudflare D1 Read Replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Cloudflare Workers Best Practices (2026)](https://developers.cloudflare.com/changelog/post/2026-02-15-workers-best-practices/)
- [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Speculation Rules API](https://developer.chrome.com/docs/web-platform/prerender-pages)
