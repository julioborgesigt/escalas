<script lang="ts">
	/**
	 * Uma equipe do plano: os dados que vão ao Anexo I, o custo dela e o efetivo.
	 *
	 * Os campos gravam num formulário só ("Salvar equipe") em vez de a cada
	 * tecla: são doze campos e o custo depende de três deles em conjunto (tipo,
	 * horas, diárias). Salvar campo a campo produziria estados intermediários
	 * inválidos no banco — `tipo_custo = 'diaria'` com zero diárias, por exemplo —
	 * que o Anexo II teria de exibir.
	 *
	 * Os membros são a exceção: entram e saem na hora, porque cada um é uma
	 * gravação completa em si e a lista precisa refletir o efetivo real
	 * imediatamente (é ela que alimenta o painel de custo).
	 *
	 * A SUGESTÃO de horas vem pronta do servidor (`sugestaoHoras`), calculada
	 * sobre a mesma cascata de horário que o PDF usa. O botão só copia os números
	 * para os campos — quem decide continua sendo o admin.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarServidores, MIN_BUSCA } from '../../_components/buscas';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { useConfirmationDialog } from '$lib/composables';
	import { loading } from '$lib/loading.svelte';
	import type { PlanoOpcao } from '$lib/server/schema';
	import { escolhasDaEquipe } from '$lib/planos/opcoes';
	import { formatarBRL, resumoHoras, rotuloCustoDaEquipe } from '$lib/planos/rotulos';
	import { formatarDiarias, MIN_MEIAS, MAX_MEIAS } from '$lib/planos/diarias';
	import type { HorasClassificadas } from '$lib/planos/horas-extras';
	import type { MembroDoPlano } from '$lib/db/planos';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Star from '@lucide/svelte/icons/star';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Wand from '@lucide/svelte/icons/wand-sparkles';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	type EquipeNaTela = {
		id: number;
		nome: string;
		tipo: 'operacional' | 'seint';
		viatura_modelo: string;
		viatura_placa: string;
		hora_inicio: string | null;
		hora_fim: string | null;
		cidade_destino: string;
		local_briefing: string | null;
		tipo_custo: 'sem_custo' | 'hora_extra' | 'diaria';
		horas_normais: number;
		horas_plus: number;
		diaria_tipo: 'estadual' | 'interestadual' | null;
		diarias_meias: number;
		membros: MembroDoPlano[];
		/** Janela EFETIVA já resolvida pela cascata equipe → plano (vem do servidor). */
		janela: { horaInicio: string; horaFim?: string | null };
		/** Destino já resolvido pela cascata equipe → plano — o que o Anexo I imprime. */
		destinoEfetivo: string;
		sugestaoHoras: HorasClassificadas;
		custo: number;
	};

	const {
		equipe,
		enviar,
		pendentes,
		opcoesBriefing,
		opcoesDestino,
		briefingPadrao,
		destinoPadrao
	}: {
		equipe: EquipeNaTela;
		/** `use:enhance` comum, vindo da página. */
		enviar: (msg: string, aoConcluir?: () => void) => SubmitFunction;
		/** `policial_id` dos membros que bloqueiam a emissão (classe não resolvida). */
		pendentes: Set<number>;
		/** As listas que o plano declara — ver `EditorOpcoes`. */
		opcoesBriefing: PlanoOpcao[];
		opcoesDestino: PlanoOpcao[];
		/**
		 * O valor da opção PADRÃO de cada tipo — o que a equipe passa a usar se o
		 * campo dela ficar vazio.
		 *
		 * Vem separado de `equipe.destinoEfetivo` de propósito: o efetivo é o
		 * RESULTADO da cascata, e numa equipe que tem valor próprio ele É o valor
		 * próprio. Rotular a opção vazia com o efetivo dizia "padrão: X" exibindo
		 * justamente o que se perderia ao escolhê-la.
		 */
		briefingPadrao: string;
		destinoPadrao: string;
	} = $props();

	// As escolhas do seletor saem de `escolhasDaEquipe` — a regra (e o motivo de
	// o valor próprio da equipe entrar na lista) mora em `$lib/planos/opcoes`,
	// com teste.
	const escolhasBriefing = $derived(escolhasDaEquipe(opcoesBriefing, equipe.local_briefing));
	const escolhasDestino = $derived(escolhasDaEquipe(opcoesDestino, equipe.cidade_destino));

	// Estado local do formulário. Reinicia quando a equipe muda de identidade —
	// a `key` no pai garante isso; aqui a captura inicial é intencional.
	// svelte-ignore state_referenced_locally
	let tipoCusto = $state(equipe.tipo_custo);
	// svelte-ignore state_referenced_locally
	let horasNormais = $state(equipe.horas_normais);
	// svelte-ignore state_referenced_locally
	let horasPlus = $state(equipe.horas_plus);
	// svelte-ignore state_referenced_locally
	let diariaTipo = $state(equipe.diaria_tipo ?? 'estadual');
	// svelte-ignore state_referenced_locally
	let diariasMeias = $state(equipe.diarias_meias || 2);

	let novoPolicial = $state<unknown>(null);
	let aberto = $state(false);
	// APARADOS, como as escolhas do seletor: um `<select>` cujo `value` não casa
	// com nenhum `<option>` não fica vazio — o navegador mostra o primeiro item, e
	// salvar sem tocar no campo gravaria esse outro valor.
	// svelte-ignore state_referenced_locally
	let briefing = $state((equipe.local_briefing ?? '').trim());
	// svelte-ignore state_referenced_locally
	let destino = $state(equipe.cidade_destino.trim());

	const confirmExcluir = useConfirmationDialog<{ nome: string }>();

	/** `id` do formulário dos dados — o rodapé o alcança por `form=`. */
	const idForm = $derived(`equipe-${equipe.id}`);

	const temSugestao = $derived(
		equipe.sugestaoHoras.normais + equipe.sugestaoHoras.plus + equipe.sugestaoHoras.semCusto > 0
	);

	function aplicarSugestao() {
		horasNormais = equipe.sugestaoHoras.normais;
		horasPlus = equipe.sugestaoHoras.plus;
		// Uma janela inteiramente dentro de 08:00–18:00 em dia útil não gera hora
		// nenhuma — a sugestão certa ali é "sem custo", não "zero horas".
		tipoCusto = horasNormais + horasPlus === 0 ? 'sem_custo' : 'hora_extra';
	}
</script>

<!-- Contorno no estilo do quadro de seccional da GISE (`GiseSeccional.svelte`):
     `border-2` numa surface mais escura, fundo branco e sombra que reage ao
     hover. A borda de 1px translúcida que estava aqui somava com a folha do
     layout, e dois cards vizinhos pareciam um bloco só. -->
<li
	class="rounded-2xl border-2 border-surface-300 dark:border-surface-700 overflow-hidden bg-white dark:bg-surface-900 shadow-sm hover:shadow-md transition-shadow duration-300"
>
	<!-- Cabeçalho: resumo sempre visível -->
	<div class="flex flex-wrap items-center gap-3 p-4 bg-surface-50 dark:bg-surface-900/40">
		<button
			type="button"
			class="flex-1 min-w-0 text-left"
			onclick={() => (aberto = !aberto)}
			aria-expanded={aberto}
		>
			<span class="flex flex-wrap items-center gap-2">
				<span class="font-semibold text-surface-900 dark:text-white">{equipe.nome}</span>
				{#if equipe.tipo === 'seint'}
					<span
						class="rounded-full bg-secondary-500/15 px-2 py-0.5 text-3xs font-medium text-secondary-700 dark:text-secondary-300"
						>SEINT</span
					>
				{/if}
				<span class="text-2xs text-surface-600 dark:text-surface-400">
					{equipe.membros.length}
					{equipe.membros.length === 1 ? 'servidor' : 'servidores'}
				</span>
			</span>
			<span class="block text-xs text-surface-600 dark:text-surface-400 mt-0.5 truncate">
				<!-- O destino EFETIVO, não a coluna: equipe com o campo vazio sai no
				     Anexo I com o padrão do plano, e o resumo tem de dizer o mesmo. -->
				{equipe.destinoEfetivo || 'sem destino'}
				{#if equipe.viatura_placa}· VTR {equipe.viatura_placa}{/if}
				· {rotuloCustoDaEquipe(equipe.tipo_custo, equipe.diaria_tipo)}
				{#if equipe.tipo_custo === 'hora_extra'}
					{resumoHoras(equipe.horas_normais, equipe.horas_plus)}
				{:else if equipe.tipo_custo === 'diaria'}
					{formatarDiarias(equipe.diarias_meias)}
				{/if}
			</span>
		</button>

		<span class="text-sm font-semibold text-surface-900 dark:text-white shrink-0">
			{formatarBRL(equipe.custo)}
		</span>

		<button
			type="button"
			class="btn btn-sm preset-outlined-surface-500 px-2.5 py-1.5 rounded-xl text-xs shrink-0"
			onclick={() => (aberto = !aberto)}
		>
			{aberto ? 'Fechar' : 'Editar'}
		</button>
	</div>

	{#if aberto}
		<div class="p-4 space-y-5 border-t border-surface-200/70 dark:border-white/10">
			<!-- ---- Dados da equipe ---- -->
			<form
				id={idForm}
				method="POST"
				action="?/salvarEquipe"
				use:enhance={enviar('Alterações salvas')}
			>
				<input type="hidden" name="equipe_id" value={equipe.id} />
				<input type="hidden" name="tipo" value={equipe.tipo} />

				<div class="grid gap-3 sm:grid-cols-2">
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200">Nome</span>
						<input name="nome" value={equipe.nome} maxlength="80" required class="input" />
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
							>Cidade destino</span
						>
						<!-- Seletor, e não campo livre: o destino redigitado em oito equipes
						     vira dois destinos no Anexo I à primeira diferença de acento. As
						     opções são as do plano (Parâmetros gerais). -->
						<select name="cidade_destino" bind:value={destino} class="select">
							<option value="">
								{destinoPadrao ? `— padrão: ${destinoPadrao} —` : '— sem destino —'}
							</option>
							{#each escolhasDestino as valor (valor)}
								<option value={valor}>{valor}</option>
							{/each}
						</select>
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
							>Modelo da viatura</span
						>
						<input
							name="viatura_modelo"
							value={equipe.viatura_modelo}
							maxlength="60"
							class="input"
						/>
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200">Placa</span>
						<input name="viatura_placa" value={equipe.viatura_placa} maxlength="20" class="input" />
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
							Apresentação <span class="text-surface-600 dark:text-surface-400"
								>(vazio = herda)</span
							>
						</span>
						<input
							name="hora_inicio"
							value={equipe.hora_inicio ?? ''}
							placeholder={equipe.janela.horaInicio}
							class="input"
						/>
					</label>
					<label class="block space-y-1">
						<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
							Término <span class="text-surface-600 dark:text-surface-400">(vazio = herda)</span>
						</span>
						<input
							name="hora_fim"
							value={equipe.hora_fim ?? ''}
							placeholder={equipe.janela.horaFim ?? 'sem término'}
							class="input"
						/>
					</label>
				</div>

				<label class="block space-y-1 mt-3">
					<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
						Local de briefing <span class="text-surface-600 dark:text-surface-400"
							>(vazio = usa o padrão do plano)</span
						>
					</span>
					<select name="local_briefing" bind:value={briefing} class="select">
						<option value="">
							{briefingPadrao ? `— padrão: ${briefingPadrao} —` : '— sem local —'}
						</option>
						{#each escolhasBriefing as valor (valor)}
							<option value={valor}>{valor}</option>
						{/each}
					</select>
				</label>
			</form>

			<!-- ---- Efetivo ---- -->
			<div class="space-y-2">
				<h4 class="text-xs font-semibold text-surface-800 dark:text-surface-100">
					Efetivo ({equipe.membros.length})
				</h4>

				{#if equipe.membros.length > 0}
					<ul class="space-y-1.5">
						{#each equipe.membros as m (m.id)}
							{@const pendente = pendentes.has(m.policial_id)}
							<li
								class="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 {pendente
									? 'border-error-500/40 bg-error-500/5'
									: 'border-surface-200/70 dark:border-white/10'}"
							>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium text-surface-900 dark:text-white truncate">
										{#if m.chefe}
											<Star
												class="inline w-3.5 h-3.5 -mt-0.5 text-warning-600 dark:text-warning-400"
												aria-label="Chefe da equipe"
											/>
										{/if}
										{m.nome}
									</p>
									<p class="text-2xs text-surface-600 dark:text-surface-400 truncate">
										{m.cargo_snapshot}
										{m.classe_snapshot || '—'} · Mat. {m.matricula} · {m.lotacao}
										{#if m.telefone}· {m.telefone}{/if}
									</p>
									{#if pendente}
										<p class="text-2xs text-error-600 dark:text-error-400 mt-0.5">
											<TriangleAlert class="inline w-3 h-3 -mt-0.5" aria-hidden="true" />
											Sem classe resolvida — impede a emissão do PDF.
										</p>
									{/if}
								</div>

								<div class="flex gap-1.5 shrink-0">
									{#if !m.chefe}
										<form
											method="POST"
											action="?/definirChefe"
											use:enhance={enviar('Chefe definido')}
											class="contents"
										>
											<input type="hidden" name="membro_id" value={m.id} />
											<button
												type="submit"
												class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-3xs"
												title="Definir como chefe da equipe"
											>
												<Star class="w-3 h-3" />
												Chefe
											</button>
										</form>
									{/if}
									<form
										method="POST"
										action="?/removerMembro"
										use:enhance={enviar('Servidor removido')}
										class="contents"
									>
										<input type="hidden" name="membro_id" value={m.id} />
										<button
											type="submit"
											class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-3xs"
											title="Remover do efetivo"
										>
											<Trash2 class="w-3 h-3" />
										</button>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-xs text-surface-600 dark:text-surface-400">
						Nenhum servidor alocado nesta equipe.
					</p>
				{/if}

				<form
					method="POST"
					action="?/adicionarMembro"
					use:enhance={enviar('Servidor alocado', () => (novoPolicial = null))}
					class="flex flex-wrap items-end gap-2 pt-1"
				>
					<input type="hidden" name="equipe_id" value={equipe.id} />
					<div class="min-w-0 flex-1">
						<SearchableSelect
							name="policial_id"
							bind:value={novoPolicial}
							loadOptions={buscarServidores}
							minSearchChars={MIN_BUSCA}
							placeholder="Buscar por nome ou matrícula"
						/>
					</div>
					<button
						type="submit"
						class="btn preset-outlined-surface-500 py-2 px-3 rounded-xl text-xs shrink-0"
						disabled={!novoPolicial}
					>
						<UserPlus class="w-3.5 h-3.5" />
						Adicionar
					</button>
				</form>
			</div>

			<!-- ---- Custo ---- -->
			<div class="mt-4 rounded-xl border border-surface-200 dark:border-white/10 p-3 space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="text-xs font-semibold text-surface-800 dark:text-surface-100"
						>Custo da equipe</span
					>
					{#if temSugestao}
						<button
							type="button"
							class="btn btn-sm preset-outlined-surface-500 py-1.5 px-3 rounded-lg text-2xs"
							onclick={aplicarSugestao}
						>
							<Wand class="w-3.5 h-3.5" />
							Sugerir pelo horário
						</button>
					{/if}
				</div>

				{#if temSugestao}
					<p class="text-2xs text-surface-600 dark:text-surface-400">
						Pelo horário desta equipe: <strong
							>{equipe.sugestaoHoras.normais}h normais · {equipe.sugestaoHoras.plus}h plus · {equipe
								.sugestaoHoras.semCusto}h sem custo</strong
						>. A quantidade gravada é a que estiver nos campos.
					</p>
				{:else}
					<p class="text-2xs text-surface-600 dark:text-surface-400">
						Sem previsão de término no plano, não há como sugerir a quantidade — informe à mão.
					</p>
				{/if}

				<div class="flex flex-wrap gap-2">
					{#each [['sem_custo', 'Sem custo'], ['hora_extra', 'Hora extra (DRO)'], ['diaria', 'Diária']] as [valor, rotulo] (valor)}
						<label
							class="cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors {tipoCusto ===
							valor
								? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
								: 'border-surface-200 dark:border-white/10 text-surface-700 dark:text-surface-300'}"
						>
							<input
								type="radio"
								name="tipo_custo"
								value={valor}
								bind:group={tipoCusto}
								form={idForm}
								class="sr-only"
							/>
							{rotulo}
						</label>
					{/each}
				</div>

				{#if tipoCusto === 'hora_extra'}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block space-y-1">
							<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
								>Horas normais</span
							>
							<input
								type="number"
								name="horas_normais"
								bind:value={horasNormais}
								min="0"
								max="744"
								form={idForm}
								class="input"
							/>
						</label>
						<label class="block space-y-1">
							<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
								Horas plus <span class="text-surface-600 dark:text-surface-400">(+30%)</span>
							</span>
							<input
								type="number"
								name="horas_plus"
								bind:value={horasPlus}
								min="0"
								max="744"
								form={idForm}
								class="input"
							/>
						</label>
					</div>
				{:else if tipoCusto === 'diaria'}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block space-y-1">
							<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
								>Tipo de diária</span
							>
							<select name="diaria_tipo" bind:value={diariaTipo} form={idForm} class="select">
								<option value="estadual">Estadual</option>
								<option value="interestadual">Interestadual</option>
							</select>
						</label>
						<label class="block space-y-1">
							<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
								Quantidade <span class="text-surface-600 dark:text-surface-400"
									>({formatarDiarias(diariasMeias)})</span
								>
							</span>
							<!-- Em MEIAS diárias: o passo é meio, e o inteiro evita float no
								     caminho do dinheiro. O rótulo acima mostra o valor em diárias. -->
							<input
								type="range"
								name="diarias_meias"
								bind:value={diariasMeias}
								min={MIN_MEIAS}
								max={MAX_MEIAS}
								step="1"
								form={idForm}
								class="w-full"
							/>
						</label>
					</div>
				{/if}
			</div>

			<!-- ---- Ações da equipe ---- -->
			<!-- Os dois botões juntos, no fim do card: quem termina de mexer na
			     equipe decide ali entre gravar e descartar. O "Salvar" vive FORA do
			     formulário dos dados e o alcança por `form={idForm}` — é o atributo
			     que o HTML tem para isso, e evita duplicar o form ou mover o
			     efetivo para dentro dele. -->
			<div
				class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-surface-200/70 dark:border-white/10"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-error-500 py-1.5 px-3 rounded-xl text-xs"
					onclick={() => confirmExcluir.openDialog({ nome: equipe.nome })}
				>
					<Trash2 class="w-3.5 h-3.5" />
					Excluir equipe
				</button>
				<button
					type="submit"
					form={idForm}
					class="btn preset-filled-primary-500 py-2 px-4 rounded-xl text-sm"
					disabled={loading.active}
				>
					Salvar Alterações
				</button>
			</div>
		</div>
	{/if}
</li>

<!-- Confirmação da exclusão, no padrão do projeto (`ModalShell` +
     `useConfirmationDialog`, como em `/gise/planos`). A equipe leva o efetivo
     alocado junto, e um clique errado num botão vermelho ao lado do de salvar
     custaria remontar a equipe inteira. -->
<ModalShell
	bind:open={confirmExcluir.isOpen}
	title="Excluir equipe?"
	largura="sm"
	pending={loading.active}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		A equipe <strong>{confirmExcluir.currentItem?.nome}</strong> e os
		{equipe.membros.length}
		{equipe.membros.length === 1 ? 'servidor alocado' : 'servidores alocados'} nela serão apagados. As
		demais equipes são renumeradas.
	{/snippet}

	{#snippet footer()}
		<form
			method="POST"
			action="?/excluirEquipe"
			use:enhance={enviar('Equipe excluída', () => confirmExcluir.closeDialog())}
			class="contents"
		>
			<input type="hidden" name="equipe_id" value={equipe.id} />
			<button
				type="submit"
				class="btn btn-sm preset-filled-error-500 flex items-center gap-2"
				disabled={loading.active}
			>
				<Trash2 class="w-4 h-4" />
				Excluir equipe
			</button>
		</form>
	{/snippet}
</ModalShell>
