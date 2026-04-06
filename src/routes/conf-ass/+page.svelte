<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
	import { invalidateAll } from '$app/navigation';
	import Spinner from '$lib/components/Spinner.svelte';

	let exigirFoto = $state(page.data.exigirFoto as boolean);
	let exigirGps = $state(page.data.exigirGps as boolean);
	let saving = $state(false);

	async function salvar() {
		saving = true;
		try {
			const res = await fetch('/api/configuracoes/assinatura', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({ exigirFoto, exigirGps })
			});
			if (res.ok) {
				await invalidateAll();
				toaster.create({ title: 'Configurações salvas com sucesso.', type: 'success' });
			} else {
				const data = await res.json();
				toaster.create({ title: data.error || 'Erro ao salvar.', type: 'error' });
			}
		} catch {
			toaster.create({ title: 'Erro de conexão.', type: 'error' });
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Conf. Assinatura | Escalas</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-8">
	<h1 class="h2 font-bold mb-1">Configurações de Assinatura</h1>
	<p class="text-surface-500 text-sm mb-8">Parâmetros globais que afetam todas as assinaturas em tela do sistema.</p>

	<div class="card p-6 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl space-y-6">

		<!-- Exigir foto -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Exigir foto do assinante (Prova de Vida)</p>
				<p class="text-xs text-surface-500">
					Quando ativado, o sistema solicita que o assinante tire uma selfie via câmera com detecção de rosto antes de confirmar a assinatura em tela.
					Desativando, apenas a rubrica desenhada e a geolocalização são coletadas.
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-label="Ativar ou desativar exigência de foto na assinatura"
				aria-checked={exigirFoto}
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none
					{exigirFoto ? 'bg-primary-500' : 'bg-surface-300 dark:bg-surface-600'}"
				onclick={() => (exigirFoto = !exigirFoto)}
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200
						{exigirFoto ? 'translate-x-5' : 'translate-x-0'}"
				></span>
			</button>
		</div>

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Exigir GPS -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Exigir geolocalização (GPS)</p>
				<p class="text-xs text-surface-500">
					Quando ativado, o sistema tenta capturar as coordenadas GPS do assinante no momento da assinatura em tela.
					Desativando, nenhuma localização é solicitada ao dispositivo.
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-label="Ativar ou desativar exigência de GPS na assinatura"
				aria-checked={exigirGps}
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none
					{exigirGps ? 'bg-primary-500' : 'bg-surface-300 dark:bg-surface-600'}"
				onclick={() => (exigirGps = !exigirGps)}
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200
						{exigirGps ? 'translate-x-5' : 'translate-x-0'}"
				></span>
			</button>
		</div>

		<div class="pt-2 border-t border-surface-200 dark:border-white/10 flex items-center justify-between gap-4">
			<p class="text-xs text-surface-400">
				{#if exigirFoto && exigirGps}
					<span class="text-success-600 dark:text-success-400 font-medium">Foto e GPS ativados</span> — validação completa.
				{:else if exigirFoto}
					<span class="text-warning-600 dark:text-warning-400 font-medium">Apenas foto ativada</span> — sem captura de localização.
				{:else if exigirGps}
					<span class="text-warning-600 dark:text-warning-400 font-medium">Apenas GPS ativado</span> — sem selfie.
				{:else}
					<span class="text-error-600 dark:text-error-400 font-medium">Foto e GPS desativados</span> — apenas rubrica será coletada.
				{/if}
			</p>
			<button
				type="button"
				class="btn preset-filled-primary-500 text-sm px-5 py-2 flex items-center gap-2"
				onclick={salvar}
				disabled={saving}
			>
				{#if saving}<Spinner size="sm" />{/if}
				{saving ? 'Salvando...' : 'Salvar'}
			</button>
		</div>

	</div>
</div>
