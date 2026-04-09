# Guia de Migração: SvelteKit Superforms

Guia passo a passo para refatorar formulários tradicionais do SvelteKit para o `sveltekit-superforms` (v2.x). Cobre desde a instalação até cenários avançados como múltiplos formulários, dados aninhados e componentização.

**Referência oficial:** [superforms.rocks](https://superforms.rocks)

---

## Atenção: Nome Correto do Pacote

O nome correto é **`sveltekit-superforms`** (uma palavra só), não `sveltekit-super-forms`. Confundir o nome causa erros silenciosos de import difíceis de rastrear.

---

## 1. Instalação

```bash
npm i -D sveltekit-superforms zod
```

> **Zod 4:** Este projeto usa Zod 4 com os adapters dedicados `zod4` (servidor) e `zod4Client` (cliente). Os exemplos abaixo já refletem isso. Se precisar usar Zod 3, substitua `zod4` por `zod` e `zod4Client` por `zodClient`.

---

## 2. Schema: A Fonte Única de Verdade

O schema Zod define a forma dos dados, as regras de validação e os tipos TypeScript — tudo em um lugar só.

```typescript
// src/lib/schemas/userSchema.ts
import { z } from 'zod';

export const userSchema = z.object({
  name: z.string().min(3, 'O nome deve ter no mínimo 3 caracteres'),
  email: z.string().email('E-mail inválido'),
  acceptTerms: z.boolean().default(false),
});

// Tipo exportado para usar em componentes
export type UserSchema = typeof userSchema;
```

> **Regra importante:** Defina o schema **fora** da load function, no nível superior do módulo. O adapter usa memoização baseada nos argumentos, e eles precisam permanecer em memória.

**Centralização:** Coloque todos os schemas em `src/lib/schemas/` para reutilizá-los entre servidor e cliente sem duplicação.

---

## 3. Refatorando o Servidor (`+page.server.ts`)

```typescript
// +page.server.ts
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { fail } from '@sveltejs/kit';
import { userSchema } from '$lib/schemas/userSchema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Inicializa o formulário vazio
  const form = await superValidate(zod4(userSchema));
  return { form };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, zod4(userSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    // form.data está validado e tipado
    console.log('Salvando:', form.data.name);

    // CORRETO: use a função message() do superforms
    return message(form, 'Usuário cadastrado com sucesso!');
  },
};
```

### Armadilhas do servidor

| Erro | Sintoma | Correção |
|------|---------|----------|
| `return { form, message: 'texto' }` | O store `$message` fica `undefined` no cliente | Use `return message(form, '...')` |
| Acessar `request.formData()` antes de `superValidate` | FormData já consumida, form vem vazio | Passe `request` diretamente para `superValidate` |
| Schema definido dentro da load function | Cache do adapter quebra, podendo causar comportamento inconsistente | Defina o schema no nível superior do módulo |
| Não retornar `{ form }` em todos os caminhos de código | Formulário não atualiza com erros no cliente | Retorne sempre `{ form }`, inclusive no `fail()` |

---

## 4. Refatorando o Cliente (`+page.svelte`)

### Svelte 5 (sintaxe atual com `$props()`)

```svelte
<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { userSchema } from '$lib/schemas/userSchema';

  let { data } = $props();

  const {
    form,        // Store reativo com os dados ($form.name)
    errors,      // Store reativo com erros ($errors.name é um array)
    constraints, // Atributos HTML5 gerados pelo Zod (required, minlength, etc.)
    message,     // Mensagem vinda do servidor via message()
    enhance,     // Substitui o use:enhance padrão do SvelteKit
    submitting,  // true enquanto o form está sendo enviado
    delayed,     // true após 500ms de espera — ideal para spinners
  } = superForm(data.form, {
    validators: zod4Client(userSchema),
    resetForm: true,
    taintedMessage: 'Você tem alterações não salvas. Deseja sair?',
  });
</script>

{#if $message}
  <div class="toast-success">{$message}</div>
{/if}

<form method="POST" use:enhance>

  <div class="field">
    <label for="name">Nome completo</label>
    <input
      type="text"
      name="name"
      id="name"
      bind:value={$form.name}
      {...$constraints.name}
      aria-invalid={$errors.name ? 'true' : undefined}
      class:input-error={$errors.name}
    />
    {#if $errors.name}
      <span class="error">{$errors.name[0]}</span>
    {/if}
  </div>

  <div class="field">
    <label for="email">E-mail</label>
    <input
      type="email"
      name="email"
      id="email"
      bind:value={$form.email}
      {...$constraints.email}
      aria-invalid={$errors.email ? 'true' : undefined}
      class:input-error={$errors.email}
    />
    {#if $errors.email}
      <span class="error">{$errors.email[0]}</span>
    {/if}
  </div>

  <div class="field">
    <label>
      <input
        type="checkbox"
        name="acceptTerms"
        bind:checked={$form.acceptTerms}
      />
      Aceito os termos de uso
    </label>
    {#if $errors.acceptTerms}
      <span class="error">{$errors.acceptTerms[0]}</span>
    {/if}
  </div>

  <button type="submit" disabled={$submitting}>
    {#if $delayed}
      Salvando...
    {:else if $submitting}
      Processando...
    {:else}
      Cadastrar
    {/if}
  </button>

</form>

<style>
  input {
    border: 1px solid #ccc;
    padding: 0.5rem;
    border-radius: 4px;
    transition: border-color 0.2s, background-color 0.2s;
  }
  .input-error {
    border-color: red;
    background-color: #fff5f5;
  }
  .error {
    color: red;
    font-size: 0.8rem;
    margin-top: 0.25rem;
    display: block;
  }
  .toast-success {
    background: #d4edda;
    color: #155724;
    padding: 1rem;
    margin-bottom: 1rem;
    border-radius: 4px;
  }
</style>
```

### Svelte 4 (sintaxe legada com `export let`)

Se ainda estiver no Svelte 4, a única diferença no cliente é a forma de receber as props:

```svelte
<script lang="ts">
  // Svelte 4: export let data
  import type { PageData } from './$types';
  export let data: PageData;

  // O resto (superForm, destructuring, etc.) é idêntico ao Svelte 5
</script>
```

### Por que `class:input-error` funciona

O Superforms define `$errors.campo` como `undefined` (falsy) quando não há erros e como um array de strings (truthy) quando há. A diretiva `class:` do Svelte usa exatamente essa distinção — nenhuma lógica extra necessária.

---

## 5. Erros do Servidor com `setError`

Além da validação do schema, muitas vezes você precisa adicionar erros manuais (ex: e-mail já cadastrado). Use `setError`:

```typescript
import { superValidate, message, setError } from 'sveltekit-superforms';

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, zod4(userSchema));
    if (!form.valid) return fail(400, { form });

    // Verificação de negócio
    const existe = await db.user.findByEmail(form.data.email);
    if (existe) {
      return setError(form, 'email', 'Este e-mail já está cadastrado.');
    }

    await db.user.create(form.data);
    return message(form, 'Cadastro realizado!');
  },
};
```

O `setError` já retorna `fail(400, { form })` internamente — não precisa encapsular com `fail()`.

---

## 6. Múltiplos Formulários na Mesma Página

Quando schemas são diferentes, o Superforms diferencia os formulários automaticamente. Quando os schemas são iguais (mesmos campos e tipos), use o parâmetro `id`.

### Servidor

```typescript
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
});

export const load: PageServerLoad = async () => {
  const loginForm = await superValidate(zod4(loginSchema));
  const registerForm = await superValidate(zod4(registerSchema));
  return { loginForm, registerForm };
};

export const actions: Actions = {
  login: async ({ request }) => {
    const form = await superValidate(request, zod4(loginSchema));
    if (!form.valid) return fail(400, { form });
    return message(form, 'Login efetuado!');
  },
  register: async ({ request }) => {
    const form = await superValidate(request, zod4(registerSchema));
    if (!form.valid) return fail(400, { form });
    return message(form, 'Cadastro realizado!');
  },
};
```

### Cliente

```svelte
<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { loginSchema, registerSchema } from '$lib/schemas';

  let { data } = $props();

  // Renomeie os stores para evitar conflito
  const {
    form: loginForm,
    errors: loginErrors,
    enhance: loginEnhance,
    message: loginMessage,
  } = superForm(data.loginForm, {
    validators: zod4Client(loginSchema),
    invalidateAll: false, // Evita limpar o outro formulário
  });

  const {
    form: registerForm,
    errors: registerErrors,
    enhance: registerEnhance,
    message: registerMessage,
  } = superForm(data.registerForm, {
    validators: zod4Client(registerSchema),
    invalidateAll: false,
  });
</script>

<form method="POST" action="?/login" use:loginEnhance>
  <!-- campos com bind:value={$loginForm.email} -->
</form>

<form method="POST" action="?/register" use:registerEnhance>
  <!-- campos com bind:value={$registerForm.email} -->
</form>
```

> **Ponto-chave:** Use `invalidateAll: false` nos formulários que você não quer que sejam limpos quando o outro for submetido. Sem isso, a invalidação da página recarrega os dados da load function e reseta todos os forms.

---

## 7. Dados Aninhados (Objetos e Arrays)

Formulários HTML só lidam com strings planas. Para dados aninhados, use `dataType: 'json'`:

```typescript
// Schema com array de objetos
const orderSchema = z.object({
  customer: z.string(),
  items: z.array(z.object({
    product: z.string(),
    quantity: z.number().min(1),
  })).min(1, 'Adicione pelo menos um item'),
});
```

### Cliente

```svelte
<script lang="ts">
  const { form, errors, enhance } = superForm(data.form, {
    dataType: 'json', // Habilita dados aninhados
    validators: zod4Client(orderSchema),
  });

  function addItem() {
    $form.items = [...$form.items, { product: '', quantity: 1 }];
  }

  function removeItem(index: number) {
    $form.items = $form.items.filter((_, i) => i !== index);
  }
</script>

<form method="POST" use:enhance>
  <input name="customer" bind:value={$form.customer} />

  {#each $form.items as _, i}
    <div class="item-row">
      <input bind:value={$form.items[i].product} />
      <input type="number" bind:value={$form.items[i].quantity} />
      <button type="button" onclick={() => removeItem(i)}>Remover</button>

      {#if $errors.items?.[i]?.product}
        <span class="error">{$errors.items[i].product[0]}</span>
      {/if}
    </div>
  {/each}

  <button type="button" on:click={addItem}>+ Adicionar item</button>
  <button type="submit">Enviar</button>
</form>
```

### Requisitos para `dataType: 'json'`

- JavaScript habilitado no navegador
- `use:enhance` do Superforms aplicado no form
- O atributo `name` nos inputs deixa de ser obrigatório (os dados vêm do store `$form`, não do FormData)

---

## 8. Componentização de Campos

Para evitar repetição de markup, extraia campos em componentes reutilizáveis usando `formFieldProxy`:

```svelte
<!-- src/lib/components/TextField.svelte -->
<script lang="ts" generics="T extends Record<string, unknown>">
  import { formFieldProxy, type SuperForm, type FormPathLeaves } from 'sveltekit-superforms';

  let {
    superform,
    field,
    label,
    type = 'text',
    ...rest
  } : {
    superform: SuperForm<T>;
    field: FormPathLeaves<T>;
    label?: string;
    type?: string;
  } = $props();

  const { value, errors, constraints } = formFieldProxy(superform, field);
</script>

<div class="field">
  {#if label}<label>{label}</label>{/if}
  <input
    name={field}
    {type}
    bind:value={$value}
    {...$constraints}
    aria-invalid={$errors ? 'true' : undefined}
    class:input-error={$errors}
    {...rest}
  />
  {#if $errors}
    <span class="error">{$errors[0]}</span>
  {/if}
</div>
```

### Uso

```svelte
<script lang="ts">
  import TextField from '$lib/components/TextField.svelte';

  let { data } = $props();
  const superform = superForm(data.form, { validators: zod4Client(userSchema) });
  const { enhance } = superform;
</script>

<form method="POST" use:enhance>
  <TextField {superform} field="name" label="Nome" />
  <TextField {superform} field="email" label="E-mail" type="email" />
  <button type="submit">Enviar</button>
</form>
```

> **Nota:** Ao componentizar, passe a instância inteira do `superForm` (não apenas o store `form`). O `formFieldProxy` precisa do objeto completo.

---

## 9. Integração com Toast

```typescript
const { form, enhance } = superForm(data.form, {
  validators: zod4Client(userSchema),

  onUpdated({ form }) {
    if (form.valid && form.message) {
      toast.success(form.message);
    }
  },

  onError({ result }) {
    toast.error(result.error.message ?? 'Erro inesperado.');
  },
});
```

> `onUpdated` é chamado após toda atualização do servidor (incluindo falhas de validação). Verifique `form.valid` antes de exibir mensagens de sucesso.

---

## 10. Debugging com SuperDebug

O Superforms inclui um componente de debug que mostra o estado do formulário formatado e colorizado:

```svelte
<script>
  import SuperDebug from 'sveltekit-superforms/SuperDebug.svelte';
</script>

<!-- Exibe o estado completo do form em tempo real -->
<SuperDebug data={$form} />
```

Use durante o desenvolvimento e remova antes do deploy. É a forma mais rápida de diagnosticar problemas com dados e validação.

---

## 11. Populando o Formulário com Dados Existentes

Para formulários de edição, passe os dados existentes para `superValidate`:

```typescript
export const load: PageServerLoad = async ({ params }) => {
  const user = await db.user.findById(params.id);

  // Passa os dados existentes — o Superforms valida e preenche o form
  const form = await superValidate(user, zod(userSchema));
  return { form };
};
```

O Superforms aceita qualquer objeto compatível com o schema. Campos ausentes usam os defaults do Zod.

---

## 12. Modo SPA (Single-Page Application)

Para formulários que não usam form actions do SvelteKit (ex: chamadas a APIs externas):

```svelte
<script lang="ts">
  const { form, errors, enhance } = superForm(data.form, {
    validators: zod4Client(userSchema),
    SPA: true,

    async onUpdate({ form }) {
      if (!form.valid) return;

      // Substitui a form action — faça sua chamada de API aqui
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.data),
      });

      if (!response.ok) {
        toast.error('Erro ao salvar.');
      } else {
        toast.success('Salvo!');
      }
    },
  });
</script>
```

> No modo SPA, o formulário **não** é enviado ao servidor via form action. A validação e o envio acontecem inteiramente no cliente.

---

## Checklist de Migração

### Essenciais

- [ ] Pacote correto: `sveltekit-superforms` (sem hífen extra)
- [ ] Adapter importado separadamente: `import { zod4 } from 'sveltekit-superforms/adapters'` (servidor) e `import { zod4Client } from 'sveltekit-superforms/adapters'` (cliente)
- [ ] Schema definido no nível superior do módulo (fora da load function)
- [ ] `message()` no servidor (não `return { form, message: '...' }`)
- [ ] Validação client-side: `validators: zod4Client(userSchema)` no `superForm()`
- [ ] Erros como arrays: `$errors.campo[0]` (não `$errors.campo` direto)
- [ ] `{ form }` retornado em **todos** os caminhos de código (inclusive no `fail()`)

### UX

- [ ] Constraints aplicados: `{...$constraints.campo}` nos inputs
- [ ] Botão protegido: `disabled={$submitting}` para evitar envios duplicados
- [ ] Spinner com `$delayed`: indicador de carregamento apenas após 500ms
- [ ] `aria-invalid` nos campos com erro para acessibilidade
- [ ] `class:input-error` para feedback visual nos campos

### Avançados (quando aplicável)

- [ ] `setError` para erros de negócio (e-mail duplicado, etc.)
- [ ] `dataType: 'json'` para dados aninhados
- [ ] `invalidateAll: false` para múltiplos formulários na mesma página
- [ ] Componentização com `formFieldProxy` para campos reutilizáveis
- [ ] `SuperDebug` durante desenvolvimento

---

## Referência Rápida de Erros Comuns

| Problema | Errado | Correto |
|---|---|---|
| Nome do pacote | `sveltekit-super-forms` | `sveltekit-superforms` |
| Import do adapter | `from 'sveltekit-superforms'` | `from 'sveltekit-superforms/adapters'` |
| Adapter errado (Zod 4) | `zod` / `zodClient` | `zod4` / `zod4Client` |
| Mensagem do servidor | `return { form, message: '...' }` | `return message(form, '...')` |
| Validação client-side | Achar que é automática com `use:enhance` | Requer `validators: zod4Client(schema)` |
| Leitura de erros | `$errors.name` | `$errors.name[0]` (é um array) |
| Schema dentro do load | `export const load = async () => { const s = z.object({...})` | Schema no nível superior do módulo |
| `setError` com `fail` | `return fail(400, setError(...))` | `return setError(form, 'campo', 'msg')` (já retorna fail) |
| Múltiplos forms resetando | Ambos com defaults | Use `invalidateAll: false` nos forms que não devem resetar |
| Props no Svelte 5 | `export let data` | `let { data } = $props()` |

---

## Links Úteis

- [Documentação oficial](https://superforms.rocks)
- [Tutorial Get Started](https://superforms.rocks/get-started)
- [Nested Data](https://superforms.rocks/concepts/nested-data)
- [Multiple Forms](https://superforms.rocks/concepts/multiple-forms)
- [Componentização](https://superforms.rocks/components)
- [FAQ](https://superforms.rocks/faq)
- [Changelog / Releases](https://github.com/ciscoheat/sveltekit-superforms/releases)
