<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
	import { invalidateAll } from '$app/navigation';
	import Spinner from '$lib/components/Spinner.svelte';

	let exigirFoto = $state(page.data.exigirFoto as boolean);
	let exigirGps = $state(page.data.exigirGps as boolean);
	let exigirCodigoEmail = $state(page.data.exigirCodigoEmail as boolean);
	let restringirSmartphone = $state(page.data.restringirSmartphone as boolean);
	let saving = $state(false);

	async function salvar() {
		saving = true;
		try {
			const res = await fetch('/api/configuracoes/assinatura', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({ exigirFoto, exigirGps, exigirCodigoEmail, restringirSmartphone })
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
					Desativando, a prova de vida por imagem não será solicitada.
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

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Exigir Código via E-mail -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Exigir código via E-mail</p>
				<p class="text-xs text-surface-500">
					Quando ativado, os usuários precisarão confirmar as assinaturas em rede através de um código numérico de 6 dígitos enviado para seu e-mail de cadastro. Impede assinatura por terceiros não autorizados caso o terminal fique desbloqueado.
					<strong class="text-error-500 block mt-1">Atenção: Os usuários precisarão ter e-mail funcional cadastrado no perfil.</strong>
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-label="Ativar ou desativar exigência de código no email"
				aria-checked={exigirCodigoEmail}
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none
					{exigirCodigoEmail ? 'bg-primary-500' : 'bg-surface-300 dark:bg-surface-600'}"
				onclick={() => (exigirCodigoEmail = !exigirCodigoEmail)}
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200
						{exigirCodigoEmail ? 'translate-x-5' : 'translate-x-0'}"
				></span>
			</button>
		</div>

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Restringir a Smartphone -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Restringir assinatura em tela a Smartphone</p>
				<p class="text-xs text-surface-500">
					Quando ativado, o sistema bloqueia o desenho da assinatura e a captura de foto/GPS se detectado que o usuário está em um computador/desktop.
					<strong>Recomendado para assinaturas que exigem geolocalização e prova de vida confiáveis.</strong>
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-label="Ativar ou desativar restrição de smartphone"
				aria-checked={restringirSmartphone}
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none
					{restringirSmartphone ? 'bg-primary-500' : 'bg-surface-300 dark:bg-surface-600'}"
				onclick={() => (restringirSmartphone = !restringirSmartphone)}
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200
						{restringirSmartphone ? 'translate-x-5' : 'translate-x-0'}"
				></span>
			</button>
		</div>

		<div class="pt-2 border-t border-surface-200 dark:border-white/10 flex items-center justify-between gap-4">
			<p class="text-xs text-surface-400">
				{#if restringirSmartphone}
					<span class="text-success-600 dark:text-success-400 font-medium">Uso restrito a celular</span> — segurança física.
				{:else}
					<span class="text-warning-600 dark:text-warning-400 font-medium">Assinatura liberada em Desktop</span> — conveniência.
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
