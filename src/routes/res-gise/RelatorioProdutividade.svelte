<script lang="ts">
	import type { GiseModeloPerguntaConfig } from '$lib/types';

	let { respostas = $bindable(), modelo = [] } = $props<{
		respostas: Record<string, unknown>;
		modelo: GiseModeloPerguntaConfig[];
	}>();

	/**
	 * Chaves de resposta e item vazio da listagem detalhada de cada tipo
	 * sistêmico. Substituem as cadeias de ternários/`if` repetidas por tipo
	 * que existiam no snippet e no `handleSimNao`.
	 */
	const CHAVES_TIPO: Record<string, { qtd: string; lista: string }> = {
		mandados_maiores: { qtd: 'mandados_qtd', lista: 'mandados_lista' },
		prisoes_maiores: { qtd: 'prisoes_qtd', lista: 'prisoes_lista' },
		apreensoes_menores: { qtd: 'apreensoes_qtd', lista: 'apreensoes_lista' },
		celulares_complex: { qtd: 'celulares_qtd', lista: 'celulares_lista' },
		analise_complex: { qtd: 'analise_qtd', lista: 'analise_lista' },
		relatorios_seint_complex: { qtd: 'relatorios_seint_qtd', lista: 'relatorios_seint_lista' },
		foragidos_complex: { qtd: 'foragidos_qtd', lista: 'foragidos_lista' },
		operacoes_seint_complex: { qtd: 'operacoes_seint_qtd', lista: 'operacoes_seint_lista' },
		operacoes_seint_pura: { qtd: 'operacoes_seint_qtd', lista: 'operacoes_seint_lista' }
	};

	const ITEM_PADRAO: Record<string, Record<string, string>> = {
		mandados_maiores: { nome: '', mandado: '' },
		prisoes_maiores: { nome: '', mandado: '' },
		apreensoes_menores: { nome: '', mandado: '' },
		celulares_complex: { modelo: '', n_proc: '', delegacia: '', situacao: '' },
		analise_complex: { tamanho: '', modelo: '', n_proc: '', delegacia: '' },
		relatorios_seint_complex: { n_relat: '', q_alvos: '', proc_vinc: '', delegacia: '' },
		foragidos_complex: { nome: '', proc_vinc: '', delegacia: '', resultado: '' },
		operacoes_seint_complex: { nome: '', delegacia: '' },
		operacoes_seint_pura: { nome: '', delegacia: '' }
	};

	function handleSimNao(key: string, val: string, q: GiseModeloPerguntaConfig) {
		respostas[key] = val;
		// Inicializações automáticas para tipos sistêmicos
		if (val === 'Sim') {
			const chaves = CHAVES_TIPO[q.tipo];
			if (chaves && !respostas[chaves.qtd]) {
				respostas[chaves.qtd] = 1;
				respostas[chaves.lista] = [{ ...ITEM_PADRAO[q.tipo] }];
			}
			if (
				q.tipo === 'armas_complex' &&
				(!respostas.armas_selecionadas || respostas.armas_selecionadas.length === 0)
			) {
				respostas.armas_selecionadas = [];
				respostas.armas_detalhe = {};
			}
			if (
				q.tipo === 'drogas_complex' &&
				(!respostas.drogas_selecionadas || respostas.drogas_selecionadas.length === 0)
			) {
				respostas.drogas_selecionadas = [];
				respostas.drogas_detalhe = {};
			}
		}
	}

	// Inicialização Automática para tipos "Pura"
	$effect(() => {
		function explore(qs: GiseModeloPerguntaConfig[]) {
			qs.forEach((q) => {
				if (q.tipo === 'operacoes_seint_pura') {
					if (respostas.operacoes_seint_qtd === undefined) {
						respostas.operacoes_seint_qtd = 1;
						if (!respostas.operacoes_seint_lista)
							respostas.operacoes_seint_lista = [{ nome: '', delegacia: '' }];
					}
				}
				if (q.filhos) explore(q.filhos);
			});
		}
		explore(modelo);
	});
</script>

<div class="space-y-6">
	<!-- Par de botões Sim/Não — repetia-se em 4 tipos de pergunta -->
	{#snippet botoesSimNao(q: GiseModeloPerguntaConfig)}
		<div class="flex gap-2 sm:gap-4 w-full">
			{#each ['Sim', 'Não'] as opt (opt)}
				<button
					type="button"
					class="flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase border-2 transition-all {respostas[
						q.key
					] === opt
						? 'bg-primary-500 text-white border-primary-500 shadow-lg shadow-primary-500/30'
						: 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-400 hover:border-primary-500/50 hover:text-surface-600'}"
					onclick={() => handleSimNao(q.key, opt, q)}
				>
					{opt}
				</button>
			{/each}
		</div>
	{/snippet}

	<!-- Célula "label + input texto" das listagens detalhadas (~18 ocorrências) -->
	{#snippet campoTexto(
		id: string,
		rotulo: string,
		placeholder: string,
		item: Record<string, string>,
		campo: string
	)}
		<div class="space-y-1">
			<label class="text-[0.6rem] font-bold text-surface-400 uppercase" for={id}>{rotulo}</label>
			<input
				{id}
				type="text"
				{placeholder}
				class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-medium"
				bind:value={item[campo]}
			/>
		</div>
	{/snippet}

	{#snippet renderCampo(q: GiseModeloPerguntaConfig, level = 0)}
		{@const chavesTipo = CHAVES_TIPO[q.tipo] ?? CHAVES_TIPO.operacoes_seint_pura}
		{@const resKey = chavesTipo.lista}
		{@const resQtdKey = chavesTipo.qtd}

		<div
			class="nested-card card p-3 sm:p-4 md:p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm space-y-4 animate-in fade-in slide-in-from-top-4 duration-500"
			style="--level: {level}"
		>
			<div class="space-y-1">
				<label
					for="q-{q.id}"
					class="text-sm font-bold text-surface-900 dark:text-surface-50 uppercase tracking-tight leading-tight block"
				>
					{q.texto}
				</label>
			</div>

			<div class="mt-2">
				{#if q.tipo === 'vtr_placa'}
					<input
						id="q-{q.id}"
						type="text"
						placeholder="Ex: XXX-0000"
						class="w-full md:w-64 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-black uppercase tracking-widest focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}
					/>
				{:else if q.tipo === 'numero'}
					<input
						id="q-{q.id}"
						type="number"
						placeholder="0"
						class="w-full md:w-48 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}
					/>
				{:else if q.tipo === 'select_99'}
					<select
						id="q-{q.id}"
						class="w-full md:w-48 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-inner appearance-none"
						bind:value={respostas[q.key]}
					>
						<option value="">Selecione</option>
						{#each Array(100) as _, i (i)}
							<option value={i}>{i}</option>
						{/each}
					</select>
				{:else if q.tipo === 'sim_nao'}
					{@render botoesSimNao(q)}
				{:else if q.tipo === 'textarea'}
					<textarea
						id="q-{q.id}"
						rows="4"
						placeholder="Descreva detalhadamente..."
						class="w-full px-4 py-3 rounded-2xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-medium focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}></textarea>
				{:else if q.tipo === 'mandados_maiores' || q.tipo === 'prisoes_maiores' || q.tipo === 'apreensoes_menores' || q.tipo === 'celulares_complex' || q.tipo === 'analise_complex' || q.tipo === 'relatorios_seint_complex' || q.tipo === 'foragidos_complex' || q.tipo === 'operacoes_seint_complex' || q.tipo === 'operacoes_seint_pura'}
					{@const isPura = q.tipo === 'operacoes_seint_pura'}
					<div class="space-y-4">
						{#if !isPura}
							{@render botoesSimNao(q)}
						{/if}

						{#if respostas[q.key] === 'Sim' || (isPura && (respostas[resQtdKey] !== undefined || true))}
							<div
								class="p-3 sm:p-4 md:p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500"
							>
								<div class="flex items-center gap-4">
									<label class="block">
										<span
											class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block"
											>{q.subtexto_qtd || 'Quantidade:'}</span
										>
										<select
											class="w-24 px-4 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-bold shadow-sm"
											bind:value={respostas[resQtdKey]}
											onchange={(e) => {
												const n = Number((e.currentTarget as HTMLSelectElement).value);
												if (!respostas[resKey]) respostas[resKey] = [];
												const defaultItem = ITEM_PADRAO[q.tipo] ?? { nome: '', mandado: '' };
												respostas[resKey] = Array(n)
													.fill(0)
													.map((_, idx) => (respostas[resKey] || [])[idx] || { ...defaultItem });
											}}
										>
											{#each Array(99)
												.fill(0)
												.map((_, idx) => idx + 1) as n (n)}
												<option value={n}>{n}</option>
											{/each}
										</select>
									</label>
								</div>

								<div class="space-y-3">
									<span
										class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block"
										>{q.subtexto_lista || 'Listagem Detalhada:'}</span
									>
									{#each respostas[resKey] || [] as item, i (i)}
										{#if q.tipo === 'celulares_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-3 md:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`mod-${q.id}-${i}`,
													'Modelo',
													'Ex: iPhone 13',
													item,
													'modelo'
												)}
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Nº proc',
													'Número',
													item,
													'n_proc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
												{@render campoTexto(
													`sit-${q.id}-${i}`,
													'Situação',
													'Pendente/Ok',
													item,
													'situacao'
												)}
											</div>
										{:else if q.tipo === 'analise_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`tam-${q.id}-${i}`,
													'Tam. Arquivo',
													'Ex: 256GB',
													item,
													'tamanho'
												)}
												{@render campoTexto(
													`mod-${q.id}-${i}`,
													'Modelo',
													'Ex: iPhone 13',
													item,
													'modelo'
												)}
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Nº proc',
													'Número',
													item,
													'n_proc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
											</div>
										{:else if q.tipo === 'relatorios_seint_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`nrel-${q.id}-${i}`,
													'Nº Relatório',
													'Ex: 001/2026',
													item,
													'n_relat'
												)}
												<div class="space-y-1">
													<label
														class="text-[0.6rem] font-bold text-surface-400 uppercase"
														for="qal-{q.id}-{i}">Qtd Alvos</label
													>
													<input
														id="qal-{q.id}-{i}"
														type="number"
														placeholder="0"
														class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-medium"
														bind:value={item.q_alvos}
													/>
												</div>
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Procedimento',
													'Número',
													item,
													'proc_vinc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
											</div>
										{:else if q.tipo === 'foragidos_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`nom-${q.id}-${i}`,
													'Nome do Alvo',
													'Nome Completo',
													item,
													'nome'
												)}
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Procedimento',
													'Número',
													item,
													'proc_vinc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
												<div class="space-y-1">
													<label
														class="text-[0.6rem] font-bold text-surface-400 uppercase"
														for="res-{q.id}-{i}">Resultado</label
													>
													<select
														id="res-{q.id}-{i}"
														class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
														bind:value={item.resultado}
													>
														<option value="">Selecione</option>
														<option value="Positivo">Positivo</option>
														<option value="Negativo">Negativo</option>
													</select>
												</div>
											</div>
										{:else if q.tipo === 'operacoes_seint_complex' || q.tipo === 'operacoes_seint_pura'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`nom-${q.id}-${i}`,
													'Nome da Operação',
													'Nome',
													item,
													'nome'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
											</div>
										{:else}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`n-${q.id}-${i}`,
													'Nome',
													'Nome Completo',
													item,
													'nome'
												)}
												{@render campoTexto(
													`m-${q.id}-${i}`,
													q.tipo === 'prisoes_maiores' ? 'Procedimento' : 'Mandado/Processo',
													'Número',
													item,
													'mandado'
												)}
											</div>
										{/if}
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else if q.tipo === 'drogas_complex'}
					<div class="space-y-4">
						{@render botoesSimNao(q)}

						{#if respostas[q.key] === 'Sim'}
							<div
								class="p-3 sm:p-4 md:p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500"
							>
								<div class="space-y-3">
									<span
										class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block"
										>{q.subtexto_tipo || 'Tipos de Droga Apreendidos:'}</span
									>
									<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
										{#each ['Maconha', 'Cocaína', 'Crack', 'Extase', 'LSD', 'Haxixe', 'Skunk', 'Outros'] as d (d)}
											<button
												type="button"
												class="px-3 py-2 rounded-xl text-[0.6rem] font-black uppercase border-2 transition-all {(
													respostas.drogas_selecionadas || []
												).includes(d)
													? 'bg-primary-500 text-white border-primary-500 shadow-md'
													: 'bg-white dark:bg-surface-900 text-surface-500 border-surface-100 dark:border-surface-800 hover:border-primary-500/50'}"
												onclick={() => {
													const current = respostas.drogas_selecionadas || [];
													if (current.includes(d)) {
														respostas.drogas_selecionadas = current.filter((x: string) => x !== d);
													} else {
														respostas.drogas_selecionadas = [...current, d];
													}
												}}>{d}</button
											>
										{/each}
									</div>
								</div>

								{#if (respostas.drogas_selecionadas || []).length > 0}
									<div
										class="space-y-4 pt-2 border-t border-surface-100 dark:border-surface-800 transition-all"
									>
										<span
											class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block"
											>{q.subtexto_detalhe || 'Indique o Peso Aproximado e a Unidade:'}</span
										>
										{#each respostas.drogas_selecionadas as d (d)}
											<div
												class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 md:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm animate-in slide-in-from-left-2 duration-300"
											>
												<span
													class="text-xs font-black w-auto sm:w-24 text-surface-600 dark:text-surface-400 uppercase tracking-tight shrink-0"
													>{d}:</span
												>

												<div class="flex items-center gap-2 sm:gap-3 w-full sm:flex-1 min-w-0">
													<div class="relative w-full min-w-0 sm:flex-1 sm:max-w-[150px]">
														<input
															type="number"
															step="0.001"
															placeholder="0.000"
															class="w-full pl-4 pr-4 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
															bind:value={respostas.drogas_detalhe[d]}
														/>
													</div>

													<div
														class="flex p-1 bg-surface-100 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700"
													>
														{#each ['g', 'kg'] as u (u)}
															<button
																type="button"
																class="px-3 py-1.5 rounded-lg text-[0.6rem] font-black uppercase transition-all {(respostas.drogas_unidade &&
																	respostas.drogas_unidade[d] === u) ||
																(!respostas.drogas_unidade?.[d] && u === 'g')
																	? 'bg-white dark:bg-surface-700 text-primary-600 shadow-sm'
																	: 'text-surface-400 hover:text-surface-600'}"
																onclick={() =>
																	((respostas.drogas_unidade = respostas.drogas_unidade || {})[d] =
																		u)}
															>
																{u}
															</button>
														{/each}
													</div>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else if q.tipo === 'armas_complex'}
					<div class="space-y-4">
						{@render botoesSimNao(q)}

						{#if respostas[q.key] === 'Sim'}
							<div
								class="p-3 sm:p-4 md:p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500"
							>
								<div class="space-y-3">
									<span
										class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block"
										>{q.subtexto_tipo || 'Tipos de Armas/Munições:'}</span
									>
									<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
										{#each ['Revolver', 'Pistola', 'Arma Longa', 'Arma Branca', 'Munição', 'Outros'] as a (a)}
											<button
												type="button"
												class="px-3 py-2 rounded-xl text-[0.6rem] font-black uppercase border-2 transition-all {(
													respostas.armas_selecionadas || []
												).includes(a)
													? 'bg-primary-500 text-white border-primary-500 shadow-md'
													: 'bg-white dark:bg-surface-900 text-surface-500 border-surface-100 dark:border-surface-800 hover:border-primary-500/50'}"
												onclick={() => {
													const current = respostas.armas_selecionadas || [];
													if (current.includes(a)) {
														respostas.armas_selecionadas = current.filter((x: string) => x !== a);
													} else {
														respostas.armas_selecionadas = [...current, a];
														if (!respostas.armas_detalhe) respostas.armas_detalhe = {};
														if (!respostas.armas_detalhe[a]) respostas.armas_detalhe[a] = 1;
													}
												}}>{a}</button
											>
										{/each}
									</div>
								</div>

								{#if (respostas.armas_selecionadas || []).length > 0}
									<div
										class="space-y-4 pt-2 border-t border-surface-100 dark:border-surface-800 transition-all"
									>
										<span
											class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block"
											>{q.subtexto_detalhe || 'Indique a Quantidade:'}</span
										>
										{#each respostas.armas_selecionadas as a (a)}
											<div
												class="flex items-center flex-wrap gap-2 sm:gap-3 p-3 md:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm animate-in slide-in-from-left-2 duration-300"
											>
												<span
													class="text-xs font-black w-auto min-w-[4.5rem] text-surface-600 dark:text-surface-400 uppercase tracking-tight shrink-0"
													>{a}:</span
												>

												<select
													class="flex-1 min-w-0 sm:flex-none sm:w-32 px-3 sm:px-4 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold focus:ring-2 focus:ring-primary-500 transition-all"
													bind:value={respostas.armas_detalhe[a]}
												>
													{#each Array(100) as _, i (i)}
														<option value={i}>{i}</option>
													{/each}
												</select>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<input
						id="q-{q.id}"
						type="text"
						placeholder="Digite aqui..."
						class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-medium focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}
					/>
				{/if}
			</div>

			<!-- RECURSIVIDADE PARA FILHOS -->
			{#if (q.tipo === 'sim_nao' || q.tipo === 'mandados_maiores' || q.tipo === 'prisoes_maiores' || q.tipo === 'apreensoes_menores' || q.tipo === 'celulares_complex' || q.tipo === 'analise_complex' || q.tipo === 'relatorios_seint_complex' || q.tipo === 'foragidos_complex' || q.tipo === 'operacoes_seint_complex' || q.tipo === 'operacoes_seint_pura' || q.tipo === 'drogas_complex' || q.tipo === 'armas_complex') && (respostas[q.key] === 'Sim' || q.tipo === 'operacoes_seint_pura') && q.filhos && q.filhos.length > 0}
				<div class="mt-6 space-y-6 pt-6 border-l-4 border-primary-500/20">
					{#each q.filhos as filho (filho.id)}
						{@render renderCampo(filho, level + 1)}
					{/each}
				</div>
			{/if}
		</div>
	{/snippet}

	{#each modelo as q (q.id)}
		{@render renderCampo(q)}
	{/each}
</div>

<style>
	.nested-card {
		margin-left: 0;
	}
	@media (min-width: 640px) {
		.nested-card {
			margin-left: calc(var(--level, 0) * 0.5rem);
		}
	}
	@media (min-width: 768px) {
		.nested-card {
			margin-left: calc(var(--level, 0) * 0.75rem);
		}
	}
</style>
