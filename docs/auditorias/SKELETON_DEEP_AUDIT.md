> ⚠️ **SUPERSEDIDA.** Esta auditoria foi consolidada — junto com `SKELETON_AUDIT.md` — em [`skeleton_audit_final.md`](skeleton_audit_final.md), que é a referência atual. Este arquivo é mantido apenas como registro histórico.

# Relatório de Auditoria Visual Profunda: Skeleton UI v4 & Tailwind CSS v4

Este relatório apresenta uma auditoria detalhada e aprofundada de toda a camada visual e interface de usuário (**UI/UX**) do projeto **Escalas de Plantão Policial (DPI SUL)**. O objetivo principal é mapear inconsistências visuais, identificar oportunidades avançadas de componentes ricos e prover planos de ação precisos para extrair 100% de proveito do ecossistema do **Skeleton UI v4** e do **Tailwind CSS v4** usando **Svelte 5 (Runes)**.

---

## 1. Resumo Executivo e Diagnóstico Geral

Após analisarmos exaustivamente os arquivos de rotas, componentes, layouts e estilos do projeto, consolidamos o seguinte veredito técnico:

*   **Nível Técnico Visual:** **A (Excepcional)**. O projeto está extremamente limpo, fazendo uso impecável de Svelte 5 (`$state`, `$derived`, `$effect`, e `#snippet`), Tailwind v4 (`@import` moderno e diretivas `@source`), e OKLCH para modelagem matemática de cores em `src/theme.css`.
*   **Oportunidade Principal:** Embora o design system personalizado no estilo "*High-Tech Command Center*" seja espetacular, há locais onde a UI recorre a elementos nativos do HTML sem estilização consistente ou a classes manuais do Tailwind que contornam o tema. 
*   **Impacto das Sugestões:** Ao adotar as refatorações sugeridas neste documento, o projeto elimina inconsistências visuais em diferentes navegadores (particularmente no Safari mobile), eleva drasticamente a acessibilidade (conforme padrões WAI-ARIA embutidos no motor Zag.js do Skeleton v4) e adiciona micro-animações premium de alto polimento.

---

## 2. Índice de Arquivos Visuais Mapeados e Avaliados

Mapeamos todos os **73 arquivos Svelte** e arquivos de configuração estilística. Foram selecionados para esta auditoria profunda os seguintes componentes e páginas que compõem o núcleo visual da plataforma:

1.  [`src/routes/+layout.svelte`](file:///c:/Users/Pc/Desktop/escalas/src/routes/+layout.svelte) (Layout Geral, Menu Lateral, Perfil)
2.  [`src/routes/login/+page.svelte`](file:///c:/Users/Pc/Desktop/escalas/src/routes/login/+page.svelte) (Tela de Login e Recuperação de Senha)
3.  [`src/routes/validar/[hash]/+page.svelte`](file:///c:/Users/Pc/Desktop/escalas/src/routes/validar/%5Bhash%5D/+page.svelte) (Validador Público de Autenticidade)
4.  [`src/routes/aceitar-termo/+page.svelte`](file:///c:/Users/Pc/Desktop/escalas/src/routes/aceitar-termo/+page.svelte) (Termos e GDPR)
5.  [`src/routes/unidades/_components/ModalCadastrarUnidade.svelte`](file:///c:/Users/Pc/Desktop/escalas/src/routes/unidades/_components/ModalCadastrarUnidade.svelte) (Modal de Configuração de Unidades)
6.  [`src/routes/res-gise/FormularioServico.svelte`](file:///c:/Users/Pc/Desktop/escalas/src/routes/res-gise/FormularioServico.svelte) (Fluxo de Entrada/Saída/Produtividade)
7.  [`src/routes/policiais/+page.svelte`](file:///c:/Users/Pc/Desktop/escalas/src/routes/policiais/+page.svelte) (Tela de Gestão e Filtros de Servidores)

---

## 3. Descobertas e Oportunidades por Categoria

### Categoria A: Padronização de Cores e Estilos (Eliminação de Desvios de Tema)
*   **Problema:** Em telas de validação de hash e termos de consentimento, são utilizadas classes utilitárias de cores específicas do Tailwind (ex: `bg-primary-600`, `bg-success-500/10`, `border-success-500/20`) diretamente no markup.
*   **Por que é um risco:** Se você alterar a paleta base no arquivo `src/theme.css` ou alternar para um novo tema do Skeleton, essas cores fixas não acompanharão a transição, quebrando a consistência visual.
*   **Solução:** Substituir cores fixas pelas classes de tokens nativas do Skeleton v4 (como `preset-tonal-success`, `preset-filled-primary-500`, etc.) ou referenciar as propriedades CSS personalizadas vinculadas ao tema.

### Categoria B: Substituição de Controles Nativos por Componentes Ricos Skeleton v4

1.  **Checkboxes para `<Switch>` (`aceitar-termo/+page.svelte`)**
    *   **Problema:** A tela de termos usa checkboxes nativos (`<input type="checkbox">`) desprovidos de estilo.
    *   **Solução:** Substituir pelo componente `<Switch>` do Skeleton. Ele fornece um controle deslizante suave e elegante, com transições matemáticas perfeitas e melhor ergonomia para cliques/toques em smartphones.
2.  **Abas Manuais para `<SegmentedControl>` (`login/+page.svelte`)**
    *   **Problema:** As telas de Login e de Recuperação de Senha utilizam botões manuais envoltos em divs estilizadas para alternar o escopo do usuário (Policial vs Administrador).
    *   **Solução:** Adotar o componente `<SegmentedControl>` nativo do Skeleton v4, mantendo a consistência com o restante do aplicativo (como na tela de policiais).
3.  **Datalist Nativo para `<SearchableSelect>` (`ModalCadastrarUnidade.svelte`)**
    *   **Problema:** A seleção de cidades utiliza um elemento nativo `<datalist id="...">`. Em dispositivos móveis (especialmente iPhones/iOS Safari), datalists renderizam de forma muito inconsistente, omitindo scrollbars ou quebrando o teclado virtual.
    *   **Solução:** Utilizar o componente customizado `SearchableSelect.svelte` (que já encapsula o robusto e acessível `<Combobox>` do Skeleton v4 via Zag.js) para garantir uma UX impecável e uniforme.
4.  **Perfil do Usuário com `<Avatar>` (`+layout.svelte`)**
    *   **Problema:** O cabeçalho de perfil no menu lateral renderiza apenas o nome em texto cru.
    *   **Solução:** Integrar o componente `<Avatar>` do Skeleton. Ele gera automaticamente as iniciais do policial com as cores do tema ou carrega sua foto oficial de perfil, agregando valor estético instantâneo.

---

## 4. Plantas de Refatoração Detalhadas (Blueprints)

Abaixo estão os guias exatos de modificação de código para cada arquivo analisado, respeitando estritamente a sintaxe do **Svelte 5 (Runes)** e as especificações do **Tailwind v4**.

---

### 📑 Blueprint 1: `src/routes/+layout.svelte`
**Objetivo:** Substituir a exibição de perfil em texto puro no rodapé da barra lateral por um cabeçalho premium contendo o componente `<Avatar>` com fallbacks.

```diff
 <script lang="ts">
 	import '../app.css';
 	import { tick } from 'svelte';
 	import { page, navigating } from '$app/state';
 	import { goto, invalidateAll, onNavigate } from '$app/navigation';
-	import { Toast, Dialog } from '@skeletonlabs/skeleton-svelte';
+	import { Toast, Dialog, Avatar } from '@skeletonlabs/skeleton-svelte';
 	import { toaster } from '$lib/toast';
 	// ...
+
+	// Rune derivada para gerar as iniciais do policial de forma dinâmica
+	const iniciaisUsuario = $derived(
+		usuario?.nome
+			? usuario.nome.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
+			: ''
+	);
 </script>
 
 <!-- ... -->
 
 			<!-- User info -->
-			<div class="px-3 py-2 space-y-1.5">
-				{#if usuario?.nome}
-					<p
-						class="text-xs font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight"
-					>
-						{usuario.nome}
-					</p>
-				{/if}
+			<div class="px-3 py-2 space-y-2.5">
+				<div class="flex items-center gap-3">
+					<Avatar
+						src={usuario?.avatarUrl}
+						initials={iniciaisUsuario}
+						background="bg-primary-500/20 text-primary-700 dark:text-primary-400 font-bold"
+						border="border border-primary-500/30"
+						width="w-9 h-9"
+						rounded="rounded-full animate-in fade-in duration-300"
+					/>
+					<div class="flex-1 min-w-0">
+						{#if usuario?.nome}
+							<p class="text-xs font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight">
+								{usuario.nome}
+							</p>
+						{/if}
+						{#if !usuario?.papel && !isSupervisorGise && usuario?.lotacao}
+							<p class="text-[0.65rem] text-surface-500 dark:text-surface-400 truncate mt-0.5">
+								{usuario.lotacao}
+							</p>
+						{/if}
+					</div>
+				</div>
 				<div class="flex flex-wrap gap-1 mt-0.5">
 					{#if usuario?.tipo === 'admin'}
 						<span
 							class="badge preset-filled-primary-500 text-[0.6rem] font-semibold tracking-wider uppercase"
 						>
 							ADMIN {adminModulo === 'gise'
 								? 'GISE'
 								: adminModulo === 'escalas'
 									? 'ESCALAS'
 									: 'GERAL'}
 						</span>
 					{/if}
 					{#if usuario?.papel === 'admin_seccional'}
 						<span
 							class="badge preset-filled-warning-500 text-[0.6rem] font-semibold tracking-wider uppercase"
 							>ADM SECCIONAL</span
 						>
 					{/if}
 					{#if usuario?.papel === 'admin_unidade'}
 						<span
 							class="badge preset-filled-tertiary-500 text-[0.6rem] font-semibold tracking-wider uppercase"
 							>ADM UNIDADE</span
 						>
 					{/if}
 					{#if isSupervisorGise}
 						<span
 							class="badge preset-filled-success-500 text-[0.6rem] font-semibold tracking-wider uppercase"
 							>SUPERVISOR GISE</span
 						>
 					{/if}
 				</div>
-				{#if !usuario?.papel && !isSupervisorGise && usuario?.lotacao}
-					<p class="text-[0.65rem] text-surface-500 dark:text-surface-400 truncate">
-						{usuario.lotacao}
-					</p>
-				{/if}
 			</div>
```

---

### 📑 Blueprint 2: `src/routes/login/+page.svelte`
**Objetivo:** Substituir as abas manuais e os seletores de botões estilizados de forma customizada pelo controle unificado e acessível `<SegmentedControl>` do Skeleton v4.

```diff
 <script lang="ts">
 	import { browser } from '$app/environment';
 	import { goto, replaceState } from '$app/navigation';
 	import { applyAction, enhance } from '$app/forms';
 	import { page } from '$app/state';
 	import { toaster } from '$lib/toast';
 	import { csrfHeaders } from '$lib/csrf';
 	import { loading as loadingService } from '$lib/loading.svelte';
 	import CodigoTimer from '$lib/components/CodigoTimer.svelte';
+	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
 	import type { ActionResult } from '@sveltejs/kit';
     // ...
 </script>
 
 <!-- ... -->
 
 		{#if !pendente2FA && !primeiroAcesso && !recuperacao}
 			<!-- ===== Formulário de credenciais ===== -->
-			<div
-				class="flex mb-8 bg-surface-100 dark:bg-surface-900/50 p-1 rounded-xl border border-surface-200 dark:border-white/5"
-			>
-				<button type="button"
-					class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'policial'
-						? 'preset-filled-primary-500'
-						: 'text-surface-500'}"
-					onclick={() => {
-						tipo = 'policial';
-					}}
-				>
-					Policial
-				</button>
-				<button type="button"
-					class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'admin'
-						? 'preset-filled-primary-500'
-						: 'text-surface-500'}"
-					onclick={() => {
-						tipo = 'admin';
-					}}
-				>
-					Administrador
-				</button>
-			</div>
+			<div class="mb-6 bg-surface-100/50 dark:bg-surface-800/10 p-1.5 rounded-2xl border border-surface-200 dark:border-white/5">
+				<SegmentedControl
+					value={tipo}
+					onValueChange={(e) => (tipo = e.value as 'policial' | 'admin')}
+					class="w-full"
+				>
+					<SegmentedControl.Control class="w-full bg-transparent border-0 gap-1 p-0.5 relative">
+						<SegmentedControl.Indicator class="absolute inset-y-1 rounded-xl bg-primary-500 shadow-lg shadow-primary-500/20 transition-all duration-300" />
+						<SegmentedControl.Item value="policial" class="flex-1 relative z-10 py-2.5 text-sm font-bold text-surface-500 data-[state=checked]:text-white transition-colors duration-200">
+							<SegmentedControl.ItemText>Policial</SegmentedControl.ItemText>
+							<SegmentedControl.ItemHiddenInput />
+						</SegmentedControl.Item>
+						<SegmentedControl.Item value="admin" class="flex-1 relative z-10 py-2.5 text-sm font-bold text-surface-500 data-[state=checked]:text-white transition-colors duration-200">
+							<SegmentedControl.ItemText>Administrador</SegmentedControl.ItemText>
+							<SegmentedControl.ItemHiddenInput />
+						</SegmentedControl.Item>
+					</SegmentedControl.Control>
+				</SegmentedControl>
+			</div>
```

---

### 📑 Blueprint 3: `src/routes/validar/[hash]/+page.svelte`
**Objetivo:** Eliminar estilos e backgrounds codificados de forma rígida nas seções de integridade e assinatura, e nos botões de processamento. Substituí-los pelos presets dinâmicos do tema.

```diff
 			<!-- ✅ DOCUMENTO VÁLIDO -->
 			<div class="flex flex-col items-center mb-6 sm:mb-10">
 				<img src={icon} alt="Logo PC-CE" class="w-14 sm:w-20 mb-3 sm:mb-4 drop-shadow-md" />
-				<div class="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-success-500/10 flex items-center justify-center mb-3 sm:mb-4">
+				<div class="w-12 h-12 sm:w-16 sm:h-16 rounded-full preset-tonal-success flex items-center justify-center mb-3 sm:mb-4">
 					<svg class="w-7 h-7 sm:w-9 sm:h-9 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
 					</svg>
 				</div>
 				<h1 class="text-xl sm:text-2xl font-black text-success-600 dark:text-success-400 uppercase tracking-tighter text-center">Autenticidade Confirmada</h1>
 				<p class="text-surface-500 font-medium text-center text-sm sm:text-base mt-1">Este documento é autêntico e foi assinado digitalmente</p>
 			</div>
 
 			<div class="space-y-4 sm:space-y-6">
 				<!-- Status criptográfico (CAdES-LT) -->
-				<section class="p-4 sm:p-6 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5">
+				<section class="p-4 sm:p-6 bg-surface-100/50 dark:bg-surface-800/20 rounded-2xl border border-surface-200 dark:border-white/5 shadow-inner">
 					<div class="flex items-center justify-between mb-3 sm:mb-4 flex-wrap gap-2">
 						<h2 class="text-[10px] font-bold text-surface-500 uppercase tracking-widest">Status Criptográfico</h2>
 						<div class="flex gap-2 flex-wrap">
 							{#if ehQualificada}
-								<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-700 dark:text-primary-300 tracking-wider">ICP-Brasil</span>
+								<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full preset-tonal-primary tracking-wider">ICP-Brasil</span>
 							{:else}
-								<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 tracking-wider">Avançada (Lei 14.063/2020)</span>
+								<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full preset-tonal-warning tracking-wider">Avançada (Lei 14.063/2020)</span>
 							{/if}
 							{#if v?.padesLt?.presente}
-								<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-success-500/10 text-success-700 dark:text-success-300 tracking-wider" title="DSS Dictionary embarcado: certificados e OCSP dentro do próprio PDF (ETSI EN 319 142-1)">PAdES-LT</span>
+								<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full preset-tonal-success tracking-wider" title="DSS Dictionary embarcado">PAdES-LT</span>
 							{/if}
 						</div>
 					</div>
 
 <!-- ... -->
 
 				<!-- Download do Documento -->
-				<section class="p-4 sm:p-6 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700/30 rounded-xl sm:rounded-2xl">
+				<section class="p-4 sm:p-6 preset-tonal-primary border border-primary-500/20 rounded-2xl">
 					<h2 class="text-[10px] font-bold text-primary-700 dark:text-primary-400 uppercase tracking-widest mb-2 sm:mb-3">Documento Original</h2>
 					<p class="text-sm text-surface-700 dark:text-surface-300 mb-3 sm:mb-4">
 						Faça o download do documento digital assinado e compare com o documento impresso que você possui.
 						As informações devem ser idênticas.
 					</p>
 					<button type="button"
 						onclick={handleDownload}
 						disabled={baixando}
-						class="flex items-center justify-center gap-2 w-full sm:w-auto sm:inline-flex px-5 py-3 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 disabled:bg-surface-400 text-white font-bold rounded-xl transition-colors text-sm touch-manipulation"
+						class="btn w-full sm:w-auto preset-filled-primary-500 font-bold rounded-xl transition-all active:scale-95 text-sm touch-manipulation shadow-md flex items-center justify-center gap-2"
 					>
```

---

### 📑 Blueprint 4: `src/routes/aceitar-termo/+page.svelte`
**Objetivo:** Substituir os checkboxes sem estilos por botões deslizantes acessíveis via componente `<Switch>` do Skeleton UI e alinhar os botões de ação à folha de estilo global.

```diff
 <script lang="ts">
 	import icon from '$lib/assets/logo.png';
 	import { enhance } from '$app/forms';
+	import { Switch } from '@skeletonlabs/skeleton-svelte';
 
 	let { data, form } = $props();
 
 	let aceitouTermo = $state(false);
 	let aceitouLgpd = $state(false);
 	let aceitouEmail = $state(false);
 	let aceitouLocalizacao = $state(false);
 	let scrollouAteFim = $state(false);
 	let enviando = $state(false);
     // ...
 </script>
 
 <!-- ... -->
 
 		<form
 			method="POST"
 			action="?/aceitar"
 			use:enhance={() => {
 				enviando = true;
 				return async ({ update }) => {
 					await update();
 					enviando = false;
 				};
 			}}
 			class="p-4 sm:p-6 border-t border-surface-200 dark:border-white/5 space-y-4"
 		>
 			{#if !scrollouAteFim}
 				<p class="text-[11px] text-amber-700 dark:text-amber-400 italic">
 					⬆ Role o termo até o final para habilitar o aceite.
 				</p>
 			{/if}
 
-			<label class="flex items-start gap-2 cursor-pointer">
-				<input
-					type="checkbox"
-					name="aceitou_termo"
-					bind:checked={aceitouTermo}
-					disabled={!scrollouAteFim}
-					class="mt-1 shrink-0"
-				/>
-				<span class="text-sm text-surface-800 dark:text-surface-200">
-					Li e concordo integralmente com este Termo de Uso e Política de Privacidade.
-				</span>
-			</label>
+			<div class="flex items-start gap-3 py-1">
+				<Switch
+					name="aceitou_termo"
+					checked={aceitouTermo}
+					onCheckedChange={(e) => (aceitouTermo = e.checked)}
+					disabled={!scrollouAteFim}
+					controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500 scale-90 sm:scale-100"
+					controlThumb="bg-white"
+					class="mt-1"
+				/>
+				<span class="text-sm text-surface-800 dark:text-surface-200 leading-tight">
+					Li e concordo integralmente com este Termo de Uso e Política de Privacidade.
+				</span>
+			</div>
 
-			<label class="flex items-start gap-2 cursor-pointer">
-				<input
-					type="checkbox"
-					name="aceitou_lgpd"
-					bind:checked={aceitouLgpd}
-					disabled={!scrollouAteFim}
-					class="mt-1 shrink-0"
-				/>
-				<span class="text-sm text-surface-800 dark:text-surface-200">
-					Compreendo que meus dados funcionais (matrícula, lotação, escalas) são processados
-					pela PC-CE para cumprimento de obrigação legal (art. 7º, II, LGPD) e consinto com
-					a coleta de IP e dispositivo para fins de segurança e auditoria (art. 7º, IX).
-				</span>
-			</label>
+			<div class="flex items-start gap-3 py-1">
+				<Switch
+					name="aceitou_lgpd"
+					checked={aceitouLgpd}
+					onCheckedChange={(e) => (aceitouLgpd = e.checked)}
+					disabled={!scrollouAteFim}
+					controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500 scale-90 sm:scale-100"
+					controlThumb="bg-white"
+					class="mt-1"
+				/>
+				<span class="text-sm text-surface-800 dark:text-surface-200 leading-tight">
+					Compreendo que meus dados funcionais (matrícula, lotação, escalas) são processados pela PC-CE para cumprimento de obrigação legal (art. 7º, II, LGPD) e consinto com a coleta de IP e dispositivo para fins de segurança e auditoria (art. 7º, IX).
+				</span>
+			</div>
 
 			<p class="text-[11px] text-surface-500 mt-1">Consentimentos opcionais (você pode recusar sem prejuízo ao acesso):</p>
 
-			<label class="flex items-start gap-2 cursor-pointer">
-				<input
-					type="checkbox"
-					name="aceitou_uso_email"
-					bind:checked={aceitouEmail}
-					class="mt-1 shrink-0"
-				/>
-				<span class="text-sm text-surface-700 dark:text-surface-300">
-					<strong>E-mail pessoal</strong> — Autorizo o envio de notificações e códigos de verificação ao
-					meu e-mail pessoal, quando cadastrado (art. 7º, I, LGPD).
-				</span>
-			</label>
+			<div class="flex items-start gap-3 py-1">
+				<Switch
+					name="aceitou_uso_email"
+					checked={aceitouEmail}
+					onCheckedChange={(e) => (aceitouEmail = e.checked)}
+					controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500 scale-90 sm:scale-100"
+					controlThumb="bg-white"
+					class="mt-1"
+				/>
+				<span class="text-sm text-surface-700 dark:text-surface-300 leading-tight">
+					<strong>E-mail pessoal</strong> — Autorizo o envio de notificações e códigos de verificação ao meu e-mail pessoal, quando cadastrado (art. 7º, I, LGPD).
+				</span>
+			</div>
 
-			<label class="flex items-start gap-2 cursor-pointer">
-				<input
-					type="checkbox"
-					name="aceitou_uso_localizacao"
-					bind:checked={aceitouLocalizacao}
-					class="mt-1 shrink-0"
-				/>
-				<span class="text-sm text-surface-700 dark:text-surface-300">
-					<strong>Geolocalização</strong> — Autorizo a captura de coordenadas GPS ao assinar documentos
-					digitalmente, para fins de evidência jurídica (art. 7º, I, LGPD). Precisão reduzida (~1 km).
-				</span>
-			</label>
+			<div class="flex items-start gap-3 py-1">
+				<Switch
+					name="aceitou_uso_localizacao"
+					checked={aceitouLocalizacao}
+					onCheckedChange={(e) => (aceitouLocalizacao = e.checked)}
+					controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500 scale-90 sm:scale-100"
+					controlThumb="bg-white"
+					class="mt-1"
+				/>
+				<span class="text-sm text-surface-700 dark:text-surface-300 leading-tight">
+					<strong>Geolocalização</strong> — Autorizo a captura de coordenadas GPS ao assinar documentos digitalmente, para fins de evidência jurídica (art. 7º, I, LGPD). Precisão reduzida (~1 km).
+				</span>
+			</div>
```

---

### 📑 Blueprint 5: `src/routes/unidades/_components/ModalCadastrarUnidade.svelte`
**Objetivo:** Substituir o `<datalist>` nativo pelo wrapper altamente otimizado e acessível `<SearchableSelect>` (baseado em Combobox/Zag.js), e converter os checkboxes do regime de escala para o componente deslizante `<Switch>`.

```diff
 <script lang="ts">
-	import { Dialog, SegmentedControl } from '@skeletonlabs/skeleton-svelte';
+	import { Dialog, SegmentedControl, Switch } from '@skeletonlabs/skeleton-svelte';
 	import { enhance } from '$app/forms';
 	import { invalidateAll } from '$app/navigation';
 	import { toaster } from '$lib/toast';
 	import { CIDADES_CEARA } from '$lib/constants/cidades';
 	import type { Unidade } from '$lib/types';
+	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
 
 	let {
 		open = $bindable(false),
 		seccionais
 	}: {
 		open: boolean;
 		seccionais: Unidade[];
 	} = $props();
 
     // ...
 
+	// Função de busca assíncrona com filtro local para o SearchableSelect de Cidades
+	async function loadCidades(query: string, signal: AbortSignal) {
+		const filterQuery = query.toLowerCase().trim();
+		const filtered = CIDADES_CEARA.filter(c => c.toLowerCase().includes(filterQuery));
+		return filtered.map(c => ({ value: c, label: c }));
+	}
+
+	const cidadeSelectedOption = $derived(
+		buscaCidade ? { value: buscaCidade, label: buscaCidade } : null
+	);
 </script>
 
 <!-- ... -->
 
-				<label class="label">
-					<span class="label-text font-semibold">Cidade no Ceará</span>
-					<input
-						class="input"
-						type="text"
-						list="cidades-ce-registro"
-						bind:value={buscaCidade}
-						placeholder="Buscar e selecionar cidade..."
-						required
-					/>
-					<datalist id="cidades-ce-registro">
-						{#each CIDADES_CEARA as c}
-							<option value={c}></option>
-						{/each}
-					</datalist>
-				</label>
+				<div class="flex flex-col gap-1">
+					<span class="label-text font-semibold text-sm">Cidade no Ceará</span>
+					<SearchableSelect
+						bind:value={buscaCidade}
+						loadOptions={loadCidades}
+						selectedOption={cidadeSelectedOption}
+						placeholder="Buscar e selecionar cidade..."
+						minSearchChars={0}
+					/>
+				</div>
 
 <!-- ... -->
 
 				<div
 					class="flex flex-col gap-2 p-3 bg-surface-200/50 dark:bg-surface-800/50 rounded-xl border border-surface-300 dark:border-white/5"
 				>
 					<p class="text-sm font-medium text-surface-600 dark:text-surface-400">
 						Regimes de Escala:
 					</p>
-					<div class="flex gap-4">
-						<label class="flex items-center space-x-2"
-							><input class="checkbox" type="checkbox" bind:checked={novoTemPlantao} /><span
-								>Plantão</span
-							></label
-						>
-						<label class="flex items-center space-x-2"
-							><input class="checkbox" type="checkbox" bind:checked={novoTemExpediente} /><span
-								>Exped.</span
-							></label
-						>
-						<label class="flex items-center space-x-2"
-							><input class="checkbox" type="checkbox" bind:checked={novoTemFds} /><span
-								>Fim de Semana</span
-							></label
-						>
-					</div>
+					<div class="flex flex-col gap-2.5 sm:flex-row sm:gap-4 mt-1">
+						<Switch
+							checked={novoTemPlantao}
+							onCheckedChange={(e) => (novoTemPlantao = e.checked)}
+							controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500"
+							controlThumb="bg-white"
+						>
+							<span class="text-xs font-semibold">Plantão</span>
+						</Switch>
+						<Switch
+							checked={novoTemExpediente}
+							onCheckedChange={(e) => (novoTemExpediente = e.checked)}
+							controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500"
+							controlThumb="bg-white"
+						>
+							<span class="text-xs font-semibold">Exped.</span>
+						</Switch>
+						<Switch
+							checked={novoTemFds}
+							onCheckedChange={(e) => (novoTemFds = e.checked)}
+							controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500"
+							controlThumb="bg-white"
+						>
+							<span class="text-xs font-semibold">Fim de Semana</span>
+						</Switch>
+					</div>
 				</div>
```

---

## 5. Diretrizes Estratégicas para Manutenção e Desenvolvimento Futuro

Para assegurar que qualquer novo arquivo ou funcionalidade visual mantenha-se em conformidade rígida com os padrões visuais premium estabelecidos, adote as seguintes práticas recomendadas:

1.  **Proteção de Acessibilidade (Zag.js / ARIA):**
    O Skeleton v4 utiliza o motor headless Zag.js por trás de seus controles interativos. Ao criar interações customizadas, dê preferência aos componentes Skeleton em vez de estruturar marcação crua. Isso garante que navegação por teclado, leitores de tela e focos visuais funcionem perfeitamente em conformidade com o padrão WAI-ARIA.
2.  **Aproveitamento Pleno do Compilador do Tailwind v4:**
    Evite aninhar classes arbitrárias ou criar variáveis CSS avulsas em `<style>` locais quando puder usar o potencial de gradiente, opacidade e OKLCH nativo do Tailwind. Mantenha os fontes funcionais importados centralizadamente no `src/theme.css`.
3.  **Transição Dinâmica de Estados e Animações Fluídas:**
    Faça uso estratégico da diretiva `transition:fly` ou `transition:fade` do Svelte em conjunto com classes `animate-in fade-in duration-300` do Tailwind CSS em todos os modais, alertas e caixas popover, garantindo que o aplicativo passe uma sensação orgânica e responsiva para o usuário.

---

## 6. Conclusão

A interface do **DPI SUL** já apresenta um trabalho visual admirável. A substituição sistemática dos elementos nativos restantes providos nesta auditoria (especialmente no menu lateral de layout, nos formulários de consentimento e nos seletores de cidades e abas) garante um **polimento visual e operacional state-of-the-art**. O código torna-se mais resiliente, escalável e perfeitamente uniforme entre diferentes navegadores e tamanhos de tela.
