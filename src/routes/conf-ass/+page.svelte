<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
	import { invalidateAll } from '$app/navigation';
	import { loading } from '$lib/loading.svelte';

	let exigirFoto = $state(page.data.exigirFoto as boolean);
	let exigirGps = $state(page.data.exigirGps as boolean);
	// `exigirCodigoEmail` é fixo `true` (requisito legal da assinatura avançada);
	// mantido como const local para o body do PUT (idempotente).
	const exigirCodigoEmail = true;
	let restringirSmartphone = $state(page.data.restringirSmartphone as boolean);

	// Metadados vindos do +page.server.ts — referência legal e classificação.
	const nivelEfetivo = page.data.nivelEfetivo as 'simples' | 'avancada';
	const baseLegalAtual = page.data.baseLegalAtual as string;
	const requisitosSempreAtivos = page.data.requisitosSempreAtivos as Array<{
		id: string;
		descricao: string;
		baseLegal: string;
	}>;
	const requisitosObrigatorios = page.data.requisitosObrigatorios as Array<{
		id: string;
		flag: string;
		descricao: string;
		baseLegal: string;
	}>;
	const reforcosOpcionais = page.data.reforcosOpcionais as Array<{
		id: string;
		flag: string;
		descricao: string;
		valorProbatorio: string;
		notas: string;
	}>;

	async function salvar() {
		loading.show('Salvando configurações...');
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
			loading.hide();
		}
	}

	// Score de reforços opcionais (informativo — não altera a classificação legal).
	const reforcoScore = $derived(
		(exigirFoto ? 1 : 0) + (exigirGps ? 1 : 0) + (restringirSmartphone ? 1 : 0)
	);
	const reforcoNivel = $derived(
		reforcoScore >= 3
			? 'Máximo'
			: reforcoScore >= 2
				? 'Médio'
				: reforcoScore >= 1
					? 'Básico'
					: 'Mínimo'
	);
	const reforcoCor = $derived(
		reforcoScore >= 3
			? 'text-success-600 dark:text-success-400 bg-success-500/10'
			: reforcoScore >= 1
				? 'text-warning-600 dark:text-warning-400 bg-warning-500/10'
				: 'text-surface-600 dark:text-surface-400 bg-surface-500/10'
	);
</script>

<svelte:head>
	<title>Conf. Assinatura | Escalas</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-8">
	<h1 class="h2 font-bold mb-1">Configurações de Assinatura</h1>
	<p class="text-surface-500 text-sm mb-6">
		Parâmetros globais que afetam todas as assinaturas em tela do sistema.
	</p>

	<!-- Painel de classificação legal: indica o nível efetivo das assinaturas
	     em tela e os requisitos legais que NÃO podem ser desligados. -->
	<div
		class="card p-4 sm:p-6 mb-6 bg-gradient-to-br from-primary-50/40 to-surface-50 dark:from-primary-900/20 dark:to-surface-900 border border-primary-300/40 dark:border-primary-700/30 rounded-2xl"
	>
		<div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
			<div>
				<p class="text-[10px] font-black uppercase tracking-widest text-surface-500">
					Nível Legal das Assinaturas em Tela
				</p>
				<p class="text-xl font-black text-surface-900 dark:text-white mt-1">
					{nivelEfetivo === 'avancada' ? 'AVANÇADA' : 'SIMPLES'}
				</p>
				<p class="text-[11px] text-surface-500 italic mt-0.5">
					Base legal: {baseLegalAtual}
				</p>
			</div>
			<span
				class="badge font-black px-3 py-1.5 rounded-full text-[0.7rem] uppercase whitespace-nowrap
				{nivelEfetivo === 'avancada'
					? 'text-success-600 dark:text-success-400 bg-success-500/10'
					: 'text-warning-600 dark:text-warning-400 bg-warning-500/10'}"
			>
				{nivelEfetivo === 'avancada' ? 'Lei 14.063/20 art. 4º II' : 'Lei 14.063/20 art. 4º I'}
			</span>
		</div>

		<!-- Sempre ativos -->
		<details class="text-[11px] mt-3">
			<summary
				class="cursor-pointer font-bold text-surface-600 dark:text-surface-400 hover:text-primary-500"
			>
				Garantias sempre ativas no sistema ({requisitosSempreAtivos.length})
			</summary>
			<ul class="mt-2 space-y-1 pl-4">
				{#each requisitosSempreAtivos as r (r.id)}
					<li class="text-surface-700 dark:text-surface-300">
						<span class="text-success-600 font-black">✓</span>
						{r.descricao}
						<br />
						<span class="text-surface-400 italic ml-3">{r.baseLegal}</span>
					</li>
				{/each}
			</ul>
		</details>

		<!-- Obrigatórios para Avançada -->
		<details class="text-[11px] mt-2" open>
			<summary
				class="cursor-pointer font-bold text-surface-600 dark:text-surface-400 hover:text-primary-500"
			>
				Requisitos mínimos para AVANÇADA (bloqueados) ({requisitosObrigatorios.length})
			</summary>
			<ul class="mt-2 space-y-1 pl-4">
				{#each requisitosObrigatorios as r (r.id)}
					<li class="text-surface-700 dark:text-surface-300">
						<span class="text-primary-600 font-black">🔒</span>
						{r.descricao}
						<br />
						<span class="text-surface-400 italic ml-3">{r.baseLegal}</span>
					</li>
				{/each}
			</ul>
		</details>

		<!-- Reforços opcionais -->
		<details class="text-[11px] mt-2">
			<summary
				class="cursor-pointer font-bold text-surface-600 dark:text-surface-400 hover:text-primary-500"
			>
				Reforços opcionais ({reforcosOpcionais.length}) — não alteram a classificação legal
			</summary>
			<ul class="mt-2 space-y-1 pl-4">
				{#each reforcosOpcionais as r (r.id)}
					<li class="text-surface-700 dark:text-surface-300">
						{r.descricao}
						<span
							class="text-[9px] uppercase font-black ml-1 px-1 rounded bg-surface-200 dark:bg-surface-700"
						>
							valor {r.valorProbatorio}
						</span>
						<br />
						<span class="text-surface-400 italic ml-3">{r.notas}</span>
					</li>
				{/each}
			</ul>
		</details>
	</div>

	<div
		class="card p-4 sm:p-6 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl space-y-4 sm:space-y-6"
	>
		<!-- Exigir foto -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Exigir foto do assinante (Prova de Vida)</p>
				<p class="text-xs text-surface-500">
					Quando ativado, o sistema solicita que o assinante tire uma selfie via câmera com detecção
					de rosto antes de confirmar a assinatura em tela. Desativando, a prova de vida por imagem
					não será solicitada.
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
					Quando ativado, o sistema tenta capturar as coordenadas GPS do assinante no momento da
					assinatura em tela. Desativando, nenhuma localização é solicitada ao dispositivo.
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

		<!-- Exigir Código via E-mail — BLOQUEADO (requisito legal Lei 14.063/2020 art. 4º II "b") -->
		<div class="flex items-start justify-between gap-4 opacity-90">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5 flex items-center gap-1.5">
					Exigir código via E-mail
					<span
						class="text-[8px] uppercase font-black px-1.5 py-0.5 rounded bg-primary-500/15 text-primary-700 dark:text-primary-300 tracking-widest"
						title="Requisito legal — Lei 14.063/2020 art. 4º II"
					>
						🔒 Obrigatório
					</span>
				</p>
				<p class="text-xs text-surface-500">
					Confirmação por código numérico de 6 dígitos no e-mail cadastrado. Este requisito é o que
					caracteriza a assinatura como
					<strong>AVANÇADA</strong> nos termos da
					<strong>Lei 14.063/2020 art. 4º II "b"</strong> (controle exclusivo dos dados de criação).
					Sem ele, as assinaturas em tela seriam classificadas como
					<strong>SIMPLES</strong> (art. 4º I), exigindo aceite expresso da contraparte para serem
					oponíveis (art. 5º I) — por isso não pode ser desligado.
					<strong class="text-error-500 block mt-1"
						>Atenção: Os usuários precisam ter e-mail funcional cadastrado no perfil.</strong
					>
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-label="Bloqueado por requisito legal (Lei 14.063/2020 art. 4º II)"
				aria-checked={true}
				disabled
				class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none bg-primary-500 cursor-not-allowed"
				title="Bloqueado por requisito legal"
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200 translate-x-5"
				></span>
			</button>
		</div>

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Restringir a Smartphone -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Restringir assinatura em tela a Smartphone</p>
				<p class="text-xs text-surface-500">
					Quando ativado, o sistema bloqueia o desenho da assinatura e a captura de foto/GPS se
					detectado que o usuário está em um computador/desktop.
					<strong
						>Recomendado para assinaturas que exigem geolocalização e prova de vida confiáveis.</strong
					>
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

		<div
			class="p-4 sm:p-5 border-t border-surface-200 dark:border-white/10 bg-surface-100/30 dark:bg-surface-800/20 rounded-b-2xl space-y-4"
		>
			<div class="flex items-center justify-between gap-4">
				<div class="flex flex-col gap-0.5">
					<div class="flex items-center gap-2">
						<span class="text-[10px] font-bold uppercase tracking-wider text-surface-500"
							>Reforços ativos:</span
						>
						<span
							class="badge {reforcoCor} font-black px-3 py-1 rounded-full text-[0.65rem] uppercase"
							>{reforcoNivel} ({reforcoScore}/3)</span
						>
					</div>
					<span class="text-[10px] text-surface-400 italic">
						Não alteram a classificação legal (sempre AVANÇADA), apenas o valor probatório em juízo.
					</span>
				</div>
				<button
					type="button"
					class="btn preset-filled-primary-500 text-sm px-6 py-2.5 flex items-center gap-2 shadow-lg shadow-primary-500/20 hover:scale-[1.02] active:scale-95 transition-all font-bold"
					onclick={salvar}
					disabled={loading.active}
				>
					{loading.active ? 'Gravando...' : 'Salvar'}
				</button>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				{#if restringirSmartphone}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-success-500/5 border border-success-500/10"
					>
						<svg
							class="w-4 h-4 text-success-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
							/></svg
						>
						<p class="text-[0.65rem] text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Antifraude Físico:</strong> Garante que a assinatura ocorra em um dispositivo móvel
							pessoal.
						</p>
					</div>
				{:else}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-warning-500/5 border border-warning-500/10"
					>
						<svg
							class="w-4 h-4 text-warning-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
							/></svg
						>
						<p class="text-[0.65rem] text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Modo Conveniência:</strong> Assinatura permitida em computadores compartilhados
							ou desktops.
						</p>
					</div>
				{/if}

				{#if exigirFoto}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-secondary-500/5 border border-secondary-500/10"
					>
						<svg
							class="w-4 h-4 text-secondary-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
							/><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
							/></svg
						>
						<p class="text-[0.65rem] text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Prova de Vida:</strong> Uma selfie com reconhecimento facial será capturada no memento
							da assinatura.
						</p>
					</div>
				{/if}

				{#if exigirGps}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-error-500/5 border border-error-500/10"
					>
						<svg
							class="w-4 h-4 text-error-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
							/><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
							/></svg
						>
						<p class="text-[0.65rem] text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Geolocalização:</strong> As coordenadas geográficas serão registradas para auditoria
							de local.
						</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
