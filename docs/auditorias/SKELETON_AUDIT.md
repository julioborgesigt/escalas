# Relatório de Auditoria: Uso do Skeleton UI v4 & Tailwind CSS v4

Este documento apresenta uma auditoria detalhada sobre a integração do **Skeleton UI v4** (utilizando `@skeletonlabs/skeleton-svelte` e `@skeletonlabs/skeleton`) combinados com **Tailwind CSS v4** e **Svelte 5** no projeto **Escalas de Plantão Policial (DPI SUL)**.

---

## 1. Resumo Executivo

O projeto encontra-se em um estado **excepcional de modernidade tecnológica**. A adoção conjunta de **Svelte 5 (com Runes)**, **Tailwind CSS v4** e **Skeleton UI v4 (arquitetura baseada em componentes Zag.js)** posiciona este codebase no topo dos padrões atuais de desenvolvimento web.

*   **Nota de Aproveitamento do Skeleton:** **A- (Excelente)**
*   **Veredito:** O ecossistema Skeleton é muito bem compreendido e implementado. Em vez de simplesmente aplicar um template genérico, o projeto utiliza Skeleton como base para um design system personalizado de alta fidelidade ("*High-Tech Command Center*") focado em usabilidade policial.
*   **Foco desta Auditoria:** Identificar pontos onde o Skeleton v4 está sendo subutilizado ou onde componentes nativos em HTML podem ser substituídos pelos novos componentes svelte-native do Skeleton, otimizando acessibilidade, consistência visual e micro-animações.

---

## 2. Pontos Fortes da Implementação Atual (Destaques de Excelência)

O codebase demonstra práticas de alto nível que mostram pleno domínio do Skeleton v4 e Tailwind v4:

### 🌟 Arquitetura de Cores OKLCH e Tematização Nativa
No arquivo `src/theme.css`, o tema `policial` foi brilhantemente estruturado usando o formato **OKLCH**, totalmente em conformidade com o novo motor do Tailwind CSS v4:
```css
[data-theme='policial'] {
    --color-primary-500: oklch(67% 0.17 210deg);
    --color-surface-900: oklch(17% 0.025 255deg);
    /* ... */
}
```
Essa abordagem garante uma paleta de cores uniforme, com gradação matemática perfeita de `50` a `950` e tratamento otimizado de contraste para modos escuro e claro.

### 🌟 Integração Perfeita com o Motor CSS do Tailwind v4
No arquivo `src/app.css`, o uso das diretivas `@source` do Tailwind v4 demonstra ótimo entendimento de como o novo compilador otimizado busca classes utilitárias dentro de pacotes npm externos:
```css
@source '../node_modules/@skeletonlabs/skeleton-svelte/dist';
@source '../node_modules/@skeletonlabs/skeleton/dist';
```
Isso evita o bloating do build de produção e assegura que apenas as classes do Skeleton de fato utilizadas sejam empacotadas.

### 🌟 Criação de Wrappers Customizados Avançados
A implementação de `src/lib/components/SearchableSelect.svelte` utilizando os componentes `<Combobox>` e a API `useListCollection` do `@skeletonlabs/skeleton-svelte` é **exemplar**. Ela combina perfeitamente o poder do mecanismo de estados sem estilo do Zag.js (adotado pelo Skeleton v4) com uma camada robusta de carregamento assíncrono com debounce e tratamento de erros local.

---

## 3. Oportunidades de Otimização e Melhorias

Embora o aproveitamento seja excelente, existem componentes do **Skeleton v4** que ainda não estão sendo explorados e poderiam substituir elementos HTML tradicionais. Abaixo estão as 3 principais frentes de melhoria com exemplos práticos de refatoração:

---

### A. Substituição de Checkboxes pelo Componente `<Switch>`

**Cenário Atual:** Modais como `ModalCadastrarUnidade.svelte` e telas de termos utilizam inputs de checkbox convencionais com a classe `.checkbox` do Skeleton:
```html
<label class="flex items-center space-x-2">
    <input class="checkbox" type="checkbox" bind:checked={novoTemPlantao} />
    <span>Plantão</span>
</label>
```

**Por que mudar:** O Skeleton v4 possui um componente `<Switch>` interativo, acessível por teclado, que renderiza um botão deslizante moderno com micro-animações fluidas, elevando a percepção de produto "premium".

#### Exemplo de Refatoração (`ModalCadastrarUnidade.svelte`):

> [!TIP]
> O componente `Switch` do Skeleton v4 já se integra perfeitamente com os Runes do Svelte 5.

```diff
<script lang="ts">
-	import { Dialog, SegmentedControl } from '@skeletonlabs/skeleton-svelte';
+	import { Dialog, SegmentedControl, Switch } from '@skeletonlabs/skeleton-svelte';
    // ...
</script>

<!-- ... -->
<div class="flex flex-col gap-2 p-3 bg-surface-200/50 dark:bg-surface-800/50 rounded-xl border border-surface-300 dark:border-white/5">
    <p class="text-sm font-medium text-surface-600 dark:text-surface-400">
        Regimes de Escala:
    </p>
    <div class="flex gap-4">
-		<label class="flex items-center space-x-2">
-			<input class="checkbox" type="checkbox" bind:checked={novoTemPlantao} />
-			<span>Plantão</span>
-		</label>
+		<Switch 
+			checked={novoTemPlantao} 
+			onCheckedChange={(e) => novoTemPlantao = e.checked}
+			controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500"
+			controlThumb="bg-white"
+		>
+			<span class="text-sm">Plantão</span>
+		</Switch>

-		<label class="flex items-center space-x-2">
-			<input class="checkbox" type="checkbox" bind:checked={novoTemExpediente} />
-			<span>Exped.</span>
-		</label>
+		<Switch 
+			checked={novoTemExpediente} 
+			onCheckedChange={(e) => novoTemExpediente = e.checked}
+			controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500"
+			controlThumb="bg-white"
+		>
+			<span class="text-sm">Exped.</span>
+		</Switch>

-		<label class="flex items-center space-x-2">
-			<input class="checkbox" type="checkbox" bind:checked={novoTemFds} />
-			<span>Fim de Semana</span>
-		</label>
+		<Switch 
+			checked={novoTemFds} 
+			onCheckedChange={(e) => novoTemFds = e.checked}
+			controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500"
+			controlThumb="bg-white"
+		>
+			<span class="text-sm">Fim de Semana</span>
+		</Switch>
    </div>
</div>
```

---

### B. Migração do `<details>` nativo para o Componente `<Accordion>`

**Cenário Atual:** Em `src/routes/policiais/upload/+page.svelte`, a tabela de erros gerada durante a importação do Excel utiliza um elemento HTML nativo `<details>` e `<summary>`:
```html
<details class="border border-surface-200 rounded-lg overflow-hidden" open={result.imported === 0}>
    <summary class="px-4 py-3 cursor-pointer preset-tonal-error text-sm font-medium">
        {result.errors.length} linha(s) com observações
    </summary>
    <!-- Tabela de Erros -->
</details>
```

**Por que mudar:** O Skeleton v4 possui um `<Accordion>` completo, altamente acessível via WAI-ARIA, com transições nativas de abertura/fechamento mais suaves e consistência com o tema visual escuro/claro.

#### Exemplo de Refatoração (`src/routes/policiais/upload/+page.svelte`):

```diff
<script lang="ts">
    // ...
+	import { Accordion } from '@skeletonlabs/skeleton-svelte';
    // ...
</script>

<!-- ... -->
{#if result.errors.length > 0}
-	<details class="border border-surface-200 rounded-lg overflow-hidden" open={result.imported === 0}>
-		<summary class="px-4 py-3 cursor-pointer preset-tonal-error text-sm font-medium select-none">
-			{result.errors.length} linha{result.errors.length !== 1 ? 's' : ''} com observações
-		</summary>
+	<Accordion value={result.imported === 0 ? ['errors'] : []} class="border border-surface-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
+		<Accordion.Item value="errors">
+			<Accordion.Control class="px-4 py-3 text-left w-full cursor-pointer preset-tonal-error text-sm font-bold flex justify-between items-center transition-colors">
+				<span>{result.errors.length} linha{result.errors.length !== 1 ? 's' : ''} com observações</span>
+				<Accordion.Icon />
+			</Accordion.Control>
+			<Accordion.Panel class="bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-white/10">
				<div class="max-h-[300px] overflow-y-auto">
					<table class="table">
						<thead>
							<tr>
								<th>Linha</th>
								<th>Nome</th>
								<th>Problema</th>
							</tr>
						</thead>
						<tbody>
							{#each result.errors as err (err.row)}
								<tr>
									<td class="font-semibold whitespace-nowrap">{err.row}</td>
									<td>{err.nome}</td>
									<td>{err.message}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
-			</details>
+			</Accordion.Panel>
+		</Accordion.Item>
+	</Accordion>
{/if}
```

---

### C. Uso do Componente `<Avatar>` no Sidebar

**Cenário Atual:** Em `src/routes/+layout.svelte` (linha 565), as informações do usuário são exibidas como texto puro e tags de badges. 
```html
<div class="px-3 py-2 space-y-1.5">
    {#if usuario?.nome}
        <p class="text-xs font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight">
            {usuario.nome}
        </p>
    {/if}
    <!-- badges -->
</div>
```

**Por que mudar:** O Skeleton v4 possui um robusto componente `<Avatar>` capaz de renderizar a imagem do policial, exibir suas iniciais automaticamente caso não haja foto (ex: "JS" para João Silva) e manter um fallback em ícone, garantindo um cabeçalho de perfil extremamente elegante no menu lateral.

#### Exemplo de Refatoração (`src/routes/+layout.svelte`):

```diff
<script lang="ts">
-	import { Toast, Dialog } from '@skeletonlabs/skeleton-svelte';
+	import { Toast, Dialog, Avatar } from '@skeletonlabs/skeleton-svelte';
    // ...
+	const iniciaisUsuario = $derived(
+		usuario?.nome
+			? usuario.nome.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
+			: ''
+	);
</script>

<!-- ... -->
<!-- Perfil do Usuário na Sidebar -->
<div class="px-3 py-2 space-y-2.5">
+	<div class="flex items-center gap-3">
+		<Avatar 
+			src={usuario?.avatarUrl} 
+			initials={iniciaisUsuario}
+			background="bg-primary-500/20 text-primary-700 dark:text-primary-400 font-bold"
+			border="border border-primary-500/30"
+			width="w-9 h-9"
+			rounded="rounded-full"
+		/>
+		<div class="flex-1 min-w-0">
			{#if usuario?.nome}
				<p class="text-xs font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight">
					{usuario.nome}
				</p>
			{/if}
			{#if !usuario?.papel && !isSupervisorGise && usuario?.lotacao}
				<p class="text-[0.65rem] text-surface-500 dark:text-surface-400 truncate mt-0.5">
					{usuario.lotacao}
				</p>
			{/if}
+		</div>
+	</div>
    <div class="flex flex-wrap gap-1 mt-0.5">
        <!-- Badges do tipo do usuário (ADMIN GERAL, ADM SECCIONAL, etc) -->
    </div>
</div>
```

---

## 4. Recomendações Adicionais

1.  **Refatoração do `SkeletonCard.svelte`:**
    O componente atual de placeholder `SkeletonCard` é ótimo e bem desenhado. No entanto, se o projeto crescer e exigir outros formatos de carregamento (como linhas individuais de tabelas ou formatos circulares), você pode encapsular esses padrões em um componente utilitário de esqueleto genérico utilizando a classe `preset-placeholder` do Skeleton v4 para garantir harmonia em todo o app.
2.  **Manutenção das Variáveis Globais:**
    O projeto utiliza muitas classes globais personalizadas no Tailwind v4. Sempre que possível, utilize as classes utilitárias de cores do Skeleton (ex: `text-surface-900 dark:text-surface-50` ou classes com transparências nativas) in vez de acoplar cores em CSS estáticos, garantindo que mudanças no `theme.css` sejam replicadas instantaneamente.

---

## 5. Conclusão

O projeto **Escalas** faz um **uso exemplar, moderno e assertivo do Skeleton UI v4**. Pouquíssimos projetos utilizam a nova API de componentes baseada em Zag.js com o nível de acerto visto aqui, especialmente no design de interfaces dinâmicas com controle assíncrono.

Seguindo as sugestões acima — principalmente a migração para `<Switch>`, `<Accordion>` e `<Avatar>` —, você eliminará controles HTML brutos, melhorando drasticamente a **acessibilidade** (conforme os padrões ARIA assegurados pelo Zag.js sob o capô do Skeleton) e o **polimento visual** geral da plataforma.
