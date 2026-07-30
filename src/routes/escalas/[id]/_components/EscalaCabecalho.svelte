<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatarData } from '$lib/utils';
	import type { Escala } from '$lib/server/schema';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';

	let {
		escala,
		isFDS,
		isExpediente,
		podeEditar,
		documentoAssinadoExiste,
		finalizadaEm,
		solicitacaoAtual,
		modoEdicao = $bindable(false),
		onFinalizarEdicao
	}: {
		escala: Escala;
		isFDS: boolean;
		isExpediente: boolean;
		podeEditar: boolean;
		documentoAssinadoExiste: boolean;
		finalizadaEm: string | null;
		solicitacaoAtual: { tipo: string } | null;
		modoEdicao: boolean;
		onFinalizarEdicao?: () => void;
	} = $props();
</script>

<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
	<div class="min-w-0">
		<BotaoVoltar
			class="mb-3"
			onclick={() => {
				if (window.history.length > 1) {
					window.history.back();
				} else {
					goto('/escalas?page=1');
				}
			}}
		/>
		<!-- Tipo como "kicker" (rótulo em maiúsculas, colorido) — antes era um badge
		     contornado que, perto do botão Voltar, parecia outro botão. -->
		<p
			class="text-2xs font-bold uppercase tracking-[0.15em] mb-1 {isExpediente
				? 'text-secondary-600 dark:text-secondary-400'
				: isFDS
					? 'text-tertiary-600 dark:text-tertiary-400'
					: 'text-primary-600 dark:text-primary-400'}"
		>
			{isExpediente ? 'Expediente' : isFDS ? 'FDS' : 'Plantão'}
		</p>
		<h1 class="font-bold text-lg sm:text-xl text-surface-900 dark:text-surface-50">
			{#if isFDS}
				{formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)}
			{:else}
				{new Date(escala.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR', {
					month: 'long'
				})}
				{new Date(escala.data_inicio + 'T00:00:00').getFullYear()}
			{/if}
		</h1>
		<p class="text-surface-600 dark:text-surface-300 text-sm font-medium mt-0.5">
			{escala.lotacao}
		</p>
		<p class="text-surface-400 dark:text-surface-500 text-xs mt-0.5">
			{#if isFDS}
				{escala.hora_entrada || '08:00'}H a {escala.hora_saida || '08:00'}H
			{:else}
				{formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)}
			{/if}
		</p>
	</div>
	<div class="flex items-center gap-2 shrink-0">
		{#if podeEditar && !documentoAssinadoExiste && !finalizadaEm && !solicitacaoAtual}
			{#if !modoEdicao}
				<button
					type="button"
					class="btn preset-filled-primary-500 transition-all"
					onclick={() => (modoEdicao = true)}
				>
					Editar escala
				</button>
			{:else if !isFDS && (isExpediente || escala.tipo === 'plantao')}
				<button
					type="button"
					class="btn preset-filled-success-500 transition-all"
					onclick={onFinalizarEdicao}
				>
					Finalizar edição
				</button>
			{/if}
		{/if}
	</div>
</div>
