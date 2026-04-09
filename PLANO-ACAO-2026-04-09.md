# 🚀 PLANO DE AÇÃO — CORREÇÕES E MELHORIAS

**Projeto:** Escalas — Sistema de Gestão de Escalas Policiais  
**Data:** 9 de abril de 2026  
**Base:** Resultados da auditoria em `AUDITORIA-PROJETO-2026-04-09.md`

---

## 📋 VISÃO GERAL

| Prioridade | Qtd | Esforço Total | Impacto Esperado |
|---|---|---|---|
| 🔴 Crítica | 2 | ~30 min | Segurança e correção |
| 🟠 Alta | 3 | ~2h | Resiliência e performance |
| 🟡 Média | 8 | ~6h | UX percebida e otimizações |
| 🟢 Baixa | 7 | ~3h | Conformidade e polish |

---

## 🔴 PRIORIDADE CRÍTICA — FAZER IMEDIATAMENTE

### 1. Remover campo `senha` de `buscarPolicial()`

**Problema:** A função `buscarPolicial()` em `src/lib/db/policiais.ts:99` usa `.select()` sem especificar colunas, retornando o hash da senha do policial. Se o resultado for serializado para o cliente, expõe credenciais.

**Arquivo:** `src/lib/db/policiais.ts`

**Ação:**

```ts
// ANTES (linha ~99)
export async function buscarPolicial(db: ReturnType<typeof getDB>, id: number) {
  return await db.select().from(policiais).where(eq(policiais.id, id)).get();
}

// DEPOIS
export async function buscarPolicial(db: ReturnType<typeof getDB>, id: number) {
  return await db
    .select({
      id: policiais.id,
      matricula: policiais.matricula,
      nome: policiais.nome,
      cargo: policiais.cargo,
      lotacao: policiais.lotacao,
      lotacao_id: policiais.lotacao_id,
      regime: policiais.regime,
      papel: policiais.papel,
      ativo: policiais.ativo,
      email: policiais.email,
      telefone: policiais.telefone,
      primeiro_acesso: policiais.primeiro_acesso,
      criado_em: policiais.criado_em,
      atualizado_em: policiais.atualizado_em,
    })
    .from(policiais)
    .where(eq(policiais.id, id))
    .get();
}
```

**Alternativa (mais limpa):** Criar um helper de colunas sem senha e reutilizar:

```ts
const colunasSemSenha = {
  id: policiais.id,
  matricula: policiais.matricula,
  nome: policiais.nome,
  cargo: policiais.cargo,
  lotacao: policiais.lotacao,
  lotacao_id: policiais.lotacao_id,
  regime: policiais.regime,
  papel: policiais.papel,
  ativo: policiais.ativo,
  email: policiais.email,
  telefone: policiais.telefone,
  primeiro_acesso: policiais.primeiro_acesso,
  criado_em: policiais.criado_em,
  atualizado_em: policiais.atualizado_em,
};
```

**Esforço:** 5 min  
**Risco:** Baixo (apenas remove campo desnecessário)  
**Teste:** Verificar que a página de detalhes do policial continua funcionando sem erros.

---

### 2. Atualizar `compatibility_date` no `wrangler.toml`

**Problema:** Data `2024-12-01` está desatualizada, podendo perder compatibilidade com APIs novas do Cloudflare.

**Arquivo:** `wrangler.toml`

**Ação:**

```toml
# ANTES
compatibility_date = "2024-12-01"

# DEPOIS
compatibility_date = "2025-04-01"
```

**Esforço:** 1 min  
**Risco:** Muito baixo (verificar após deploy se há warnings)  
**Teste:** `npm run build` e `npm run preview` — verificar logs do Wrangler.

---

## 🟠 PRIORIDADE ALTA — FAZER NESTA SEMANA

### 3. Adicionar try/catch em funções de escrita do DB

**Problema:** 19 funções de escrita (insert/update/delete) não possuem try/catch. Erros não tratados resultam em respostas 500 genéricas e sem feedback ao usuário.

**Arquivos:** `src/lib/db/unidades.ts`, `policiais.ts`, `escalas.ts`, `gise.ts`, `documentos.ts`

**Ação:** Adicionar try/catch nas funções de escrita **ou** garantir que todos os handlers de route tratem os erros consistentemente.

**Abordagem recomendada:** Tratamento na camada de route (actions/handlers), mantendo os db modules limpos:

```ts
// +page.server.ts — exemplo
export const actions: Actions = {
  criar: async ({ request, locals, platform }) => {
    const form = await superValidate(request, zod4(schema));
    if (!form.valid) return fail(400, { form });

    try {
      const db = getDB(platform);
      await criarPolicial(db, form.data);
    } catch (err) {
      logger.error('Erro ao criar policial', { error: err });
      return message(form, JSON.stringify({ type: 'error', error: 'Erro ao criar policial. Tente novamente.' }), { status: 500 });
    }

    return message(form, 'Policial criado com sucesso!');
  }
};
```

**Esforço:** ~1h (auditar todas as actions e adicionar tratamento)  
**Risco:** Baixo (apenas adiciona resiliência)  
**Teste:** Simular erros (ex: duplicar matrícula) e verificar feedback ao usuário.

---

### 4. Converter `Promise.all` para `db.batch()` em queries D1 independentes

**Problema:** Múltiplas queries independentes usam `Promise.all()` ao invés de `db.batch()`, resultando em múltiplos roundtrips ao banco.

**Arquivos principais:**
- `src/lib/db/gise.ts` — `listarGiseEscalas()` (4 queries), `buscarGiseDetalhado()` (7 queries)
- `src/lib/db/documentos.ts` — `buscarDocumentoPorHash()` (3 queries)

**Ação:** Converter para `db.batch()`:

```ts
// ANTES (gise.ts ~81)
const [saidas, secCount, assExtra, membroSec] = await Promise.all([
  db.select().from(giseSaidas).where(...).all(),
  db.select({ count: count() }).from(giseSeccionais).where(...).get(),
  db.select().from(giseAssinaturas).where(...).all(),
  db.select().from(giseMembros).where(...).all(),
]);

// DEPOIS
const [saidas, secCount, assExtra, membroSec] = await db.batch([
  db.select().from(giseSaidas).where(...).all(),
  db.select({ count: count() }).from(giseSeccionais).where(...).get(),
  db.select().from(giseAssinaturas).where(...).all(),
  db.select().from(giseMembros).where(...).all(),
]);
```

**Esforço:** ~1h (4-5 funções para converter)  
**Risco:** Baixo (db.batch é atômico — se uma falhar, todas falham)  
**Teste:** Verificar que listagens GISE continuam funcionando corretamente.  
**Ganho estimado:** 30-60% de redução na latência de queries D1.

---

### 5. Implementar `waitUntil` para tarefas em background

**Problema:** `registrarAudit()` e possivelmente envio de emails rodam de forma síncrona, adicionando latência à resposta.

**Arquivo principal:** `src/lib/db/audit.ts` — `registrarAudit()`

**Ação:** Mover chamada de auditoria para `waitUntil` nas actions:

```ts
// ANTES (+page.server.ts)
export const actions: Actions = {
  criar: async ({ request, locals, platform }) => {
    const form = await superValidate(request, zod4(schema));
    if (!form.valid) return fail(400, { form });

    const db = getDB(platform);
    await criarEscala(db, form.data);
    await registrarAudit(db, { acao: 'criar_escala', ... }); // bloqueia resposta

    return message(form, 'Escala criada!');
  }
};

// DEPOIS
export const actions: Actions = {
  criar: async ({ request, locals, platform }) => {
    const form = await superValidate(request, zod4(schema));
    if (!form.valid) return fail(400, { form });

    const db = getDB(platform);
    await criarEscala(db, form.data);

    // Auditoria roda em background — não bloqueia resposta
    platform?.context.waitUntil(
      registrarAudit(db, { acao: 'criar_escala', ... })
    );

    return message(form, 'Escala criada!'); // resposta imediata
  }
};
```

**Esforço:** ~30 min  
**Risco:** Baixo (auditoria continua rodando, apenas não bloqueia)  
**Teste:** Verificar que audit log continua sendo registrado após ações.

---

## 🟡 PRIORIDADE MÉDIA — FAZER NAS PRÓXIMAS 2 SEMANAS

### 6. Implementar View Transitions API

**Problema:** Navegação entre páginas causa "flash branco" sem transição suave.

**Arquivo:** `src/routes/+layout.svelte`

**Ação:** Adicionar `onNavigate` com `document.startViewTransition`:

```svelte
<script lang="ts">
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

**CSS adicional para transição suave:**

```css
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

::view-transition-old(root) {
  animation: 200ms cubic-bezier(0.4, 0, 0.2, 1) fade-out;
}

::view-transition-new(root) {
  animation: 300ms cubic-bezier(0.4, 0, 0.2, 1) fade-in;
}
```

**Esforço:** ~15 min  
**Risco:** Muito baixo (API nativa, fallback graceful)  
**Teste:** Navegar entre páginas e verificar ausência de flash branco.

---

### 7. Implementar `$state.raw()` para dados imutáveis do servidor

**Problema:** Listas grandes (policiais, escalas, GISE) são recebidas do servidor e tratadas como estado reativo profundo, criando proxies desnecessários.

**Arquivos:**
- `src/routes/policiais/+page.svelte`
- `src/routes/escalas/+page.svelte`
- `src/routes/unidades/+page.svelte`
- `src/routes/gise/+page.svelte`

**Ação:**

```svelte
<!-- ANTES -->
<script>
  let { data } = $props();
  let policiais = $state(data.policiais); // cria proxy profundo
</script>

<!-- DEPOIS -->
<script>
  let { data } = $props();
  let policiais = $state.raw(data.policiais); // sem proxy
</script>
```

**Esforço:** ~30 min (4-5 páginas)  
**Risco:** Baixo (dados de lista são imutáveis; edições criam novos objetos)  
**Teste:** Verificar que paginação, filtros e exclusões continuam funcionando.

---

### 8. Implementar Optimistic UI para ações rápidas

**Problema:** Ações como deletar, favoritar, toggle de status aguardam resposta do servidor antes de atualizar a UI.

**Arquivos:** Páginas com ações de exclusão/criação rápida

**Ação:** Adicionar callbacks `onSubmit`/`onResult` ao `superForm`:

```svelte
<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { escalaSchema } from '$lib/schemas/escala';
  import { toast } from '$lib/toast';

  let { data } = $props();
  let escalas = $state.raw(data.escalas);

  const { form, errors, enhance, submitting, delayed } = superForm(data.form, {
    validators: zod4Client(escalaSchema),
    resetForm: true,
    onUpdated({ form }) {
      if (form.valid && form.message) {
        const msg = JSON.parse(form.message || '{}');
        if (msg.type === 'success') {
          toast.success('Escala criada com sucesso!');
        }
      }
    },
  });

  function handleDelete(escalaId: number) {
    return ({ cancel }) => {
      // Otimista: remove da UI
      const backup = [...escalas];
      escalas = escalas.filter(e => e.id !== escalaId);

      return async ({ result }) => {
        if (result.type === 'failure' || result.type === 'error') {
          escalas = backup; // Reverte
          toast.error('Falha ao excluir escala.');
        }
      };
    };
  }
</script>

<form method="POST" action="?/criar" use:enhance>
  <!-- campos -->
</form>

<!-- Formulário de exclusão com optimistic delete -->
<form method="POST" action="?/excluir" use:enhance={handleDelete(escala.id)}>
  <input type="hidden" name="escalaId" value={escala.id} />
  <button type="submit">Excluir</button>
</form>
```

**Esforço:** ~2h (implementar em 4-5 páginas)  
**Risco:** Médio (requer rollback correto em caso de erro)  
**Teste:** Simular falha de rede e verificar reversão correta.

---

### 9. Implementar Edge Caching com `Cache-Control`

**Problema:** Load functions públicas não configuram headers de cache, causando roundtrip desnecessário para dados que mudam pouco.

**Arquivos:** Load functions de páginas com dados públicos/frequentes

**Ação:**

```ts
// +page.server.ts
import type { PageServerLoad } from './$types';
import { setHeaders } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ platform }) => {
  setHeaders({
    'Cache-Control': 'public, max-age=60, s-maxage=3600'
  });

  const db = getDB(platform);
  const unidades = await listarUnidades(db);
  return { unidades };
};
```

**Candidatas a caching:**
- `/unidades` — dados raramente mudam (max-age=3600)
- `/escalas` — dados mudam diariamente (max-age=60)
- `/policiais` — dados mudam ocasionalmente (max-age=300)

**Esforço:** ~30 min  
**Risco:** Baixo (cache invalida em deploy ou com `invalidate()`)  
**Teste:** Verificar headers com DevTools Network tab.

---

### 10. Corrigir `fail()` sem `{ form }` em rotas Superforms

**Problema:** Em rotas como `policiais/+page.server.ts` e `gise/+page.server.ts`, `fail(401/403)` é retornado sem o objeto `form`, causando perda de estado do formulário.

**Arquivos:** `src/routes/policiais/+page.server.ts`, `src/routes/gise/+page.server.ts`, e outros

**Ação:**

```ts
// ANTES
if (!usuario) return fail(401, { error: 'Não autorizado' });

// DEPOIS
if (!usuario) return fail(401, { form });
```

**Esforço:** ~15 min  
**Risco:** Baixo  
**Teste:** Testar acesso não autorizado com formulário aberto.

---

### 11. Adicionar `setError()` para erros de campo específicos

**Problema:** Erros de negócio como "matrícula já cadastrada" retornam como mensagem genérica ao invés de apontar o campo exato.

**Ação:** Usar `setError()` do Superforms:

```ts
import { superValidate, message, setError } from 'sveltekit-superforms';

export const actions: Actions = {
  criar: async ({ request, locals, platform }) => {
    const form = await superValidate(request, zod4(policialSchema));
    if (!form.valid) return fail(400, { form });

    const db = getDB(platform);
    const existente = await buscarPolicialPorMatricula(db, form.data.matricula);
    if (existente) {
      return setError(form, 'matricula', 'Matrícula já cadastrada');
    }

    await criarPolicial(db, form.data);
    return message(form, 'Policial criado com sucesso!');
  }
};
```

**Esforço:** ~30 min  
**Risco:** Baixo  
**Teste:** Tentar cadastrar matrícula duplicada e verificar erro inline no campo.

---

### 12. Invalidação inteligente com `depends()` + `invalidate()`

**Problema:** `invalidateAll()` é usado genericamente, recarregando todas as load functions.

**Ação:**

```ts
// No load function — declarar dependência
export const load: PageServerLoad = async ({ depends }) => {
  depends('app:policiais');
  const db = getDB(platform);
  const policiais = await listarPoliciais(db);
  return { policiais };
};

// No onUpdated do Superforms — invalidar apenas o necessário
onUpdated({ form }) {
  if (form.valid) {
    invalidate('app:policiais');
  }
}
```

**Esforço:** ~1h  
**Risco:** Baixo  
**Teste:** Verificar que apenas as rotas afetadas recarregam após ações.

---

## 🟢 PRIORIDADE BAIXA — FAZER QUANDO HOUVER TEMPO

### 13. Trocar `z.string().email()` por `z.email()`

**Arquivo:** `src/lib/schemas/policial.ts:15`

```ts
// ANTES
email: z.string().email('E-mail inválido').or(z.literal('')).nullable().optional().default(null)

// DEPOIS
email: z.email('E-mail inválido').or(z.literal('')).nullable().optional().default(null)
```

**Esforço:** 2 min

---

### 14. Configurar Prerendering para páginas estáticas

**Arquivos:** `src/routes/login/+page.ts`, `src/routes/validar/+page.ts`

```ts
// +page.ts
export const prerender = true;
```

**Esforço:** ~15 min

---

### 15. Implementar Shallow Routing para modais

**Arquivos:** Páginas com modais de edição/detalhes

```ts
import { pushState, replaceState } from '$app/navigation';

// Abrir modal com shallow routing
function abrirModal(id: number) {
  pushState(`/escalas/${id}/editar`, { escala: id });
}
```

**Esforço:** ~2h  
**Teste:** Navegar com botão voltar/avançar deve fechar/abrir modal.

---

### 16. Adicionar `font-display: swap` nas fontes

**Arquivo:** `src/app.html`

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

**Esforço:** 2 min (já incluso na URL)

---

### 17. Adicionar `loading="lazy"` em imagens

**Arquivos:** Páginas com imagens grandes/carrosséis

```html
<img src="..." alt="..." loading="lazy" />
```

**Esforço:** ~15 min

---

### 18. Revisar `$effect` em `useMobile.svelte.ts`

**Arquivo:** `src/lib/composables/useMobile.svelte.ts`

```ts
// ANTES
let isMobile = $state(true);
$effect(() => {
  isMobile = /Android|.../.test(navigator.userAgent) || ...
});

// DEPOIS
let isMobile = $state(
  typeof navigator !== 'undefined' && (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (window.innerWidth < 768)
  )
);
```

**Esforço:** 5 min

---

### 19. Medir bundle size com visualizer

**Arquivo:** `vite.config.ts`

```ts
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    sveltekit(),
    visualizer({
      template: 'treemap',
      filename: '.svelte-kit/stats.html'
    })
  ]
});
```

**Esforço:** ~15 min

---

## 📅 CRONOGRAMA SUGERIDO

| Semana | Ações |
|---|---|
| **Hoje** | #1 (senha), #2 (compatibility_date) |
| **Semana 1** | #3 (try/catch), #4 (db.batch), #5 (waitUntil) |
| **Semana 2** | #6 (View Transitions), #7 ($state.raw), #8 (Optimistic UI) |
| **Semana 3** | #9 (Edge Caching), #10 (fail com form), #11 (setError) |
| **Semana 4** | #12 (depends/invalidate), #13-19 (baixa prioridade) |

---

## ✅ CHECKLIST DE VALIDAÇÃO PÓS-IMPLANTAÇÃO

Após cada correção, executar:

```bash
# Type check
npm run check

# Lint
npm run lint

# Testes unitários
npm run test

# Build
npm run build

# Preview (verificar manualmente)
npm run preview

# E2E (se disponível)
npx playwright test
```

---

*Plano de ação gerado em 9 de abril de 2026.*
