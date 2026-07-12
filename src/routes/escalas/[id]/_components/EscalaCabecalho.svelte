<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatarData } from '$lib/utils';
	import type { Escala } from '$lib/server/schema';

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
	<div>
		<div class="flex items-center gap-2 mb-1 flex-wrap">
			{#if isExpediente}
				<span class="badge preset-outlined-secondary-500 font-bold text-sm px-3 py-1"
					>Expediente</span
				>
			{:else if isFDS}
				<span class="badge preset-outlined-tertiary-500 font-bold text-sm px-3 py-1">FDS</span>
			{:else}
				<span class="badge preset-outlined-primary-500 font-bold text-sm px-3 py-1">Plantão</span>
			{/if}
			{#if !isFDS}
				<span class="font-bold text-lg sm:text-xl text-surface-900 dark:text-surface-50">
					{new Date(escala.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR', {
						month: 'long'
					})}
					{new Date(escala.data_inicio + 'T00:00:00').getFullYear()}
				</span>
			{/if}
		</div>
		<p class="text-surface-600 dark:text-surface-300 text-sm font-medium">{escala.lotacao}</p>
		<p class="text-surface-400 dark:text-surface-500 text-xs mt-0.5">
			{formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)}{isFDS
				? ` · ${escala.hora_entrada || '08:00'}H a ${escala.hora_saida || '08:00'}H`
				: ''}
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
		<button
			type="button"
			class="btn preset-outlined-surface-500 text-sm"
			onclick={() => {
				if (window.history.length > 1) {
					window.history.back();
				} else {
					goto('/escalas?page=1');
				}
			}}>Voltar</button
		>
	</div>
</div>
