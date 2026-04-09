<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { giseCriarSchema } from '$lib/schemas';

	let { data } = $props();

	const escalas = $derived(data.escalas ?? []);
	const ativas = $derived(escalas.filter((e: any) => e.status !== 'finalizada'));
	const historico = $derived(escalas.filter((e: any) => e.status === 'finalizada'));
	const papelGise = $derived(data.papelGise);
	const isAdminGeral = $derived(papelGise === 'admin_geral');
	const isSeccional = $derived(papelGise === 'admin_seccional');
	const isSupervisor = $derived(papelGise === 'supervisor');
	const isMembro = $derived(papelGise === 'membro');

	// Modal de criação (Admin Geral)
	let showCriarModal = $state(false);

	const {
		form,
		errors,
		constraints,
		enhance,
		submitting,
		delayed
	// svelte-ignore state_referenced_locally
	} = superForm(data.form, {
		validators: zod4Client(giseCriarSchema),
		invalidateAll: false,
		onUpdated: async ({ form }) => {
			if (form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.type === 'success') {
						const count = msg.count ?? 1;
						const primeiroId = msg.ids?.[0];
						toaster.success({ title: `${count} escala(s) GISE criada(s)` });
						showCriarModal = false;
						await invalidateAll();
						if (primeiroId) goto(`/gise/${primeiroId}?edit=true`);
					} else {
						toaster.error({ title: msg.error || 'Erro ao criar GISE' });
					}
				} catch (e) {}
			} else if (!form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.error) toaster.error({ title: msg.error });
				} catch(e) {}
			}
		}
	});

	function hoje(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function abrirCriarModal() {
		$form.data_inicio = hoje();
		$form.data_fim = hoje();
		$form.hora_entrada = '08:00';
		$form.hora_saida = '16:00';
		$form.modo = 'completa';
		if (escalas.length > 0) {
			$form.clonar_de = escalas[0].id;
		} else {
			$form.clonar_de = '';
		}
		showCriarModal = true;
	}

	function statusLabel(status: string): string {
		const labels: Record<string, string> = {
			em_definicao_supervisor: 'Em definição do supervisor',
			em_preenchimento: 'Preenchendo escalados',
			aguardando_assinatura: 'Aguardando assinatura do supervisor',
			em_andamento: 'GISE em operação',
			aguardando_relatorios: 'Aguardando relatórios',
			aguardando_assinatura_relat: 'Aguardando assinatura dos Rel. de Extra',
			pronta_para_finalizar: 'Pronta para finalizar',
			finalizada: 'Concluída'
		};
		return labels[status] ?? status;
	}

	function statusColor(status: string): string {
		const colors: Record<string, string> = {
			em_definicao_supervisor: 'bg-surface-500/15 text-surface-600 dark:text-surface-300',
			em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
			em_andamento: 'bg-success-500/15 text-success-700 dark:text-success-400',
			aguardando_relatorios: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura_relat: 'bg-tertiary-500/15 text-tertiary-700 dark:text-tertiary-400',
			pronta_para_finalizar: 'bg-success-500/20 text-success-800 dark:text-success-300',
			finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
		};
		return colors[status] ?? '';
	}

	function fmtDate(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	function diaSemana(iso: string): string {
		if (!iso) return '';
		const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
		return dias[new Date(iso + 'T12:00:00').getDay()];
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

	<!-- Card informativo para membros comuns -->
	{#if isMembro}
		<div
			class="rounded-2xl border border-primary-500/20 bg-primary-500/5 dark:bg-primary-500/10 p-6 text-center space-y-2"
		>
			<p class="text-base font-semibold text-surface-900 dark:text-surface-100">
				Você está escalado na GISE
			</p>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				Os formulários de produtividade estarão disponíveis nesta área.
			</p>
			{#if ativas.length > 0}
				<div class="mt-2 space-y-1">
					{#each ativas as ativa}
						<p class="text-xs text-surface-400">
							Escala vigente: <span class="font-medium"
								>{diaSemana(ativa.data_inicio)}
								{fmtDate(ativa.data_inicio)}</span
							>
						</p>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Escala Ativa -->
	{#if ativas.length > 0 && !isMembro}
		<h2 class="text-base font-semibold text-surface-700 dark:text-surface-300 mb-2">
			Escalas Ativas
		</h2>
		<div class="space-y-3">
			{#each ativas as ativa}
				<div
					class="rounded-2xl border border-primary-500/30 bg-primary-500/5 dark:bg-primary-500/10 p-5"
				>
					<div class="flex items-start justify-between flex-wrap gap-3">
						<div>
							<div class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></span>
								<span class="text-sm font-semibold text-primary-700 dark:text-primary-400"
									>Escala Ativa #{ativa.id}</span
								>
							</div>
							<p class="text-xl font-bold mt-1 text-surface-900 dark:text-surface-50">
								{diaSemana(ativa.data_inicio)}, {fmtDate(ativa.data_inicio)}
							</p>
							<div class="flex items-center gap-2 mt-2">
								<span
									class="text-xs px-2 py-0.5 rounded-full font-semibold {statusColor(ativa.status)}"
								>
									{statusLabel(ativa.status)}
								</span>
								<span class="text-xs text-surface-500"
									>{ativa.hora_entrada} às {ativa.hora_saida}</span
								>
							</div>
						</div>

						<div class="flex items-center gap-3">
							{#if isSupervisor && ativa.status === 'aguardando_assinatura'}
								<button
									class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl"
									onclick={() => goto(`/gise/${ativa.id}`)}
								>
									{ativa.temSaidaConfirmada ? 'Assinar Rel. extra' : 'Assinar Escala'}
								</button>
							{:else}
								<button
									class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
									onclick={() => goto(`/gise/${ativa.id}`)}
								>
									Acessar
								</button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if !isMembro}
		<div
			class="rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 p-8 text-center"
		>
			<p class="text-surface-500 dark:text-surface-400">Nenhuma escala GISE ativa no momento.</p>
		</div>
	{/if}

	<!-- Histórico -->
	{#if historico.length > 0 && !isMembro}
		<div class="mt-8">
			<h2 class="text-base font-semibold text-surface-700 dark:text-surface-300 mb-3">Histórico</h2>
			<div class="space-y-2">
				{#each historico as escala}
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
								{diaSemana(escala.data_inicio)}, {fmtDate(escala.data_inicio)}
								<span class="ml-1 opacity-50 font-normal">#{escala.id}</span>
							</p>
							<p class="text-xs text-surface-500 mt-0.5">
								{escala.hora_entrada} às {escala.hora_saida}
							</p>
						</div>
						<span
							class="text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 {statusColor(
								escala.status
							)}"
						>
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
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
		>
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Nova Escala GISE</h2>
			<p class="text-xs text-surface-500">
				Selecione uma data ou intervalo de datas. O sistema criará uma escala independente por dia.
			</p>

			<form method="POST" action="?/criar" use:enhance class="contents space-y-4">
			<!-- Datas -->
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label
						for="novaDataInicio"
						class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1"
						>Data início</label
					>
					<input
						id="novaDataInicio"
						name="data_inicio"
						type="date"
						bind:value={$form.data_inicio}
						{...$constraints.data_inicio}
						aria-invalid={$errors.data_inicio ? 'true' : undefined}
						class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {$errors.data_inicio ? 'border-error-500 input-error' : 'border-surface-300 dark:border-surface-700'}"
					/>
					{#if $errors.data_inicio}<span class="text-error-500 text-[10px]">{$errors.data_inicio[0]}</span>{/if}
				</div>
				<div>
					<label
						for="novaDataFim"
						class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1"
						>Data fim (opcional)</label
					>
					<input
						id="novaDataFim"
						name="data_fim"
						type="date"
						bind:value={$form.data_fim}
						{...$constraints.data_fim}
						min={$form.data_inicio}
						aria-invalid={$errors.data_fim ? 'true' : undefined}
						class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {$errors.data_fim ? 'border-error-500 input-error' : 'border-surface-300 dark:border-surface-700'}"
					/>
					{#if $errors.data_fim}<span class="text-error-500 text-[10px]">{$errors.data_fim[0]}</span>{/if}
				</div>
			</div>

			<!-- Horários -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<p class="text-xs font-semibold text-surface-600 dark:text-surface-400">
					Horário padrão (aplicado a todos os dias)
				</p>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="novaHoraEntrada" class="text-xs text-surface-500 block mb-1">Entrada</label>
						<input
							id="novaHoraEntrada"
							name="hora_entrada"
							type="text"
							placeholder="Ex: 08:00"
							bind:value={$form.hora_entrada}
							{...$constraints.hora_entrada}
							aria-invalid={$errors.hora_entrada ? 'true' : undefined}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {$errors.hora_entrada
								? 'border-error-500 input-error'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
						{#if $errors.hora_entrada}<span class="text-error-500 text-[10px]">{$errors.hora_entrada[0]}</span>{/if}
					</div>
					<div>
						<label for="novaHoraSaida" class="text-xs text-surface-500 block mb-1">Saída</label>
						<input
							id="novaHoraSaida"
							name="hora_saida"
							type="text"
							placeholder="Ex: 16:00"
							bind:value={$form.hora_saida}
							{...$constraints.hora_saida}
							aria-invalid={$errors.hora_saida ? 'true' : undefined}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {$errors.hora_saida
								? 'border-error-500 input-error'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
						{#if $errors.hora_saida}<span class="text-error-500 text-[10px]">{$errors.hora_saida[0]}</span>{/if}
					</div>
				</div>
			</div>

			<!-- Tipo de Criação -->
			<div class="space-y-3">
				<p class="text-xs font-semibold text-surface-600 dark:text-surface-400">Tipo de Escala</p>
				<input type="hidden" name="modo" bind:value={$form.modo} />
				<div class="grid grid-cols-2 gap-3">
					<button
						type="button"
						class="btn py-3 rounded-xl flex flex-col items-center gap-1 border transition-all {$form.modo ===
						'completa'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => ($form.modo = 'completa')}
					>
						<span class="font-bold text-xs">Escala Completa</span>
						<span class="text-[0.6rem] opacity-70">Seccionais padrão</span>
					</button>
					<button
						type="button"
						class="btn py-3 rounded-xl flex flex-col items-center gap-1 border transition-all {$form.modo ===
						'clonada'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => ($form.modo = 'clonada')}
						disabled={escalas.length === 0}
					>
						<span class="font-bold text-xs">Copiar de...</span>
						<span class="text-[0.6rem] opacity-70">Equipes de outra escala</span>
					</button>
				</div>

				{#if $form.modo === 'clonada'}
					<div class="mt-2 animate-in fade-in slide-in-from-top-1 duration-300">
						<label
							for="clonarDe"
							class="text-[0.65rem] font-medium text-surface-500 dark:text-surface-400 block mb-1"
							>Escolha a escala de origem</label
						>
						<select
							id="clonarDe"
							name="clonar_de"
							bind:value={$form.clonar_de}
							aria-invalid={$errors.clonar_de ? 'true' : undefined}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {$errors.clonar_de ? 'border-error-500 input-error' : 'border-surface-300 dark:border-surface-700'}"
						>
							<option value="" disabled>Selecione uma escala</option>
							{#each escalas.slice(0, 10) as esc}
								<option value={esc.id}>
									GISE — {diaSemana(esc.data_inicio)}
									{fmtDate(esc.data_inicio)} ({esc.status})
								</option>
							{/each}
						</select>
						{#if $errors.clonar_de}<span class="text-error-500 text-[10px]">{$errors.clonar_de[0]}</span>{/if}
					</div>
				{/if}
			</div>

			<div class="flex justify-end gap-3 pt-2">
				<button
					type="button"
					class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
					onclick={() => (showCriarModal = false)}
				>
					Cancelar
				</button>
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
					disabled={$submitting || !$form.data_inicio || ($form.modo === 'clonada' && !$form.clonar_de)}
				>
					{#if $delayed}<Spinner size="sm" />{/if}
					{$submitting ? 'Criando...' : 'Criar Escala'}
				</button>
			</div>
			</form>
		</div>
	</div>
{/if}
