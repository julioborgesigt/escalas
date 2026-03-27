<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';

	let { data } = $props();

	const escalas = $derived(data.escalas ?? []);
	const ativa = $derived(data.ativa);
	const papelGise = $derived(data.papelGise);
	const isAdminGeral = $derived(papelGise === 'admin_geral');
	const isSeccional = $derived(papelGise === 'admin_seccional');
	const isSupervisor = $derived(papelGise === 'supervisor');
	const isMembro = $derived(papelGise === 'membro');

	// Modal de criação (Admin Geral)
	let showCriarModal = $state(false);
	let novaDataInicio = $state('');
	let novaDataFim = $state('');
	// Feature 1: horários separados por dia
	let novaHoraEntradaSabado = $state('08');
	let novaHoraSaidaSabado = $state('16');
	let novaHoraEntradaDomingo = $state('08');
	let novaHoraSaidaDomingo = $state('16');
	let criando = $state(false);

	function proximoSabado(): string {
		const hoje = new Date();
		const dia = hoje.getDay();
		const diasAteSabado = (6 - dia + 7) % 7 || 7;
		const sabado = new Date(hoje);
		sabado.setDate(hoje.getDate() + diasAteSabado);
		return sabado.toISOString().slice(0, 10);
	}

	function abrirCriarModal() {
		const sabado = proximoSabado();
		const domingo = new Date(sabado);
		domingo.setDate(new Date(sabado).getDate() + 1);
		novaDataInicio = sabado;
		novaDataFim = domingo.toISOString().slice(0, 10);
		showCriarModal = true;
	}

	async function criarGise() {
		criando = true;
		try {
			const res = await fetch('/api/gise', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					data_inicio: novaDataInicio,
					data_fim: novaDataFim,
					hora_entrada: novaHoraEntradaSabado,
					hora_saida: novaHoraSaidaSabado,
					hora_entrada_sabado: novaHoraEntradaSabado,
					hora_saida_sabado: novaHoraSaidaSabado,
					hora_entrada_domingo: novaHoraEntradaDomingo,
					hora_saida_domingo: novaHoraSaidaDomingo
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? 'Erro ao criar GISE');
			toaster.success({ title: 'Escala GISE criada', description: `ID ${json.id}` });
			showCriarModal = false;
			await invalidateAll();
			goto(`/gise/${json.id}`);
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			criando = false;
		}
	}

	function statusLabel(status: string): string {
		const labels: Record<string, string> = {
			em_preenchimento: 'Em Preenchimento',
			aguardando_assinatura: 'Aguardando Assinatura',
			assinada: 'Assinada',
			finalizada: 'Finalizada',
			retificada: 'Finalizada (Retificada)'
		};
		return labels[status] ?? status;
	}

	function statusColor(status: string): string {
		const colors: Record<string, string> = {
			em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
			assinada: 'bg-success-500/15 text-success-700 dark:text-success-400',
			finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
		};
		return colors[status] ?? '';
	}

	function fmtDate(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}
</script>

<div class="space-y-6">
	<!-- Cabeçalho -->
	<div class="flex items-center justify-between flex-wrap gap-3">
		<div>
			<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Escala GISE</h1>
			<p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
				{#if isAdminGeral}
					Gerenciamento completo das escalas GISE
				{:else if isSeccional}
					Preenchimento da sua seccional
				{:else if isSupervisor}
					Assinatura digital da escala
				{:else}
					Formulários de produtividade
				{/if}
			</p>
		</div>

		{#if isAdminGeral}
			<button
				class="btn preset-filled-primary-500 text-sm font-medium px-4 py-2 rounded-xl"
				onclick={abrirCriarModal}
			>
				+ Nova Escala GISE
			</button>
		{/if}
	</div>

	<!-- Card informativo para servidores escalados (membros comuns) -->
	{#if isMembro}
		<div class="rounded-2xl border border-primary-500/20 bg-primary-500/5 dark:bg-primary-500/10 p-6 text-center space-y-2">
			<svg class="w-10 h-10 mx-auto text-primary-500 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
			</svg>
			<p class="text-base font-semibold text-surface-900 dark:text-surface-100">
				Você está escalado na GISE
			</p>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				Os formulários de produtividade estarão disponíveis em breve nesta área.
			</p>
			{#if ativa}
				<p class="text-xs text-surface-400 mt-1">
					Escala vigente: <span class="font-medium">{fmtDate(ativa.data_inicio)} – {fmtDate(ativa.data_fim)}</span>
				</p>
			{/if}
		</div>
	{/if}

	<!-- Escala Ativa -->
	{#if ativa && !isMembro}
		<div class="rounded-2xl border border-primary-500/30 bg-primary-500/5 dark:bg-primary-500/10 p-5">
			<div class="flex items-start justify-between flex-wrap gap-3">
				<div>
					<div class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></span>
						<span class="text-sm font-semibold text-primary-700 dark:text-primary-400">Escala Ativa</span>
					</div>
					<p class="text-xl font-bold mt-1 text-surface-900 dark:text-surface-50">
						{fmtDate(ativa.data_inicio)} – {fmtDate(ativa.data_fim)}
					</p>
					<div class="flex items-center gap-2 mt-2">
						<span class="text-xs px-2 py-0.5 rounded-full font-semibold {statusColor(ativa.status)}">
							{statusLabel(ativa.status)}
						</span>
						<span class="text-xs text-surface-500">{ativa.hora_entrada}h às {ativa.hora_saida}h</span>
					</div>
				</div>

				<div class="flex items-center gap-3">
					{#if isSupervisor && ativa.status === 'aguardando_assinatura'}
						<button
							class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl"
							onclick={() => goto(`/gise/${ativa.id}`)}
						>
							Assinar Escala
						</button>
					{:else if isSupervisor && ativa.status !== 'aguardando_assinatura'}
						<button
							class="btn preset-tonal-surface text-sm px-4 py-2 rounded-xl"
							onclick={() => {
								toaster.warning({ title: 'A escala não está concluída', description: 'Aguarde todas as seccionais finalizarem o preenchimento.' });
							}}
						>
							Ver Escala
						</button>
					{:else}
						<button
							class="btn preset-tonal-primary text-sm px-4 py-2 rounded-xl"
							onclick={() => goto(`/gise/${ativa.id}`)}
						>
							Acessar
						</button>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 p-8 text-center">
			<p class="text-surface-500 dark:text-surface-400">Nenhuma escala GISE ativa no momento.</p>
			{#if isAdminGeral}
				<button
					class="btn preset-filled-primary-500 text-sm mt-4 px-4 py-2 rounded-xl"
					onclick={abrirCriarModal}
				>
					Criar primeira Escala GISE
				</button>
			{/if}
		</div>
	{/if}

	<!-- Histórico (oculto para membros comuns) -->
	{#if escalas.length > 0 && !isMembro}
		<div>
			<h2 class="text-base font-semibold text-surface-700 dark:text-surface-300 mb-3">Histórico</h2>
			<div class="space-y-2">
				{#each escalas as escala}
					<button
						class="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl border
							border-surface-200 dark:border-surface-800
							bg-surface-50 dark:bg-surface-900
							hover:border-primary-500/40 hover:bg-primary-500/5
							transition-all text-left"
						onclick={() => goto(`/gise/${escala.id}`)}
					>
						<div>
							<p class="text-sm font-semibold text-surface-900 dark:text-surface-100">
								{fmtDate(escala.data_inicio)} – {fmtDate(escala.data_fim)}
							</p>
							<p class="text-xs text-surface-500 mt-0.5">{escala.hora_entrada}h às {escala.hora_saida}h</p>
						</div>
						<span class="text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 {statusColor(escala.status)}">
							{statusLabel(escala.status)}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- Modal Criar GISE -->
{#if showCriarModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Nova Escala GISE</h2>

			<!-- Datas -->
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="novaDataInicio" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Sábado (data)</label>
					<input
						id="novaDataInicio"
						type="date"
						bind:value={novaDataInicio}
						class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
					/>
				</div>
				<div>
					<label for="novaDataFim" class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">Domingo (data)</label>
					<input
						id="novaDataFim"
						type="date"
						bind:value={novaDataFim}
						class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
					/>
				</div>
			</div>

			<!-- Feature 1: Horários separados por dia -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<p class="text-xs font-semibold text-surface-600 dark:text-surface-400">Horários — Sábado</p>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="novaHoraEntradaSab" class="text-xs text-surface-500 block mb-1">Entrada (h)</label>
						<input id="novaHoraEntradaSab" type="number" min="0" max="23"
							bind:value={novaHoraEntradaSabado}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm" />
					</div>
					<div>
						<label for="novaHoraSaidaSab" class="text-xs text-surface-500 block mb-1">Saída (h)</label>
						<input id="novaHoraSaidaSab" type="number" min="0" max="23"
							bind:value={novaHoraSaidaSabado}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm" />
					</div>
				</div>
			</div>

			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<p class="text-xs font-semibold text-surface-600 dark:text-surface-400">Horários — Domingo</p>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="novaHoraEntradaDom" class="text-xs text-surface-500 block mb-1">Entrada (h)</label>
						<input id="novaHoraEntradaDom" type="number" min="0" max="23"
							bind:value={novaHoraEntradaDomingo}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm" />
					</div>
					<div>
						<label for="novaHoraSaidaDom" class="text-xs text-surface-500 block mb-1">Saída (h)</label>
						<input id="novaHoraSaidaDom" type="number" min="0" max="23"
							bind:value={novaHoraSaidaDomingo}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm" />
					</div>
				</div>
			</div>

			<div class="flex justify-end gap-3 pt-2">
				<button
					class="btn preset-tonal-surface text-sm px-4 py-2 rounded-xl"
					onclick={() => (showCriarModal = false)}
				>
					Cancelar
				</button>
				<button
					class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
					onclick={criarGise}
					disabled={criando || !novaDataInicio || !novaDataFim}
				>
					{criando ? 'Criando...' : 'Criar'}
				</button>
			</div>
		</div>
	</div>
{/if}
