<script lang="ts">
	/**
	 * Criação do plano operacional — os parâmetros gerais.
	 *
	 * Rota, e não modal (README §10): são dezoito campos mais o calendário. O
	 * agrupamento segue a ordem do documento — identificação, calendário, quem
	 * demanda e quem coordena, quem assina, e por fim a estrutura das equipes.
	 *
	 * ## Diagramação: seções, não cartões dentro de cartão
	 *
	 * O `+layout.svelte` já entrega a página dentro de uma FOLHA (`max-w-6xl` com
	 * borda e fundo branco em `xl`). Empilhar `card-elevated` aqui dentro desenha
	 * cartão sobre cartão, e travar a largura de novo (`max-w-3xl`) deixa o
	 * formulário estreito dentro de uma folha larga, com o título deslocado.
	 *
	 * Então: a folha é o contêiner, as seções se separam por TÍTULO e por linha,
	 * e o formulário ocupa a largura que tem. É o padrão de `/solicitacoes` e o
	 * que o README §10 chama de "dentro de um card largo, o conteúdo que ganha
	 * com a largura fica solto".
	 *
	 * Tudo aqui é EDITÁVEL depois no editor. O que se pede na criação é só o que
	 * o plano precisa para existir com um número e uma data; obrigar o
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
	import CampoNup from '../_components/CampoNup.svelte';
	import CamposSignatario from '../_components/CamposSignatario.svelte';
	import ListaOpcoes from '../_components/ListaOpcoes.svelte';
	import {
		acrescentarNaLista,
		definirPadraoNaLista,
		removerDaLista,
		padraoDaLista,
		type OpcaoEmLista
	} from '$lib/planos/opcoes';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
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
	/**
	 * As três listas de opções, montadas ANTES de o plano existir.
	 *
	 * Ficam em memória e viajam como arrays de campos ocultos no mesmo POST que
	 * cria o plano — não há `plano_id` para gravá-las contra. As regras (primeira
	 * nasce padrão, sem repetir valor, removida a padrão a próxima assume) vêm de
	 * `$lib/planos/opcoes`, as MESMAS que o editor aplica depois contra o banco.
	 */
	let listaBriefing = $state<OpcaoEmLista[]>([]);
	let listaOrigem = $state<OpcaoEmLista[]>([]);
	let listaDestino = $state<OpcaoEmLista[]>([]);

	let qtdEquipes = $state(3);
	let oipPorEquipe = $state(4);
	let temSeint = $state(false);

	let coordenadorId = $state<unknown>(null);
	let demandanteId = $state<unknown>(null);
	let diretorId = $state<unknown>(null);
	// svelte-ignore state_referenced_locally
	let diretorCargo = $state(data.diretorCargo);

	const podeCriar = $derived(nome.trim().length > 0 && dataInicio !== '');
</script>

<svelte:head><title>Novo plano operacional | Escalas</title></svelte:head>

{#snippet tituloSecao(texto: string, apoio?: string)}
	<div class="border-b border-surface-200/70 dark:border-white/10 pb-2">
		<h2
			class="text-sm font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400"
		>
			{texto}
		</h2>
		{#if apoio}
			<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 normal-case">{apoio}</p>
		{/if}
	</div>
{/snippet}

<div class="space-y-6">
	<div>
		<BotaoVoltar href="/gise/planos" />
		<h1 class="h2 font-bold mt-2">Novo plano operacional</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
			Os parâmetros gerais da operação. Tudo pode ser ajustado depois — viaturas, destinos, efetivo
			e custos são preenchidos por equipe no editor.
		</p>
	</div>

	<!-- Os botões de cada linha das três listas. Um snippet só porque são os
	     mesmos três em cada uma — e `type="button"`, porque este bloco vive dentro
	     do formulário que cria o plano: um submit aqui enviaria o plano pela
	     metade ao marcar uma estrela. -->
	{#snippet botoes(
		o: { chave: string | number; padrao: boolean },
		aoPadrao: () => void,
		aoRemover: () => void
	)}
		{#if !o.padrao}
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
				title="Usar como padrão nas equipes criadas"
				onclick={aoPadrao}
			>
				<Star class="w-3.5 h-3.5" />
				Padrão
			</button>
		{/if}
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
			title="Remover da lista"
			onclick={aoRemover}
		>
			<Trash2 class="w-3.5 h-3.5" />
		</button>
	{/snippet}

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
		class="space-y-8"
	>
		<!-- ---- Identificação ---- -->
		<section class="space-y-4">
			{@render tituloSecao('Identificação')}

			<label class="block space-y-1">
				<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
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

			<div class="grid gap-4 sm:grid-cols-2">
				<CampoNup bind:valor={nup} opcional />
				<label class="block space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>Departamento responsável</span
					>
					<input name="departamento" value={DEPARTAMENTO_PADRAO} maxlength="60" class="input" />
				</label>
			</div>

			<label class="block space-y-1">
				<span class="text-sm font-medium text-surface-700 dark:text-surface-200">Finalidade</span>
				<textarea
					name="finalidade"
					bind:value={finalidade}
					rows="4"
					maxlength="2000"
					class="textarea"></textarea>
			</label>

			<label class="block space-y-1">
				<span class="text-sm font-medium text-surface-700 dark:text-surface-200">
					Ações a serem realizadas <span class="text-surface-600 dark:text-surface-400"
						>(uma por linha)</span
					>
				</span>
				<textarea name="acoes" bind:value={acoes} rows="4" maxlength="2000" class="textarea"
				></textarea>
			</label>
		</section>

		<!-- ---- Calendário ---- -->
		<section class="space-y-4">
			{@render tituloSecao(
				'Calendário',
				'A data e o horário decidem se a operação gera hora extra, e de qual tipo.'
			)}

			<CalendarioDia bind:valor={dataInicio} bind:feriado />
			<input type="hidden" name="data_inicio" value={dataInicio} />
			{#if feriado}<input type="hidden" name="feriado" value="1" />{/if}

			<!-- Os três campos de tempo numa linha só: são curtos e se leem juntos
			     ("das 05:00 às 11:00, terminando em"). Empilhados, a data de término
			     ficava longe do horário que ela completa. -->
			<div class="grid gap-4 sm:grid-cols-3">
				<label class="block space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>Horário de apresentação</span
					>
					<input
						name="hora_inicio"
						bind:value={horaInicio}
						placeholder="05:00"
						class="input w-32"
					/>
				</label>
				<label class="block space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200">
						Previsão de término <span class="text-surface-600 dark:text-surface-400"
							>(opcional)</span
						>
					</span>
					<input name="hora_fim" bind:value={horaFim} placeholder="11:00" class="input w-32" />
				</label>
				<label class="block space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200">
						Data de término <span class="text-surface-600 dark:text-surface-400"
							>(se virar o dia)</span
						>
					</span>
					<input type="date" name="data_fim" bind:value={dataFim} class="input w-44" />
				</label>
			</div>

			<p class="text-xs text-surface-600 dark:text-surface-400">
				Sem previsão de término, o sistema não sugere a quantidade de horas — ela é digitada por
				equipe no editor.
			</p>
		</section>

		<!-- ---- Comando e demanda ---- -->
		<section class="space-y-4">
			{@render tituloSecao('Comando e demanda')}

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-1">
					<label
						for="coordenador"
						class="block text-sm font-medium text-surface-700 dark:text-surface-200"
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
						class="block text-sm font-medium text-surface-700 dark:text-surface-200"
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
			</div>

			<!-- As três listas que os seletores das equipes vão oferecer. Montadas
			     AQUI, e não só no editor: a operação que sai para três cidades
			     declara as três antes de criar o plano, em vez de criar, entrar no
			     editor e voltar para acrescentar. Cada lista vira campos ocultos no
			     POST; o servidor as grava depois de o plano existir. -->
			<div class="space-y-1">
				<h3 class="text-sm font-semibold text-surface-900 dark:text-white">Opções das equipes</h3>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					O que os seletores de cada equipe vão oferecer. A marcada com estrela vem pré-preenchida
					nas equipes criadas — e todas continuam editáveis no plano.
				</p>
			</div>

			<div class="grid gap-5 sm:grid-cols-3">
				<ListaOpcoes
					rotulo="Locais de briefing"
					descricao="Onde as equipes se apresentam."
					exemplo="Sede da 4ª Seccional do Interior Sul"
					opcoes={listaBriefing.map((o) => ({ chave: o.valor, ...o }))}
					aoAcrescentar={(v) => (listaBriefing = acrescentarNaLista(listaBriefing, v))}
				>
					{#snippet acoes(o)}
						{@render botoes(
							o,
							() => (listaBriefing = definirPadraoNaLista(listaBriefing, String(o.chave))),
							() => (listaBriefing = removerDaLista(listaBriefing, String(o.chave)))
						)}
					{/snippet}
				</ListaOpcoes>

				<ListaOpcoes
					rotulo="Cidades de origem"
					descricao="De onde as equipes saem — mede a distância."
					exemplo="Jucás"
					opcoes={listaOrigem.map((o) => ({ chave: o.valor, ...o }))}
					aoAcrescentar={(v) => (listaOrigem = acrescentarNaLista(listaOrigem, v))}
				>
					{#snippet acoes(o)}
						{@render botoes(
							o,
							() => (listaOrigem = definirPadraoNaLista(listaOrigem, String(o.chave))),
							() => (listaOrigem = removerDaLista(listaOrigem, String(o.chave)))
						)}
					{/snippet}
				</ListaOpcoes>

				<ListaOpcoes
					rotulo="Cidades de destino"
					descricao="Para onde as equipes se deslocam."
					exemplo="Acopiara"
					opcoes={listaDestino.map((o) => ({ chave: o.valor, ...o }))}
					aoAcrescentar={(v) => (listaDestino = acrescentarNaLista(listaDestino, v))}
				>
					{#snippet acoes(o)}
						{@render botoes(
							o,
							() => (listaDestino = definirPadraoNaLista(listaDestino, String(o.chave))),
							() => (listaDestino = removerDaLista(listaDestino, String(o.chave)))
						)}
					{/snippet}
				</ListaOpcoes>
			</div>

			<!-- O que de fato viaja no POST. Um campo por opção, mais o valor da
			     padrão de cada tipo — o servidor recria a lista na ordem e marca a
			     estrela depois de inserir todas. -->
			{#each listaBriefing as o (o.valor)}
				<input type="hidden" name="opcao_briefing" value={o.valor} />
			{/each}
			{#each listaOrigem as o (o.valor)}
				<input type="hidden" name="opcao_origem" value={o.valor} />
			{/each}
			{#each listaDestino as o (o.valor)}
				<input type="hidden" name="opcao_destino" value={o.valor} />
			{/each}
			<input type="hidden" name="padrao_briefing" value={padraoDaLista(listaBriefing)} />
			<input type="hidden" name="padrao_origem" value={padraoDaLista(listaOrigem)} />
			<input type="hidden" name="padrao_destino" value={padraoDaLista(listaDestino)} />
		</section>

		<!-- ---- Signatário ---- -->
		<section class="space-y-4">
			{@render tituloSecao(
				'Signatário do plano',
				'Quem assina o documento. Varia por operação — o Titular assina umas, o Adjunto outras.'
			)}

			<CamposSignatario bind:diretorId bind:cargo={diretorCargo} />
		</section>

		<!-- ---- Equipes ---- -->
		<section class="space-y-4">
			{@render tituloSecao(
				'Estrutura inicial',
				'As equipes nascem como "Equipe 01", "Equipe 02"… e podem ser renomeadas, acrescentadas ou removidas no editor.'
			)}

			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>Quantidade de equipes</span
					>
					<input
						type="number"
						name="qtd_equipes"
						bind:value={qtdEquipes}
						min="0"
						max="50"
						class="input w-28"
					/>
				</label>
				<label class="block space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>OIPs por equipe</span
					>
					<input
						type="number"
						name="oip_por_equipe"
						bind:value={oipPorEquipe}
						min="0"
						max="99"
						class="input w-28"
					/>
					<span class="block text-xs text-surface-600 dark:text-surface-400">
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
					<span class="block text-xs text-surface-600 dark:text-surface-400">
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

		<div
			class="flex justify-end gap-2 pt-4 pb-4 border-t border-surface-200/70 dark:border-white/10"
		>
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
