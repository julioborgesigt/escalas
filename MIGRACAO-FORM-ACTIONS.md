# Migração para SvelteKit Form Actions + Load Functions

## Contexto

O projeto usava o padrão `fetch()` manual via API routes (`/api/escalas`, `/api/policiais`, etc.) combinado com `$effect(() => carregar())` nos componentes para buscar dados. Isso significava:
- Sem SSR dos dados iniciais (usuário vê spinner no primeiro load)
- Gerenciamento manual de CSRF (`csrfHeaders()`)
- Handlers `onsubmit` com `e.preventDefault()` + try/catch
- `invalidateAll()` manual após cada write

A migração visa usar **Load Functions** (`export const load`) e **Form Actions** (`export const actions` + `use:enhance`) do SvelteKit.

---

## ✅ O QUE JÁ FOI FEITO

### 1. `/escalas` (listagem de escalas)

**Arquivos modificados:**
- `src/routes/escalas/+page.server.ts` — **CRIADO** com `load` + actions `criar` e `excluir`
- `src/routes/escalas/+page.svelte` — Refatorado para usar `data` do server + `invalidateAll()` para exclusão

**Antes:**
```ts
// Componente fazia fetch manual
let escalas = $state([]);
async function carregar() {
  const res = await fetch(`/api/escalas?${params}`);
  escalas = (await res.json()).escalas;
}
$effect(() => { carregar(); });
```

**Depois:**
```ts
// +page.server.ts
export const load = async ({ platform, url, locals }) => {
  return { escalas: resultado.escalas, pagination, unidades, filtros, isAdmin, skipLoad };
};
export const actions = { criar, excluir };
```

**Ganhos:**
- Dados já vêm do servidor no SSR (sem spinner inicial)
- Filtros agora usam URL search params (compartilháveis via URL)
- Ação de exclusão usa form action com `invalidateAll()`

### 2. `/escalas/nova` (criar escala)

**Arquivos modificados:**
- `src/routes/escalas/nova/+page.server.ts` — **CRIADO** com `load` + action `criar`
- `src/routes/escalas/nova/+page.svelte` — Refatorado para usar `use:enhance`

**Antes:**
```svelte
<form onsubmit={salvar}>
```
```ts
async function salvar(e: Event) {
  e.preventDefault();
  const res = await fetch('/api/escalas', {
    method: 'POST', headers: csrfHeaders(), body: JSON.stringify({...})
  });
}
```

**Depois:**
```svelte
<form method="POST" action="?/criar" use:enhance={handleForm}>
  <input type="hidden" name="data_inicio" value={dataInicio} />
  <!-- campos visíveis -->
</form>
```

**Ganhos:**
- CSRF nativo do SvelteKit (sem `csrfHeaders()`)
- Progressive enhancement (funciona sem JS)
- Loading state via `onSubmit`/`onUpdate` do `enhance`
- Redirect automático via `goto()` no `onUpdate`

### 3. `/policiais` (gerenciar policiais)

**Arquivos modificados:**
- `src/routes/policiais/+page.server.ts` — **REESCRITO** com `load` + actions `criar` e `excluir`
- `src/routes/policiais/+page.svelte` — Refatorado

**Antes:**
```ts
let policiais = $state([]);
async function carregarPoliciais() {
  const res = await fetch(`/api/policiais?${params}`);
  policiais = (await res.json()).policiais;
}
$effect(() => { carregarPoliciais(); carregarUnidades(); });
```

**Depois:**
```ts
// +page.server.ts
export const load = async ({ platform, url, locals }) => {
  return { policiais, pagination, unidades, filtros, isAdmin, lotacaoUsuario, skipLoad };
};
export const actions = { criar, excluir };
```

**Ganhos:**
- SSR dos policiais (sem spinner no load inicial)
- Filtros via URL params
- Cadastro via form action com `use:enhance`

### 4. `/unidades` (gerenciar unidades)

**Arquivos criados/modificados:**
- `src/routes/unidades/+page.server.ts` — **CRIADO** com `load` + actions `criar`, `editar`, `excluir`
- `src/routes/unidades/+page.svelte` — Refatorado

**Novidade:** Aqui adicionamos **3 actions** (`criar`, `editar`, `excluir`) — a edição inline usa `fetch('?/editar')` manualmente com FormData.

### 5. Type Check

```
svelte-check found 0 errors and 18 warnings in 4 files
```
- 18 warnings são apenas `state_referenced_locally` (benignos — $state inicializado com `data.x` é padrão aceito)

---

## ⚠️ O QUE NÃO FOI FEITO (e porquê)

### API Routes mantidas (ainda usadas por outras rotas)

As seguintes rotas ainda fazem `fetch()` para as API routes existentes:

| Rota | API calls que ainda usa |
|------|------------------------|
| `/recebidos` | `GET /api/escalas`, `DELETE /api/escalas/[id]/visto` |
| `/painel` | `DELETE /api/escalas/[id]` (exclusão) |
| `/escalas/[id]` | `GET /api/escalas`, `GET /api/escalas/[id]/policiais`, `POST/PATCH/DELETE /api/escalas/[id]/policiais`, `POST /api/escalas/[id]/proximo-mes` |
| `/gise/[id]` | Múltiplas chamadas à API GISE |
| `/res-gise` | Múltiplas chamadas à API GISE |

**Decisão:** Não removemos `/api/escalas`, `/api/policiais`, `/api/unidades` porque outras rotas dependem delas. A remoção só deve acontecer quando TODAS as rotas forem migradas.

---

## 📋 O QUE AINDA PRECISA SER FEITO

### Prioridade ALTA

#### 1. `/escalas/[id]` (editar escala — adicionar/remover policiais)
- **Arquivo:** `src/routes/escalas/[id]/+page.svelte` (~1500 linhas)
- **Complexidade:** Muito alta — tem ~10 handlers de fetch diferentes
- **O que migrar:**
  - `load` no server: busca escala + policiais da escala + todos policiais + documento assinado info
  - Actions: `adicionar`, `adicionarTodos`, `editar`, `remover`, `gerarProximoMes`
- **Desafio:** O componente tem lógica complexa (agrupamento por data/equipe/servidor, checkboxes de datas)
- **APIs usadas:**
  - `GET /api/escalas` (busca escala por id)
  - `GET /api/escalas/[id]/policiais`
  - `POST /api/escalas/[id]/policiais` (adicionar 1)
  - `PUT /api/escalas/[id]/policiais` (adicionar todos)
  - `PATCH /api/escalas/[id]/policiais` (editar)
  - `DELETE /api/escalas/[id]/policiais` (remover)
  - `POST /api/escalas/[id]/proximo-mes`
  - `GET /api/escalas/[id]/documento-assinado/info`

#### 2. `/recebidos` (validar escalas recebidas)
- **Arquivo:** `src/routes/recebidos/+page.svelte` (~300 linhas)
- **Complexidade:** Média
- **O que migrar:**
  - `load`: lista escalas recebidas com filtros
  - Actions: `marcarVisto`, `excluir`, `download`
- **APIs usadas:**
  - `GET /api/escalas` (com filtro `visto`)
  - `POST /api/escalas/[id]/visto`
  - `DELETE /api/escalas` (por id)

#### 3. `/painel` (painel de compliance)
- **Arquivo:** `src/routes/painel/+page.svelte` (~700 linhas)
- **Complexidade:** Média
- **O que migrar:**
  - `load`: busca dados de compliance + unidades
  - Actions: `excluirEscala`, `restaurar`
- **APIs usadas:**
  - `GET /api/admin/compliance`
  - `DELETE /api/escalas`

### Prioridade MÉDIA

#### 4. `/gise` (listagem de GISEs)
- **Arquivo:** `src/routes/gise/+page.svelte`
- Já tem `+page.server.ts` com load function — verificar se usa actions

#### 5. `/gise/[id]` (detalhe de GISE)
- **Arquivo:** `src/routes/gise/[id]/+page.svelte` (~2500 linhas!)
- **Complexidade:** Extrema — muitas operações
- **Já tem:** `+page.server.ts` com load function
- **Falta:** Actions para salvar membros, finalizar seccional, assinar, etc.

#### 6. `/res-gise` (resposta GISE)
- **Arquivo:** `src/routes/res-gise/+page.svelte`
- **Já tem:** `+page.server.ts` com load function
- **Falta:** Actions para submissão de formulário

#### 7. `/produtividade`
- **Arquivo:** `src/routes/produtividade/+page.svelte`
- **Já tem:** `+page.server.ts` com load function
- Nota: Este é mais de leitura/charts — pode não precisar de actions

### Prioridade BAIXA

#### 8. `/login`
- Já funciona via API route `/api/auth/login` — pode ser migrado para action

#### 9. `/alterar-senha`
- Já tem `+page.server.ts` — verificar se já usa actions

#### 10. Remover API routes redundantes
- Quando TODAS as rotas acima forem migradas, remover:
  - `src/routes/api/escalas/+server.ts`
  - `src/routes/api/escalas/[id]/+server.ts`
  - `src/routes/api/policiais/+server.ts`
  - `src/routes/api/policiais/[id]/+server.ts`
  - `src/routes/api/unidades/+server.ts`
  - `src/routes/api/unidades/[id]/+server.ts`
  - `src/routes/api/lotacoes/+server.ts`
  - `src/routes/api/lotacoes/regimes/+server.ts`

---

## 🔧 PADRÃO ADOTADO (para replicar nas demais rotas)

### +page.server.ts

```ts
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  // 1. Verificar auth
  // 2. Buscar dados do DB
  // 3. Retornar { dados, pagination, filtros, ... }
};

export const actions: Actions = {
  criar: async ({ request, locals, platform }) => {
    // 1. Parse FormData
    // 2. Validar com Zod schema
    // 3. Executar operação no DB
    // 4. Retornar { success: true } ou fail(400, { error, fields })
  }
};
```

### +page.svelte

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	let pending = $state(false);
	const handleForm = () => ({
		onSubmit: () => { pending = true; },
		onUpdate({ result }) {
			pending = false;
			if (result.type === 'success') {
				// toast + invalidateAll ou goto
			} else if (result.type === 'failure') {
				// toast com result.data.error
			}
		}
	});
</script>

<form method="POST" action="?/criar" use:enhance={handleForm}>
	<!-- Campos visíveis -->
	<input type="hidden" name="campo_calculado" value={valor} />
	<button type="submit" disabled={pending}>
		{#if pending}<Spinner />{/if}
		{pending ? 'Salvando...' : 'Salvar'}
	</button>
</form>
```

### Notas importantes:
- **Não usar** `SubmitFunction` de `$app/forms` — não existe nesta versão do SvelteKit
- Usar `: any` no tipo do handler para evitar erros de tipagem
- `result.data` precisa de cast `as Record<string, unknown> | undefined` para acesso tipado
- Filtros de listagem devem ir para URL params (não localStorage apenas) para serem compartilháveis
- Manter `invalidateAll()` após actions que modificam dados listados

---

## 📊 STATUS POR ROTA

| Rota | Load Function | Form Actions | use:enhance | SSR | Status |
|------|:-:|:-:|:-:|:-:|--------|
| `/escalas` | ✅ | ✅ criar, excluir | ✅ (excluir) | ✅ | **Concluída** |
| `/escalas/nova` | ✅ | ✅ criar | ✅ | ✅ | **Concluída** |
| `/escalas/[id]` | ✅ | ✅ 6 actions | ✅ (fetch direto) | ✅ | **Concluída** |
| `/policiais` | ✅ | ✅ criar, excluir | ✅ (criar) | ✅ | **Concluída** |
| `/unidades` | ✅ | ✅ criar, editar, excluir | ✅ (criar) | ✅ | **Concluída** |
| `/recebidos` | ✅ | ✅ toggleVisto, excluir | ✅ (fetch direto) | ✅ | **Concluída** |
| `/painel` | ✅ | ✅ excluirEscala | ✅ (fetch direto) | ✅ | **Concluída** |
| `/gise` | ✅ | ✅ criar | ✅ (fetch direto) | ✅ | **Concluída** |
| `/gise/[id]` | ✅ | ❌ | ❌ | ✅ | Parcial |
| `/res-gise` | ✅ | ❌ | ❌ | ✅ | Parcial |
| `/produtividade` | ✅ | ❌ | ❌ | ✅ | Parcial |
| `/login` | ❌ | ❌ | ❌ | ❌ | **Pendente** |

---

## 🚀 COMANDO PARA VERIFICAR

```bash
npx svelte-check --tsconfig ./tsconfig.json
```
Deve retornar **0 errors**.
