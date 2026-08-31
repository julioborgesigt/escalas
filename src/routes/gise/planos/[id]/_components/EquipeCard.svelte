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
	import { formatarBRL, resumoHoras, rotuloCustoDaEquipe } from '$lib/planos/rotulos';
	import { formatarDiarias } from '$lib/planos/diarias';
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
		briefingEfetivo: string;
		sugestaoHoras: HorasClassificadas;
		custo: number;
	};

	const {
		equipe,
		enviar,
		pendentes
	}: {
		equipe: EquipeNaTela;
		/** `use:enhance` comum, vindo da página. */
		enviar: (msg: string, aoConcluir?: () => void) => SubmitFunction;
		/** `policial_id` dos membros que bloqueiam a emissão (classe não resolvida). */
		pendentes: Set<number>;
	} = $props();

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

<li class="rounded-2xl border border-surface-200/70 dark:border-white/10 overflow-hidden">
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
				{equipe.cidade_destino || 'sem destino'}
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
			<form method="POST" action="?/salvarEquipe" use:enhance={enviar('Equipe salva')}>
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
						<input
							name="cidade_destino"
							value={equipe.cidade_destino}
							maxlength="120"
							class="input"
						/>
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
					<input
						name="local_briefing"
						value={equipe.local_briefing ?? ''}
						maxlength="200"
						placeholder={equipe.briefingEfetivo || 'sem local definido'}
						class="input"
					/>
				</label>

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
								<select name="diaria_tipo" bind:value={diariaTipo} class="select">
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
									min="1"
									max="30"
									step="1"
									class="w-full"
								/>
							</label>
						</div>
					{/if}
				</div>

				<div class="flex justify-end mt-3">
					<button type="submit" class="btn preset-filled-primary-500 py-2 px-4 rounded-xl text-sm">
						Salvar equipe
					</button>
				</div>
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

			<!-- ---- Excluir ---- -->
			<form
				method="POST"
				action="?/excluirEquipe"
				use:enhance={enviar('Equipe excluída')}
				class="flex justify-end pt-1 border-t border-surface-200/70 dark:border-white/10"
			>
				<input type="hidden" name="equipe_id" value={equipe.id} />
				<button
					type="submit"
					class="btn btn-sm preset-filled-error-500 py-1.5 px-3 rounded-xl text-xs mt-3"
				>
					<Trash2 class="w-3.5 h-3.5" />
					Excluir equipe
				</button>
			</form>
		</div>
	{/if}
</li>
