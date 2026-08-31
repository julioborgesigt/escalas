<script lang="ts">
	/**
	 * Editor do plano operacional.
	 *
	 * Três blocos, na ordem em que o documento é montado: os parâmetros gerais
	 * (o corpo), as equipes (Anexo I) e o consolidado financeiro (Anexo II).
	 *
	 * O cabeçalho abre RECOLHIDO. Depois da criação ele já está preenchido, e o
	 * trabalho do dia a dia é nas equipes — deixá-lo expandido empurraria a
	 * primeira equipe para fora da tela em todo acesso.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { invalidate } from '$app/navigation';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import CalendarioDia from '$lib/components/CalendarioDia.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarCoordenadores, buscarUnidades, MIN_BUSCA } from '../_components/buscas';
	import { fmtDate } from '$lib/gise/formatters';
	import { formatarBRL } from '$lib/planos/rotulos';
	import EquipeCard from './_components/EquipeCard.svelte';
	import PainelCustos from './_components/PainelCustos.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	const { data, form }: PageProps = $props();

	let cabecalhoAberto = $state(false);

	// svelte-ignore state_referenced_locally
	let dataInicio = $state(data.plano.data_inicio);
	// svelte-ignore state_referenced_locally
	let feriado = $state(data.plano.feriado);

	// Captura intencional: os dois selects passam a ser do usuário depois da
	// primeira renderização, e re-derivá-los apagaria uma escolha em curso.
	// svelte-ignore state_referenced_locally
	let coordenadorId = $state<unknown>(data.plano.coordenador_id);
	// svelte-ignore state_referenced_locally
	let demandanteId = $state<unknown>(data.plano.demandante_unidade_id);

	/** `policial_id` de quem impede a emissão — o card marca esses membros. */
	const pendentes = $derived(new Set(data.custo.pendencias.map((p) => p.policial_id)));

	const efetivoTotal = $derived(data.equipes.reduce((s, e) => s + e.membros.length, 0));

	/** `use:enhance` comum: toast do erro do servidor e revalidação da página. */
	function enviar(mensagemOk: string, aoConcluir?: () => void): SubmitFunction {
		return () => {
			loading.show('A gravar…');
			return async ({ result }: { result: { type: string; data?: unknown } }) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: mensagemOk });
					await invalidate('planos:detalhe');
					aoConcluir?.();
				} else if (result.type === 'failure') {
					const err = (result.data as { error?: string } | undefined)?.error;
					toaster.error({ title: err || 'Não foi possível gravar' });
				}
			};
		};
	}
</script>

<svelte:head>
	<title>Plano {data.plano.numero}/{data.plano.ano} | Escalas</title>
</svelte:head>

<div class="max-w-4xl mx-auto space-y-5 px-1">
	<div>
		<BotaoVoltar href="/gise/planos" />
		<div class="flex flex-wrap items-center gap-2 mt-2">
			<span
				class="rounded-full bg-primary-500/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-primary-700 dark:text-primary-300"
			>
				{data.plano.numero}/{data.plano.ano}
			</span>
			<h1 class="h1 text-2xl font-bold min-w-0">{data.plano.nome}</h1>
		</div>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
			{fmtDate(data.plano.data_inicio)} às {data.plano.hora_inicio}
			{#if data.plano.feriado}
				<span class="text-error-600 dark:text-error-400 font-medium">· feriado</span>
			{/if}
			· {data.equipes.length}
			{data.equipes.length === 1 ? 'equipe' : 'equipes'} · {efetivoTotal} servidor(es) ·
			<strong class="text-surface-800 dark:text-surface-100"
				>{formatarBRL(data.custo.consolidado.totalGeral)}</strong
			>
		</p>
	</div>

	<!-- ---- Parâmetros gerais ---- -->
	<section class="card-elevated rounded-2xl overflow-hidden">
		<button
			type="button"
			class="w-full flex items-center justify-between gap-3 p-5 text-left"
			onclick={() => (cabecalhoAberto = !cabecalhoAberto)}
			aria-expanded={cabecalhoAberto}
		>
			<span>
				<span class="block text-base font-semibold text-surface-900 dark:text-white"
					>Parâmetros gerais</span
				>
				<span class="block text-xs text-surface-600 dark:text-surface-400">
					Finalidade, calendário, coordenador e demandante — o corpo do documento.
				</span>
			</span>
			<ChevronDown
				class="w-5 h-5 shrink-0 transition-transform {cabecalhoAberto ? 'rotate-180' : ''}"
				aria-hidden="true"
			/>
		</button>

		{#if cabecalhoAberto}
			<form
				method="POST"
				action="?/salvarPlano"
				use:enhance={enviar('Plano salvo')}
				class="p-5 pt-0 space-y-4 border-t border-surface-200/70 dark:border-white/10"
			>
				<div class="grid gap-3 sm:grid-cols-2 pt-4">
					<label class="block space-y-1 sm:col-span-2">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
							>Nome da operação</span
						>
						<input name="nome" value={data.plano.nome} maxlength="160" required class="input" />
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200">Nº do NUP</span
						>
						<input name="nup" value={data.plano.nup ?? ''} maxlength="40" class="input" />
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
							>Departamento</span
						>
						<input
							name="departamento"
							value={data.plano.departamento}
							maxlength="60"
							class="input"
						/>
					</label>
				</div>

				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200">Finalidade</span>
					<textarea
						name="finalidade"
						value={data.plano.finalidade}
						rows="4"
						maxlength="2000"
						class="textarea"></textarea>
				</label>

				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
						Ações a serem realizadas <span class="text-surface-600 dark:text-surface-400"
							>(uma por linha)</span
						>
					</span>
					<textarea name="acoes" value={data.plano.acoes} rows="4" maxlength="2000" class="textarea"
					></textarea>
				</label>

				<div class="space-y-2">
					<span class="block text-xs font-medium text-surface-700 dark:text-surface-200"
						>Data da operação</span
					>
					<CalendarioDia bind:valor={dataInicio} bind:feriado />
					<input type="hidden" name="data_inicio" value={dataInicio} />
					{#if feriado}<input type="hidden" name="feriado" value="1" />{/if}
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
							>Apresentação</span
						>
						<input name="hora_inicio" value={data.plano.hora_inicio} class="input" />
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
							Previsão de término <span class="text-surface-600 dark:text-surface-400"
								>(liga a sugestão de horas)</span
							>
						</span>
						<input name="hora_fim" value={data.plano.hora_fim ?? ''} class="input" />
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
							>Data de término</span
						>
						<input type="date" name="data_fim" value={data.plano.data_fim ?? ''} class="input" />
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
							>OIPs por equipe (referência)</span
						>
						<input
							type="number"
							name="oip_por_equipe"
							value={data.plano.oip_por_equipe_padrao}
							min="0"
							max="99"
							class="input"
						/>
					</label>
				</div>

				<div class="space-y-1">
					<label
						for="coord"
						class="block text-xs font-medium text-surface-700 dark:text-surface-200"
					>
						DPC coordenador
					</label>
					<SearchableSelect
						id="coord"
						name="coordenador_id"
						bind:value={coordenadorId}
						loadOptions={buscarCoordenadores}
						minSearchChars={MIN_BUSCA}
						placeholder="Busque por nome ou matrícula"
					/>
				</div>

				<div class="space-y-1">
					<label for="dem" class="block text-xs font-medium text-surface-700 dark:text-surface-200">
						Delegacia / seccional demandante
					</label>
					<SearchableSelect
						id="dem"
						name="demandante_unidade_id"
						bind:value={demandanteId}
						loadOptions={buscarUnidades}
						minSearchChars={MIN_BUSCA}
						placeholder="Busque a unidade"
					/>
				</div>

				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
						>Local de briefing padrão</span
					>
					<input
						name="local_briefing_padrao"
						value={data.plano.local_briefing_padrao}
						maxlength="200"
						class="input"
					/>
				</label>

				{#if form?.error}
					<p class="text-xs text-error-600 dark:text-error-400">{form.error}</p>
				{/if}

				<div class="flex justify-end">
					<button
						type="submit"
						class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm"
						disabled={loading.active}
					>
						Salvar parâmetros
					</button>
				</div>
			</form>
		{/if}
	</section>

	<!-- ---- Equipes (Anexo I) ---- -->
	<section class="space-y-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div>
				<h2 class="text-base font-semibold text-surface-900 dark:text-white">
					Anexo I — equipes e efetivo
				</h2>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Viatura, destino, briefing e custo de cada equipe.
				</p>
			</div>
			<div class="flex gap-2">
				<form method="POST" action="?/adicionarEquipe" use:enhance={enviar('Equipe acrescentada')}>
					<input type="hidden" name="tipo" value="operacional" />
					<button
						type="submit"
						class="btn btn-sm preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-xs"
					>
						<Plus class="w-3.5 h-3.5" />
						Equipe
					</button>
				</form>
				<form method="POST" action="?/adicionarEquipe" use:enhance={enviar('Equipe SEINT criada')}>
					<input type="hidden" name="tipo" value="seint" />
					<button
						type="submit"
						class="btn btn-sm preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-xs"
					>
						<Plus class="w-3.5 h-3.5" />
						SEINT
					</button>
				</form>
			</div>
		</div>

		{#if data.equipes.length === 0}
			<p
				class="rounded-2xl border border-dashed border-surface-300 dark:border-white/10 p-6 text-center text-sm text-surface-600 dark:text-surface-400"
			>
				Nenhuma equipe. Use os botões acima para acrescentar.
			</p>
		{:else}
			<ul class="space-y-3">
				{#each data.equipes as eq (eq.id)}
					{#key `${eq.id}-${eq.tipo_custo}-${eq.horas_normais}-${eq.horas_plus}-${eq.diarias_meias}`}
						<EquipeCard equipe={eq} {enviar} {pendentes} />
					{/key}
				{/each}
			</ul>
		{/if}
	</section>

	<!-- ---- Custos (Anexo II) ---- -->
	<PainelCustos custo={data.custo} versaoValores={data.versaoValores} />

	<!-- ---- Ações do documento ---- -->
	<section class="card-elevated rounded-2xl p-5 space-y-3">
		<h2 class="text-base font-semibold text-surface-900 dark:text-white">Documento</h2>

		<div class="flex flex-wrap gap-2">
			<a
				href="/api/planos/{data.plano.id}/download"
				class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm {data.podeEmitir
					? ''
					: 'pointer-events-none opacity-50'}"
				aria-disabled={!data.podeEmitir}
			>
				Baixar plano operacional (PDF)
			</a>

			<form
				method="POST"
				action="?/ressincronizarCadastro"
				use:enhance={enviar('Cargo/classe reaplicados do cadastro')}
			>
				<button
					type="submit"
					class="btn preset-outlined-surface-500 py-2.5 px-4 rounded-xl text-sm"
					title="Reaplica cargo e classe atuais do cadastro aos membros já alocados"
				>
					<RefreshCw class="w-4 h-4" />
					Reaplicar cargo/classe do cadastro
				</button>
			</form>

			<form method="POST" action="?/alternarStatus" use:enhance={enviar('Status alterado')}>
				<button
					type="submit"
					class="btn preset-outlined-surface-500 py-2.5 px-4 rounded-xl text-sm"
				>
					{data.plano.status === 'concluido' ? 'Reabrir como rascunho' : 'Marcar como concluído'}
				</button>
			</form>
		</div>

		{#if !data.podeEmitir}
			<p class="text-xs text-error-600 dark:text-error-400">
				O PDF fica bloqueado enquanto houver servidor sem classe resolvida em equipe com custo —
				emitir assim produziria um documento orçado a menor.
			</p>
		{/if}
	</section>
</div>
