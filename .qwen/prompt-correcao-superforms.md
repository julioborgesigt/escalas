# Prompt de Correção Superforms — Projeto Escalas

## Status

✅ **CONCLUÍDO** — Todas as pendências pertinentes foram corrigidas em 2026-04-09.
`npm run build` passou sem erros após as correções.

---

## 1. ✅ CORRIGIDO (era 🔴 ALTA): `src/routes/unidades/+page.svelte` — constraints e aria-invalid

### O que foi feito

- Extraído `eConstraints` do `formEditarObj` (estava faltando, os demais já existiam)
- Input `nome` do formulário de edição inline (desktop e mobile): adicionado `{...$eConstraints.nome}` e `aria-invalid={$eErrors.nome ? 'true' : undefined}`
- Input `cidade` do formulário de edição inline (desktop e mobile): adicionado `{...$eConstraints.cidade}` e `aria-invalid={$eErrors.cidade ? 'true' : undefined}`
- Input `cidade` do modal de criação: adicionado `aria-invalid={$cErrors.cidade ? 'true' : undefined}` e `class:input-error={$cErrors.cidade}`

### Observação sobre o formulário de criação

O modal de criação usa campos de UI que vinculam a variáveis de estado local (`buscaCidade`, `delegaciaPrefixo`, etc.) sincronizadas ao `$cForm` via `$effect`. Por isso, `{...$cConstraints.campo}` **não se aplica** aos inputs visíveis — apenas `aria-invalid` é pertinente.

---

## 2. ✅ CORRIGIDO (era 🟡 MÉDIA): Spinner sem `$delayed` em 5 arquivos

### O que foi feito

Em todos os 5 arquivos, o `delayed` foi extraído do `superForm()` e os spinners passaram a usar `$delayed` em vez de `$submitting` diretamente. O botão de submit permanece usando `$submitting` para o `disabled` (comportamento correto: desabilitar imediatamente, mostrar spinner só após 500ms).

| Arquivo | Variável(eis) adicionada(s) |
|---|---|
| `src/routes/alterar-senha/+page.svelte` | `formDelayed` |
| `src/routes/policiais/+page.svelte` | `formDelayed` |
| `src/routes/policiais/[id]/+page.svelte` | `formDelayed` |
| `src/routes/login/+page.svelte` | `loginDelayed`, `primeiroAcessoDelayed`, `verificar2FADelayed` |
| `src/routes/unidades/+page.svelte` | `eDelayed`, `cDelayed` |

---

## 3. ❌ NÃO PERTINENTE (era 🟢 BAIXA): `$message` via template

### Por que não foi aplicado

O projeto usa mensagens JSON-stringificadas intencionalmente:

```typescript
return message(form, JSON.stringify({ type: 'success', id: result[0]?.id }));
return message(form, JSON.stringify({ type: 'error', error: 'Mensagem de erro' }), { status: 409 });
```

Exibir `$message` diretamente no template mostraria JSON bruto para o usuário (ex: `{"type":"success","id":42}`). O padrão `JSON.parse(form.message)` no `onUpdated` é a abordagem correta para este projeto, pois permite extrair tipo, id, mensagem de erro e acionar toasts/redirects com os dados corretos.

**Não há pendência aqui.** O código existente está correto.

---

## Regras Gerais (mantidas para referência)

1. **NÃO remova lógica existente** que seja funcional (redirects, resets, toast notifications)
2. **Mantenha o estilo de código** existente
3. **Teste o build** após cada arquivo corrigido: `npm run build`
4. **NÃO altere arquivos .server.ts** — as pendências são apenas nos componentes .svelte
5. **Preserve handlers** existentes nos forms

---

## Referência Rápida

Padrão correto de um campo com Superforms:
```svelte
<input
  bind:value={$form.nome}
  {...$constraints.nome}
  aria-invalid={$errors.nome ? 'true' : undefined}
  class:input-error={$errors.nome}
/>
{#if $errors.nome}
  <span class="text-red-500 text-sm">{$errors.nome[0]}</span>
{/if}
```

Padrão correto de spinner com delay:
```svelte
const { form, enhance, submitting, delayed } = superForm(data.form, { ... });
```
```svelte
<!-- botão desabilitado usa $submitting (imediato) -->
<button disabled={$submitting}>
  <!-- spinner usa $delayed (após 500ms) -->
  {#if $delayed}<Spinner size="md" />{/if}
</button>
```

Padrão de mensagem JSON (este projeto):
```typescript
// Servidor
return message(form, JSON.stringify({ type: 'success', id }));
return message(form, JSON.stringify({ type: 'error', error: 'texto' }), { status: 409 });

// Cliente — onUpdated (correto para este projeto)
onUpdated: async ({ form }) => {
  if (form.message) {
    const msg = JSON.parse(form.message);
    if (msg.type === 'success') toaster.create({ title: '...', type: 'success' });
    else toaster.create({ title: msg.error, type: 'error' });
  }
}
// NÃO usar $message diretamente no template — o valor é JSON bruto
```
