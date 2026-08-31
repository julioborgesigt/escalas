<script lang="ts">
	/**
	 * Criação do plano operacional — os parâmetros gerais.
	 *
	 * Rota, e não modal (README §10): são quinze campos mais o calendário. O
	 * agrupamento segue a ordem do documento — identificação, calendário, quem
	 * demanda e quem coordena, e por fim a estrutura inicial das equipes.
	 *
	 * Tudo aqui é EDITÁVEL depois no editor do plano. O que se pede na criação é
	 * só o que o plano precisa para existir com um número e uma data; obrigar o
	 * preenchimento completo antes de criar transformaria a tela num muro.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import CalendarioDia from '$lib/components/CalendarioDia.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarCoordenadores, buscarUnidades, MIN_BUSCA } from '../_components/buscas';
	import { DEPARTAMENTO_PADRAO } from '$lib/planos/padroes';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	const { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let dataInicio = $state(data.hoje);
	let feriado = $state(false);
	let horaInicio = $state('05:00');
	let horaFim = $state('11:00');
	let dataFim = $state('');
	let nome = $state('');
	let nup = $state('');
	// svelte-ignore state_referenced_locally
	let finalidade = $state(data.finalidadePadrao);
	// svelte-ignore state_referenced_locally
	let acoes = $state(data.acoesPadrao);
	let localBriefing = $state('');
	let qtdEquipes = $state(3);
	let oipPorEquipe = $state(4);
	let temSeint = $state(false);

	let coordenadorId = $state<unknown>(null);
	let demandanteId = $state<unknown>(null);

	const podeCriar = $derived(nome.trim().length > 0 && dataInicio !== '');
</script>

<svelte:head><title>Novo plano operacional | Escalas</title></svelte:head>

<div class="max-w-3xl mx-auto space-y-5 px-1">
	<div>
		<BotaoVoltar href="/gise/planos" />
		<h1 class="h1 text-2xl font-bold mt-2">Novo plano operacional</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
			Os parâmetros gerais da operação. Tudo pode ser ajustado depois — viaturas, destinos, efetivo
			e custos são preenchidos por equipe no editor.
		</p>
	</div>

	{#if !data.temValores}
		<p
			class="flex gap-2 rounded-xl border border-warning-500/30 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300"
		>
			<TriangleAlert class="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
			<span>
				Ainda não há tabela de valores gravada. O plano pode ser criado, mas o Anexo II sairia
				zerado — peça ao Super Administrador para preencher <strong>Valores de custo</strong> antes de
				emitir o documento.
			</span>
		</p>
	{/if}

	<form
		method="POST"
		action="?/criar"
		use:enhance={() => {
			loading.show('Criando o plano…');
			return async ({ result, update }) => {
				loading.hide();
				if (result.type === 'failure') {
					toaster.error({ title: String(result.data?.error ?? 'Não foi possível criar') });
				}
				await update({ reset: false });
			};
		}}
		class="space-y-5"
	>
		<!-- ---- Identificação ---- -->
		<section class="card-elevated rounded-2xl p-5 space-y-4">
			<h2 class="text-base font-semibold text-surface-900 dark:text-white">Identificação</h2>

			<label class="block space-y-1">
				<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
					>Nome da operação</span
				>
				<input
					name="nome"
					bind:value={nome}
					maxlength="160"
					required
					placeholder="CUMPRIMENTO DE MANDADOS JUDICIAIS"
					class="input"
				/>
			</label>

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
						Nº do NUP <span class="text-surface-600 dark:text-surface-400">(opcional)</span>
					</span>
					<input name="nup" bind:value={nup} maxlength="40" class="input" />
				</label>
				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
						>Departamento responsável</span
					>
					<input name="departamento" value={DEPARTAMENTO_PADRAO} maxlength="60" class="input" />
				</label>
			</div>

			<label class="block space-y-1">
				<span class="text-xs font-medium text-surface-700 dark:text-surface-200">Finalidade</span>
				<textarea
					name="finalidade"
					bind:value={finalidade}
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
				<textarea name="acoes" bind:value={acoes} rows="4" maxlength="2000" class="textarea"
				></textarea>
			</label>
		</section>

		<!-- ---- Calendário ---- -->
		<section class="card-elevated rounded-2xl p-5 space-y-4">
			<div>
				<h2 class="text-base font-semibold text-surface-900 dark:text-white">Calendário</h2>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					A data e o horário decidem se a operação gera hora extra, e de qual tipo.
				</p>
			</div>

			<CalendarioDia bind:valor={dataInicio} bind:feriado />
			<input type="hidden" name="data_inicio" value={dataInicio} />
			{#if feriado}<input type="hidden" name="feriado" value="1" />{/if}

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
						>Horário de apresentação</span
					>
					<input name="hora_inicio" bind:value={horaInicio} placeholder="05:00" class="input" />
				</label>
				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
						Previsão de término <span class="text-surface-600 dark:text-surface-400"
							>(opcional)</span
						>
					</span>
					<input name="hora_fim" bind:value={horaFim} placeholder="11:00" class="input" />
				</label>
			</div>

			<label class="block space-y-1">
				<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
					Data de término <span class="text-surface-600 dark:text-surface-400"
						>(só se a operação virar o dia)</span
					>
				</span>
				<input type="date" name="data_fim" bind:value={dataFim} class="input" />
			</label>

			<p class="text-2xs text-surface-600 dark:text-surface-400">
				Sem previsão de término, o sistema não sugere a quantidade de horas — ela é digitada por
				equipe no editor.
			</p>
		</section>

		<!-- ---- Comando e demanda ---- -->
		<section class="card-elevated rounded-2xl p-5 space-y-4">
			<h2 class="text-base font-semibold text-surface-900 dark:text-white">Comando e demanda</h2>

			<div class="space-y-1">
				<label
					for="coordenador"
					class="block text-xs font-medium text-surface-700 dark:text-surface-200"
				>
					DPC coordenador da operação
				</label>
				<SearchableSelect
					id="coordenador"
					name="coordenador_id"
					bind:value={coordenadorId}
					loadOptions={buscarCoordenadores}
					minSearchChars={MIN_BUSCA}
					placeholder="Busque por nome ou matrícula"
				/>
			</div>

			<div class="space-y-1">
				<label
					for="demandante"
					class="block text-xs font-medium text-surface-700 dark:text-surface-200"
				>
					Delegacia / seccional demandante
				</label>
				<SearchableSelect
					id="demandante"
					name="demandante_unidade_id"
					bind:value={demandanteId}
					loadOptions={buscarUnidades}
					minSearchChars={MIN_BUSCA}
					placeholder="Busque a unidade"
				/>
			</div>

			<label class="block space-y-1">
				<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
					Local de briefing padrão
				</span>
				<input
					name="local_briefing_padrao"
					bind:value={localBriefing}
					maxlength="200"
					placeholder="Sede da 4ª Seccional do Interior Sul"
					class="input"
				/>
				<span class="block text-2xs text-surface-600 dark:text-surface-400">
					Cada equipe pode ter um local diferente — inclusive em outro estado.
				</span>
			</label>
		</section>

		<!-- ---- Equipes ---- -->
		<section class="card-elevated rounded-2xl p-5 space-y-4">
			<div>
				<h2 class="text-base font-semibold text-surface-900 dark:text-white">Estrutura inicial</h2>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					As equipes nascem como "Equipe 01", "Equipe 02"… e podem ser renomeadas, acrescentadas ou
					removidas no editor.
				</p>
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
						>Quantidade de equipes</span
					>
					<input
						type="number"
						name="qtd_equipes"
						bind:value={qtdEquipes}
						min="0"
						max="50"
						class="input"
					/>
				</label>
				<label class="block space-y-1">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
						>OIPs por equipe</span
					>
					<input
						type="number"
						name="oip_por_equipe"
						bind:value={oipPorEquipe}
						min="0"
						max="99"
						class="input"
					/>
					<span class="block text-2xs text-surface-600 dark:text-surface-400">
						Referência para montar o efetivo; cada equipe pode ter tamanho próprio.
					</span>
				</label>
			</div>

			<label
				class="flex items-start gap-3 rounded-xl border border-surface-200 dark:border-white/10 p-3 cursor-pointer"
			>
				<input type="checkbox" name="tem_seint" bind:checked={temSeint} class="checkbox mt-0.5" />
				<span class="space-y-0.5">
					<span class="block text-sm font-medium text-surface-900 dark:text-white"
						>Incluir equipe SEINT</span
					>
					<span class="block text-2xs text-surface-600 dark:text-surface-400">
						Uma só, atendendo todas as operacionais. Nasce como "Equipe SEINT".
					</span>
				</span>
			</label>
		</section>

		{#if form?.error}
			<p
				class="rounded-xl border border-error-500/30 bg-error-500/10 p-3 text-sm text-error-700 dark:text-error-300"
			>
				{form.error}
			</p>
		{/if}

		<div class="flex justify-end gap-2 pb-4">
			<a href="/gise/planos" class="btn preset-outlined-surface-500 py-2.5 px-4 rounded-xl text-sm">
				Cancelar
			</a>
			<button
				type="submit"
				class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm"
				disabled={loading.active || !podeCriar}
			>
				Criar plano
			</button>
		</div>
	</form>
</div>
