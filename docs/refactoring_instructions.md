# Instruções de Refatoração: Padronização de Loading

Este documento descreve o novo padrão de feedback de carregamento para o projeto, utilizando **Svelte 5 Runes** e um serviço centralizado.

## 1. O Novo Padrão

O objetivo é substituir o gerenciamento local de estados de carregamento (variáveis como `salvando`, `processando`, etc.) por um sistema global que exibe um overlay de alta fidelidade (glassmorphism) sobre a aplicação.

- **Serviço Global:** `src/lib/loading.svelte.ts`
- **Componente Overlay:** `src/lib/components/LoadingOverlay.svelte` (já integrado no `+layout.svelte`)

## 2. Como Aplicar

### Passo 1: Importação
Importe o serviço global no bloco `<script>` do seu arquivo `.svelte` ou no seu arquivo `.ts`:
```typescript
import { loading } from '$lib/loading.svelte';
```

### Passo 2: Remover Estados Locais
Remova declarações redundantes de estado:
- ~~`let salvando = $state(false);`~~
- ~~`let processando = $state(false);`~~

### Passo 3: Atualizar Lógica de Funções
Substitua as atribuições manuais pelas chamadas ao serviço:
- No início da ação: `loading.show('Texto descritivo...');`
- No final (inclusive nos blocos `finally` ou após erros): `loading.hide();`

### Passo 4: Limpeza do Template (HTML)
- Atualize atributos `disabled`: `disabled={loading.active}`
- Remova indicadores locais redundantes: `{#if salvando}<Spinner ... />{/if}`

## 3. Exemplo Prático

**Antes:**
```svelte
<script>
  let salvando = $state(false);
  async function salvar() {
    salvando = true;
    await api.post(...);
    salvando = false;
  }
</script>

<button onclick={salvar} disabled={salvando}>
  {#if salvando}<Spinner size="xs" />{/if} Salvar
</button>
```

**Depois:**
```svelte
<script>
  import { loading } from '$lib/loading.svelte';
  async function salvar() {
    loading.show('Salvando dados...');
    try {
      await api.post(...);
    } finally {
      loading.hide();
    }
  }
</script>

<button onclick={salvar} disabled={loading.active}>
  Salvar
</button>
```
